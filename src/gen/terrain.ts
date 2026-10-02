import { makeSimplex2D, makeSimplex3D, makeFbm2D, makeFbm3D, makeRidged2D } from './noise';
import { deriveSeed } from '../engine/rng';
import { BlockRegistry } from '../world/blocks/registry';
import { ChunkColumn } from '../world/column';
import { TerrainStage } from './pipeline';

export const SEA_LEVEL = 64;

export interface TerrainClimateSample {
  continentalness: number;
  erosion: number;
  peaks: number;
  river: number; // 0..1 strength (1 = channel centre, 0 outside channels)
  surfaceHeight: number; // final 2D surface height including river carving
}

interface Samplers {
  fbmCont: (x: number, y: number) => number;
  fbmErosion: (x: number, y: number) => number;
  ridgedPeaks: (x: number, y: number) => number;
  s2Rivers: (x: number, y: number) => number;
  fbmWarpX: (x: number, y: number) => number;
  fbmWarpZ: (x: number, y: number) => number;
  fbm3D: (x: number, y: number, z: number) => number;
  s2Foundation: (x: number, y: number) => number;
}

let cachedStageSeed: number | null = null;
let cachedSamplers: Samplers | null = null;

function getSamplersForSeed(stageSeed: number): Samplers {
  if (cachedStageSeed === stageSeed && cachedSamplers) {
    return cachedSamplers;
  }

  const seedCont = deriveSeed(stageSeed, 'cont');
  const seedErosion = deriveSeed(stageSeed, 'erosion');
  const seedPeaks = deriveSeed(stageSeed, 'peaks');
  const seedRivers = deriveSeed(stageSeed, 'rivers');
  const seedWarpX = deriveSeed(stageSeed, 'river_warp_x');
  const seedWarpZ = deriveSeed(stageSeed, 'river_warp_z');
  const seed3D = deriveSeed(stageSeed, 'density3d');
  const seedFoundation = deriveSeed(stageSeed, 'foundation');

  const s2Cont = makeSimplex2D(seedCont);
  const fbmCont = makeFbm2D(s2Cont, 4, 0.5, 2.0);

  const s2Erosion = makeSimplex2D(seedErosion);
  const fbmErosion = makeFbm2D(s2Erosion, 3, 0.5, 2.0);

  const s2Peaks = makeSimplex2D(seedPeaks);
  const ridgedPeaks = makeRidged2D(s2Peaks, 4, 0.5, 2.0);

  const s2Rivers = makeSimplex2D(seedRivers);

  const s2WarpX = makeSimplex2D(seedWarpX);
  const fbmWarpX = makeFbm2D(s2WarpX, 2, 0.5, 2.0);

  const s2WarpZ = makeSimplex2D(seedWarpZ);
  const fbmWarpZ = makeFbm2D(s2WarpZ, 2, 0.5, 2.0);

  const s3Density = makeSimplex3D(seed3D);
  const fbm3D = makeFbm3D(s3Density, 3, 0.5, 2.0);

  const s2Foundation = makeSimplex2D(seedFoundation);

  cachedStageSeed = stageSeed;
  cachedSamplers = {
    fbmCont,
    fbmErosion,
    ridgedPeaks,
    s2Rivers,
    fbmWarpX,
    fbmWarpZ,
    fbm3D,
    s2Foundation,
  };
  return cachedSamplers;
}

