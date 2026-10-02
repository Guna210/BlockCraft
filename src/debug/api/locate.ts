import { getWorldInstance } from '../../world/world-instance';
import { sampleBiome } from '../../gen/biomes';
import { sampleTerrainClimate } from '../../gen/terrain';
import { deriveSeed } from '../../engine/rng';

export type LocateKind = 'ore' | 'structure' | 'biome';

type LocatorFunction = (
  id: string,
  near: [number, number, number],
) => [number, number, number] | null;

const locators: Partial<Record<LocateKind, LocatorFunction>> = {};

function locateBiome(id: string, near: [number, number, number]): [number, number, number] | null {
  const worldSeed = getWorldInstance().worldSeed ?? 42;
  const terrainStageSeed = deriveSeed(worldSeed, 'terrain_shape');

  const startX = Math.round(near[0]);
  const startZ = Math.round(near[2]);

  // Spiral search outward with step <= 16 blocks up to max radius 6000
  const step = 16;
  const maxRadius = 6000;

  // Check origin first
  if (sampleBiome(worldSeed, startX, startZ) === id) {
    const climate = { continentalness: 0, erosion: 0, peaks: 0, river: 0, surfaceHeight: 0 };
    sampleTerrainClimate(terrainStageSeed, startX, startZ, climate);
    return [startX, climate.surfaceHeight + 1, startZ];
  }

  const climate = { continentalness: 0, erosion: 0, peaks: 0, river: 0, surfaceHeight: 0 };

  for (let r = step; r <= maxRadius; r += step) {
    // Check points along square perimeter at distance r
    for (let i = -r; i <= r; i += step) {
      // Top & Bottom edges
      for (const px of [startX + i, startX - i]) {
        for (const pz of [startZ + r, startZ - r]) {
          if (sampleBiome(worldSeed, px, pz) === id) {
            sampleTerrainClimate(terrainStageSeed, px, pz, climate);
            return [px, climate.surfaceHeight + 1, pz];
          }
        }
      }
      // Left & Right edges
      for (const pz of [startZ + i, startZ - i]) {
        for (const px of [startX + r, startX - r]) {
          if (sampleBiome(worldSeed, px, pz) === id) {
            sampleTerrainClimate(terrainStageSeed, px, pz, climate);
            return [px, climate.surfaceHeight + 1, pz];
          }
        }
      }
    }
  }

  return null;
}

registerLocator('biome', locateBiome);

export function registerLocator(kind: LocateKind, fn: LocatorFunction): void {
  locators[kind] = fn;
}

export function locate(
  kind: LocateKind,
  id: string,
  near: [number, number, number],
): [number, number, number] | null {
  const locator = locators[kind];
  if (!locator) {
    return null;
  }
  return locator(id, near);
}
