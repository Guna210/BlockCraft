import { makeSimplex2D, makeSimplex3D } from './noise';
import { deriveSeed, hash2 } from '../engine/rng';
import { BlockRegistry } from '../world/blocks/registry';
import { ChunkColumn } from '../world/column';
import { TerrainStage } from './pipeline';
import { sampleTerrainClimate, SEA_LEVEL } from './terrain';

interface CaveSamplers {
  cheeseNoise: (x: number, y: number, z: number) => number;
  spag1Noise: (x: number, y: number, z: number) => number;
  spag2Noise: (x: number, y: number, z: number) => number;
  aquiferLevelNoise: (x: number, z: number) => number;
  aquiferZoneNoise: (x: number, y: number, z: number) => number;
  lavaLevelNoise: (x: number, z: number) => number;
  entranceNoise: (x: number, z: number) => number;
}

let cachedCaveStageSeed: number | null = null;
let cachedCaveSamplers: CaveSamplers | null = null;

function getCaveSamplers(stageSeed: number): CaveSamplers {
  if (cachedCaveStageSeed === stageSeed && cachedCaveSamplers) {
    return cachedCaveSamplers;
  }

  const cheeseNoise = makeSimplex3D(deriveSeed(stageSeed, 'cheese'));
  const spag1Noise = makeSimplex3D(deriveSeed(stageSeed, 'spag1'));
  const spag2Noise = makeSimplex3D(deriveSeed(stageSeed, 'spag2'));

  const aquiferLevelNoise = makeSimplex2D(deriveSeed(stageSeed, 'aq_level'));
  const aquiferZoneNoise = makeSimplex3D(deriveSeed(stageSeed, 'aq_zone'));

  const lavaLevelNoise = makeSimplex2D(deriveSeed(stageSeed, 'lava_level'));
  const entranceNoise = makeSimplex2D(deriveSeed(stageSeed, 'entrance'));

  cachedCaveStageSeed = stageSeed;
  cachedCaveSamplers = {
    cheeseNoise,
    spag1Noise,
    spag2Noise,
    aquiferLevelNoise,
    aquiferZoneNoise,
    lavaLevelNoise,
    entranceNoise,
  };
  return cachedCaveSamplers;
}

// Flat scratch array for worm segment points: [x, y, z, radiusSquared]
const WORM_POINTS_SCRATCH = new Float32Array(500 * 4);
let wormPointCount = 0;

// Y-indexed spatial bucket for worm points
const WORM_Y_BUCKETS = new Int32Array(320 * 32);
const WORM_Y_COUNTS = new Int32Array(320);

