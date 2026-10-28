import type { World, WorldListener } from '../world/world';
import { BlockRegistry } from '../world/blocks/registry';
import { CURRENT_BLOCK_IDS } from '../gameplay/current/types';
import { BlockCollision } from './physics';
import type { Vec3 } from './ecs/model';
import { registerEntityModel, cubeFaceRects } from './ecs/model';
import { BodyC, EntityKindC, RenderableC, TransformC } from './ecs/components';
import { defineComponent, type EntityWorld } from './ecs/world';
import { buildModel } from './mobs/kit';
import { genBlastCharge } from '../render/textures/explosions';
import { PRNG, deriveSeed } from '../engine/rng';
import { explosionSteps, setExplosionEffects } from '../gameplay/explosions';
import { blastExposure, type BlastScene } from '../gameplay/blast';
import type { BreakParticles } from '../render/particles';

export const CHARGE_FUSE = 80;
export const CHARGE_POWER = 4;
export const PrimedChargeC = defineComponent<{ fuse: number; vel: Vec3 }>('primedCharge');
const MODEL = 'primed_blast_charge';
for (const flash of [false, true]) {
  const model = buildModel({
    id: MODEL + (flash ? '_flash' : ''),
    textureSize: [64, 64],
    parts: [
      { name: 'charge', pivot: [0, 0, 0], cubes: [{ from: [-8, 0, -8], size: [16, 16, 16] }] },
    ],
  });
  registerEntityModel(model, (seed) => {
    const data = new Uint8Array(64 * 64 * 4);
    for (const [face, rect] of Object.entries(cubeFaceRects(model.parts[0]!.cubes[0]!))) {
      const tile = genBlastCharge(seed, face === 'top' || face === 'bottom');
      for (let y = 0; y < rect[3]; y++)
        for (let x = 0; x < rect[2]; x++) {
          const target = ((rect[1] + y) * 64 + rect[0] + x) * 4;
          for (let c = 0; c < 4; c++) data[target + c] = flash ? 255 : tile[(y * 16 + x) * 4 + c]!;
        }
    }
    return data;
  });
}

