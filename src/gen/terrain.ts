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
  s2Rivers: (x: number, y: number) => number;
  warpRivers: (x: number, y: number) => { wx: number; wy: number };
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
  const fbmCont = makeFbm2D(s2Cont, 4, 0.5, 2.0);

  const s2Erosion = makeSimplex2D(seedErosion);
  const fbmErosion = makeFbm2D(s2Erosion, 3, 0.5, 2.0);

  const s2Peaks = makeSimplex2D(seedPeaks);
  const ridgedPeaks = makeRidged2D(s2Peaks, 4, 0.5, 2.0);

  const s2Rivers = makeSimplex2D(seedRivers);

  const seedWarpX = deriveSeed(stageSeed, 'river_warp_x');
  const seedWarpZ = deriveSeed(stageSeed, 'river_warp_z');
  const s2WarpX = makeSimplex2D(seedWarpX);
  const fbmWarpX = makeFbm2D(s2WarpX, 2, 0.5, 2.0);
  const s2WarpZ = makeSimplex2D(seedWarpZ);
  const fbmWarpZ = makeFbm2D(s2WarpZ, 2, 0.5, 2.0);

  const warpRivers = (x: number, y: number) => {
    const wx = fbmWarpX(x * 2.0, y * 2.0) * 0.35;
    const wy = fbmWarpZ(x * 2.0, y * 2.0) * 0.35;
    return { wx: x + wx, wy: y + wy };
  };


  const s3Density = makeSimplex3D(seed3D);
  const fbm3D = makeFbm3D(s3Density, 3, 0.5, 2.0);

  const s2Foundation = makeSimplex2D(seedFoundation);

  cachedStageSeed = stageSeed;
  cachedSamplers = {
    fbmCont,
    fbmErosion,
    ridgedPeaks,
    s2Rivers,
    warpRivers,
    fbm3D,
    s2Foundation,
  };
  return cachedSamplers;
}

export interface TerrainClimate {
  continentalness: number;
  erosion: number;
  peaks: number;
  river: number;
  surfaceHeight: number;
}

let _lastStageSeed = -1;
let _lastSamplers: CachedSamplers | null = null;

export function sampleTerrainClimate(
  stageSeed: number,
  wx: number,
  wz: number,
  out: TerrainClimate,
): void {
  if (stageSeed !== _lastStageSeed || !_lastSamplers) {
    _lastSamplers = getSamplersForSeed(stageSeed);
    _lastStageSeed = stageSeed;
  }

  const fbmCont = _lastSamplers.fbmCont;
  const fbmErosion = _lastSamplers.fbmErosion;
  const ridgedPeaks = _lastSamplers.ridgedPeaks;
  const s2Rivers = _lastSamplers.s2Rivers;
  const warpRivers = _lastSamplers.warpRivers;

  const cont = fbmCont(wx * 0.0012, wz * 0.0012);
  const erosion = fbmErosion(wx * 0.002, wz * 0.002);
  const peaksRaw = ridgedPeaks(wx * 0.003, wz * 0.003);

  const rx = wx * 0.0012;
  const rz = wz * 0.0012;

  const cw = warpRivers(rx, rz);
  const n = s2Rivers(cw.wx, cw.wy);

  const eps = 0.0012;
  const cwx1 = warpRivers(rx + eps, rz);
  const nx1 = s2Rivers(cwx1.wx, cwx1.wy);
  const cwx2 = warpRivers(rx - eps, rz);
  const nx2 = s2Rivers(cwx2.wx, cwx2.wy);
  const cwz1 = warpRivers(rx, rz + eps);
  const nz1 = s2Rivers(cwz1.wx, cwz1.wy);
  const cwz2 = warpRivers(rx, rz - eps);
  const nz2 = s2Rivers(cwz2.wx, cwz2.wy);

  const dx = (nx1 - nx2) / 2.0;
  const dz = (nz1 - nz2) / 2.0;
  const gradLen = Math.sqrt(dx * dx + dz * dz);

  let d = 999;
  if (gradLen > 0.00001) {
    d = Math.abs(n) / gradLen;
  }

  const peaks = (peaksRaw + 1.0) / 2.0;

  let baseH: number;
  if (cont < -0.45) {
    const t = (cont + 1.0) / 0.55;
    baseH = 32 + t * 16;
  } else if (cont < -0.15) {
    const t = (cont + 0.45) / 0.3;
    baseH = 48 + t * 14;
  } else if (cont < 0.2) {
    const t = (cont + 0.15) / 0.35;
    baseH = 62 + t * 15;
  } else if (cont < 0.55) {
    const t = (cont - 0.2) / 0.35;
    baseH = 77 + t * 45;
  } else {
    const t = Math.min(1.0, (cont - 0.55) / 0.45);
    baseH = 122 + t * 65;
  }

  let erosionFactor: number;
  if (erosion > 0.3) {
    erosionFactor = 0.3;
  } else if (erosion < -0.3) {
    erosionFactor = 1.8;
  } else {
    const t = (erosion + 0.3) / 0.6;
    erosionFactor = 1.8 - t * 1.5;
  }

  baseH += (peaks * 45.0 - 10.0) * erosionFactor;

  let strength = 0;
  if (cont >= -0.15) {
    strength = Math.max(0, 1.0 - d / 4.9);

    if (baseH > 100) {
      let fade = (120 - baseH) / 20.0;
      fade = Math.max(0, Math.min(1.0, fade));
      strength *= fade;
    }

    if (strength > 0) {
      const riverVal = Math.min(1.0, strength);
      const targetRiverH = SEA_LEVEL - 4; // y 60
      if (baseH > targetRiverH) {
        const carveStr = riverVal * riverVal * (3 - 2 * riverVal);
        baseH = baseH * (1.0 - carveStr) + targetRiverH * carveStr;
      }
    }
  }

  out.continentalness = cont;
  out.erosion = erosion;
  out.peaks = peaks;
  out.river = strength;
  out.surfaceHeight = baseH;
}

// Scratch buffers allocated once per worker/thread environment
const HEIGHTS_SCRATCH = new Float32Array(256);
const SCRATCH_CLIMATE: TerrainClimate = {
  continentalness: 0,
  erosion: 0,
  peaks: 0,
  river: 0,
  surfaceHeight: 0,
};

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

  // 1. Compute 2D heightmap
  for (let z = 0; z < 16; z++) {
    const wz = baseWorldZ + z;
    for (let x = 0; x < 16; x++) {
      const wx = baseWorldX + x;
      const idx = z * 16 + x;

      sampleTerrainClimate(stageSeed, wx, wz, SCRATCH_CLIMATE);
      HEIGHTS_SCRATCH[idx] = SCRATCH_CLIMATE.surfaceHeight;
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