function evaluateWormsForColumn(
  stageSeed: number,
  cx: number,
  cz: number,
  baseWorldX: number,
  baseWorldZ: number,
): void {
  wormPointCount = 0;
  WORM_Y_COUNTS.fill(0);

  const wormSeedBase = deriveSeed(stageSeed, 'worms');
  const colCenterX = baseWorldX + 7.5;
  const colCenterZ = baseWorldZ + 7.5;

  // Evaluate worms from a 5x5 chunk neighborhood around (cx, cz)
  for (let ncz = cz - 2; ncz <= cz + 2; ncz++) {
    for (let ncx = cx - 2; ncx <= cx + 2; ncx++) {
      const chunkSeed = deriveSeed(wormSeedBase, `${ncx},${ncz}`);
      const val0 = hash2(chunkSeed, 0, 0);

      if (val0 > 0.7) continue; // ~70% chance of worm

      const startX = ncx * 16 + hash2(chunkSeed, 1, 0) * 16;
      const startZ = ncz * 16 + hash2(chunkSeed, 0, 1) * 16;

      const dxStart = startX - colCenterX;
      const dzStart = startZ - colCenterZ;
      if (dxStart * dxStart + dzStart * dzStart > 96 * 96) continue;

      const startY = 15 + hash2(chunkSeed, 1, 1) * 45; // Y in [15, 60]
      const length = Math.floor(30 + hash2(chunkSeed, 2, 0) * 30);
      let yaw = hash2(chunkSeed, 0, 2) * Math.PI * 2;
      let pitch = (hash2(chunkSeed, 2, 2) - 0.5) * 0.6;
      const radius = 1.8 + hash2(chunkSeed, 3, 0) * 1.4;

      let curX = startX;
      let curY = startY;
      let curZ = startZ;

      // Padded bounding box for this column: [baseWorldX - 3, baseWorldX + 18] x [baseWorldZ - 3, baseWorldZ + 18]
      const minBoxX = baseWorldX - 3;
      const maxBoxX = baseWorldX + 18;
      const minBoxZ = baseWorldZ - 3;
      const maxBoxZ = baseWorldZ + 18;

      for (let step = 0; step < length; step++) {
        const clampX = Math.max(minBoxX, Math.min(maxBoxX, curX));
        const clampZ = Math.max(minBoxZ, Math.min(maxBoxZ, curZ));
        const dxBox = curX - clampX;
        const dzBox = curZ - clampZ;
        const distSqBox = dxBox * dxBox + dzBox * dzBox;

        if (distSqBox <= radius * radius && wormPointCount < 480) {
          const pIdx = wormPointCount;
          const idx = pIdx * 4;
          WORM_POINTS_SCRATCH[idx] = curX;
          WORM_POINTS_SCRATCH[idx + 1] = curY;
          WORM_POINTS_SCRATCH[idx + 2] = curZ;
          WORM_POINTS_SCRATCH[idx + 3] = radius * radius;
          wormPointCount++;

          const yMin = Math.max(5, Math.floor(curY - radius));
          const yMax = Math.min(120, Math.ceil(curY + radius));

          for (let y = yMin; y <= yMax; y++) {
            const count = WORM_Y_COUNTS[y]!;
            if (count < 32) {
              WORM_Y_BUCKETS[y * 32 + count] = pIdx;
              WORM_Y_COUNTS[y] = count + 1;
            }
          }
        }

        const stepSeed = hash2(chunkSeed, step, 10);
        const stepSeed2 = hash2(chunkSeed, step, 20);

        yaw += (stepSeed - 0.5) * 0.35;
        pitch = Math.max(-0.6, Math.min(0.6, pitch + (stepSeed2 - 0.5) * 0.2));

        curX += Math.cos(yaw) * Math.cos(pitch) * 1.2;
        curY += Math.sin(pitch) * 1.2;
        curZ += Math.sin(yaw) * Math.cos(pitch) * 1.2;

        if (curY < 10 || curY > 70) break;
      }
    }
  }
}

// Fast check against column's worm points
function isColumnWormCarved(wx: number, y: number, wz: number): boolean {
  const bucketCount = WORM_Y_COUNTS[y]!;
  if (bucketCount === 0) return false;

  const bucketOffset = y * 32;
  for (let b = 0; b < bucketCount; b++) {
    const pIdx = WORM_Y_BUCKETS[bucketOffset + b]!;
    const ptIdx = pIdx * 4;
    const sx = WORM_POINTS_SCRATCH[ptIdx]!;
    const sy = WORM_POINTS_SCRATCH[ptIdx + 1]!;
    const sz = WORM_POINTS_SCRATCH[ptIdx + 2]!;
    const rSq = WORM_POINTS_SCRATCH[ptIdx + 3]!;

    const dx = wx - sx;
    const dy = y - sy;
    const dz = wz - sz;

    if (dx * dx + dy * dy + dz * dz <= rSq) {
      return true;
    }
  }
  return false;
}

const CLIMATE_SCRATCH = {
  continentalness: 0,
  erosion: 0,
  peaks: 0,
  river: 0,
  surfaceHeight: 0,
};

// 24x24 surface scratch for 2D climate pre-sampling (from -4 to +19)
const SURFACE_24_SCRATCH = new Int16Array(24 * 24);

// 22x22x128 Padded Grid Scratch Buffers (px in [0,21], pz in [0,21], y in [0,127])
// Grid offset formula: (y * 22 + pz) * 22 + px
const GRID_DIM = 22;
const GRID_SIZE = GRID_DIM * GRID_DIM * 128;
const RAW_CARVED_GRID = new Uint8Array(GRID_SIZE);
const CANDIDATE_WATER_GRID = new Uint8Array(GRID_SIZE);
const SUPPORTED_WATER_GRID = new Uint8Array(GRID_SIZE);

const SURFACE_Y_SCRATCH = new Int16Array(GRID_DIM * GRID_DIM);
const MAX_CARVE_Y_SCRATCH = new Int16Array(GRID_DIM * GRID_DIM);

