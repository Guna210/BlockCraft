import { makeSimplex2D, makeSimplex3D, makeFbm2D, makeFbm3D } from './noise';
import { deriveSeed } from '../engine/rng';
import { sampleTerrainClimate, TerrainClimateSample } from './terrain';

/**
 * Height of the highest solid block that `terrainShapeStage` produces at (wx, wz), without
 * generating the column.
 *
 * `sampleTerrainClimate().surfaceHeight` is only the 2D target: the 3D density noise moves the real
 * top by up to ±16 blocks, so neighbours of a column border cannot be judged from it. This
 * function repeats the density rule of `generateTerrainShape` for one column and stops at the
 * first solid block from the top. It must stay in lock-step with that stage;
 * tests/unit/surface-seam.test.ts compares it with the real generated columns.
 */

interface HeightSamplers {
  s2Rivers: (x: number, y: number) => number;
  fbmWarpX: (x: number, y: number) => number;
  fbmWarpZ: (x: number, y: number) => number;
  fbm3D: (x: number, y: number, z: number) => number;
}

let cachedStageSeed: number | null = null;
let cachedSamplers: HeightSamplers | null = null;

function getSamplers(stageSeed: number): HeightSamplers {
  if (cachedStageSeed === stageSeed && cachedSamplers) return cachedSamplers;

  const s2Rivers = makeSimplex2D(deriveSeed(stageSeed, 'rivers'));
  const fbmWarpX = makeFbm2D(makeSimplex2D(deriveSeed(stageSeed, 'river_warp_x')), 2, 0.5, 2.0);
  const fbmWarpZ = makeFbm2D(makeSimplex2D(deriveSeed(stageSeed, 'river_warp_z')), 2, 0.5, 2.0);
  const fbm3D = makeFbm3D(makeSimplex3D(deriveSeed(stageSeed, 'density3d')), 3, 0.5, 2.0);

  cachedStageSeed = stageSeed;
  cachedSamplers = { s2Rivers, fbmWarpX, fbmWarpZ, fbm3D };
  return cachedSamplers;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function splineContinentalness(c: number): number {
  if (c < -0.45) return 30 + ((c + 1.0) / 0.55) * 20;
  if (c < -0.15) return 50 + ((c + 0.45) / 0.3) * 14;
  if (c < 0.15) return 65 + ((c + 0.15) / 0.3) * 13;
  if (c < 0.4) return 78 + ((c - 0.15) / 0.25) * 37;
  return 115 + Math.min(1.0, (c - 0.4) / 0.6) * 75;
}

function splineErosion(e: number): number {
  if (e > 0.3) return 0.3;
  if (e < -0.3) return 1.8;
  return 1.8 - ((e + 0.3) / 0.6) * 1.5;
}

function warpedRiverNoise(s: HeightSamplers, wx: number, wz: number): number {
  const warpX = s.fbmWarpX(wx * 0.0024, wz * 0.0024) * 0.35;
  const warpZ = s.fbmWarpZ(wx * 0.0024, wz * 0.0024) * 0.35;
  return s.s2Rivers(wx * 0.0012 + warpX, wz * 0.0012 + warpZ);
}

const CLIMATE: TerrainClimateSample = {
  continentalness: 0,
  erosion: 0,
  peaks: 0,
  river: 0,
  surfaceHeight: 0,
};

export function sampleTerrainTopY(terrainStageSeed: number, wx: number, wz: number): number {
  const s = getSamplers(terrainStageSeed);
  sampleTerrainClimate(terrainStageSeed, wx, wz, CLIMATE);

  const targetH = CLIMATE.surfaceHeight;
  const cont = CLIMATE.continentalness;
  const uncarved =
    splineContinentalness(cont) + (CLIMATE.peaks * 25.0 - 10.0) * splineErosion(CLIMATE.erosion);

  let river3DFactor = 1.0;
  if (cont >= -0.15) {
    const n = warpedRiverNoise(s, wx, wz);
    if (Math.abs(n) <= 0.05) {
      const gradX = (warpedRiverNoise(s, wx + 1, wz) - warpedRiverNoise(s, wx - 1, wz)) * 0.5;
      const gradZ = (warpedRiverNoise(s, wx, wz + 1) - warpedRiverNoise(s, wx, wz - 1)) * 0.5;
      const gradMag = Math.sqrt(gradX * gradX + gradZ * gradZ);
      const d = gradMag > 1e-6 ? Math.abs(n) / gradMag : 999;
      const hw = 4.0 * (1.0 - smoothstep(100, 120, uncarved));
      if (hw > 0 && d < hw + 6) {
        river3DFactor = d < hw ? 0.0 : smoothstep(hw, hw + 6, d);
      }
    }
  }

  const noiseAmp = (3.0 + 19.0 * smoothstep(64, 85, uncarved)) * river3DFactor;
  const noiseMinY = Math.max(5, Math.floor(targetH - 24));
  const noiseMaxY = Math.min(319, Math.ceil(targetH + 24));

  for (let y = noiseMaxY; y >= noiseMinY; y--) {
    const n3d = noiseAmp > 0 ? s.fbm3D(wx * 0.015, y * 0.025, wz * 0.015) * noiseAmp : 0.0;
    let density = targetH - y + n3d;
    if (y > 220) density -= (y - 220) * 2.0;
    if (density > 0) return y;
  }
  // Everything below noiseMinY is guaranteed solid.
  return noiseMinY - 1;
}
