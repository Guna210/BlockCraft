import { makeSimplex2D, makeSimplex3D } from './noise';
import { deriveSeed, hash2 } from '../engine/rng';
import { BlockRegistry } from '../world/blocks/registry';
import { ChunkColumn } from '../world/column';
import { TerrainStage } from './pipeline';
import { sampleTerrainClimate, SEA_LEVEL } from './terrain';
import { detCos, detSin } from './detmath';

interface CaveSamplers {
  cheeseNoise: (x: number, y: number, z: number) => number;
  spag1Noise: (x: number, y: number, z: number) => number;
  spag2Noise: (x: number, y: number, z: number) => number;
  aquiferLevelNoise: (x: number, z: number) => number;
  aquiferZoneNoise: (x: number, y: number, z: number) => number;
  lavaLevelNoise: (x: number, z: number) => number;
  entranceNoise: (x: number, z: number) => number;
  floorSeed: number;
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
  const floorSeed = deriveSeed(stageSeed, 'floor');

  cachedCaveStageSeed = stageSeed;
  cachedCaveSamplers = {
    cheeseNoise,
    spag1Noise,
    spag2Noise,
    aquiferLevelNoise,
    aquiferZoneNoise,
    lavaLevelNoise,
    entranceNoise,
    floorSeed,
  };
  return cachedCaveSamplers;
}

// ---------------------------------------------------------------------------------------------
// Sampling model
//
// Cheese, spaghetti and aquifer-zone noise are smooth fields, so they are sampled on a lattice
// aligned to world coordinates and trilinearly interpolated per block. Because the lattice is
// anchored to world coordinates (never to the column being generated), every column computes the
// same value for the same block, which keeps generation seamless and order-independent.
//
//   x/z spacing 4 for all fields; y spacing 4 (cheese, aquifer zone) or 2 (spaghetti, thin tubes).
//   Lattice y level k sits at y = 4 + k * spacing.
//
// A lattice cell is skipped when its corner values prove that no interpolated value inside it can
// reach the carve threshold (the interpolant is a convex combination of the corner values).
// ---------------------------------------------------------------------------------------------

const CHEESE_THRESHOLD = 0.42;
const SPAG_TUBE_LIMIT = 0.038; // |n1| <= limit before n2 is consulted
const SPAG_TUBE_RADIUS_SQ = 0.0014;
const AQUIFER_ZONE_THRESHOLD = 0.1;

const GRID_DIM = 22; // padded columns: world x/z in [base - 3, base + 18]
const GRID_COLS = GRID_DIM * GRID_DIM;
const GRID_H = 128; // y 0..127
const LAT_N = 7; // lattice points per axis: world x/z = base - 4 + 4 * i
const LAT_CELLS = LAT_N - 1;
const CHEESE_LEVELS = 32;
const SPAG_LEVELS = 64;
const AQ_LEVELS = 16;
const MIN_CARVE_Y = 5;
const MAX_CARVE_Y = 120;

// Worm segments: [x, y, z, radiusSquared]. A 5x5 chunk neighborhood holds at most 25 worms of
// at most 59 steps, so this capacity can never be exceeded and no segment is ever dropped.
const MAX_WORM_POINTS = 25 * 60;
const WORM_POINTS_SCRATCH = new Float32Array(MAX_WORM_POINTS * 4);
let wormPointCount = 0;