export function generateCaves(
  stageSeed: number,
  cx: number,
  cz: number,
  column: ChunkColumn,
): void {
  const worldSeed = column.worldSeed;
  if (worldSeed === undefined) {
    throw new Error('generateCaves requires column.worldSeed to be set');
  }

  const terrainStageSeed = deriveSeed(worldSeed, 'terrain_shape');
  const registry = BlockRegistry.getInstance();

  const airState = 0;
  const waterState = registry.getDefaultStateId('water') ?? 1;
  const lavaState = registry.getDefaultStateId('lava') ?? 1;

  const samplers = getCaveSamplers(stageSeed);
  const {
    cheeseNoise,
    spag1Noise,
    spag2Noise,
    aquiferLevelNoise,
    aquiferZoneNoise,
    lavaLevelNoise,
    entranceNoise,
  } = samplers;

  const baseWorldX = cx * 16;
  const baseWorldZ = cz * 16;

  // 1. Evaluate Worm Carvers for this column
  evaluateWormsForColumn(stageSeed, cx, cz, baseWorldX, baseWorldZ);

  // 2a. Pre-sample surface Y for 24x24 neighborhood (from -4 to +19 relative to base)
  for (let s24z = 0; s24z < 24; s24z++) {
    const wz = baseWorldZ + s24z - 4;
    for (let s24x = 0; s24x < 24; s24x++) {
      const wx = baseWorldX + s24x - 4;
      const s24Idx = s24z * 24 + s24x;

      if (s24x >= 4 && s24x <= 19 && s24z >= 4 && s24z <= 19) {
        // Interior column: scan real blocks
        const lx = s24x - 4;
        const lz = s24z - 4;
        let colSurfY = -1;

        for (let y = 319; y >= 0; y--) {
          const state = column.getBlockStateId(lx, y, lz);
          if (state !== airState && state !== waterState) {
            colSurfY = y;
            break;
          }
        }
        SURFACE_24_SCRATCH[s24Idx] = colSurfY >= 0 ? colSurfY : 64;
      } else {
        // Border padding: use climate sampler
        sampleTerrainClimate(terrainStageSeed, wx, wz, CLIMATE_SCRATCH);
        SURFACE_24_SCRATCH[s24Idx] = CLIMATE_SCRATCH.surfaceHeight;
      }
    }
  }

  // 2b. Compute SURFACE_Y_SCRATCH and MAX_CARVE_Y_SCRATCH for 22x22 grid (from -3 to +18)
  for (let pz = 0; pz < 22; pz++) {
    for (let px = 0; px < 22; px++) {
      const s24x = px + 1; // offset relative to 24x24 grid
      const s24z = pz + 1;
      const s24Idx = s24z * 24 + s24x;

      const surfY = SURFACE_24_SCRATCH[s24Idx]!;
      let minWaterY = surfY < SEA_LEVEL ? surfY : 999;

      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nSurfY = SURFACE_24_SCRATCH[(s24z + dz) * 24 + (s24x + dx)]!;
          if (nSurfY < SEA_LEVEL && nSurfY < minWaterY) {
            minWaterY = nSurfY;
          }
        }
      }

      const p2dIdx = pz * 22 + px;
      SURFACE_Y_SCRATCH[p2dIdx] = surfY;
      MAX_CARVE_Y_SCRATCH[p2dIdx] = Math.min(surfY, minWaterY - 3);
    }
  }

  RAW_CARVED_GRID.fill(0);
  CANDIDATE_WATER_GRID.fill(0);
  SUPPORTED_WATER_GRID.fill(0);

  // 3. Populate 22x22x128 padded grids for raw carving and candidate aquifer water
  for (let pz = 0; pz < 22; pz++) {
    const wz = baseWorldZ + pz - 3;
    for (let px = 0; px < 22; px++) {
      const wx = baseWorldX + px - 3;
      const p2dIdx = pz * 22 + px;
      const surfY = SURFACE_Y_SCRATCH[p2dIdx]!;
      const maxCarveY = MAX_CARVE_Y_SCRATCH[p2dIdx]!;

      if (maxCarveY < 5) continue;

      const entVal = entranceNoise(wx * 0.05, wz * 0.05);
      const isEntranceAllowed = entVal >= 0.65;
      const upperLimit = Math.min(120, maxCarveY);

      const yAq = Math.floor(20 + ((aquiferLevelNoise(wx * 0.01, wz * 0.01) + 1) / 2) * 36);

      for (let y = 5; y <= upperLimit; y++) {
        if (!isEntranceAllowed && y > surfY - 8) {
          continue;
        }

        let isCarved = false;

        // a) Cheese
        const nCheese = cheeseNoise(wx * 0.018, y * 0.025, wz * 0.018);
        if (nCheese > 0.42) {
          isCarved = true;
        }

        // b) Spaghetti with short-circuit check on nSpag1
        if (!isCarved) {
          const nSpag1 = spag1Noise(wx * 0.022, y * 0.03, wz * 0.022);
          if (Math.abs(nSpag1) <= 0.038) {
            const nSpag2 = spag2Noise(wx * 0.022, y * 0.03, wz * 0.022);
            if (nSpag1 * nSpag1 + nSpag2 * nSpag2 < 0.0014) {
              isCarved = true;
            }
          }
        }

        // c) Worms
        if (!isCarved && isColumnWormCarved(wx, y, wz)) {
          isCarved = true;
        }

        // Bedrock fade transition at y 5..9
        if (isCarved && y < 10) {
          const bedrockFade = (y - 4) / 6.0;
          if (hash2(stageSeed + y, wx, wz) > bedrockFade) {
            isCarved = false;
          }
        }

        const gridIdx = (y * 22 + pz) * 22 + px;

        if (isCarved) {
          RAW_CARVED_GRID[gridIdx] = 1;

          // Candidate aquifer water check only for carved cells!
          if (y >= 12 && y <= yAq) {
            const nAq = aquiferZoneNoise(wx * 0.015, y * 0.02, wz * 0.015);
            if (nAq > 0.1) {
              CANDIDATE_WATER_GRID[gridIdx] = 1;
            }
          }
        }
      }
    }
  }

  // 4. Compute SUPPORTED_WATER_GRID bottom-to-top (y 12..120)
  for (let pz = 0; pz < 22; pz++) {
    const wz = baseWorldZ + pz - 3;
    for (let px = 0; px < 22; px++) {
      const wx = baseWorldX + px - 3;
      const yLava = Math.floor(9 + ((lavaLevelNoise(wx * 0.02, wz * 0.02) + 1) / 2) * 2.9);

      for (let y = 12; y <= 120; y++) {
        const gridIdx = (y * 22 + pz) * 22 + px;

        if (RAW_CARVED_GRID[gridIdx] === 1 && CANDIDATE_WATER_GRID[gridIdx] === 1) {
          // Check support from below:
          let isSupported = false;
          if (y === 12) {
            if (11 <= yLava || RAW_CARVED_GRID[(11 * 22 + pz) * 22 + px] === 0) {
              isSupported = true;
            }
          } else {
            const belowGridIdx = ((y - 1) * 22 + pz) * 22 + px;
            if (RAW_CARVED_GRID[belowGridIdx] === 0 || SUPPORTED_WATER_GRID[belowGridIdx] === 1) {
              isSupported = true;
            }
          }

          if (isSupported) {
            SUPPORTED_WATER_GRID[gridIdx] = 1;
          }
        }
      }
    }
  }

  // Manhattan distance 2 offsets relative to center (0,0):
  const MANHATTAN_R2_OFFSETS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [2, 0],
    [-2, 0],
    [0, 2],
    [0, -2],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  // 5. Apply Carving and Aquifer Rules to column (16x16)
  for (let z = 0; z < 16; z++) {
    const pz = z + 3;
    const wz = baseWorldZ + z;
    for (let x = 0; x < 16; x++) {
      const px = x + 3;
      const wx = baseWorldX + x;

      for (let y = 5; y <= 120; y++) {
        const gridIdx = (y * 22 + pz) * 22 + px;
        if (RAW_CARVED_GRID[gridIdx] === 0) continue;

        if (y < 12) {
          // Lava lakes below y=12
          const yLava = Math.floor(9 + ((lavaLevelNoise(wx * 0.02, wz * 0.02) + 1) / 2) * 2.9);
          if (y <= yLava) {
            column.setBlockStateId(x, y, z, lavaState);
          } else {
            column.setBlockStateId(x, y, z, airState);
          }
        } else {
          // Aquifer evaluation:
          // Cell becomes water if and only if self AND ALL carved cells within Manhattan radius 2
          // are supported candidate water!
          let isWater = SUPPORTED_WATER_GRID[gridIdx] === 1;

          if (isWater) {
            for (const [offX, offZ] of MANHATTAN_R2_OFFSETS) {
              const nGridIdx = (y * 22 + (pz + offZ!)) * 22 + (px + offX!);
              if (RAW_CARVED_GRID[nGridIdx] === 1 && SUPPORTED_WATER_GRID[nGridIdx] === 0) {
                isWater = false;
                break;
              }
            }
          }

          if (isWater) {
            column.setBlockStateId(x, y, z, waterState);
          } else {
            if (SUPPORTED_WATER_GRID[gridIdx] === 1) {
              // Preserve solid stone as barrier to prevent water touching air!
              continue;
            } else {
              column.setBlockStateId(x, y, z, airState);
            }
          }
        }
      }
    }
  }
}

export const caveStage: TerrainStage = {
  name: 'caves',
  generate: generateCaves,
};
