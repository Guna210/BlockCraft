import { describe, it, expect, beforeEach } from 'vitest';
import { createDefaultPipeline } from '../../src/gen/pipeline';
import { findSpawnPoint } from '../../src/world/spawn';
import { World } from '../../src/world/world';
import { hashString } from '../../src/engine/rng';
import { BlockRegistry } from '../../src/world/blocks/registry';

// M03b-fix3 — land spawn: nearest generated column whose top block is above sea level and not a fluid.

function topOf(world: World, x: number, z: number): { y: number; id: string } {
  for (let y = 319; y >= 0; y--) {
    const id = world.getBlock(x, y, z).id;
    if (id !== 'air') return { y, id };
  }
  return { y: -1, id: 'air' };
}

function isLand(world: World, x: number, z: number): boolean {
  const t = topOf(world, x, z);
  return t.y > 64 && t.id !== 'water' && t.id !== 'lava';
}

function buildColumn(
  world: World,
  stone: number,
  water: number,
  stoneTop: (x: number, z: number) => number,
  waterTop: number,
): void {
  const col = world.getColumn(0, 0, true)!;
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      const top = stoneTop(x, z);
      for (let y = 0; y <= top; y++) col.setBlockStateId(x, y, z, stone);
      for (let y = top + 1; y <= waterTop; y++) col.setBlockStateId(x, y, z, water);
    }
  }
}

describe('M03b-fix3 — findSpawnPoint', () => {
  beforeEach(() => {
    BlockRegistry.resetInstance();
    BlockRegistry.getInstance();
  });

  for (const seed of ['blockcraft-test-seed-42', 'origin-probe-seed-0', 'origin-probe-seed-5']) {
    it(`spawns on the nearest dry land column of a generated radius-4 world (${seed})`, () => {
      const worldSeed = hashString(seed);
      const pipeline = createDefaultPipeline();
      const world = new World(false);
      for (let cx = -4; cx <= 4; cx++) {
        for (let cz = -4; cz <= 4; cz++) {
          pipeline.generateColumn(worldSeed, cx, cz, world.getColumn(cx, cz, true)!);
        }
      }

      const spawn = findSpawnPoint(world, 4)!;
      expect(spawn).not.toBeNull();
      expect(spawn.fallback).toBe(false);

      const top = topOf(world, spawn.x, spawn.z);
      expect(top.y).toBe(spawn.topY);
      expect(top.y).toBeGreaterThan(64);
      expect(top.id).not.toBe('water');
      expect(top.id).not.toBe('lava');
      expect(spawn.position).toEqual([spawn.x + 0.5, spawn.topY + 1.82, spawn.z + 0.5]);

      // Brute force: no qualifying column in a smaller ring, none closer in the same ring.
      const ring = Math.max(Math.abs(spawn.x), Math.abs(spawn.z));
      const d2 = spawn.x * spawn.x + spawn.z * spawn.z;
      for (let z = -64; z <= 79; z++) {
        for (let x = -64; x <= 79; x++) {
          const r = Math.max(Math.abs(x), Math.abs(z));
          if (r > ring) continue;
          if (!isLand(world, x, z)) continue;
          expect(r, `land column (${x}, ${z}) is in a smaller ring`).toBe(ring);
          expect(x * x + z * z, `land column (${x}, ${z}) is closer`).toBeGreaterThanOrEqual(d2);
        }
      }

      // Deterministic
      expect(findSpawnPoint(world, 4)).toEqual(spawn);
    }, 60_000);
  }

  it('uses the origin column when it is dry land', () => {
    const registry = BlockRegistry.getInstance();
    const world = new World(false);
    buildColumn(
      world,
      registry.getDefaultStateId('stone')!,
      registry.getDefaultStateId('water')!,
      () => 70,
      70,
    );
    const spawn = findSpawnPoint(world, 0)!;
    expect(spawn.fallback).toBe(false);
    expect(spawn.position).toEqual([0.5, 71.82, 0.5]);
  });

  it('skips fluid-topped columns and columns at or below sea level', () => {
    const registry = BlockRegistry.getInstance();
    const world = new World(false);
    // Origin: stone 66 under water 68 (fluid on top). (3, 0): stone at exactly sea level.
    // (2, 5): stone 66 with air above, the nearest valid column.
    buildColumn(
      world,
      registry.getDefaultStateId('stone')!,
      registry.getDefaultStateId('water')!,
      (x, z) => (x === 3 && z === 0 ? 64 : x === 2 && z === 5 ? 66 : 60),
      68,
    );
    const col = world.getColumn(0, 0, false)!;
    for (let y = 61; y <= 68; y++) col.setBlockStateId(2, y, 5, 0);
    for (let y = 0; y <= 66; y++) {
      col.setBlockStateId(2, y, 5, registry.getDefaultStateId('stone')!);
    }
    const spawn = findSpawnPoint(world, 0)!;
    expect(spawn.fallback).toBe(false);
    expect([spawn.x, spawn.z, spawn.topY]).toEqual([2, 5, 66]);
  });

  it('falls back to the highest column when no column is dry land above sea level', () => {
    const registry = BlockRegistry.getInstance();
    const world = new World(false);
    // Ocean: water to 63 everywhere, one stone column topped at exactly y 64 (not above sea level).
    buildColumn(
      world,
      registry.getDefaultStateId('stone')!,
      registry.getDefaultStateId('water')!,
      (x, z) => (x === 5 && z === 7 ? 64 : 50),
      63,
    );
    const spawn = findSpawnPoint(world, 0)!;
    expect(spawn.fallback).toBe(true);
    expect([spawn.x, spawn.z, spawn.topY]).toEqual([5, 7, 64]);
    expect(spawn.position).toEqual([5.5, 65.82, 7.5]);
  });
});
