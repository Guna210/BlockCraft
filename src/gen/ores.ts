import { ChunkColumn } from '../world/column';
import { BlockRegistry } from '../world/blocks/registry';
import { deriveSeed, hash3 } from '../engine/rng';
import { detCos, detSin } from './detmath';
import { sampleBiome } from './biomes';
import { TerrainStage } from './pipeline';

/**
 * M03e — Overworld ores (SPEC Appendix A.4): coal, copper, iron, gold and lumite. Skyshard is
 * Hollowdeep-only (M20b) and is never placed here.
 *
 * Veins are seeded from their origin column. Every origin column owns a fixed number of vein
 * attempts per ore band; each attempt has a position (x, z inside the origin column, y from the ore's
 * triangular depth distribution) and a shape seed, all hashed from the world seed, the ore, the
 * origin column and the attempt number. A vein is a set of cells around its origin, a pure function
 * of its shape seed (`buildVein`) and never longer than `VEIN_MAX_REACH` blocks in x, y or z. A column
 * that is generated evaluates the veins of every origin column within that reach (3 x 3 columns) and
 * writes the cells that fall inside itself, so a vein crosses a chunk border without either side
 * reading the other, and the result never depends on generation order or on how many workers run.
 *
 * Where veins overlap, the first one wins: ores are visited in `ORE_SPECS` order, bands in order,
 * origin columns by (z, x), attempts by number, and the same order holds in every column.
 *
 * What a cell becomes ore depends only on the column's own blocks after the cave stage:
 *  - only a stone block is replaced (never Foundation Stone, water, lava, air or anything else);
 *  - never at or above the column's surface (its highest block that is not air, water or lava),
 *    so the top block of a column is never ore;
 *  - never above the ore's maximum height; iron above y 80 only in a column of a mountain biome;
 *  - lumite has a bonus: the cells of a vein's halo (the blocks beside a lumite vein) turn into
 *    ore only where they touch air inside the same column, so lumite coats cave walls.
 *
 * No trigonometry except `detSin` / `detCos` (src/gen/detmath.ts), no Math.random: every choice is
 * an integer hash.
 */

// ---------------------------------------------------------------------------------------------
// Definitions

export type VeinShape = 'blob' | 'streak' | 'lumps' | 'cluster' | 'crystal';

export interface OreBand {
  /** Origin heights follow a triangular distribution: zero at minY and maxY, highest at peakY. */
  minY: number;
  peakY: number;
  maxY: number;
  /** Expected vein origins per origin column (16 x 16 blocks) over the whole band. */
  perColumn: number;
  /** Origins only count where the biome at the origin is a mountain biome. */
  mountainOnly?: boolean;
}

export interface OreSpec {
  id: string;
  shape: VeinShape;
  bands: OreBand[];
  /** No cell above this height, in any biome (SPEC A.4 maximum). */
  maxY: number;
  /** Above this height the ore only appears in a column of a mountain biome. */
  freeMaxY: number;
}

/** Biomes where iron also generates from y 80 up to 256 (SPEC A.4, "mountains"). */
export const MOUNTAIN_BIOMES: readonly string[] = ['frost_peaks', 'stony_heights'];

/**
 * Overworld ores, in placement order. `perColumn` values were calibrated with the counting rule of
 * `decisions/M03e-ore-counting.md`.
 */
export const ORE_SPECS: readonly OreSpec[] = [
  {
    id: 'coal_ore',
    shape: 'blob',
    bands: [{ minY: 0, peakY: 96, maxY: 192, perColumn: 3.4 }],
    maxY: 192,
    freeMaxY: 192,
  },
  {
    id: 'copper_ore',
    shape: 'streak',
    bands: [{ minY: 0, peakY: 48, maxY: 112, perColumn: 0.54 }],
    maxY: 112,
    freeMaxY: 112,
  },
  {
    id: 'iron_ore',
    shape: 'lumps',
    bands: [
      { minY: 0, peakY: 16, maxY: 80, perColumn: 0.53 },
      { minY: 80, peakY: 120, maxY: 256, perColumn: 0.33, mountainOnly: true },
    ],
    maxY: 256,
    freeMaxY: 80,
  },
  {
    id: 'gold_ore',
    shape: 'cluster',
    bands: [{ minY: 0, peakY: 16, maxY: 32, perColumn: 0.36 }],
    maxY: 32,
    freeMaxY: 32,
  },
  {
    id: 'lumite_ore',
    shape: 'crystal',
    bands: [{ minY: 0, peakY: 20, maxY: 40, perColumn: 0.125 }],
    maxY: 40,
    freeMaxY: 40,
  },
];

