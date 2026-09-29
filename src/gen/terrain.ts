import { makeSimplex2D, makeSimplex3D, makeFbm2D, makeFbm3D, makeRidged2D } from './noise';
import { deriveSeed } from '../engine/rng';
import { BlockRegistry } from '../world/blocks/registry';
import { ChunkColumn } from '../world/column';
import { TerrainStage } from './pipeline';

export const SEA_LEVEL = 64;

interface CachedSamplers {
  fbmCont: (x: number, y: number) => number;
  fbmErosion: (x: number, y: number) => number;
  ridgedPeaks: (x: number, y: number) => number;
  ridgedRivers: (x: number, y: number) => number;
  fbm3D: (x: number, y: number, z: number) => number;
  s2Foundation: (x: number, y: number) => number;
}

let cachedStageSeed: number | null = null;
let cachedSamplers: CachedSamplers | null = null;

function getSamplersForSeed(stageSeed: number): CachedSamplers {
  if (cachedStageSeed === stageSeed && cachedSamplers) {
    return cachedSamplers;
  }

  const seedCont = deriveSeed(stageSeed, 'cont');
  const seedErosion = deriveSeed(stageSeed, 'erosion');
  const seedPeaks = deriveSeed(stageSeed, 'peaks');
  const seedRivers = deriveSeed(stageSeed, 'rivers');
  const seed3D = deriveSeed(stageSeed, 'density3d');
  const seedFoundation = deriveSeed(stageSeed, 'foundation');

  const s2Cont = makeSimplex2D(seedCont);
  const fbmCont = makeFbm2D(s2Cont, 4, 2.0, 0.5);

  const s2Erosion = makeSimplex2D(seedErosion);
  const fbmErosion = makeFbm2D(s2Erosion, 3, 2.0, 0.5);

  const s2Peaks = makeSimplex2D(seedPeaks);
  const ridgedPeaks = makeRidged2D(s2Peaks, 4, 2.0, 0.5);

  const s2Rivers = makeSimplex2D(seedRivers);
  const ridgedRivers = makeRidged2D(s2Rivers, 3, 2.0, 0.5);

  const s3Density = makeSimplex3D(seed3D);
  const fbm3D = makeFbm3D(s3Density, 3, 2.0, 0.5);

  const s2Foundation = makeSimplex2D(seedFoundation);

  cachedStageSeed = stageSeed;
  cachedSamplers = {
    fbmCont,
    fbmErosion,
    ridgedPeaks,
    ridgedRivers,
    fbm3D,
    s2Foundation,
  };
  return cachedSamplers;
}

// Spline function for Continentalness -> Base Height
function splineContinentalness(c: number): number {
  if (c < -0.45) {
    const t = (c + 1.0) / 0.55;
    return 32 + t * 16;
  } else if (c < -0.15) {
    const t = (c + 0.45) / 0.3;
    return 48 + t * 14;
  } else if (c < 0.2) {
    const t = (c + 0.15) / 0.35;
    return 65 + t * 13;
  } else if (c < 0.55) {
    const t = (c - 0.2) / 0.35;
    return 78 + t * 37;
  } else {
    const t = Math.min(1.0, (c - 0.55) / 0.45);
    return 115 + t * 55;
  }
}

// Spline function for Erosion -> Height Variation Factor
function splineErosion(e: number): number {
  if (e > 0.3) {
    return 0.3;
  } else if (e < -0.3) {
    return 1.8;
  } else {
    const t = (e + 0.3) / 0.6;
    return 1.8 - t * 1.5;
  }
}

// Scratch buffers allocated once per worker/thread environment
const HEIGHTS_SCRATCH = new Float32Array(256);

