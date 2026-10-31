import { PRNG, deriveSeed } from '../engine/rng';
import type { Vec3 } from '../entity/ecs/model';
import type { World, RemovedBlock } from '../world/world';
import { BlockRegistry } from '../world/blocks/registry';
import { playExplosion } from '../audio/explosion';
import { blast, type BlastScene } from './blast';
import { rollBlockLoot } from './loot';

/** The surface of a 16³ direction grid, precomputed once. */
const DIRECTIONS: Vec3[] = [];
for (let x = 0; x < 16; x++)
  for (let y = 0; y < 16; y++)
    for (let z = 0; z < 16; z++) {
      if (x !== 0 && x !== 15 && y !== 0 && y !== 15 && z !== 0 && z !== 15) continue;
      const dx = x / 7.5 - 1,
        dy = y / 7.5 - 1,
        dz = z / 7.5 - 1;
      const length = Math.hypot(dx, dy, dz);
      DIRECTIONS.push([dx / length, dy / length, dz / length]);
    }
export const MAX_EXPLOSION_POWER = 8;
/** Hard bounds on rays, steps, and edits make a single explosion finite even in empty space. */
export function explosionBlocks(
  world: Pick<World, 'getBlockStateId'>,
  center: Readonly<Vec3>,
  power: number,
  random: () => number,
): RemovedBlock[] {
  const steps = explosionBlockSteps(world, center, power, random);
  let result = steps.next();
  while (!result.done) result = steps.next();
  return result.value;
}
export function* explosionBlockSteps(
  world: Pick<World, 'getBlockStateId'>,
  center: Readonly<Vec3>,
  power: number,
  random: () => number,
): Generator<void, RemovedBlock[]> {
  if (
    !Number.isFinite(power) ||
    power <= 0 ||
    power > MAX_EXPLOSION_POWER ||
    !center.every(Number.isFinite)
  )
    throw new Error('Explosion needs a finite centre and power in (0, 8]');
  const registry = BlockRegistry.getInstance(),
    removed = new Map<number, RemovedBlock>();
  const samples = new Map<number, { state: number; resistance: number; fixed: boolean }>();
  const baseX = Math.floor(center[0]),
    baseY = Math.floor(center[1]),
    baseZ = Math.floor(center[2]);
  let rays = 0;
  for (const direction of DIRECTIONS) {
    if (++rays % 64 === 0) yield;
    let intensity = power * (0.7 + random() * 0.6);
    let x = center[0],
      y = center[1],
      z = center[2];
    let previousCell = -1;
    for (let step = 0; intensity > 0 && step < 48; step++) {
      const bx = Math.floor(x),
        by = Math.floor(y),
        bz = Math.floor(z);
      if (by < 0 || by > 319) break;
      const cell = (bx - baseX + 32) * 4096 + (by - baseY + 32) * 64 + (bz - baseZ + 32);
      if (cell !== previousCell) {
        previousCell = cell;
        let sample = samples.get(cell);
        if (!sample) {
          const state = world.getBlockStateId(bx, by, bz);
          const block = registry.getResolvedState(state)!;
          sample = {
            state,
            resistance: (block.definition.blastResistance + 0.3) * 0.22,
            fixed: block.blockId === 'blackglass' || block.blockId === 'foundation_stone',
          };
          samples.set(cell, sample);
        }
        if (sample.fixed) break;
        if (sample.state !== 0) intensity -= sample.resistance;
        if (intensity > 0 && sample.state !== 0 && !removed.has(cell))
          removed.set(cell, { x: bx, y: by, z: bz, state: sample.state });
      }
      x += direction[0] * 0.3;
      y += direction[1] * 0.3;
      z += direction[2] * 0.3;
      intensity -= 0.225;
    }
  }
  return [...removed.values()];
}
export interface ExplosionEffects {
  prime(x: number, y: number, z: number, fuse: number): void;
  burst(center: Readonly<Vec3>, power: number): void;
  push(center: Readonly<Vec3>, power: number): void;
}
const effects = new WeakMap<World, ExplosionEffects>();
export function setExplosionEffects(world: World, value: ExplosionEffects | null): void {
  if (value) effects.set(world, value);
  else effects.delete(world);
}
/** Exposure is evaluated against intact cover, before the atomic terrain edit. */
export function explode(
  scene: BlastScene & { world: World },
  center: Readonly<Vec3>,
  power: number,
  source?: number,
): number {
  const world = scene.world;
  const sequence = world.breakCount++;
  const rng = new PRNG(deriveSeed(world.worldSeed, `explosion:${sequence}`));
  const blocks = explosionBlocks(world, center, power, () => rng.next());
  return commitExplosion(scene, center, power, blocks, rng, source);
}
/** Fixed ray slices, then one atomic edit. No jobs run concurrently against mutable terrain. */
export function* explosionSteps(
  scene: BlastScene & { world: World },
  center: Readonly<Vec3>,
  power: number,
  onDetonate?: () => void,
): Generator<void | 'commit' | 'lighting'> {
  const rng = new PRNG(deriveSeed(scene.world.worldSeed, `explosion:${scene.world.breakCount++}`));
  const blocks = yield* explosionBlockSteps(scene.world, center, power, () => rng.next());
  yield 'commit';
  yield* commitExplosionSteps(scene, center, power, blocks, rng, undefined, onDetonate);
}
function commitExplosion(
  scene: BlastScene & { world: World },
  center: Readonly<Vec3>,
  power: number,
  blocks: RemovedBlock[],
  rng: PRNG,
  source?: number,
): number {
  const steps = commitExplosionSteps(scene, center, power, blocks, rng, source);
  let result = steps.next();
  while (!result.done) result = steps.next();
  return result.value;
}
function* commitExplosionSteps(
  scene: BlastScene & { world: World },
  center: Readonly<Vec3>,
  power: number,
  blocks: RemovedBlock[],
  rng: PRNG,
  source?: number,
  onDetonate?: () => void,
): Generator<void | 'lighting', number> {
  const world = scene.world;
  playExplosion(center, Math.max(1, power * 0.5));
  blocks = blocks.filter((b) => world.getBlockStateId(b.x, b.y, b.z) === b.state);
  const hurt = blast(scene, center, power, source),
    fx = effects.get(world);
  fx?.push(center, power);
  yield* world.removeBlocksSteps(blocks, () => {
    const registry = BlockRegistry.getInstance();
    for (const b of blocks) {
      const block = registry.getResolvedState(b.state)!.blockId;
      if (block === 'blast_charge') {
        fx?.prime(b.x, b.y, b.z, 10 + Math.floor(rng.next() * 21));
        continue;
      }
      if (rng.next() >= 1 / power) continue;
      for (const loot of rollBlockLoot(block, world.worldSeed, b.x, b.y, b.z, world.breakCount++))
        world.itemSpawner?.(loot.id, loot.count, b.x + 0.5, b.y + 0.5, b.z + 0.5, [0, 1, 0], 10);
    }
    fx?.burst(center, power);
    onDetonate?.();
  });
  return hurt;
}