export const OVERWORLD_ORE_IDS: readonly string[] = ORE_SPECS.map((o) => o.id);

/** The farthest a vein cell lies from its origin along x, y or z. Shapes are built to stay within it. */
export const VEIN_MAX_REACH = 12;
const RING = Math.ceil(VEIN_MAX_REACH / 16);

// ---------------------------------------------------------------------------------------------
// Block ids

interface OreBlocks {
  stone: number;
  ores: number[]; // state id per ORE_SPECS entry
  open: Uint8Array; // 1 for air, water, lava
}

let cachedRegistry: BlockRegistry | null = null;
let cachedBlocks: OreBlocks | null = null;

function getBlocks(): OreBlocks {
  const registry = BlockRegistry.getInstance();
  if (cachedRegistry === registry && cachedBlocks) return cachedBlocks;
  const id = (name: string): number => {
    const st = registry.getStateId(name);
    if (st === undefined) throw new Error(`oreStage: unknown block ${name}`);
    return st;
  };
  const open = new Uint8Array(registry.getMaxStateId() + 1);
  for (const st of registry.getAllStateIds()) {
    const bid = registry.getResolvedState(st)!.blockId;
    if (bid === 'air' || bid === 'water' || bid === 'lava') open[st] = 1;
  }
  cachedBlocks = { stone: id('stone'), ores: ORE_SPECS.map((o) => id(o.id)), open };
  cachedRegistry = registry;
  return cachedBlocks;
}

// ---------------------------------------------------------------------------------------------
// Vein shapes

/** Cells of the vein being built, relative to its origin. kind 0 = core, 1 = halo (lumite only). */
export interface VeinCells {
  count: number;
  dx: Int8Array;
  dy: Int8Array;
  dz: Int8Array;
  kind: Uint8Array;
}

const MAX_CELLS = 160;
const GRID = 33; // offsets -16..16
const markStamp = new Uint32Array(GRID * GRID * GRID);
let stamp = 0;

export function createVeinCells(): VeinCells {
  return {
    count: 0,
    dx: new Int8Array(MAX_CELLS),
    dy: new Int8Array(MAX_CELLS),
    dz: new Int8Array(MAX_CELLS),
    kind: new Uint8Array(MAX_CELLS),
  };
}

function cellIndex(dx: number, dy: number, dz: number): number {
  return dx + 16 + GRID * (dy + 16 + GRID * (dz + 16));
}

/** Adds a cell unless it is already part of the vein (a core cell is never downgraded to halo). */
function addCell(out: VeinCells, dx: number, dy: number, dz: number, kind: number): void {
  if (dx < -VEIN_MAX_REACH || dx > VEIN_MAX_REACH) return;
  if (dy < -VEIN_MAX_REACH || dy > VEIN_MAX_REACH) return;
  if (dz < -VEIN_MAX_REACH || dz > VEIN_MAX_REACH) return;
  if (out.count >= MAX_CELLS) return;
  const idx = cellIndex(dx, dy, dz);
  if (markStamp[idx] === stamp) return;
  markStamp[idx] = stamp;
  const n = out.count++;
  out.dx[n] = dx;
  out.dy[n] = dy;
  out.dz[n] = dz;
  out.kind[n] = kind;
}

function rnd(seed: number, i: number): number {
  return hash3(seed, i, 0x2f1d, 0x71);
}

/** Compact lumpy ellipsoid, radii 1.3-2.3 blocks: coal. */
function buildBlob(seed: number, out: VeinCells): void {
  const a = 1.3 + rnd(seed, 0);
  const b = 1.3 + rnd(seed, 1);
  const c = 1.1 + 0.9 * rnd(seed, 2);
  for (let dz = -3; dz <= 3; dz++) {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const d = (dx * dx) / (a * a) + (dy * dy) / (c * c) + (dz * dz) / (b * b);
        const jitter = hash3(seed, dx + 8, dy + 8, dz + 8) - 0.5;
        if (d + jitter * 0.5 <= 1) addCell(out, dx, dy, dz, 0);
      }
    }
  }
  addCell(out, 0, 0, 0, 0);
}

