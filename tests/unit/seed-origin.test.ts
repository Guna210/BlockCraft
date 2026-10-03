import { describe, it, expect, beforeEach } from 'vitest';
import { createDefaultPipeline } from '../../src/gen/pipeline';
import { sampleTerrainClimate, TerrainClimateSample } from '../../src/gen/terrain';
import { sampleBiome } from '../../src/gen/biomes';
import { World } from '../../src/world/world';
import { hashString, deriveSeed } from '../../src/engine/rng';
import { BlockRegistry } from '../../src/world/blocks/registry';

// M03b-fix3: simplex noise is exactly 0 at the lattice point (0,0) for every seed and octave, so
// without a seed-derived offset the origin of every world has the same continentalness and the
// same biome.

const SEEDS: string[] = Array.from({ length: 24 }, (_, i) => `origin-probe-seed-${i}`);

function newSample(): TerrainClimateSample {
  return { continentalness: 0, erosion: 0, peaks: 0, river: 0, surfaceHeight: 0 };
}

function regionHash(seed: string, x1: number, z1: number, x2: number, z2: number): string {
  const worldSeed = hashString(seed);
  const pipeline = createDefaultPipeline();
  const world = new World(false);
  for (let cz = Math.floor(z1 / 16); cz <= Math.floor(z2 / 16); cz++) {
    for (let cx = Math.floor(x1 / 16); cx <= Math.floor(x2 / 16); cx++) {
      pipeline.generateColumn(worldSeed, cx, cz, world.getColumn(cx, cz, true)!);
    }
  }
  return world.worldHash(x1, z1, x2, z2);
}

describe('M03b-fix3 — seed-dependent origin', () => {
  beforeEach(() => {
    BlockRegistry.resetInstance();
    BlockRegistry.getInstance();
  });

  it('continentalness and biome at (0,0) differ between seeds', () => {
    const conts: number[] = [];
    const heights: number[] = [];
    const biomes: string[] = [];
    const sample = newSample();
    for (const seed of SEEDS) {
      const worldSeed = hashString(seed);
      sampleTerrainClimate(deriveSeed(worldSeed, 'terrain_shape'), 0, 0, sample);
      conts.push(sample.continentalness);
      heights.push(sample.surfaceHeight);
      biomes.push(sampleBiome(worldSeed, 0, 0));
    }

    // Not identical across seeds (on master every value is exactly 0 and every biome is "river").
    expect(new Set(conts).size).toBeGreaterThanOrEqual(20);
    expect(conts.some((c) => Math.abs(c) > 0.05)).toBe(true);
    expect(new Set(heights).size).toBeGreaterThan(1);
    expect(new Set(biomes).size).toBeGreaterThan(1);
    // No single biome owns the origin of most worlds.
    const counts = new Map<string, number>();
    for (const b of biomes) counts.set(b, (counts.get(b) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(12);
  });

  it('worldHash of (0,0)-(64,64) and of a 64x64 region at (2000,2000) differs between 4 seeds', () => {
    const seeds = SEEDS.slice(0, 4);
    const atOrigin = seeds.map((s) => regionHash(s, 0, 0, 64, 64));
    const far = seeds.map((s) => regionHash(s, 2000, 2000, 2063, 2063));
    expect(new Set(atOrigin).size).toBe(4);
    expect(new Set(far).size).toBe(4);
  }, 120_000);
});
