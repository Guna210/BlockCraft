import { describe, expect, it } from 'vitest';
import { World } from '../../src/world/world';
import { setWorldInstance } from '../../src/world/world-instance';
import { createDefaultPipeline } from '../../src/gen/pipeline';
import { hashString } from '../../src/engine/rng';
import { getBiome, getHeight } from '../../src/debug/api/world';
import { locate } from '../../src/debug/api/locate';

// M03g: the debug API takes block coordinates, and later tests will pass the player's position,
// which is fractional. getBiome, getHeight and locate('biome') must treat (x + f, z + f), 0 <= f < 1,
// as the block (x, z) that contains it, in negative coordinates as well.

// Camera positions of the seven fixed viewpoints of tests/e2e/m03.spec.ts (standard seed) and the
// biome expected at each.
const VIEWPOINTS: Array<{ name: string; camera: [number, number]; biome: string }> = [
  { name: 'plains', camera: [1120.5, -446.5], biome: 'plains' },
  { name: 'mountains', camera: [-600.5, -505.5], biome: 'frost_peaks' },
  { name: 'ocean', camera: [-282.5, -187.5], biome: 'ocean' },
  { name: 'desert', camera: [64.5, -229.5], biome: 'desert' },
  { name: 'snowy', camera: [16.5, 609.5], biome: 'snowy_tundra' },
  { name: 'cave', camera: [-69.5, -222.5], biome: 'savanna' },
  { name: 'border', camera: [-246.5, -204.5], biome: 'rainforest' },
];

describe('Fractional coordinates in getBiome, getHeight and locate (M03g)', () => {
  const seed = hashString('blockcraft-test-seed-42');
  const world = new World(false);
  world.worldSeed = seed;
  const pipeline = createDefaultPipeline();
  for (const v of VIEWPOINTS) {
    const cx = Math.floor(v.camera[0] / 16);
    const cz = Math.floor(v.camera[1] / 16);
    pipeline.generateColumn(seed, cx, cz, world.getColumn(cx, cz, true)!);
  }
  setWorldInstance(world);

  for (const v of VIEWPOINTS) {
    const x = Math.floor(v.camera[0]);
    const z = Math.floor(v.camera[1]);

    it(`${v.name}: getBiome and getHeight at (${x} + f, ${z} + f) equal those at (${x}, ${z})`, () => {
      expect(getBiome(x, z)).toBe(v.biome);
      const height = getHeight(x, z);
      expect(height).toBeGreaterThan(0);
      for (const f of [0.25, 0.5, 0.99]) {
        expect(getBiome(x + f, z + f), `getBiome f=${f}`).toBe(v.biome);
        expect(getHeight(x + f, z + f), `getHeight f=${f}`).toBe(height);
      }
      // the camera position itself
      expect(getBiome(v.camera[0], v.camera[1])).toBe(v.biome);
    });

    it(`${v.name}: locate('biome') from (${x} + 0.5, ${z} + 0.5) equals locate from (${x}, ${z})`, () => {
      expect(locate('biome', v.biome, [x + 0.5, 64, z + 0.5])).toEqual(
        locate('biome', v.biome, [x, 64, z]),
      );
    });
  }

  it('the viewpoints include negative x and z', () => {
    expect(VIEWPOINTS.some((v) => v.camera[0] < 0 && v.camera[1] < 0)).toBe(true);
  });
});