/** A thin, slightly bent line, 8-13 blocks long, mostly horizontal: copper. */
function buildStreak(seed: number, out: VeinCells): void {
  const theta = 6.283185307179586 * rnd(seed, 0);
  const pitch = (rnd(seed, 1) - 0.5) * 0.9;
  const cp = detCos(pitch);
  const dirX = detCos(theta) * cp;
  const dirY = detSin(pitch);
  const dirZ = detSin(theta) * cp;
  const half = 4 + 2.5 * rnd(seed, 2);
  const bend = (rnd(seed, 3) - 0.5) * 6;
  const perpX = -detSin(theta);
  const perpZ = detCos(theta);
  const rad = 0.75 + 0.35 * rnd(seed, 4);
  const rad2 = rad * rad;
  for (let t = -half; t <= half; t += 0.5) {
    const k = (t / half) * (t / half) * bend;
    const px = dirX * t + perpX * k;
    const py = dirY * t;
    const pz = dirZ * t + perpZ * k;
    const bx = Math.floor(px + 0.5);
    const by = Math.floor(py + 0.5);
    const bz = Math.floor(pz + 0.5);
    for (let dz = bz - 1; dz <= bz + 1; dz++) {
      for (let dy = by - 1; dy <= by + 1; dy++) {
        for (let dx = bx - 1; dx <= bx + 1; dx++) {
          const ex = dx - px;
          const ey = dy - py;
          const ez = dz - pz;
          if (ex * ex + ey * ey + ez * ez <= rad2) addCell(out, dx, dy, dz, 0);
        }
      }
    }
  }
  addCell(out, 0, 0, 0, 0);
}

/** Two or three overlapping round lumps along a short walk: iron. */
function buildLumps(seed: number, out: VeinCells): void {
  const lumps = 2 + Math.floor(rnd(seed, 0) * 2);
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < lumps; i++) {
    const r = 1.1 + 0.6 * rnd(seed, 10 + i);
    const r2 = r * r;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const jitter = hash3(seed, cx + dx + 8 + i * 29, cy + dy + 8, cz + dz + 8) - 0.5;
          if (dx * dx + dy * dy + dz * dz + jitter <= r2)
            addCell(out, cx + dx, cy + dy, cz + dz, 0);
        }
      }
    }
    cx += Math.floor(rnd(seed, 20 + i) * 5) - 2;
    cy += Math.floor(rnd(seed, 30 + i) * 3) - 1;
    cz += Math.floor(rnd(seed, 40 + i) * 5) - 2;
  }
}

/** A handful of touching blocks, 3-6 of them: gold. */
function buildCluster(seed: number, out: VeinCells): void {
  const target = 3 + Math.floor(rnd(seed, 0) * 4);
  addCell(out, 0, 0, 0, 0);
  for (let step = 0; out.count < target && step < 24; step++) {
    const from = Math.floor(rnd(seed, 100 + step) * out.count);
    const dir = Math.floor(rnd(seed, 200 + step) * 6);
    const sign = dir & 1 ? 1 : -1;
    const axis = dir >> 1;
    addCell(
      out,
      out.dx[from]! + (axis === 0 ? sign : 0),
      out.dy[from]! + (axis === 1 ? sign : 0),
      out.dz[from]! + (axis === 2 ? sign : 0),
      0,
    );
  }
}

const ARM_DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [0, 1, 1],
  [0, -1, 1],
  [1, 0, 1],
  [-1, 0, -1],
];

/**
 * A crystal: a core with 2-4 straight arms of 2-3 blocks. Every block beside the core is a halo
 * cell, which becomes ore only where it touches air.
 */
function buildCrystal(seed: number, out: VeinCells): void {
  addCell(out, 0, 0, 0, 0);
  const arms = 2 + Math.floor(rnd(seed, 0) * 3);
  for (let a = 0; a < arms; a++) {
    const d = ARM_DIRS[Math.floor(rnd(seed, 10 + a) * ARM_DIRS.length)]!;
    const len = 2 + Math.floor(rnd(seed, 20 + a) * 2);
    for (let k = 1; k <= len; k++) addCell(out, d[0] * k, d[1] * k, d[2] * k, 0);
  }
  const coreCount = out.count;
  for (let i = 0; i < coreCount; i++) {
    const x = out.dx[i]!;
    const y = out.dy[i]!;
    const z = out.dz[i]!;
    addCell(out, x + 1, y, z, 1);
    addCell(out, x - 1, y, z, 1);
    addCell(out, x, y + 1, z, 1);
    addCell(out, x, y - 1, z, 1);
    addCell(out, x, y, z + 1, 1);
    addCell(out, x, y, z - 1, 1);
  }
}