export function generateTerrainShape(
  stageSeed: number,
  cx: number,
  cz: number,
  column: ChunkColumn,
): void {
  const registry = BlockRegistry.getInstance();
  const stoneState = registry.getDefaultStateId('stone') ?? 1;
  const waterState = registry.getDefaultStateId('water') ?? 1;
  const foundationState = registry.getDefaultStateId('foundation_stone') ?? 1;

  const samplers = getSamplersForSeed(stageSeed);
  const { fbmCont, fbmErosion, ridgedPeaks, ridgedRivers, fbm3D, s2Foundation } = samplers;

  const baseWorldX = cx * 16;
  const baseWorldZ = cz * 16;

  // 1. Compute 2D heightmap
  for (let z = 0; z < 16; z++) {
    const wz = baseWorldZ + z;
    for (let x = 0; x < 16; x++) {
      const wx = baseWorldX + x;
      const idx = z * 16 + x;

      const cont = fbmCont(wx * 0.0012, wz * 0.0012);
      const erosion = fbmErosion(wx * 0.002, wz * 0.002);
      const peaks = ridgedPeaks(wx * 0.003, wz * 0.003);
      const riverNoise = ridgedRivers(wx * 0.0025, wz * 0.0025);

      let baseH = splineContinentalness(cont);
      const erosionFactor = splineErosion(erosion);

      baseH += (peaks * 25.0 - 10.0) * erosionFactor;

      if (cont >= -0.15 && riverNoise < 0.12) {
        let riverVal = (1.2 - riverNoise / 0.1) * (1.0 - Math.max(0, erosion));
        if (riverVal > 0) {
          riverVal = Math.min(1.0, riverVal);
          const targetRiverH = SEA_LEVEL - 6;
          if (baseH > targetRiverH) {
            baseH = baseH * (1.0 - riverVal) + targetRiverH * riverVal;
          }
        }
      }

      HEIGHTS_SCRATCH[idx] = baseH;
    }
  }

  // 2. Voxel Fill with Density Skipping
  for (let z = 0; z < 16; z++) {
    const wz = baseWorldZ + z;
    for (let x = 0; x < 16; x++) {
      const wx = baseWorldX + x;
      const colIdx = z * 16 + x;
      const targetH = HEIGHTS_SCRATCH[colIdx]!;

      // Active 3D noise sampling bounds around target surface height
      const noiseMinY = Math.max(5, Math.floor(targetH - 24));
      const noiseMaxY = Math.min(319, Math.ceil(targetH + 24));

      for (let y = 0; y < 320; y++) {
        // Foundation Stone floor rule (y 0..4)
        if (y <= 4) {
          let isFoundation = false;
          if (y === 0) {
            isFoundation = true;
          } else {
            const fn = s2Foundation(wx * 0.1, wz * 0.1);
            if (y + fn * 2.2 <= 3.5) {
              isFoundation = true;
            }
          }

          if (isFoundation) {
            const secY = y >> 4;
            const yLocal = y & 15;
            const sec = column.getOrCreateSection(secY);
            if (sec) {
              sec.setBlockStateId(x, yLocal, z, foundationState);
            }
            continue;
          }
        }

        // Fast density evaluation using bounds
        let density: number;

        if (y < noiseMinY) {
          density = 100.0; // Guaranteed solid stone
        } else if (y > noiseMaxY) {
          density = -100.0; // Guaranteed air / water
        } else {
          // Inside surface transition zone: sample 3D noise
          const n3d = fbm3D(wx * 0.015, y * 0.012, wz * 0.015) * 22.0;
          density = targetH - y + n3d;
          if (y > 220) {
            density -= (y - 220) * 2.0;
          }
        }

        if (density > 0) {
          const secY = y >> 4;
          const yLocal = y & 15;
          const sec = column.getOrCreateSection(secY);
          if (sec) {
            sec.setBlockStateId(x, yLocal, z, stoneState);
          }
        } else if (y <= SEA_LEVEL) {
          const secY = y >> 4;
          const yLocal = y & 15;
          const sec = column.getOrCreateSection(secY);
          if (sec) {
            sec.setBlockStateId(x, yLocal, z, waterState);
          }
        }
      }
    }
  }
}

export const terrainShapeStage: TerrainStage = {
  name: 'terrain_shape',
  generate: generateTerrainShape,
};
