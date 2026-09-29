import { makeSimplex2D, makeSimplex3D, makeFbm2D, makeFbm3D, makeRidged2D } from './noise';
import { deriveSeed } from '../engine/rng';
import { BlockRegistry } from '../world/blocks/registry';
import { ChunkColumn } from '../world/column';
import { TerrainStage } from './pipeline';

export const SEA_LEVEL = 64;

const HEIGHTS_SCRATCH = new Float32Array(256);
const RIVER_SCRATCH = new Float32Array(256);

// Spline function for Continentalness -> Base Height
function splineContinentalness(c: number): number {
  if (c < -0.45) {
    // Deep Ocean: 32 - 48
    const t = (c + 1.0) / 0.55;
    return 32 + t * 16;
  } else if (c < -0.15) {
    // Ocean / Shore: 48 - 62
    const t = (c + 0.45) / 0.3;
    return 48 + t * 14;
  } else if (c < 0.2) {
    // Plains / Lowlands: 65 - 78
    const t = (c + 0.15) / 0.35;
    return 65 + t * 13;
  } else if (c < 0.55) {
    // Hills / Highlands: 78 - 115
    const t = (c - 0.2) / 0.35;
    return 78 + t * 37;
  } else {
    // High Mountains: 115 - 170
    const t = Math.min(1.0, (c - 0.55) / 0.45);
    return 115 + t * 55;
  }
}

// Spline function for Erosion -> Height Variation Factor
function splineErosion(e: number): number {
  // e high (> 0.3): flat, low variation
  // e low (< -0.3): high variation, steep cliffs
  if (e > 0.3) {
    return 0.3;
  } else if (e < -0.3) {
    return 1.8;
  } else {
    const t = (e + 0.3) / 0.6;
    return 1.8 - t * 1.5;
  }
}

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

  // Derive per-channel seeds
  const seedCont = deriveSeed(stageSeed, 'cont');
  const seedErosion = deriveSeed(stageSeed, 'erosion');
  const seedPeaks = deriveSeed(stageSeed, 'peaks');
  const seedRivers = deriveSeed(stageSeed, 'rivers');
  const seed3D = deriveSeed(stageSeed, 'density3d');
  const seedFoundation = deriveSeed(stageSeed, 'foundation');

  // Noise samplers
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

  // Pre-allocated scratch buffers to avoid heap allocations per column generation call
  const heights = HEIGHTS_SCRATCH;
  const riverFactors = RIVER_SCRATCH;

  const baseWorldX = cx * 16;
  const baseWorldZ = cz * 16;

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

      // Add peak/valley variation
      baseH += (peaks * 25.0 - 10.0) * erosionFactor;

      // River carving (only in land areas where cont >= -0.15)
      let riverVal = 0;
      if (cont >= -0.15 && riverNoise < 0.12) {
        riverVal = (1.2 - riverNoise / 0.1) * (1.0 - Math.max(0, erosion));
        if (riverVal > 0) {
          riverVal = Math.min(1.0, riverVal);
          // Carve down towards sea level - 6
          const targetRiverH = SEA_LEVEL - 6;
          if (baseH > targetRiverH) {
            baseH = baseH * (1.0 - riverVal) + targetRiverH * riverVal;
          }
        }
      }

      heights[idx] = baseH;
      riverFactors[idx] = riverVal;
    }
  }

  // 3D Density & Voxel Fill
  for (let z = 0; z < 16; z++) {
    const wz = baseWorldZ + z;
    for (let x = 0; x < 16; x++) {
      const wx = baseWorldX + x;
      const colIdx = z * 16 + x;
      const targetH = heights[colIdx]!;

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

        // Density calculation
        // Density = (targetH - y) + 3D noise
        const n3d = fbm3D(wx * 0.015, y * 0.012, wz * 0.015) * 22.0;

        // Density squashing above build height / sky
        let density = targetH - y + n3d;
        if (y > 220) {
          density -= (y - 220) * 2.0;
        }

        if (density > 0) {
          // Solid terrain -> Stone
          const secY = y >> 4;
          const yLocal = y & 15;
          const sec = column.getOrCreateSection(secY);
          if (sec) {
            sec.setBlockStateId(x, yLocal, z, stoneState);
          }
        } else if (y <= SEA_LEVEL) {
          // Below or at sea level -> Water
          const secY = y >> 4;
          const yLocal = y & 15;
          const sec = column.getOrCreateSection(secY);
          if (sec) {
            sec.setBlockStateId(x, yLocal, z, waterState);
          }
        }
        // y > sea level and density <= 0 is air (state 0 default in section)
      }
    }
  }
}

export const terrainShapeStage: TerrainStage = {
  name: 'terrain_shape',
  generate: generateTerrainShape,
};