/** Builds the cells of one vein (relative to its origin) from its shape seed. */
export function buildVein(shape: VeinShape, shapeSeed: number, out: VeinCells): void {
  out.count = 0;
  stamp++;
  switch (shape) {
    case 'blob':
      buildBlob(shapeSeed, out);
      break;
    case 'streak':
      buildStreak(shapeSeed, out);
      break;
    case 'lumps':
      buildLumps(shapeSeed, out);
      break;
    case 'cluster':
      buildCluster(shapeSeed, out);
      break;
    case 'crystal':
      buildCrystal(shapeSeed, out);
      break;
  }
}

// ---------------------------------------------------------------------------------------------
// Vein origins

/** Inverse CDF of the triangular distribution on [lo, hi] with its mode at `peak`. */
export function triangular(lo: number, peak: number, hi: number, u: number): number {
  const f = (peak - lo) / (hi - lo);
  return u < f ? lo + (hi - lo) * Math.sqrt(u * f) : hi - (hi - lo) * Math.sqrt((1 - u) * (1 - f));
}

export interface VeinOrigin {
  x: number;
  y: number;
  z: number;
  shapeSeed: number;
}

/** Vein attempts per origin column and band, as a count: the integer part plus a chance for one more. */
function attemptCount(bandSeed: number, ocx: number, ocz: number, perColumn: number): number {
  const whole = Math.floor(perColumn);
  return whole + (hash3(bandSeed, ocx, ocz, 0x7001) < perColumn - whole ? 1 : 0);
}

/**
 * The origin of attempt `j` of an origin column. Pure in its arguments: the same origin comes out
 * whichever column asks for it.
 */
export function veinOrigin(
  bandSeed: number,
  band: OreBand,
  ocx: number,
  ocz: number,
  j: number,
  out: VeinOrigin,
): void {
  const k = j * 8;
  out.x = ocx * 16 + Math.floor(hash3(bandSeed, ocx, ocz, k) * 16);
  out.z = ocz * 16 + Math.floor(hash3(bandSeed, ocx, ocz, k + 1) * 16);
  out.y = Math.floor(
    triangular(band.minY, band.peakY, band.maxY, hash3(bandSeed, ocx, ocz, k + 2)),
  );
  out.shapeSeed = (hash3(bandSeed, ocx, ocz, k + 3) * 4294967296) >>> 0;
}

/** Number of vein attempts of an origin column and band (exported for tests). */
export function veinAttempts(bandSeed: number, band: OreBand, ocx: number, ocz: number): number {
  return attemptCount(bandSeed, ocx, ocz, band.perColumn);
}

interface StageSeeds {
  stageSeed: number;
  band: number[][]; // [ore][band]
}

let cachedSeeds: StageSeeds | null = null;

export function getBandSeed(stageSeed: number, oreIndex: number, bandIndex: number): number {
  if (!cachedSeeds || cachedSeeds.stageSeed !== stageSeed) {
    cachedSeeds = {
      stageSeed,
      band: ORE_SPECS.map((o, oi) =>
        o.bands.map((_, bi) => deriveSeed(stageSeed, `${o.id}:${bi}:${oi}`)),
      ),
    };
  }
  return cachedSeeds.band[oreIndex]![bandIndex]!;
}

// ---------------------------------------------------------------------------------------------
// The stage

const topY = new Int16Array(256);
const mountainColumn = new Uint8Array(256);
const sectionBuf = new Uint16Array(4096);
const cells = createVeinCells();
const origin: VeinOrigin = { x: 0, y: 0, z: 0, shapeSeed: 0 };