// Spline function for Continentalness -> Base Height
function splineContinentalness(c: number): number {
  if (c < -0.45) {
    // Deep ocean
    const t = (c + 1.0) / 0.55;
    return 30 + t * 20; // 30 .. 50
  } else if (c < -0.15) {
    // Ocean / Shore transition
    const t = (c + 0.45) / 0.3;
    return 50 + t * 14; // 50 .. 64
  } else if (c < 0.15) {
    // Lowland / Plains
    const t = (c + 0.15) / 0.3;
    return 65 + t * 13; // 65 .. 78
  } else if (c < 0.4) {
    // Hills
    const t = (c - 0.15) / 0.25;
    return 78 + t * 37; // 78 .. 115
  } else {
    // Peaks / High mountains
    const t = Math.min(1.0, (c - 0.4) / 0.6);
    return 115 + t * 75; // 115 .. 190
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

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function sampleWarpedRiverNoise(samplers: Samplers, wx: number, wz: number): number {
  const baseNoiseX = wx * 0.0012;
  const baseNoiseZ = wz * 0.0012;
  const warpX = samplers.fbmWarpX(wx * 0.0024, wz * 0.0024) * 0.35;
  const warpZ = samplers.fbmWarpZ(wx * 0.0024, wz * 0.0024) * 0.35;
  return samplers.s2Rivers(baseNoiseX + warpX, baseNoiseZ + warpZ);
}

export function sampleTerrainClimate(
  terrainStageSeed: number,
  wx: number,
  wz: number,
  out: TerrainClimateSample,
): void {
  const samplers = getSamplersForSeed(terrainStageSeed);
  const cont = samplers.fbmCont(wx * 0.0012, wz * 0.0012);
  const erosion = samplers.fbmErosion(wx * 0.002, wz * 0.002);
  const ridgedP = samplers.ridgedPeaks(wx * 0.003, wz * 0.003);
  const peaks = (ridgedP + 1.0) * 0.5; // remap peaks to [0, 1]

  const baseH = splineContinentalness(cont);
  const erosionFactor = splineErosion(erosion);

  const uncarvedHeight = baseH + (peaks * 25.0 - 10.0) * erosionFactor;

  // River calculation
  let riverStrength = 0;
  let finalSurface = uncarvedHeight;

  if (cont >= -0.15) {
    const n = sampleWarpedRiverNoise(samplers, wx, wz);

    // Fast check: if |n| > 0.05, distance d is > 10, well beyond hw + 6 = 10, so river strength is 0.
    if (Math.abs(n) <= 0.05) {
      const nX1 = sampleWarpedRiverNoise(samplers, wx + 1, wz);
      const nX0 = sampleWarpedRiverNoise(samplers, wx - 1, wz);
      const nZ1 = sampleWarpedRiverNoise(samplers, wx, wz + 1);
      const nZ0 = sampleWarpedRiverNoise(samplers, wx, wz - 1);

      const gradX = (nX1 - nX0) * 0.5;
      const gradZ = (nZ1 - nZ0) * 0.5;
      const gradMag = Math.sqrt(gradX * gradX + gradZ * gradZ);

      const d = gradMag > 1e-6 ? Math.abs(n) / gradMag : 999;

      // Shrink hw to 0 as un-carved surface goes from y 100 to y 120
      const heightFactor = 1.0 - smoothstep(100, 120, uncarvedHeight);
      const hw = 4.0 * heightFactor;

      if (hw > 0 && d < hw + 6) {
        if (d < hw) {
          riverStrength = Math.max(0, Math.min(1, 1.0 - d / hw));
          finalSurface = SEA_LEVEL - 1 - Math.round(3.0 * riverStrength);
        } else {
          // Banks: hw <= d < hw + 6
          riverStrength = 0;
          const bankT = (d - hw) / 6.0;
          const s = smoothstep(0, 1, bankT);
          finalSurface = SEA_LEVEL + s * (uncarvedHeight - SEA_LEVEL);
        }
      }
    }
  }

  out.continentalness = cont;
  out.erosion = erosion;
  out.peaks = peaks;
  out.river = riverStrength;
  out.surfaceHeight = finalSurface;
}

// Scratch buffer for column generation
const SAMPLE_SCRATCH: TerrainClimateSample = {
  continentalness: 0,
  erosion: 0,
  peaks: 0,
  river: 0,
  surfaceHeight: 0,
};

const HEIGHTS_SCRATCH = new Float32Array(256);
const UNCARVED_SCRATCH = new Float32Array(256);
const DIST_SCRATCH = new Float32Array(256);
const HW_SCRATCH = new Float32Array(256);

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
  const { fbm3D, s2Foundation } = samplers;

  const baseWorldX = cx * 16;
  const baseWorldZ = cz * 16;

  // 1. Compute 2D heightmap using sampleTerrainClimate
  for (let z = 0; z < 16; z++) {
    const wz = baseWorldZ + z;
    for (let x = 0; x < 16; x++) {
      const wx = baseWorldX + x;
      const idx = z * 16 + x;

      sampleTerrainClimate(stageSeed, wx, wz, SAMPLE_SCRATCH);

      HEIGHTS_SCRATCH[idx] = SAMPLE_SCRATCH.surfaceHeight;

      // We also need distance & hw or uncarved height to compute 3D density scaling
      const cont = SAMPLE_SCRATCH.continentalness;
      const erosionFactor = splineErosion(SAMPLE_SCRATCH.erosion);
      const baseH = splineContinentalness(cont);
      const uncarved = baseH + (SAMPLE_SCRATCH.peaks * 25.0 - 10.0) * erosionFactor;
      UNCARVED_SCRATCH[idx] = uncarved;

      if (cont >= -0.15) {
        const n = sampleWarpedRiverNoise(samplers, wx, wz);
        if (Math.abs(n) <= 0.05) {
          const nX1 = sampleWarpedRiverNoise(samplers, wx + 1, wz);
          const nX0 = sampleWarpedRiverNoise(samplers, wx - 1, wz);
          const nZ1 = sampleWarpedRiverNoise(samplers, wx, wz + 1);
          const nZ0 = sampleWarpedRiverNoise(samplers, wx, wz - 1);

          const gradX = (nX1 - nX0) * 0.5;
          const gradZ = (nZ1 - nZ0) * 0.5;
          const gradMag = Math.sqrt(gradX * gradX + gradZ * gradZ);

          const d = gradMag > 1e-6 ? Math.abs(n) / gradMag : 999;
          const heightFactor = 1.0 - smoothstep(100, 120, uncarved);
          const hw = 4.0 * heightFactor;

          DIST_SCRATCH[idx] = d;
          HW_SCRATCH[idx] = hw;
        } else {
          DIST_SCRATCH[idx] = 999;
          HW_SCRATCH[idx] = 0;
        }
      } else {
        DIST_SCRATCH[idx] = 999;
        HW_SCRATCH[idx] = 0;
      }
    }
  }

  // 2. Voxel Fill with Density Skipping
  for (let z = 0; z < 16; z++) {
    const wz = baseWorldZ + z;
    for (let x = 0; x < 16; x++) {
      const wx = baseWorldX + x;
      const colIdx = z * 16 + x;
      const targetH = HEIGHTS_SCRATCH[colIdx]!;
      const uncarvedH = UNCARVED_SCRATCH[colIdx]!;
      const d = DIST_SCRATCH[colIdx]!;
      const hw = HW_SCRATCH[colIdx]!;

      // Determine 3D noise amplitude according to Req 4:
      // - full 22 where uncarved surface y >= 85;
      // - fading smoothly to at most 3 near sea level (y <= 64);
      // - 0 inside river channels and banks (d < hw + 6).
      const base3DAmp = 3.0 + 19.0 * smoothstep(64, 85, uncarvedH);

      let river3DFactor = 1.0;
      if (hw > 0 && d < hw + 6) {
        if (d < hw) {
          river3DFactor = 0.0;
        } else {
          // hw <= d < hw + 6
          river3DFactor = smoothstep(hw, hw + 6, d);
        }
      }

      const noiseAmp = base3DAmp * river3DFactor;

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
          const n3d = noiseAmp > 0 ? fbm3D(wx * 0.015, y * 0.025, wz * 0.015) * noiseAmp : 0.0;
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
