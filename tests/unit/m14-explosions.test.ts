import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { World } from '../../src/world/world';
import { ItemEntityManager } from '../../src/entity/item-entity';
import { WeatherHeightmap } from '../../src/world/weather';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { PRNG } from '../../src/engine/rng';
import { explosionBlocks, explode, explosionSteps } from '../../src/gameplay/explosions';
import { blast, blastExposure } from '../../src/gameplay/blast';
import { BlastCharges, PrimedChargeC } from '../../src/entity/blast-charge';
import { createEntityWorld } from '../../src/entity/ecs/systems';
import { TransformC, RenderableC } from '../../src/entity/ecs/components';
import { BreakParticles } from '../../src/render/particles';
import { genBlastCharge, BLAST_PALETTE } from '../../src/render/textures/explosions';
import { match, maxCrafts } from '../../src/gameplay/crafting';
import { buildIconSheet } from '../../src/ui/icons';

const registry = BlockRegistry.getInstance();
function blocks(world: World, power = 4, seed = 42) {
  const rng = new PRNG(seed);
  return explosionBlocks(world, [8.5, 40.5, 8.5], power, () => rng.next());
}
function runtime() {
  const world = new World(false),
    ecs = createEntityWorld(),
    particles = new BreakParticles(world);
  const scene = { world, ecs, player: () => null };
  const feedback = vi.fn();
  const charges = new BlastCharges(world, ecs, scene, particles, feedback);
  return { world, ecs, particles, scene, charges, feedback };
}
describe('M14 explosions', () => {
  it('crafts Blast Charge from the registered recipe when Spore Powder is supplied', () => {
    const grid = [
      [null, { id: 'copper_ingot', count: 2 }, null],
      [
        { id: 'spore_powder', count: 2 },
        { id: 'sand', count: 2 },
        { id: 'spore_powder', count: 2 },
      ],
      [null, { id: 'spore_powder', count: 2 }, null],
    ];
    expect(match(grid)?.result).toEqual({ id: 'blast_charge', count: 1 });
    expect(maxCrafts(grid)).toBe(2);
    grid[2]![1] = null;
    expect(match(grid)).toBeNull();
    expect(maxCrafts(grid)).toBe(0);
  });
  it('power 4 removes 20–60 blocks of solid stone across deterministic seeds', () => {
    const world = new World(false);
    world.fill(0, 30, 0, 15, 50, 15, 'stone');
    for (let seed = 1; seed <= 20; seed++) {
      const removed = blocks(world, 4, seed);
      console.log('M14 stone removed', seed, removed.length);
      expect(removed.length).toBeGreaterThanOrEqual(20);
      expect(removed.length).toBeLessThanOrEqual(60);
      expect(new Set(removed.map((b) => `${b.x},${b.y},${b.z}`)).size).toBe(removed.length);
    }
  });
  it('never removes Blackglass or Foundation Stone, even at maximum supported power', () => {
    const world = new World(false);
    world.fill(0, 30, 0, 15, 50, 15, 'blackglass');
    expect(blocks(world, 8)).toEqual([]);
    world.fill(0, 30, 0, 15, 50, 15, 'foundation_stone');
    expect(blocks(world, 8)).toEqual([]);
    expect(() => blocks(world, Infinity)).toThrow();
  });
  it('samples full, partial and zero exposure through real block shapes', () => {
    const world = new World(false);
    const center = [0.5, 40.9, 0.5] as const,
      target = [6.5, 40, 0.5] as const;
    expect(blastExposure(world, center, target, 0.6, 1.8)).toBe(1);
    world.fill(2, 39, -3, 4, 43, 3, 'blackglass');
    expect(blastExposure(world, center, target, 0.6, 1.8)).toBe(0);
    world.fill(2, 41, -3, 4, 43, 3, 'air');
    const partial = blastExposure(world, center, target, 0.6, 1.8);
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(1);
  });
  it('does no exposure traversal for a target outside the finite damage radius', () => {
    const world = new World(false),
      ecs = createEntityWorld(),
      hurt = vi.fn();
    const read = vi.spyOn(world, 'getBlockStateId');
    const player = { pos: [1e9, 40, 0] as [number, number, number], height: 1.8, hurt };
    expect(blast({ world, ecs, player: () => player }, [0, 40, 0], 4)).toBe(0);
    expect(read).not.toHaveBeenCalled();
    expect(hurt).not.toHaveBeenCalled();
  });
  it('commits all removals before observers run and runs light exactly once', () => {
    const world = new World();
    world.fill(7, 40, 7, 9, 42, 9, 'stone');
    const edit = vi.spyOn(world.lightEngine, 'onBlocksRemoved');
    const single = vi.spyOn(world.lightEngine, 'onBlockChanged');
    const removed = [
      { x: 8, y: 42, z: 8, state: registry.getDefaultStateId('stone')! },
      { x: 8, y: 41, z: 8, state: registry.getDefaultStateId('stone')! },
    ];
    const observed = vi.fn(() => {
      for (const b of removed) expect(world.getBlockStateId(b.x, b.y, b.z)).toBe(0);
    });
    world.listeners.add({ blocksRemoved: observed });
    world.removeBlocks(removed);
    expect(edit).toHaveBeenCalledTimes(1);
    expect(single).not.toHaveBeenCalled();
    expect(observed).toHaveBeenCalledTimes(1);
    expect(world.getLight(8, 41, 8).sky).toBe(15);
    expect(world.modifiedColumns.size).toBe(1);
  });
  it('keeps an ordinary light edit intact between explosion light slices and publishes one batch', () => {
    const world = new World();
    world.fill(7, 40, 7, 9, 42, 9, 'stone');
    const state = registry.getDefaultStateId('stone')!;
    const removed = [
      { x: 8, y: 42, z: 8, state },
      { x: 8, y: 41, z: 8, state },
    ];
    const notified = vi.fn();
    world.listeners.add({ blocksRemoved: notified });
    const steps = world.removeBlocksSteps(removed);
    expect(steps.next().done).toBe(false);
    expect(notified).not.toHaveBeenCalled();
    world.setBlock(10, 43, 10, 'torch');
    while (!steps.next().done) {
      /* Finish the same transaction after an intervening edit. */
    }
    expect(world.getLight(8, 41, 8).sky).toBe(15);
    expect(world.getLight(10, 43, 10).block).toBe(14);
    expect(world.getLight(11, 43, 10).block).toBe(13);
    expect(notified).toHaveBeenCalledTimes(1);
  });
  it('gives overlapping explosion transactions independent light queues', () => {
    const world = new World();
    world.fill(7, 40, 7, 10, 42, 9, 'stone');
    const state = registry.getDefaultStateId('stone')!;
    const first = world.removeBlocksSteps([
      { x: 8, y: 42, z: 8, state },
      { x: 8, y: 41, z: 8, state },
    ]);
    const second = world.removeBlocksSteps([
      { x: 9, y: 42, z: 8, state },
      { x: 9, y: 41, z: 8, state },
    ]);
    expect(first.next().done).toBe(false);
    expect(first.next().done).toBe(false);
    expect(second.next().done).toBe(false);
    expect(second.next().done).toBe(false);
    while (!first.next().done) {
      /* A second blast must not reset this transaction's cursors. */
    }
    while (!second.next().done) {
      /* Finish the other independent transaction. */
    }
    expect(world.getLight(8, 41, 8).sky).toBe(15);
    expect(world.getLight(9, 41, 8).sky).toBe(15);
  });
  it('updates weather surface heights once per x/z from the previous surface after a batch', () => {
    const world = new World(false),
      heights = new WeatherHeightmap();
    world.fill(0, 60, 0, 15, 64, 15, 'stone');
    heights.updateColumn(world, 0, 0);
    const previousVersion = heights.version;
    const removed = [64, 63, 62].map((y) => ({
      x: 8,
      y,
      z: 8,
      state: registry.getDefaultStateId('stone')!,
    }));
    world.removeBlocks(removed);
    const scan = vi.spyOn(world, 'getHeight');
    heights.blocksRemoved(world, removed);
    expect(heights.getTopSolidY(world, 8, 8)).toBe(61);
    expect(heights.getTopSolidY(world, 9, 8)).toBe(64);
    expect(heights.version).toBe(previousVersion + 1);
    expect(scan).not.toHaveBeenCalled();
  });
  it('primes from adjacent fire and a Current signal with an 80-tick fuse; dormant runtime installs no tick system', () => {
    const { world, ecs, charges } = runtime();
    const install = vi.spyOn(ecs, 'addSystem');
    world.setBlock(8, 40, 8, 'blast_charge');
    ecs.tick();
    expect(install).not.toHaveBeenCalled();
    world.setBlock(9, 40, 8, 'fire');
    const id = ecs.query(PrimedChargeC)[0]!;
    expect(ecs.get(id, PrimedChargeC)!.fuse).toBe(80);
    expect(world.getBlock(8, 40, 8).id).toBe('air');
    world.setBlock(1, 40, 1, 'blast_charge');
    world.setBlock(2, 40, 1, 'lever', { face: 'floor', powered: 'true' });
    expect(ecs.query(PrimedChargeC)).toHaveLength(2);
    for (let i = 0; i < 8; i++) {
      world.tick();
      ecs.tick();
    }
    expect(ecs.get(id, RenderableC)!.model).toContain('_flash');
    charges.dispose();
  });
  it('falls, flashes, chains with short fuses, bounds detonation work and removes its idle system', () => {
    const { world, ecs, charges, scene } = runtime();
    world.fill(0, 38, 0, 15, 38, 15, 'blackglass');
    world.setBlock(8, 40, 8, 'blast_charge');
    explode(scene, [8.5, 40.5, 8.5], 4);
    const id = ecs.query(PrimedChargeC)[0]!;
    expect(ecs.get(id, PrimedChargeC)!.fuse).toBeGreaterThanOrEqual(10);
    expect(ecs.get(id, PrimedChargeC)!.fuse).toBeLessThanOrEqual(30);
    for (let i = 0; i < 8; i++) {
      world.tick();
      ecs.tick();
    }
    expect(ecs.get(id, TransformC)!.pos[1]).toBeLessThan(41);
    const remove = vi.spyOn(ecs, 'removeSystem');
    for (let i = 0; i < 40; i++) {
      world.tick();
      ecs.tick();
    }
    expect(ecs.query(PrimedChargeC)).toHaveLength(0);
    expect(charges.detonations).toBe(1);
    expect(remove).toHaveBeenCalled();
    charges.dispose();
  });
  it('a piston pushes a primed entity clear of its head and an explosion pushes it away', () => {
    const { world, ecs, charges, scene } = runtime();
    const worldKeys = Object.keys(world);
    world.fill(0, 38, 0, 15, 38, 15, 'blackglass');
    world.setBlock(2, 39, 2, 'blast_charge');
    const id = charges.prime(2, 39, 2)!;
    const t = ecs.get(id, TransformC)!;
    t.pos[1] = 39;
    world.setBlock(1, 39, 2, 'piston', { facing: 'east', extended: 'false' });
    world.setBlock(1, 39, 3, 'lever', { face: 'floor', powered: 'true' });
    world.tick();
    ecs.tick();
    expect(t.pos[0]).toBeGreaterThanOrEqual(3.49);
    const before = ecs.get(id, PrimedChargeC)!.vel[2];
    explode(scene, [t.pos[0], t.pos[1] + 0.49, t.pos[2] - 2], 4);
    expect(ecs.get(id, PrimedChargeC)!.vel[2]).toBeGreaterThan(before);
    expect(Object.keys(world)).toEqual(worldKeys);
    charges.dispose();
  });
  it('revalidates a charge primed while rays are being traced instead of duplicating it', () => {
    const { world, ecs, charges, scene } = runtime();
    world.setBlock(8, 40, 8, 'blast_charge');
    const steps = explosionSteps(scene, [8.5, 40.5, 8.5], 4);
    for (let i = 0; i < 10; i++) steps.next();
    const id = charges.prime(8, 40, 8);
    while (!steps.next().done) {
      /* Drain the bounded ray slices. */
    }
    expect(ecs.query(PrimedChargeC)).toEqual([id]);
    charges.dispose();
  });
  it('keeps pooled loot objects in the same shape when plain and damaged drops reuse a slot', () => {
    const manager = new ItemEntityManager(new World(false));
    const keys = Object.keys(manager.pool[0]!);
    const first = manager.spawn('wooden_pickaxe', 1, 0, 40, 0, undefined, { damage: 2 })!;
    expect(Object.keys(first)).toEqual(keys);
    first.active = false;
    const second = manager.spawn('stone', 1, 0, 40, 0)!;
    expect(second).toBe(first);
    expect(second.damage).toBeUndefined();
    expect(second.affix).toBeUndefined();
    expect(Object.keys(second)).toEqual(keys);
  });
  it('uses the existing loot path at 1/power probability and never evicts debris with smoke', () => {
    const { world, scene, particles, charges } = runtime();
    world.fill(3, 35, 3, 13, 45, 13, 'oak_log');
    const drops = vi.fn();
    world.itemSpawner = drops;
    const removed = vi.spyOn(world, 'removeBlocksSteps');
    explode(scene, [8.5, 40.5, 8.5], 4);
    const count = removed.mock.calls[0]![0].length;
    expect(drops.mock.calls.length).toBeGreaterThan(count * 0.1);
    expect(drops.mock.calls.length).toBeLessThan(count * 0.4);
    expect(drops.mock.calls.every((call) => call[0] === 'oak_log')).toBe(true);
    for (let i = 0; i < 32; i++) particles.spawn(registry.getDefaultStateId('stone')!, 0, 40, 0);
    const before = particles.pool.map((p) => ({ ...p }));
    particles.explosion([0, 40, 0], () => 0.5);
    expect(particles.pool.map((p) => ({ ...p }))).toEqual(before);
    charges.dispose();
  });
  it('renders the two new tiles in three-by-three repeats for art review', () => {
    const png = new PNG({ width: 392, height: 192 });
    [false, true].forEach((top, n) => {
      const tile = genBlastCharge(42, top);
      for (let y = 0; y < 192; y++)
        for (let x = 0; x < 192; x++) {
          const from = ((Math.floor(y / 4) % 16) * 16 + (Math.floor(x / 4) % 16)) * 4;
          const to = (y * 392 + n * 200 + x) * 4;
          for (let c = 0; c < 4; c++) png.data[to + c] = tile[from + c]!;
        }
    });
    fs.mkdirSync('artifacts/M14', { recursive: true });
    fs.writeFileSync('artifacts/M14/m14-textures.png', PNG.sync.write(png));
    expect(png.width).toBe(392);
  });
  it('provides palette-only deterministic art and its generated inventory icon', () => {
    const a = genBlastCharge(42),
      b = genBlastCharge(42);
    expect(a).toEqual(b);
    const palette = new Set(BLAST_PALETTE.map((c) => c.join(',')));
    for (let i = 0; i < a.length; i += 4)
      expect(palette.has(Array.from(a.slice(i, i + 4)).join(','))).toBe(true);
    const missing: string[] = [];
    const sheet = buildIconSheet(
      (name) =>
        name.startsWith('blast_charge') ? genBlastCharge(42, name.endsWith('_top')) : undefined,
      genBlastCharge(42),
      (name) => missing.push(name),
    );
    expect(missing.filter((name) => name.startsWith('blast_charge'))).toEqual([]);
    expect(sheet.rects.has('blast_charge')).toBe(true);
  });
});