function evaluateWormsForColumn(
  stageSeed: number,
  cx: number,
  cz: number,
  baseWorldX: number,
  baseWorldZ: number,
): void {
  wormPointCount = 0;

  const wormSeedBase = deriveSeed(stageSeed, 'worms');
  const colCenterX = baseWorldX + 7.5;
  const colCenterZ = baseWorldZ + 7.5;

  // Padded bounding box for this column: [baseWorldX - 3, baseWorldX + 18] x [baseWorldZ - 3, baseWorldZ + 18]
  const minBoxX = baseWorldX - 3;
  const maxBoxX = baseWorldX + 18;
  const minBoxZ = baseWorldZ - 3;
  const maxBoxZ = baseWorldZ + 18;

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

      for (let step = 0; step < length; step++) {
        const clampX = Math.max(minBoxX, Math.min(maxBoxX, curX));
        const clampZ = Math.max(minBoxZ, Math.min(maxBoxZ, curZ));
        const dxBox = curX - clampX;
        const dzBox = curZ - clampZ;
        const distSqBox = dxBox * dxBox + dzBox * dzBox;

        if (distSqBox <= radius * radius) {
          const idx = wormPointCount * 4;
          WORM_POINTS_SCRATCH[idx] = curX;
          WORM_POINTS_SCRATCH[idx + 1] = curY;
          WORM_POINTS_SCRATCH[idx + 2] = curZ;
          WORM_POINTS_SCRATCH[idx + 3] = radius * radius;
          wormPointCount++;
        }

        const stepSeed = hash2(chunkSeed, step, 10);
        const stepSeed2 = hash2(chunkSeed, step, 20);

        yaw += (stepSeed - 0.5) * 0.35;
        pitch = Math.max(-0.6, Math.min(0.6, pitch + (stepSeed2 - 0.5) * 0.2));

        // detSin/detCos use only IEEE-exact arithmetic, so the path is identical in every JS engine
        const cosPitch = detCos(pitch);
        curX += detCos(yaw) * cosPitch * 1.2;
        curY += detSin(pitch) * 1.2;
        curZ += detSin(yaw) * cosPitch * 1.2;

        if (curY < 10 || curY > 70) break;
      }
    }
  }
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

// Per padded column (p = pz * 22 + px)
const UPPER_SCRATCH = new Int16Array(GRID_COLS); // highest carvable y, 0 when the column is not carved
const FLOOR_SCRATCH = new Int16Array(GRID_COLS); // lowest carvable y (5..9)
const AQUIFER_TOP_SCRATCH = new Int16Array(GRID_COLS);
const LAVA_TOP_SCRATCH = new Int16Array(GRID_COLS);

// Padded grids, one contiguous y-run per column: index = p * 128 + y
const RAW_CARVED_GRID = new Uint8Array(GRID_COLS * GRID_H);
const CANDIDATE_WATER_GRID = new Uint8Array(GRID_COLS * GRID_H);
const SUPPORTED_WATER_GRID = new Uint8Array(GRID_COLS * GRID_H);

// Lattice values, index = (lz * 7 + lx) * LEVELS + k
const CHEESE_LATTICE = new Float32Array(LAT_N * LAT_N * CHEESE_LEVELS);
const SPAG1_LATTICE = new Float32Array(LAT_N * LAT_N * SPAG_LEVELS);
const SPAG2_LATTICE = new Float32Array(LAT_N * LAT_N * SPAG_LEVELS);
const AQUIFER_LATTICE = new Float32Array(LAT_N * LAT_N * AQ_LEVELS);
const SPAG2_UNSET = 9; // simplex output is within [-1, 1]

// Highest active cell level per lattice cell (-1 = cell unused) and evaluated levels per lattice point
const CHEESE_CELL_TOP = new Int16Array(LAT_CELLS * LAT_CELLS);
const SPAG_CELL_TOP = new Int16Array(LAT_CELLS * LAT_CELLS);
const CHEESE_POINT_LEVELS = new Int16Array(LAT_N * LAT_N);
const SPAG_POINT_LEVELS = new Int16Array(LAT_N * LAT_N);

// Manhattan distance 2 neighbours as padded-column index offsets (pz * 22 + px)
const MANHATTAN_R2_OFFSETS = new Int32Array([1, -1, 22, -22, 2, -2, 44, -44, 23, -21, 21, -23]);

/**
 * Smooth per-column floor of the cave volume (y 5..9). Below it the rock stays solid, so the
 * bedrock transition is a continuous heightfield sitting on Foundation Stone and cannot leave
 * isolated blocks the way a per-block random dropout does.
 */