/** World-local event-driven priming; the ECS physics system exists only while charges are active. */
export class BlastCharges {
  private readonly rng: PRNG;
  private readonly collision: BlockCollision;
  private readonly active = new Set<number>();
  private installed = false;
  private frameStart = 0;
  private frameLimited = false;
  private readonly pending: Generator<void | 'commit' | 'lighting'>[] = [];
  private readonly lighting: Generator<void | 'commit' | 'lighting'>[] = [];
  private readonly listener: WorldListener;
  detonations = 0;
  lastDetonationTick = 0;
  maxExplosionMs = 0;
  constructor(
    readonly world: World,
    readonly ecs: EntityWorld,
    private readonly scene: BlastScene,
    private readonly particles: BreakParticles,
    private readonly feedback: (center: Readonly<Vec3>, power: number) => void,
  ) {
    this.rng = new PRNG(deriveSeed(world.worldSeed, 'blast-charges'));
    this.collision = new BlockCollision(world);
    this.listener = {
      blockEdited: (x, y, z, state) => {
        if (state === 0) return;
        const id = BlockRegistry.getInstance().getResolvedState(state)!.blockId;
        if (
          id === 'blast_charge' ||
          id === 'fire' ||
          CURRENT_BLOCK_IDS.has(id) ||
          world.current.hasComponents
        )
          this.changed(x, y, z);
      },
    };
    world.listeners.add(this.listener);
    setExplosionEffects(world, {
      prime: (x, y, z, fuse) => this.spawn(x + 0.5, y, z + 0.5, fuse),
      push: (center, power) => this.push(center, power),
      burst: (center, power) => {
        this.particles.explosion(center, () => this.rng.next());
        this.feedback(center, power);
      },
    });
  }
  /** Catch-up ticks share one work allowance; manual fixed-tick advancement remains independent. */
  beginFrame(): void {
    if (!this.installed) return;
    this.frameStart = performance.now();
    this.frameLimited = true;
  }
  endFrame(): void {
    this.frameLimited = false;
  }
  get pendingWork(): number {
    return this.pending.length + this.lighting.length;
  }
  dispose(): void {
    this.world.listeners.delete(this.listener);
    this.ecs.removeSystem(this.tick);
    setExplosionEffects(this.world, null);
    this.active.clear();
    for (const job of [...this.pending, ...this.lighting]) job.return(undefined);
    this.lighting.length = 0;
    this.pending.length = 0;
  }
  prime(x: number, y: number, z: number): number | null {
    if (this.world.getBlock(x, y, z).id !== 'blast_charge') return null;
    this.world.setBlockStateId(x, y, z, 0);
    return this.spawn(x + 0.5, y, z + 0.5, CHARGE_FUSE);
  }
  private spawn(x: number, y: number, z: number, fuse: number): number {
    const id = this.ecs.create();
    this.ecs.add(id, EntityKindC, { type: 'primed_blast_charge' });
    this.ecs.add(id, TransformC, { pos: [x, y, z], previous: [x, y, z], yaw: 0, previousYaw: 0 });
    this.ecs.add(id, BodyC, { width: 0.98, height: 0.98 });
    this.ecs.add(id, RenderableC, { model: MODEL, scale: 0.98 });
    this.ecs.add(id, PrimedChargeC, {
      fuse,
      vel: [(this.rng.next() - 0.5) * 0.04, 0.12, (this.rng.next() - 0.5) * 0.04],
    });
    this.active.add(id);
    if (!this.installed) {
      this.installed = true;
      this.ecs.addSystem(this.tick, -50);
    }
    return id;
  }
  private changed(x: number, y: number, z: number): void {
    // Signals can reach through one strongly powered conductor. No scanning on idle ticks.
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -2; dy <= 2; dy++)
        for (let dz = -2; dz <= 2; dz++) {
          if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 2) continue;
          const bx = x + dx,
            by = y + dy,
            bz = z + dz;
          if (this.world.getBlock(bx, by, bz).id !== 'blast_charge') continue;
          const fire = [
            [1, 0, 0],
            [-1, 0, 0],
            [0, 1, 0],
            [0, -1, 0],
            [0, 0, 1],
            [0, 0, -1],
          ].some(([a, b, c]) => this.world.getBlock(bx + a!, by + b!, bz + c!).id === 'fire');
          if (fire || this.world.current.getWeakPower(bx, by, bz) > 0) this.prime(bx, by, bz);
        }
  }
  private push(center: Readonly<Vec3>, power: number): void {
    for (const id of this.active) {
      const t = this.ecs.get(id, TransformC),
        charge = this.ecs.get(id, PrimedChargeC);
      if (!t || !charge) continue;
      const delta: Vec3 = [t.pos[0] - center[0], t.pos[1] + 0.49 - center[1], t.pos[2] - center[2]];
      const distance = Math.hypot(...delta);
      if (distance >= power * 2) continue;
      const exposure = blastExposure(this.world, center, t.pos, 0.98, 0.98);
      for (let a = 0; a < 3; a++)
        charge.vel[a]! +=
          (delta[a]! / Math.max(0.01, distance)) * (1 - distance / (power * 2)) * exposure;
    }
  }
  private readonly tick = (): void => {
    let exploded = false;
    const moving = this.world.current.mechanics.movingBlocks();
    for (const id of this.active) {
      const charge = this.ecs.get(id, PrimedChargeC),
        t = this.ecs.get(id, TransformC);
      if (!charge || !t) {
        this.active.delete(id);
        continue;
      }
      charge.fuse--;
      // Swept piston cells displace a primed charge before ordinary terrain collision.
      for (const block of moving) {
        const elapsed = this.world.ticks.time - block.start;
        if (elapsed < 0 || elapsed >= block.duration) continue;
        if (
          Math.abs(t.pos[0] - (block.x + 0.5)) < 0.99 &&
          Math.abs(t.pos[2] - (block.z + 0.5)) < 0.99 &&
          t.pos[1] < block.y + 1 &&
          t.pos[1] + 0.98 > block.y
        ) {
          for (let a = 0; a < 3; a++) {
            if (block.move[a]) {
              const base = a === 0 ? block.x : a === 1 ? block.y : block.z;
              const half = a === 1 ? 0 : 0.49;
              t.pos[a] =
                block.move[a]! > 0
                  ? Math.max(t.pos[a]!, base + 1 + half)
                  : Math.min(t.pos[a]!, base - (a === 1 ? 0.98 : half));
            }
            charge.vel[a]! += block.move[a]! * 0.1;
          }
        }
      }
      charge.vel[1] -= 0.04;
      for (const axis of [1, 0, 2]) {
        const move = this.collision.sweep(t.pos, 0.98, axis, charge.vel[axis]!, 0.49);
        t.pos[axis]! += move;
        if (move !== charge.vel[axis]) charge.vel[axis] = 0;
        else charge.vel[axis]! *= 0.98;
      }
      this.ecs.get(id, RenderableC)!.model =
        MODEL + (Math.floor(charge.fuse / 4) % 2 === 0 ? '_flash' : '');
      // At most one terrain/light transaction per simulation tick; overdue fuses wait in order.
      if (charge.fuse <= 0 && !exploded) {
        exploded = true;
        const center: Vec3 = [t.pos[0], t.pos[1] + 0.49, t.pos[2]];
        this.active.delete(id);
        this.ecs.destroy(id);
        this.pending.push(
          explosionSteps({ ...this.scene, world: this.world }, center, CHARGE_POWER, () => {
            this.detonations++;
            this.lastDetonationTick = this.ecs.time;
          }),
        );
      }
    }
    const physical = this.pending.length > 0;
    const jobs = physical ? this.pending : this.lighting;
    const job = jobs[0];
    if (job && (!this.frameLimited || performance.now() - this.frameStart < 32)) {
      const start = performance.now();
      let done: boolean;
      do {
        const result = job.next();
        done = Boolean(result.done);
        if (result.value === 'lighting' && physical) {
          this.pending.shift();
          this.lighting.push(job);
          break;
        }
        if (result.value === 'commit') break;
      } while (
        !done &&
        performance.now() - start < 6 &&
        (!this.frameLimited || performance.now() - this.frameStart < 32)
      );
      const work = performance.now() - start;
      this.maxExplosionMs = Math.max(this.maxExplosionMs, work);
      if (done) {
        jobs.shift();
      }
    }
    if (this.active.size === 0 && this.pendingWork === 0) {
      this.ecs.removeSystem(this.tick);
      this.installed = false;
    }
  };
}
