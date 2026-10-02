import { makeSimplex2D, makeSimplex3D } from './noise';
import { deriveSeed, hash2 } from '../engine/rng';
import { BlockRegistry } from '../world/blocks/registry';
import { ChunkColumn } from '../world/column';
import { TerrainStage } from './pipeline';

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
const WORM_POINTS_SCRATCH = new Float32Array(1000 * 4);
let wormPointCount = 0;

// Y-indexed spatial bucket for worm points to achieve O(1) worm queries per Y level
// Stores indices into WORM_POINTS_SCRATCH
const WORM_Y_BUCKETS = new Int32Array(320 * 32); // Max 32 worm points per Y level
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

  // Evaluate worms from a 5x5 chunk neighborhood around (cx, cz)
  for (let ncz = cz - 2; ncz <= cz + 2; ncz++) {
    for (let ncx = cx - 2; ncx <= cx + 2; ncx++) {
      const chunkSeed = deriveSeed(wormSeedBase, `${ncx},${ncz}`);
      const val0 = hash2(chunkSeed, 0, 0);

      if (val0 > 0.7) continue; // ~70% chance of worm

      const startX = ncx * 16 + hash2(chunkSeed, 1, 0) * 16;
      const startZ = ncz * 16 + hash2(chunkSeed, 0, 1) * 16;
      const startY = 15 + hash2(chunkSeed, 1, 1) * 45; // Y in [15, 60]

      const length = Math.floor(30 + hash2(chunkSeed, 2, 0) * 30);
      let yaw = hash2(chunkSeed, 0, 2) * Math.PI * 2;
      let pitch = (hash2(chunkSeed, 2, 2) - 0.5) * 0.6;
      const radius = 1.8 + hash2(chunkSeed, 3, 0) * 1.4;

      let curX = startX;
      let curY = startY;
      let curZ = startZ;

      for (let step = 0; step < length; step++) {
        const dxCol = curX - (baseWorldX + 7.5);
        const dzCol = curZ - (baseWorldZ + 7.5);
        const distSqCol = dxCol * dxCol + dzCol * dzCol;

        if (distSqCol <= (18 + radius) * (18 + radius) && wormPointCount < 950) {
          const pIdx = wormPointCount;
          const idx = pIdx * 4;
          WORM_POINTS_SCRATCH[idx] = curX;
          WORM_POINTS_SCRATCH[idx + 1] = curY;
          WORM_POINTS_SCRATCH[idx + 2] = curZ;
          WORM_POINTS_SCRATCH[idx + 3] = radius * radius;
          wormPointCount++;

          // Index point into Y buckets [yMin, yMax]
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

// Scratch buffers for column carving decisions
const CARVED_MASK = new Uint8Array(16 * 16 * 320);
const CANDIDATE_AQ_WATER = new Uint8Array(16 * 16 * 320);
const SURFACE_Y_SCRATCH = new Int16Array(16 * 16);
const MIN_WATER_Y_SCRATCH = new Int16Array(16 * 16);

export function generateCaves(
  stageSeed: number,
  cx: number,
  cz: number,
  column: ChunkColumn,
): void {
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

  // Clear scratch masks
  CARVED_MASK.fill(0);
  CANDIDATE_AQ_WATER.fill(0);

  // 2. Pre-scan surface Y and surface water Y per column (16x16)
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      const idx = z * 16 + x;
      let surfY = -1;
      let minWaterY = 999;

      for (let y = 319; y >= 0; y--) {
        const state = column.getBlockStateId(x, y, z);
        if (state === waterState) {
          if (y < minWaterY) minWaterY = y;
        } else if (state !== airState) {
          if (surfY === -1) {
            surfY = y;
          }
        }
      }

      SURFACE_Y_SCRATCH[idx] = surfY >= 0 ? surfY : 64;
      MIN_WATER_Y_SCRATCH[idx] = minWaterY;
    }
  }

  // 3. Evaluate Carving Rules for y in [5, 120]
  for (let z = 0; z < 16; z++) {
    const wz = baseWorldZ + z;
    for (let x = 0; x < 16; x++) {
      const wx = baseWorldX + x;
      const colIdx = z * 16 + x;
      const surfY = SURFACE_Y_SCRATCH[colIdx]!;

      let minWaterY = MIN_WATER_Y_SCRATCH[colIdx]!;
      for (let dz = -1; dz <= 1; dz++) {
        const nz = z + dz;
        if (nz < 0 || nz >= 16) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= 16) continue;
          const nWaterY = MIN_WATER_Y_SCRATCH[nz * 16 + nx]!;
          if (nWaterY < minWaterY) minWaterY = nWaterY;
        }
      }

      const maxCarveY = Math.min(surfY, minWaterY - 3);

      if (maxCarveY < 5) continue;

      const entVal = entranceNoise(wx * 0.05, wz * 0.05);
      const isEntranceAllowed = entVal >= 0.65;

      const upperLimit = Math.min(120, maxCarveY);

      for (let y = 5; y <= upperLimit; y++) {
        if (!isEntranceAllowed && y > surfY - 8) {
          continue;
        }

        let isCarved = false;

        // a) Cheese caverns (single octave simplex noise)
        const nCheese = cheeseNoise(wx * 0.018, y * 0.025, wz * 0.018);
        if (nCheese > 0.42) {
          isCarved = true;
        }

        // b) Spaghetti tunnels with short-circuiting
        if (!isCarved) {
          const nSpag1 = spag1Noise(wx * 0.022, y * 0.03, wz * 0.022);
          if (Math.abs(nSpag1) <= 0.04) {
            const nSpag2 = spag2Noise(wx * 0.022, y * 0.03, wz * 0.022);
            if (nSpag1 * nSpag1 + nSpag2 * nSpag2 < 0.0014) {
              isCarved = true;
            }
          }
        }

        // c) Worm carvers (O(1) bucket query)
        if (!isCarved) {
          const bucketCount = WORM_Y_COUNTS[y]!;
          if (bucketCount > 0) {
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
                isCarved = true;
                break;
              }
            }
          }
        }

        // Depth transition near bedrock (y 5..9)
        if (isCarved && y < 10) {
          const bedrockFade = (y - 4) / 6.0;
          if (hash2(stageSeed + y, wx, wz) > bedrockFade) {
            isCarved = false;
          }
        }

        if (isCarved) {
          const blockIdx = (y * 16 + z) * 16 + x;
          CARVED_MASK[blockIdx] = 1;

          if (y >= 12) {
            const yAq = Math.floor(20 + ((aquiferLevelNoise(wx * 0.01, wz * 0.01) + 1) / 2) * 36);
            const nAq = aquiferZoneNoise(wx * 0.015, y * 0.02, wz * 0.015);

            if (y <= yAq && nAq > 0.1) {
              CANDIDATE_AQ_WATER[blockIdx] = 1;
            }
          }
        }
      }
    }
  }

  // 4. Apply Replacement Rules (Air, Lava, Aquifer Water)
  for (let z = 0; z < 16; z++) {
    const wz = baseWorldZ + z;
    for (let x = 0; x < 16; x++) {
      const wx = baseWorldX + x;

      for (let y = 5; y <= 120; y++) {
        const blockIdx = (y * 16 + z) * 16 + x;

        if (CARVED_MASK[blockIdx] === 0) continue;

        if (y < 12) {
          const yLava = Math.floor(9 + ((lavaLevelNoise(wx * 0.02, wz * 0.02) + 1) / 2) * 2.9);
          if (y <= yLava) {
            column.setBlockStateId(x, y, z, lavaState);
          } else {
            column.setBlockStateId(x, y, z, airState);
          }
        } else {
          if (CANDIDATE_AQ_WATER[blockIdx] === 1) {
            const blockBelow = column.getBlockStateId(x, y - 1, z);
            if (blockBelow === airState) {
              column.setBlockStateId(x, y, z, airState);
              continue;
            }

            let isSafeAquifer = true;

            const offsets = [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ];

            for (const off of offsets) {
              const nx = x + off[0]!;
              const nz = z + off[1]!;

              if (nx >= 0 && nx < 16 && nz >= 0 && nz < 16) {
                const nIdx = (y * 16 + nz) * 16 + nx;
                const isNCarved = CARVED_MASK[nIdx] === 1;
                const isNCandidate = CANDIDATE_AQ_WATER[nIdx] === 1;

                if (isNCarved && !isNCandidate) {
                  isSafeAquifer = false;
                  break;
                }
              } else {
                const nwx = wx + off[0]!;
                const nwz = wz + off[1]!;
                const nEnt = entranceNoise(nwx * 0.05, nwz * 0.05);
                const nCheese = cheeseNoise(nwx * 0.018, y * 0.025, nwz * 0.018);
                const nSpag1 = spag1Noise(nwx * 0.022, y * 0.03, nwz * 0.022);

                let isNCarved = false;
                if (nEnt >= 0.65 || y <= SURFACE_Y_SCRATCH[z * 16 + x]! - 8) {
                  if (nCheese > 0.42 || Math.abs(nSpag1) <= 0.04) {
                    isNCarved = true;
                  }
                }

                if (isNCarved) {
                  const nyAq = Math.floor(
                    20 + ((aquiferLevelNoise(nwx * 0.01, nwz * 0.01) + 1) / 2) * 36,
                  );
                  const nnAq = aquiferZoneNoise(nwx * 0.015, y * 0.02, nwz * 0.015);
                  const isNCandidate = y <= nyAq && nnAq > 0.1;

                  if (!isNCandidate) {
                    isSafeAquifer = false;
                    break;
                  }
                }
              }
            }

            if (isSafeAquifer) {
              column.setBlockStateId(x, y, z, waterState);
            } else {
              column.setBlockStateId(x, y, z, airState);
            }
          } else {
            column.setBlockStateId(x, y, z, airState);
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