function caveFloorY(floorSeed: number, wx: number, wz: number): number {
  // Value noise on a world-aligned lattice of spacing 4, smoothstep-interpolated
  const gx = wx >> 2;
  const gz = wz >> 2;
  const fx = (wx & 3) * 0.25;
  const fz = (wz & 3) * 0.25;
  const h00 = hash2(floorSeed, gx, gz);
  const h10 = hash2(floorSeed, gx + 1, gz);
  const h01 = hash2(floorSeed, gx, gz + 1);
  const h11 = hash2(floorSeed, gx + 1, gz + 1);
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const top = h00 + (h10 - h00) * sx;
  const bottom = h01 + (h11 - h01) * sx;
  return MIN_CARVE_Y + Math.floor((top + (bottom - top) * sz) * 5);
}

function ensureSpag2(
  index: number,
  wx: number,
  wy: number,
  wz: number,
  noise: (x: number, y: number, z: number) => number,
): void {
  if (SPAG2_LATTICE[index] === SPAG2_UNSET) {
    SPAG2_LATTICE[index] = noise(wx * 0.022, wy * 0.03, wz * 0.022);
  }
}

function stampWorms(baseWorldX: number, baseWorldZ: number): void {
  const minX = baseWorldX - 3;
  const maxX = baseWorldX + 18;
  const minZ = baseWorldZ - 3;
  const maxZ = baseWorldZ + 18;

  for (let n = 0; n < wormPointCount; n++) {
    const o = n * 4;
    const sx = WORM_POINTS_SCRATCH[o]!;
    const sy = WORM_POINTS_SCRATCH[o + 1]!;
    const sz = WORM_POINTS_SCRATCH[o + 2]!;
    const rSq = WORM_POINTS_SCRATCH[o + 3]!;
    const r = Math.sqrt(rSq) + 0.01;

    const x0 = Math.max(minX, Math.ceil(sx - r));
    const x1 = Math.min(maxX, Math.floor(sx + r));
    const z0 = Math.max(minZ, Math.ceil(sz - r));
    const z1 = Math.min(maxZ, Math.floor(sz + r));
    const y0 = Math.max(MIN_CARVE_Y, Math.ceil(sy - r));
    const y1 = Math.min(MAX_CARVE_Y, Math.floor(sy + r));

    for (let z = z0; z <= z1; z++) {
      const dz = z - sz;
      for (let x = x0; x <= x1; x++) {
        const dx = x - sx;
        const dxz = dx * dx + dz * dz;
        if (dxz > rSq) continue;
        const p = (z - minZ) * GRID_DIM + (x - minX);
        const upper = UPPER_SCRATCH[p]!;
        if (upper === 0) continue;
        const lo = Math.max(y0, FLOOR_SCRATCH[p]!);
        const hi = Math.min(y1, upper);
        const base = p * GRID_H;
        for (let y = lo; y <= hi; y++) {
          const dy = y - sy;
          if (dxz + dy * dy <= rSq) RAW_CARVED_GRID[base + y] = 1;
        }
      }
    }
  }
}

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

  const {
    cheeseNoise,
    spag1Noise,
    spag2Noise,
    aquiferLevelNoise,
    aquiferZoneNoise,
    lavaLevelNoise,
    entranceNoise,
    floorSeed,
  } = getCaveSamplers(stageSeed);

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
        // Interior column: highest block that is neither air nor water, found section by section
        const lx = s24x - 4;
        const lz = s24z - 4;
        let colSurfY = -1;

        for (let sy = ChunkColumn.SECTION_COUNT - 1; sy >= 0 && colSurfY < 0; sy--) {
          const section = column.getSection(sy);
          if (!section) continue;
          if (section.getBitsPerEntry() === 0) {
            const uniform = section.uniformStateId;
            if (uniform !== airState && uniform !== waterState) colSurfY = sy * 16 + 15;
            continue;
          }
          for (let ly = 15; ly >= 0; ly--) {
            const state = section.getBlockStateId(lx, ly, lz);
            if (state !== airState && state !== waterState) {
              colSurfY = sy * 16 + ly;
              break;
            }
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

  // 2b. Per padded column (22x22, world -3..+18): carve range, bedrock floor, aquifer and lava levels
  for (let pz = 0; pz < GRID_DIM; pz++) {
    const wz = baseWorldZ + pz - 3;
    for (let px = 0; px < GRID_DIM; px++) {
      const wx = baseWorldX + px - 3;
      const p = pz * GRID_DIM + px;
      const s24x = px + 1; // offset relative to 24x24 grid
      const s24z = pz + 1;

      const surfY = SURFACE_24_SCRATCH[s24z * 24 + s24x]!;
      let minWaterY = surfY < SEA_LEVEL ? surfY : 999;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nSurfY = SURFACE_24_SCRATCH[(s24z + dz) * 24 + (s24x + dx)]!;
          if (nSurfY < SEA_LEVEL && nSurfY < minWaterY) {
            minWaterY = nSurfY;
          }
        }
      }

      UPPER_SCRATCH[p] = 0;
      const maxCarveY = Math.min(surfY, minWaterY - 3);
      if (maxCarveY < MIN_CARVE_Y) continue;

      const entVal = entranceNoise(wx * 0.05, wz * 0.05);
      const isEntranceAllowed = entVal >= 0.65;
      const upperLimit = Math.min(MAX_CARVE_Y, maxCarveY);
      const effectiveUpper = isEntranceAllowed ? upperLimit : Math.min(upperLimit, surfY - 8);
      if (effectiveUpper < MIN_CARVE_Y) continue;

      const floorY = caveFloorY(floorSeed, wx, wz);
      if (effectiveUpper < floorY) continue;

      UPPER_SCRATCH[p] = effectiveUpper;
      FLOOR_SCRATCH[p] = floorY;
      AQUIFER_TOP_SCRATCH[p] = Math.floor(
        20 + ((aquiferLevelNoise(wx * 0.01, wz * 0.01) + 1) / 2) * 36,
      );
      LAVA_TOP_SCRATCH[p] = Math.floor(9 + ((lavaLevelNoise(wx * 0.02, wz * 0.02) + 1) / 2) * 2.9);
    }
  }

  // 3. Lattice cells in use, and how many levels each lattice point must evaluate
  for (let lz = 0; lz < LAT_CELLS; lz++) {
    for (let lx = 0; lx < LAT_CELLS; lx++) {
      let cellUpper = 0;
      const pzLo = Math.max(0, 4 * lz - 1);
      const pzHi = Math.min(GRID_DIM - 1, 4 * lz + 2);
      const pxLo = Math.max(0, 4 * lx - 1);
      const pxHi = Math.min(GRID_DIM - 1, 4 * lx + 2);
      for (let pz = pzLo; pz <= pzHi; pz++) {
        for (let px = pxLo; px <= pxHi; px++) {
          const up = UPPER_SCRATCH[pz * GRID_DIM + px]!;
          if (up > cellUpper) cellUpper = up;
        }
      }
      const cell = lz * LAT_CELLS + lx;
      CHEESE_CELL_TOP[cell] = cellUpper > 0 ? (cellUpper - 4) >> 2 : -1;
      SPAG_CELL_TOP[cell] = cellUpper > 0 ? (cellUpper - 4) >> 1 : -1;
    }
  }
  for (let lz = 0; lz < LAT_N; lz++) {
    for (let lx = 0; lx < LAT_N; lx++) {
      let cheeseTop = -1;
      let spagTop = -1;
      for (let dz = -1; dz <= 0; dz++) {
        for (let dx = -1; dx <= 0; dx++) {
          const clx = lx + dx;
          const clz = lz + dz;
          if (clx < 0 || clz < 0 || clx >= LAT_CELLS || clz >= LAT_CELLS) continue;
          const cell = clz * LAT_CELLS + clx;
          if (CHEESE_CELL_TOP[cell]! > cheeseTop) cheeseTop = CHEESE_CELL_TOP[cell]!;
          if (SPAG_CELL_TOP[cell]! > spagTop) spagTop = SPAG_CELL_TOP[cell]!;
        }
      }
      // A cell with top level t reads corner levels t and t + 1
      const point = lz * LAT_N + lx;
      CHEESE_POINT_LEVELS[point] = cheeseTop >= 0 ? cheeseTop + 2 : 0;
      SPAG_POINT_LEVELS[point] = spagTop >= 0 ? spagTop + 2 : 0;
    }
  }

  // 4. Evaluate cheese, spaghetti-1 and aquifer-zone noise on the lattice
  SPAG2_LATTICE.fill(SPAG2_UNSET);
  for (let lz = 0; lz < LAT_N; lz++) {
    const wz = baseWorldZ - 4 + 4 * lz;
    for (let lx = 0; lx < LAT_N; lx++) {
      const wx = baseWorldX - 4 + 4 * lx;
      const point = lz * LAT_N + lx;

      const cheeseLevels = CHEESE_POINT_LEVELS[point]!;
      const cheeseBase = point * CHEESE_LEVELS;
      for (let k = 0; k < cheeseLevels; k++) {
        CHEESE_LATTICE[cheeseBase + k] = cheeseNoise(wx * 0.018, (4 + 4 * k) * 0.025, wz * 0.018);
      }

      const spagLevels = SPAG_POINT_LEVELS[point]!;
      const spagBase = point * SPAG_LEVELS;
      for (let k = 0; k < spagLevels; k++) {
        SPAG1_LATTICE[spagBase + k] = spag1Noise(wx * 0.022, (4 + 2 * k) * 0.03, wz * 0.022);
      }

      // Aquifer zones only matter at y 12..56 and only below the carve ceiling
      const aqBase = point * AQ_LEVELS;
      const aqLevels = Math.min(15, cheeseLevels);
      for (let k = 2; k < aqLevels; k++) {
        AQUIFER_LATTICE[aqBase + k] = aquiferZoneNoise(wx * 0.015, (4 + 4 * k) * 0.02, wz * 0.015);
      }
    }
  }

  RAW_CARVED_GRID.fill(0);
  CANDIDATE_WATER_GRID.fill(0);
  SUPPORTED_WATER_GRID.fill(0);

  // 5a. Worm carvers
  stampWorms(baseWorldX, baseWorldZ);

  // 5b. Cheese caverns: carve blocks whose interpolated noise exceeds the threshold
  for (let lz = 0; lz < LAT_CELLS; lz++) {
    for (let lx = 0; lx < LAT_CELLS; lx++) {
      const top = CHEESE_CELL_TOP[lz * LAT_CELLS + lx]!;
      if (top < 0) continue;
      const b00 = (lz * LAT_N + lx) * CHEESE_LEVELS;
      const b10 = b00 + CHEESE_LEVELS;
      const b01 = b00 + LAT_N * CHEESE_LEVELS;
      const b11 = b01 + CHEESE_LEVELS;
      const pxLo = Math.max(0, 4 * lx - 1);
      const pxHi = Math.min(GRID_DIM - 1, 4 * lx + 2);
      const pzLo = Math.max(0, 4 * lz - 1);
      const pzHi = Math.min(GRID_DIM - 1, 4 * lz + 2);

      for (let k = 0; k <= top; k++) {
        const c000 = CHEESE_LATTICE[b00 + k]!;
        const c100 = CHEESE_LATTICE[b10 + k]!;
        const c001 = CHEESE_LATTICE[b01 + k]!;
        const c101 = CHEESE_LATTICE[b11 + k]!;
        const c010 = CHEESE_LATTICE[b00 + k + 1]!;
        const c110 = CHEESE_LATTICE[b10 + k + 1]!;
        const c011 = CHEESE_LATTICE[b01 + k + 1]!;
        const c111 = CHEESE_LATTICE[b11 + k + 1]!;
        if (Math.max(c000, c100, c001, c101, c010, c110, c011, c111) <= CHEESE_THRESHOLD) {
          continue;
        }
        const yLo = Math.max(MIN_CARVE_Y, 4 + 4 * k);
        const yHi = Math.min(MAX_CARVE_Y, 7 + 4 * k);

        for (let pz = pzLo; pz <= pzHi; pz++) {
          const fz = ((pz + 1) & 3) * 0.25;
          for (let px = pxLo; px <= pxHi; px++) {
            const p = pz * GRID_DIM + px;
            const upper = UPPER_SCRATCH[p]!;
            if (upper === 0) continue;
            const lo = Math.max(yLo, FLOOR_SCRATCH[p]!);
            const hi = Math.min(yHi, upper);
            if (lo > hi) continue;
            const fx = ((px + 1) & 3) * 0.25;
            // Blend the x/z plane at the cell's lower and upper level, then lerp in y. The
            // interpolant stays between the two plane values, so a plane pair at or below the
            // threshold cannot carve anything.
            const planeLow = bilerp(c000, c100, c001, c101, fx, fz);
            const planeHigh = bilerp(c010, c110, c011, c111, fx, fz);
            if (planeLow <= CHEESE_THRESHOLD && planeHigh <= CHEESE_THRESHOLD) continue;
            const base = p * GRID_H;
            for (let y = lo; y <= hi; y++) {
              const fy = ((y - 4) & 3) * 0.25;
              if (planeLow + (planeHigh - planeLow) * fy > CHEESE_THRESHOLD) {
                RAW_CARVED_GRID[base + y] = 1;
              }
            }
          }
        }
      }
    }
  }

  // 5c. Spaghetti tunnels: thin tubes where both noise fields are close to zero
  for (let lz = 0; lz < LAT_CELLS; lz++) {
    const wzL = baseWorldZ - 4 + 4 * lz;
    for (let lx = 0; lx < LAT_CELLS; lx++) {
      const top = SPAG_CELL_TOP[lz * LAT_CELLS + lx]!;
      if (top < 0) continue;
      const wxL = baseWorldX - 4 + 4 * lx;
      const b00 = (lz * LAT_N + lx) * SPAG_LEVELS;
      const b10 = b00 + SPAG_LEVELS;
      const b01 = b00 + LAT_N * SPAG_LEVELS;
      const b11 = b01 + SPAG_LEVELS;
      const pxLo = Math.max(0, 4 * lx - 1);
      const pxHi = Math.min(GRID_DIM - 1, 4 * lx + 2);
      const pzLo = Math.max(0, 4 * lz - 1);
      const pzHi = Math.min(GRID_DIM - 1, 4 * lz + 2);

      for (let k = 0; k <= top; k++) {
        const a000 = SPAG1_LATTICE[b00 + k]!;
        const a100 = SPAG1_LATTICE[b10 + k]!;
        const a001 = SPAG1_LATTICE[b01 + k]!;
        const a101 = SPAG1_LATTICE[b11 + k]!;
        const a010 = SPAG1_LATTICE[b00 + k + 1]!;
        const a110 = SPAG1_LATTICE[b10 + k + 1]!;
        const a011 = SPAG1_LATTICE[b01 + k + 1]!;
        const a111 = SPAG1_LATTICE[b11 + k + 1]!;
        const minA = Math.min(a000, a100, a001, a101, a010, a110, a011, a111);
        const maxA = Math.max(a000, a100, a001, a101, a010, a110, a011, a111);
        if (minA > SPAG_TUBE_LIMIT || maxA < -SPAG_TUBE_LIMIT) continue;

        // The second field is only needed in cells the first one passes through
        const wyLo = 4 + 2 * k;
        const wyHi = wyLo + 2;
        ensureSpag2(b00 + k, wxL, wyLo, wzL, spag2Noise);
        ensureSpag2(b10 + k, wxL + 4, wyLo, wzL, spag2Noise);
        ensureSpag2(b01 + k, wxL, wyLo, wzL + 4, spag2Noise);
        ensureSpag2(b11 + k, wxL + 4, wyLo, wzL + 4, spag2Noise);
        ensureSpag2(b00 + k + 1, wxL, wyHi, wzL, spag2Noise);
        ensureSpag2(b10 + k + 1, wxL + 4, wyHi, wzL, spag2Noise);
        ensureSpag2(b01 + k + 1, wxL, wyHi, wzL + 4, spag2Noise);
        ensureSpag2(b11 + k + 1, wxL + 4, wyHi, wzL + 4, spag2Noise);
        const s000 = SPAG2_LATTICE[b00 + k]!;
        const s100 = SPAG2_LATTICE[b10 + k]!;
        const s001 = SPAG2_LATTICE[b01 + k]!;
        const s101 = SPAG2_LATTICE[b11 + k]!;
        const s010 = SPAG2_LATTICE[b00 + k + 1]!;
        const s110 = SPAG2_LATTICE[b10 + k + 1]!;
        const s011 = SPAG2_LATTICE[b01 + k + 1]!;
        const s111 = SPAG2_LATTICE[b11 + k + 1]!;

        // n1² + n2² < 0.0014 needs |n2| < 0.0374 somewhere inside the cell
        const minS = Math.min(s000, s100, s001, s101, s010, s110, s011, s111);
        const maxS = Math.max(s000, s100, s001, s101, s010, s110, s011, s111);
        if (
          (minS > 0 && minS * minS >= SPAG_TUBE_RADIUS_SQ) ||
          (maxS < 0 && maxS * maxS >= SPAG_TUBE_RADIUS_SQ)
        ) {
          continue;
        }

        const yLo = Math.max(MIN_CARVE_Y, wyLo);
        const yHi = Math.min(MAX_CARVE_Y, wyLo + 1);
        for (let pz = pzLo; pz <= pzHi; pz++) {
          const fz = ((pz + 1) & 3) * 0.25;
          for (let px = pxLo; px <= pxHi; px++) {
            const p = pz * GRID_DIM + px;
            const upper = UPPER_SCRATCH[p]!;
            if (upper === 0) continue;
            const lo = Math.max(yLo, FLOOR_SCRATCH[p]!);
            const hi = Math.min(yHi, upper);
            if (lo > hi) continue;
            const fx = ((px + 1) & 3) * 0.25;
            const n1Low = bilerp(a000, a100, a001, a101, fx, fz);
            const n1High = bilerp(a010, a110, a011, a111, fx, fz);
            if (
              Math.min(n1Low, n1High) > SPAG_TUBE_LIMIT ||
              Math.max(n1Low, n1High) < -SPAG_TUBE_LIMIT
            ) {
              continue;
            }
            const n2Low = bilerp(s000, s100, s001, s101, fx, fz);
            const n2High = bilerp(s010, s110, s011, s111, fx, fz);
            const base = p * GRID_H;
            for (let y = lo; y <= hi; y++) {
              const fy = ((y - 4) & 1) * 0.5;
              const n1 = n1Low + (n1High - n1Low) * fy;
              if (Math.abs(n1) > SPAG_TUBE_LIMIT) continue;
              const n2 = n2Low + (n2High - n2Low) * fy;
              if (n1 * n1 + n2 * n2 < SPAG_TUBE_RADIUS_SQ) {
                RAW_CARVED_GRID[base + y] = 1;
              }
            }
          }
        }
      }
    }
  }

  // 6. Candidate aquifer water: carved cells at y 12..aquiferTop inside an aquifer zone
  for (let pz = 0; pz < GRID_DIM; pz++) {
    for (let px = 0; px < GRID_DIM; px++) {
      const p = pz * GRID_DIM + px;
      const upper = UPPER_SCRATCH[p]!;
      if (upper === 0) continue;
      const yEnd = Math.min(upper, AQUIFER_TOP_SCRATCH[p]!);
      const yStart = Math.max(12, FLOOR_SCRATCH[p]!);
      if (yStart > yEnd) continue;

      const lx = (px + 1) >> 2;
      const lz = (pz + 1) >> 2;
      const fx = ((px + 1) & 3) * 0.25;
      const fz = ((pz + 1) & 3) * 0.25;
      const b00 = (lz * LAT_N + lx) * AQ_LEVELS;
      const b10 = b00 + AQ_LEVELS;
      const b01 = b00 + LAT_N * AQ_LEVELS;
      const b11 = b01 + AQ_LEVELS;
      const base = p * GRID_H;

      let curK = -1;
      let lowerLevel = 0;
      let upperLevel = 0;
      for (let y = yStart; y <= yEnd; y++) {
        if (RAW_CARVED_GRID[base + y] === 0) continue;
        const k = (y - 4) >> 2;
        if (k !== curK) {
          curK = k;
          lowerLevel = bilerp(
            AQUIFER_LATTICE[b00 + k]!,
            AQUIFER_LATTICE[b10 + k]!,
            AQUIFER_LATTICE[b01 + k]!,
            AQUIFER_LATTICE[b11 + k]!,
            fx,
            fz,
          );
          upperLevel = bilerp(
            AQUIFER_LATTICE[b00 + k + 1]!,
            AQUIFER_LATTICE[b10 + k + 1]!,
            AQUIFER_LATTICE[b01 + k + 1]!,
            AQUIFER_LATTICE[b11 + k + 1]!,
            fx,
            fz,
          );
        }
        const fy = ((y - 4) & 3) * 0.25;
        if (lowerLevel + (upperLevel - lowerLevel) * fy > AQUIFER_ZONE_THRESHOLD) {
          CANDIDATE_WATER_GRID[base + y] = 1;
        }
      }
    }
  }

  // 7. Supported water, bottom to top: a candidate cell needs solid rock or supported water below
  for (let p = 0; p < GRID_COLS; p++) {
    const upper = UPPER_SCRATCH[p]!;
    if (upper < 12) continue;
    const base = p * GRID_H;
    const yLava = LAVA_TOP_SCRATCH[p]!;
    for (let y = Math.max(12, FLOOR_SCRATCH[p]!); y <= upper; y++) {
      if (RAW_CARVED_GRID[base + y] === 0 || CANDIDATE_WATER_GRID[base + y] === 0) continue;
      if (y === 12) {
        if (11 <= yLava || RAW_CARVED_GRID[base + 11] === 0) {
          SUPPORTED_WATER_GRID[base + y] = 1;
        }
      } else if (RAW_CARVED_GRID[base + y - 1] === 0 || SUPPORTED_WATER_GRID[base + y - 1] === 1) {
        SUPPORTED_WATER_GRID[base + y] = 1;
      }
    }
  }

  // 8. Apply carving and aquifer rules to the 16x16 column
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      const p = (z + 3) * GRID_DIM + (x + 3);
      const upper = UPPER_SCRATCH[p]!;
      if (upper === 0) continue;
      const base = p * GRID_H;
      const yLava = LAVA_TOP_SCRATCH[p]!;

      for (let y = FLOOR_SCRATCH[p]!; y <= upper; y++) {
        if (RAW_CARVED_GRID[base + y] === 0) continue;

        if (y < 12) {
          // Lava lakes below y=12
          column.setBlockStateId(x, y, z, y <= yLava ? lavaState : airState);
          continue;
        }

        // Aquifer evaluation:
        // Cell becomes water if and only if self AND ALL carved cells within Manhattan radius 2
        // are supported candidate water!
        let isWater = SUPPORTED_WATER_GRID[base + y] === 1;
        if (isWater) {
          for (let o = 0; o < MANHATTAN_R2_OFFSETS.length; o++) {
            const nIdx = (p + MANHATTAN_R2_OFFSETS[o]!) * GRID_H + y;
            if (RAW_CARVED_GRID[nIdx] === 1 && SUPPORTED_WATER_GRID[nIdx] === 0) {
              isWater = false;
              break;
            }
          }
        }

        if (isWater) {
          column.setBlockStateId(x, y, z, waterState);
        } else if (SUPPORTED_WATER_GRID[base + y] === 1) {
          // Preserve solid stone as barrier to prevent water touching air!
          continue;
        } else {
          column.setBlockStateId(x, y, z, airState);
        }
      }
    }
  }
}

function bilerp(
  v00: number,
  v10: number,
  v01: number,
  v11: number,
  fx: number,
  fz: number,
): number {
  const a = v00 + (v10 - v00) * fx;
  const b = v01 + (v11 - v01) * fx;
  return a + (b - a) * fz;
}

export const caveStage: TerrainStage = {
  name: 'caves',
  generate: generateCaves,
};