/** Highest block that is not air, water or lava, per column cell (index z * 16 + x); -1 if none. */
function scanSurface(column: ChunkColumn, open: Uint8Array): number {
  topY.fill(-1);
  let unresolved = 256;
  let maxTop = -1;
  for (let sy = ChunkColumn.SECTION_COUNT - 1; sy >= 0 && unresolved > 0; sy--) {
    const section = column.getSection(sy);
    if (!section) continue;
    section.copyBlockStatesTo(sectionBuf);
    for (let ly = 15; ly >= 0; ly--) {
      const base = ly << 8;
      for (let i = 0; i < 256; i++) {
        if (topY[i]! >= 0) continue;
        // section index layout is (y * 16 + z) * 16 + x, i.e. base + z * 16 + x
        if (open[sectionBuf[base + i]!] === 0) {
          const y = sy * 16 + ly;
          topY[i] = y;
          if (y > maxTop) maxTop = y;
          unresolved--;
        }
      }
    }
  }
  return maxTop;
}

export function generateOres(stageSeed: number, cx: number, cz: number, column: ChunkColumn): void {
  const worldSeed = column.worldSeed;
  if (worldSeed === undefined) {
    throw new Error('generateOres requires column.worldSeed to be set');
  }
  const blocks = getBlocks();
  const x0 = cx * 16;
  const z0 = cz * 16;

  const maxTop = scanSurface(column, blocks.open);
  if (maxTop < 1) return;
  for (let i = 0; i < 256; i++) {
    mountainColumn[i] = MOUNTAIN_BIOMES.includes(column.biomes[i]!) ? 1 : 0;
  }

  for (let oi = 0; oi < ORE_SPECS.length; oi++) {
    const spec = ORE_SPECS[oi]!;
    const oreState = blocks.ores[oi]!;
    for (let bi = 0; bi < spec.bands.length; bi++) {
      const band = spec.bands[bi]!;
      if (band.minY >= maxTop) continue;
      const bandSeed = getBandSeed(stageSeed, oi, bi);
      for (let dz = -RING; dz <= RING; dz++) {
        for (let dx = -RING; dx <= RING; dx++) {
          const ocx = cx + dx;
          const ocz = cz + dz;
          const n = attemptCount(bandSeed, ocx, ocz, band.perColumn);
          for (let j = 0; j < n; j++) {
            veinOrigin(bandSeed, band, ocx, ocz, j, origin);
            // Reach test in x and z; and the vein must start below the highest surface of this column
            if (origin.x + VEIN_MAX_REACH < x0 || origin.x - VEIN_MAX_REACH > x0 + 15) continue;
            if (origin.z + VEIN_MAX_REACH < z0 || origin.z - VEIN_MAX_REACH > z0 + 15) continue;
            if (origin.y - VEIN_MAX_REACH >= maxTop) continue;
            if (
              band.mountainOnly &&
              !MOUNTAIN_BIOMES.includes(sampleBiome(worldSeed, origin.x, origin.z))
            )
              continue;

            buildVein(spec.shape, origin.shapeSeed, cells);
            for (let c = 0; c < cells.count; c++) {
              const lx = origin.x + cells.dx[c]! - x0;
              const lz = origin.z + cells.dz[c]! - z0;
              if (lx < 0 || lx > 15 || lz < 0 || lz > 15) continue;
              const y = origin.y + cells.dy[c]!;
              if (y < 0 || y > spec.maxY) continue;
              const idx = lz * 16 + lx;
              if (y > spec.freeMaxY && mountainColumn[idx] === 0) continue;
              if (y >= topY[idx]!) continue;
              if (column.getBlockStateId(lx, y, lz) !== blocks.stone) continue;
              if (cells.kind[c] === 1 && !touchesAir(column, lx, y, lz)) continue;
              column.setBlockStateId(lx, y, lz, oreState);
            }
          }
        }
      }
    }
  }
}

/** True when one of the six neighbours inside this column is air. Neighbours across a border are not read. */
function touchesAir(column: ChunkColumn, lx: number, y: number, lz: number): boolean {
  return (
    (lx > 0 && column.getBlockStateId(lx - 1, y, lz) === 0) ||
    (lx < 15 && column.getBlockStateId(lx + 1, y, lz) === 0) ||
    (lz > 0 && column.getBlockStateId(lx, y, lz - 1) === 0) ||
    (lz < 15 && column.getBlockStateId(lx, y, lz + 1) === 0) ||
    (y > 0 && column.getBlockStateId(lx, y - 1, lz) === 0) ||
    column.getBlockStateId(lx, y + 1, lz) === 0
  );
}

export const oreStage: TerrainStage = {
  name: 'ores',
  generate: generateOres,
};
