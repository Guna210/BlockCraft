import { ChunkColumn } from '../world/column';
import { BlockRegistry } from '../world/blocks/registry';
import { deriveSeed, hash2, hash3 } from '../engine/rng';
import { OverworldBiomeId, sampleBiome } from './biomes';
import { TerrainStage } from './pipeline';
import { SEA_LEVEL } from './terrain';
import { sampleTerrainTopY } from './terrain-height';
import {
  CAVE_ENTRANCE_THRESHOLD,
  GroundContext,
  GroundProbe,
  caveEntranceAt,
  createGroundProbe,
  getGroundContext,
  probeGround,
} from './ground';

/**
 * M03f — surface features: five tree families (oak, birch, pine, rainwood, acacia), boulders, ice
 * spikes, and the plants that grow on the ground: tall grass, flowers, mushrooms, pumpkins,
 * cacti and sugar reeds.
 *
 * Seamless and order independent. Features that span several columns (trees, boulders, ice
 * spikes) are keyed by an origin on a jittered 4x4 grid. A column evaluates every origin whose
 * blocks can reach it, so each column that a feature touches decides about the same feature from
 * the same inputs: the world seed, the origin, and `probeGround`, a prediction of what the earlier
 * stages leave at the origin (it never reads another column's blocks). Plants occupy one cell and
 * read the column's own blocks.
 *
 * Priority where features meet: a rank decides between competing origins (a lower-ranked origin
 * closer than the two features' clearances is dropped); logs, boulders and spikes go in before any
 * leaf and only into air (logs may replace leaves); leaves go in rank order and only into air;
 * plants go in last, in the order cactus, reeds, pumpkin, mushroom, flower, tall grass, and only
 * into air above a valid support. Nothing ever replaces a terrain block or water.
 *
 * No trigonometry and no Math.random: positions, shapes and choices come from integer hashes.
 */

// ---------------------------------------------------------------------------------------------
// Block ids

interface FeatureBlocks {
  logY: Record<TreeFamily, number>;
  logX: Record<TreeFamily, number>;
  logZ: Record<TreeFamily, number>;
  leaves: Record<TreeFamily, number>;
  stone: number;
  cobblestone: number;
  mossy: number;
  packedIce: number;
  cactus: number;
  pumpkin: number;
  reeds: number;
  tallGrass: number;
  flowers: number[]; // 8 flowers, see FLOWER_IDS
  brownMushroom: number;
  redMushroom: number;
  water: number;
  lava: number;
  /** 1 for every state that is a full opaque cube: the blocks something can stand on. */
  opaque: Uint8Array;
  grass: number;
  dirt: number;
  sand: number;
  gravel: number;
  mire: number;
  clay: number;
  snow: number;
}

type TreeFamily = 'oak' | 'birch' | 'pine' | 'rainwood' | 'acacia';
const FAMILIES: TreeFamily[] = ['oak', 'birch', 'pine', 'rainwood', 'acacia'];

export const FLOWER_IDS = [
  'bluebell',
  'buttercup',
  'marigold',
  'violet',
  'daisy',
  'wild_rose',
  'lupine',
  'heather',
] as const;

let cachedRegistry: BlockRegistry | null = null;
let cachedBlocks: FeatureBlocks | null = null;

function getBlocks(): FeatureBlocks {
  const registry = BlockRegistry.getInstance();
  if (cachedRegistry === registry && cachedBlocks) return cachedBlocks;
  const id = (name: string, props?: Record<string, string | number>): number => {
    const st = registry.getStateId(name, props);
    if (st === undefined) throw new Error(`featureStage: unknown block ${name}`);
    return st;
  };
  const logY = {} as Record<TreeFamily, number>;
  const logX = {} as Record<TreeFamily, number>;
  const logZ = {} as Record<TreeFamily, number>;
  const leaves = {} as Record<TreeFamily, number>;
  for (const f of FAMILIES) {
    logY[f] = id(`${f}_log`, { axis: 'y' });
    logX[f] = id(`${f}_log`, { axis: 'x' });
    logZ[f] = id(`${f}_log`, { axis: 'z' });
    leaves[f] = id(`${f}_leaves`);
  }
  const opaque = new Uint8Array(registry.getMaxStateId() + 1);
  for (const st of registry.getAllStateIds()) {
    if (registry.getResolvedState(st)!.definition.fullOpaqueCube) opaque[st] = 1;
  }
  cachedBlocks = {
    logY,
    logX,
    logZ,
    leaves,
    stone: id('stone'),
    cobblestone: id('cobblestone'),
    mossy: id('mossy_cobblestone'),
    packedIce: id('packed_ice'),
    cactus: id('cactus'),
    pumpkin: id('pumpkin'),
    reeds: id('sugar_reeds'),
    tallGrass: id('tall_grass'),
    flowers: FLOWER_IDS.map((f) => id(f)),
    brownMushroom: id('brown_mushroom'),
    redMushroom: id('red_mushroom'),
    water: id('water'),
    lava: id('lava'),
    opaque,
    grass: id('grass_block'),
    dirt: id('dirt'),
    sand: id('sand'),
    gravel: id('gravel'),
    mire: id('mire'),
    clay: id('clay'),
    snow: id('snow'),
  };
  cachedRegistry = registry;
  return cachedBlocks;
}

// ---------------------------------------------------------------------------------------------
// Large features: types, reach, clearance

export const FeatureType = {
  Oak: 0,
  Birch: 1,
  PineSmall: 2,
  PineBig: 3,
  RainwoodSmall: 4,
  RainwoodBig: 5,
  Acacia: 6,
  Boulder: 7,
  IceSpike: 8,
} as const;

export const FEATURE_TYPE_NAMES = [
  'oak',
  'birch',
  'pine',
  'pine_big',
  'rainwood',
  'rainwood_big',
  'acacia',
  'boulder',
  'ice_spike',
] as const;

/** Largest horizontal distance (blocks) from the origin to any block of the feature. */
const REACH = [4, 2, 3, 6, 4, 8, 5, 2, 1];
/** Clearance: two origins closer than clearA + clearB + 1 (Chebyshev) cannot both exist. */
const CLEAR = [1, 1, 1, 3, 1, 3, 2, 2, 1];
const MAX_REACH = 8;
const MAX_CLEAR_DIST = 7; // 3 + 3 + 1
const CELL = 4;
/** Cells around the column window that are consulted for clearance. */
const CELL_MARGIN = Math.ceil(MAX_CLEAR_DIST / CELL);

function isBig(type: number): boolean {
  return type === FeatureType.PineBig || type === FeatureType.RainwoodBig;
}

function isTree(type: number): boolean {
  return type <= FeatureType.Acacia;
}

// ---------------------------------------------------------------------------------------------
// Densities per biome (probability that a 4x4 cell holds a large feature, by class) and the mix
// of tree types. Appendix C: dense in the forest biomes and rainforest, sparse in plains,
// savanna and snowy tundra, none in desert, badlands, beach, oceans and rivers.

const BIOME_COUNT = 19;
const BIOME_INDEX: Record<OverworldBiomeId, number> = {
  plains: 0,
  meadow: 1,
  oakwood_forest: 2,
  birch_grove: 3,
  pine_taiga: 4,
  snowy_tundra: 5,
  frost_peaks: 6,
  stony_heights: 7,
  desert: 8,
  badlands: 9,
  savanna: 10,
  swampland: 11,
  rainforest: 12,
  beach: 13,
  stony_shore: 14,
  river: 15,
  ocean: 16,
  deep_ocean: 17,
  frozen_ocean: 18,
};

interface LargeBiomeRule {
  tree: number; // probability per cell
  boulder: number;
  spike: number;
  /** Cumulative weights over [Oak, Birch, PineSmall, PineBig, RainwoodSmall, RainwoodBig, Acacia]. */
  mix: number[];
}

function mix(...w: number[]): number[] {
  const total = w.reduce((a, b) => a + b, 0);
  let acc = 0;
  const cumulative = w.map((x) => (acc += x / total));
  cumulative[cumulative.length - 1] = 2; // rounding must never push a roll past the last type
  return cumulative;
}

const NO_FEATURES: LargeBiomeRule = {
  tree: 0,
  boulder: 0,
  spike: 0,
  mix: mix(1, 0, 0, 0, 0, 0, 0),
};

const LARGE_RULES: LargeBiomeRule[] = new Array<LargeBiomeRule>(BIOME_COUNT).fill(NO_FEATURES);
function rule(biome: OverworldBiomeId, r: Partial<LargeBiomeRule>): void {
  LARGE_RULES[BIOME_INDEX[biome]] = { ...NO_FEATURES, ...r };
}
rule('plains', { tree: 0.04, mix: mix(1, 0, 0, 0, 0, 0, 0) });
rule('meadow', { tree: 0.06, mix: mix(3, 2, 0, 0, 0, 0, 0) });
rule('oakwood_forest', { tree: 0.55, mix: mix(17, 3, 0, 0, 0, 0, 0) });
rule('birch_grove', { tree: 0.45, mix: mix(1, 9, 0, 0, 0, 0, 0) });
rule('pine_taiga', { tree: 0.55, boulder: 0.03, mix: mix(0, 0, 88, 12, 0, 0, 0) });
rule('snowy_tundra', { tree: 0.03, spike: 0.04, mix: mix(0, 0, 1, 0, 0, 0, 0) });
rule('frost_peaks', { boulder: 0.02 });
rule('stony_heights', { boulder: 0.05 });
rule('savanna', { tree: 0.05, mix: mix(0, 0, 0, 0, 0, 0, 1) });
rule('swampland', { tree: 0.22, mix: mix(1, 0, 0, 0, 0, 0, 0) });
rule('rainforest', { tree: 0.8, mix: mix(1, 0, 0, 0, 5, 5, 0) });
rule('stony_shore', { boulder: 0.04 });

// ---------------------------------------------------------------------------------------------
// Cell lists: blocks of one feature, relative to its origin and its base height

const MAX_CELLS = 3072;
const CELL_DX = new Int16Array(MAX_CELLS);
const CELL_DY = new Int16Array(MAX_CELLS);
const CELL_DZ = new Int16Array(MAX_CELLS);
const CELL_KIND = new Uint8Array(MAX_CELLS);
let cellCount = 0;

const K_LOG_Y = 0;
const K_LOG_X = 1;
const K_LOG_Z = 2;
const K_LEAVES = 3;
const K_STONE = 4; // boulder block; the material is chosen at placement
const K_ICE = 5;

function push(dx: number, dy: number, dz: number, kind: number): void {
  if (cellCount >= MAX_CELLS) return;
  CELL_DX[cellCount] = dx;
  CELL_DY[cellCount] = dy;
  CELL_DZ[cellCount] = dz;
  CELL_KIND[cellCount] = kind;
  cellCount++;
}

/** Deterministic roll in [0, 1) for a feature, by purpose. */
function roll(seed: number, ox: number, oz: number, salt: number): number {
  return hash3(seed, ox, salt, oz);
}

/** Leaves of one layer: all cells with dx² + dz² <= lim around (cx, cz), a share trimmed away. */
function leafLayer(
  seed: number,
  cx: number,
  cy: number,
  cz: number,
  lim: number,
  trim: number,
): void {
  let r = 0;
  while ((r + 1) * (r + 1) <= lim) r++;
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dz * dz > lim) continue;
      if (trim > 0 && hash3(seed, cx + dx, cy, cz + dz) < trim) continue;
      push(cx + dx, cy, cz + dz, K_LEAVES);
    }
  }
}

/**
 * Leaves of one layer around the centre of a 2x2 trunk (which covers dx 0..1, dz 0..1): all cells
 * whose centre is within `rad2` half-blocks of the trunk's centre.
 */
function leafLayerBig(seed: number, cy: number, rad2: number, trim: number): void {
  const reach = (rad2 >> 1) + 1;
  const lim = rad2 * rad2 + rad2;
  for (let dz = -reach; dz <= reach + 1; dz++) {
    for (let dx = -reach; dx <= reach + 1; dx++) {
      const a = 2 * dx - 1;
      const b = 2 * dz - 1;
      if (a * a + b * b > lim) continue;
      if (trim > 0 && hash3(seed, dx, cy, dz) < trim) continue;
      push(dx, cy, dz, K_LEAVES);
    }
  }
}

function trunk(height: number): void {
  for (let dy = 0; dy < height; dy++) push(0, dy, 0, K_LOG_Y);
}

function trunkBig(height: number): void {
  for (let dy = 0; dy < height; dy++) {
    push(0, dy, 0, K_LOG_Y);
    push(1, dy, 0, K_LOG_Y);
    push(0, dy, 1, K_LOG_Y);
    push(1, dy, 1, K_LOG_Y);
  }
}

function buildOak(seed: number, ox: number, oz: number): void {
  const h = 4 + Math.floor(roll(seed, ox, oz, 1) * 3); // trunk of 4..6 logs
  const wide = roll(seed, ox, oz, 2) < 0.22;
  const r = wide ? 3 : 2;
  const shiftX = roll(seed, ox, oz, 3) < 0.2 ? (roll(seed, ox, oz, 4) < 0.5 ? -1 : 1) : 0;
  const shiftZ = roll(seed, ox, oz, 5) < 0.2 ? (roll(seed, ox, oz, 6) < 0.5 ? -1 : 1) : 0;
  const lim = (rr: number) => (rr <= 1 ? 1 : rr * rr + 1);
  trunk(h);
  leafLayer(seed, shiftX, h - 3, shiftZ, lim(r), 0.1);
  leafLayer(seed, shiftX, h - 2, shiftZ, lim(r), 0.1);
  leafLayer(seed, shiftX, h - 1, shiftZ, lim(r - 1), 0.1);
  leafLayer(seed, shiftX, h, shiftZ, lim(r - 1), 0.08);
  leafLayer(seed, shiftX, h + 1, shiftZ, 1, 0);
}

function buildBirch(seed: number, ox: number, oz: number): void {
  const h = 5 + Math.floor(roll(seed, ox, oz, 1) * 4); // 5..8
  trunk(h);
  leafLayer(seed, 0, h - 2, 0, 5, 0.1);
  leafLayer(seed, 0, h - 1, 0, 5, 0.1);
  leafLayer(seed, 0, h, 0, 2, 0.05);
  leafLayer(seed, 0, h + 1, 0, 1, 0);
}

const PINE_RADIUS = [0, 1, 1, 2, 1, 2, 2, 3, 2, 3, 3, 3, 3, 3, 3, 3];

function buildPineSmall(seed: number, ox: number, oz: number): void {
  const h = 6 + Math.floor(roll(seed, ox, oz, 1) * 5); // 6..10
  const maxR = roll(seed, ox, oz, 2) < 0.5 ? 2 : 3;
  trunk(h + 1);
  const bottom = Math.max(2, Math.floor(h / 3));
  for (let dy = h + 1; dy >= bottom; dy--) {
    const d = h + 1 - dy;
    const r = Math.min(maxR, PINE_RADIUS[Math.min(d, 15)]!);
    const lim = r === 0 ? 0 : r === 1 ? 1 : r * r + 1;
    leafLayer(seed, 0, dy, 0, lim, d === 0 ? 0 : 0.06);
  }
}

function buildPineBig(seed: number, ox: number, oz: number): void {
  const h = 14 + Math.floor(roll(seed, ox, oz, 1) * 9); // 14..22
  trunkBig(h + 1);
  const bottom = 4 + Math.floor(roll(seed, ox, oz, 2) * 3);
  const widest = 8 + Math.floor(roll(seed, ox, oz, 3) * 4); // widest ring: 4..5.5 blocks from the centre
  for (let dy = h + 1; dy >= bottom; dy--) {
    const d = h + 1 - dy;
    let rad2 = d === 0 ? 1 : Math.min(widest, 2 + Math.floor((d * 3 + 2) / 4));
    if (d > 3 && d % 3 === 0) rad2 = Math.max(2, rad2 - 2); // tiers
    if (dy < bottom + 3) rad2 = Math.max(2, rad2 - 2); // the skirt tapers off
    leafLayerBig(seed, dy, rad2, d === 0 ? 0 : 0.05);
  }
}

function buildRainwoodSmall(seed: number, ox: number, oz: number): void {
  const h = 11 + Math.floor(roll(seed, ox, oz, 1) * 6); // 11..16
  trunk(h);
  const lim = [5, 10, 10, 10, 5, 1];
  for (let i = 0; i < 6; i++) leafLayer(seed, 0, h - 3 + i, 0, lim[i]!, 0.12);
}

function buildRainwoodBig(seed: number, ox: number, oz: number): void {
  const h = 18 + Math.floor(roll(seed, ox, oz, 1) * 11); // 18..28
  trunkBig(h);
  // main canopy
  const rad2 = [8, 11, 12, 11, 8, 5];
  for (let i = 0; i < 6; i++) leafLayerBig(seed, h - 2 + i, rad2[i]!, 0.1);
  // lateral branches with their own leaf clusters; each is a run of horizontal logs
  const branches = 3 + (roll(seed, ox, oz, 2) < 0.5 ? 1 : 0);
  for (let i = 0; i < branches; i++) {
    const dir = Math.floor(roll(seed, ox, oz, 10 + i) * 8); // 0..7 around the trunk
    const dxs = [1, 1, 0, -1, -1, -1, 0, 1][dir]!;
    const dzs = [0, 1, 1, 1, 0, -1, -1, -1][dir]!;
    const len = 3 + Math.floor(roll(seed, ox, oz, 20 + i) * 2); // 3..4
    const by = h - 6 - i * 3 - Math.floor(roll(seed, ox, oz, 30 + i) * 2);
    if (by < 6) continue;
    // the run starts at the trunk's outer edge facing the direction
    const ex = dxs > 0 ? 1 : 0;
    const ez = dzs > 0 ? 1 : 0;
    let bx = ex;
    let bz = ez;
    for (let s = 1; s <= len; s++) {
      bx = ex + dxs * s;
      bz = ez + dzs * s;
      // a diagonal step goes through the cell beside it, so that every log touches the previous one
      if (dxs !== 0 && dzs !== 0) push(bx - dxs, by, bz, K_LOG_X);
      push(bx, by, bz, dzs === 0 ? K_LOG_X : K_LOG_Z);
    }
    for (let dy = 0; dy < 3; dy++) leafLayer(seed, bx, by + dy, bz, dy === 1 ? 5 : 2, 0.1);
  }
}

function buildAcacia(seed: number, ox: number, oz: number): void {
  const t1 = 2 + Math.floor(roll(seed, ox, oz, 1) * 2); // straight part: 2..3
  const dirA = Math.floor(roll(seed, ox, oz, 2) * 4);
  const ax = [1, -1, 0, 0][dirA]!;
  const az = [0, 0, 1, -1][dirA]!;
  const lean = 1 + Math.floor(roll(seed, ox, oz, 3) * 2); // 1..2 blocks sideways
  const h2 = 1 + Math.floor(roll(seed, ox, oz, 4) * 2); // rises 1..2 after the lean
  trunk(t1 + 1);
  // lean: horizontal logs at the top of the straight part
  for (let s = 1; s <= lean; s++) push(ax * s, t1, az * s, ax !== 0 ? K_LOG_X : K_LOG_Z);
  const cx = ax * lean;
  const cz = az * lean;
  for (let dy = 1; dy <= h2; dy++) push(cx, t1 + dy, cz, K_LOG_Y);
  const topA = t1 + h2;
  // flat crown: a wide disc with a narrower one on top
  leafLayer(seed, cx, topA + 1, cz, 10, 0.08);
  leafLayer(seed, cx, topA + 2, cz, 5, 0.08);
  // a second, lower branch the other way
  if (roll(seed, ox, oz, 5) < 0.65) {
    const bx = -ax;
    const bz = -az;
    push(bx, t1, bz, bx !== 0 ? K_LOG_X : K_LOG_Z);
    push(bx * 2, t1, bz * 2, bx !== 0 ? K_LOG_X : K_LOG_Z);
    push(bx * 2, t1 + 1, bz * 2, K_LOG_Y);
    leafLayer(seed, bx * 2, t1 + 2, bz * 2, 5, 0.08);
    leafLayer(seed, bx * 2, t1 + 3, bz * 2, 2, 0.05);
  }
}

function buildBoulder(seed: number, ox: number, oz: number): void {
  const big = roll(seed, ox, oz, 1) < 0.4;
  if (!big) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (hash3(seed, ox + dx, 0, oz + dz) < 0.12 && dx * dx + dz * dz === 2) continue;
        push(dx, 0, dz, K_STONE);
      }
    }
    push(0, 1, 0, K_STONE);
    if (roll(seed, ox, oz, 2) < 0.5) push(1, 1, 0, K_STONE);
    return;
  }
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const d2 = dx * dx + dz * dz;
      if (d2 <= 5 && !(d2 === 5 && hash3(seed, ox + dx, 0, oz + dz) < 0.3))
        push(dx, 0, dz, K_STONE);
      if (d2 <= 2) push(dx, 1, dz, K_STONE);
    }
  }
  push(0, 2, 0, K_STONE);
  if (roll(seed, ox, oz, 3) < 0.6) push(-1, 2, 0, K_STONE);
}

function buildIceSpike(seed: number, ox: number, oz: number): void {
  const h = 4 + Math.floor(roll(seed, ox, oz, 1) * 10); // 4..13
  for (let dy = 0; dy < h; dy++) {
    push(0, dy, 0, K_ICE);
    if (dy < 2) {
      push(1, dy, 0, K_ICE);
      push(-1, dy, 0, K_ICE);
      push(0, dy, 1, K_ICE);
      push(0, dy, -1, K_ICE);
    } else if (dy === 2 && roll(seed, ox, oz, 2) < 0.5) {
      push(1, dy, 0, K_ICE);
    }
  }
}

function buildFeature(type: number, seed: number, ox: number, oz: number): void {
  cellCount = 0;
  switch (type) {
    case FeatureType.Oak:
      buildOak(seed, ox, oz);
      break;
    case FeatureType.Birch:
      buildBirch(seed, ox, oz);
      break;
    case FeatureType.PineSmall:
      buildPineSmall(seed, ox, oz);
      break;
    case FeatureType.PineBig:
      buildPineBig(seed, ox, oz);
      break;
    case FeatureType.RainwoodSmall:
      buildRainwoodSmall(seed, ox, oz);
      break;
    case FeatureType.RainwoodBig:
      buildRainwoodBig(seed, ox, oz);
      break;
    case FeatureType.Acacia:
      buildAcacia(seed, ox, oz);
      break;
    case FeatureType.Boulder:
      buildBoulder(seed, ox, oz);
      break;
    default:
      buildIceSpike(seed, ox, oz);
  }
}

// ---------------------------------------------------------------------------------------------
// Origins on the cell grid

/** Cells of the window: gx from gx0 to gx0 + W - 1. */
const WINDOW_CELLS = Math.ceil((16 + 2 * (MAX_REACH + MAX_CLEAR_DIST)) / CELL) + 2;
const CAND_CLASS = new Int8Array(WINDOW_CELLS * WINDOW_CELLS); // 0 none, 1 tree, 2 boulder, 3 spike
const CAND_TYPE = new Int8Array(WINDOW_CELLS * WINDOW_CELLS);
const CAND_X = new Int32Array(WINDOW_CELLS * WINDOW_CELLS);
const CAND_Z = new Int32Array(WINDOW_CELLS * WINDOW_CELLS);
const CAND_RANK = new Float64Array(WINDOW_CELLS * WINDOW_CELLS);

/** Biome sampled on an 8-block lattice, shared by the cells around it. */
const BIOME_LATTICE_N = Math.ceil((WINDOW_CELLS * CELL) / 8) + 2;
const BIOME_LATTICE = new Int8Array(BIOME_LATTICE_N * BIOME_LATTICE_N);

export interface FeatureOrigin {
  type: number;
  /** Origin of the feature (the trunk, or the lowest corner of a 2x2 trunk). */
  x: number;
  z: number;
  /** Height of the first block of the feature. */
  baseY: number;
  rank: number;
  /** Hash seed of the feature's shape. */
  shapeSeed: number;
}

const MAX_ACCEPTED = 128;
/** Largest share of 4x4 cells that any biome fills with a large feature. */
const MAX_CELL_SHARE = 0.85;

function collectOrigins(
  worldSeed: number,
  x0: number,
  z0: number,
  boxReach: boolean,
  out: FeatureOrigin[],
): number {
  const ctx = getGroundContext(worldSeed);
  const gridSeed = deriveSeed(worldSeed, 'features');
  const originSeed = deriveSeed(gridSeed, 'origins');
  const shapeBase = deriveSeed(gridSeed, 'shapes');

  const margin = MAX_REACH + MAX_CLEAR_DIST;
  const gx0 = Math.floor((x0 - margin) / CELL);
  const gz0 = Math.floor((z0 - margin) / CELL);
  const gx1 = Math.floor((x0 + 15 + margin) / CELL);
  const gz1 = Math.floor((z0 + 15 + margin) / CELL);
  const W = gx1 - gx0 + 1;
  const H = gz1 - gz0 + 1;

  // Lattice biome window
  const bx0 = Math.floor((gx0 * CELL) / 8);
  const bz0 = Math.floor((gz0 * CELL) / 8);
  const BW = Math.floor((gx1 * CELL + CELL - 1) / 8) - bx0 + 1;
  const BH = Math.floor((gz1 * CELL + CELL - 1) / 8) - bz0 + 1;
  BIOME_LATTICE.fill(-1, 0, BW * BH);

  // 1. Origin of every cell and the class and type it holds
  for (let j = 0; j < H; j++) {
    const gz = gz0 + j;
    for (let i = 0; i < W; i++) {
      const gx = gx0 + i;
      const k = j * W + i;
      CAND_CLASS[k] = 0;
      const u = hash2(originSeed, gx, gz);
      if (u >= MAX_CELL_SHARE) continue; // no biome has more than this share of cells
      const px = gx * CELL + Math.floor(hash3(originSeed, gx, gz, 1) * CELL);
      const pz = gz * CELL + Math.floor(hash3(originSeed, gx, gz, 2) * CELL);
      // biome from the 8-block lattice
      const lx = (px >> 3) - bx0;
      const lz = (pz >> 3) - bz0;
      const li = lz * BW + lx;
      let bi = BIOME_LATTICE[li]!;
      if (bi < 0) {
        bi = BIOME_INDEX[sampleBiome(worldSeed, ((px >> 3) << 3) + 4, ((pz >> 3) << 3) + 4)];
        BIOME_LATTICE[li] = bi;
      }
      const rule = LARGE_RULES[bi]!;
      let cls = 0;
      if (u < rule.tree) cls = 1;
      else if (u < rule.tree + rule.boulder) cls = 2;
      else if (u < rule.tree + rule.boulder + rule.spike) cls = 3;
      if (cls === 0) continue;
      let type: number;
      if (cls === 1) {
        const t = hash3(originSeed, gx, gz, 3);
        type = 0;
        while (type < 6 && t >= rule.mix[type]!) type++;
      } else {
        type = cls === 2 ? FeatureType.Boulder : FeatureType.IceSpike;
      }
      CAND_CLASS[k] = cls;
      CAND_TYPE[k] = type;
      CAND_X[k] = px;
      CAND_Z[k] = pz;
      CAND_RANK[k] = hash3(originSeed, gx, gz, 4);
    }
  }

  // 2. Keep the origins that can reach the column, drop those out-ranked by a close neighbour,
  //    then check the ground under what is left
  const probe = createGroundProbe();
  const probe2 = createGroundProbe();
  let count = 0;
  const cMargin = CELL_MARGIN;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      if (CAND_CLASS[k] === 0) continue;
      const type = CAND_TYPE[k]!;
      const px = CAND_X[k]!;
      const pz = CAND_Z[k]!;
      if (boxReach) {
        const r = REACH[type]!;
        if (px + r < x0 || px - r > x0 + 15 || pz + r < z0 || pz - r > z0 + 15) continue;
        if (isBig(type) && (px + 1 + r < x0 || pz + 1 + r < z0)) continue;
      } else if (px < x0 || px > x0 + 15 || pz < z0 || pz > z0 + 15) {
        continue;
      }

      // clearance against the origins of nearby cells
      let blocked = false;
      for (let dj = -cMargin; dj <= cMargin && !blocked; dj++) {
        const nj = j + dj;
        if (nj < 0 || nj >= H) continue;
        for (let di = -cMargin; di <= cMargin; di++) {
          const ni = i + di;
          if (ni < 0 || ni >= W || (di === 0 && dj === 0)) continue;
          const n = nj * W + ni;
          if (CAND_CLASS[n] === 0) continue;
          const rn = CAND_RANK[n]!;
          const rk = CAND_RANK[k]!;
          if (rn < rk || (rn === rk && n < k)) continue;
          const dist = Math.max(Math.abs(CAND_X[n]! - px), Math.abs(CAND_Z[n]! - pz));
          if (dist < CLEAR[type]! + CLEAR[CAND_TYPE[n]!]! + 1) {
            blocked = true;
            break;
          }
        }
      }
      if (blocked) continue;

      const baseY = validateGround(ctx, type, px, pz, probe, probe2);
      if (baseY < 0 || count >= MAX_ACCEPTED) continue;
      const o = out[count]!;
      o.type = type;
      o.x = px;
      o.z = pz;
      o.baseY = baseY;
      o.rank = CAND_RANK[k]!;
      o.shapeSeed = deriveSeed(shapeBase, `${px},${pz}`);
      count++;
    }
  }
  return count;
}

/** The entrance noise has a gradient of at most about 0.14 per block; 0.35 leaves 2 blocks of margin. */
const ENTRANCE_SAFE = 0.35;

/**
 * Checks the ground under a feature origin and returns the height of the feature's first block,
 * or -1 when the feature cannot stand there. Trees need grass (with or without the snow block of
 * a snowy biome on it) on gentle ground; boulders need any dry ground; ice spikes need the snow
 * of a snowy biome. A cave entrance under the feature rejects it (nothing floats over one).
 */
function validateGround(
  ctx: GroundContext,
  type: number,
  px: number,
  pz: number,
  probe: GroundProbe,
  probe2: GroundProbe,
): number {
  probeGround(ctx, px, pz, probe);
  if (probe.topBlock === '') return -1;
  const baseY = probe.topY + 1 + (probe.snow ? 1 : 0);
  const entrance = caveEntranceAt(ctx, px, pz);
  if (isTree(type)) {
    if (probe.topBlock !== 'grass_block' || probe.slope > 2) return -1;
    if (isBig(type)) {
      if (entrance >= CAVE_ENTRANCE_THRESHOLD - 0.01) return -1;
      for (let k = 1; k < 4; k++) {
        const x = px + (k & 1);
        const z = pz + (k >> 1);
        probeGround(ctx, x, z, probe2);
        if (
          probe2.topBlock !== 'grass_block' ||
          probe2.topY !== probe.topY ||
          probe2.snow !== probe.snow ||
          probe2.slope > 2 ||
          caveEntranceAt(ctx, x, z) >= CAVE_ENTRANCE_THRESHOLD - 0.01
        ) {
          return -1;
        }
      }
    } else if (entrance >= CAVE_ENTRANCE_THRESHOLD - 0.01) {
      return -1;
    }
    return baseY;
  }
  if (type === FeatureType.IceSpike) {
    if (probe.topBlock !== 'grass_block' || !probe.snow || probe.slope > 1) return -1;
    if (entrance >= ENTRANCE_SAFE) return -1;
    return baseY;
  }
  // boulder
  if (probe.slope > 2 || probe.topBlock === 'mire') return -1;
  if (entrance >= ENTRANCE_SAFE) return -1;
  return baseY;
}

// ---------------------------------------------------------------------------------------------
// Placement

const BOULDER_STONE = 0;
const BOULDER_COBBLE = 1;
const BOULDER_MOSSY = 2;

/** Cumulative weights of [stone, cobblestone, mossy cobblestone] by biome family. */
function boulderMaterial(biome: OverworldBiomeId, u: number): number {
  if (biome === 'pine_taiga')
    return u < 0.15 ? BOULDER_STONE : u < 0.45 ? BOULDER_COBBLE : BOULDER_MOSSY;
  return u < 0.55 ? BOULDER_STONE : u < 0.9 ? BOULDER_COBBLE : BOULDER_MOSSY;
}

const FAMILY_ORDER: TreeFamily[] = [
  'oak',
  'birch',
  'pine',
  'pine',
  'rainwood',
  'rainwood',
  'acacia',
];

function placeOrigin(
  column: ChunkColumn,
  blocks: FeatureBlocks,
  o: FeatureOrigin,
  pass: 'solid' | 'leaves',
  x0: number,
  z0: number,
  ctx: GroundContext,
): void {
  buildFeature(o.type, o.shapeSeed, o.x, o.z);
  const tree = isTree(o.type);
  const family = tree ? FAMILY_ORDER[o.type]! : 'oak';
  const biome = tree ? 'plains' : sampleBiome(ctx.worldSeed, o.x, o.z);
  for (let c = 0; c < cellCount; c++) {
    const kind = CELL_KIND[c]!;
    if ((kind === K_LEAVES) !== (pass === 'leaves')) continue;
    const lx = o.x + CELL_DX[c]! - x0;
    const lz = o.z + CELL_DZ[c]! - z0;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15) continue;
    const y = o.baseY + CELL_DY[c]!;
    if (y < 0 || y > 319) continue;
    const here = column.getBlockStateId(lx, y, lz);
    let state: number;
    switch (kind) {
      case K_LOG_Y:
        state = blocks.logY[family];
        break;
      case K_LOG_X:
        state = blocks.logX[family];
        break;
      case K_LOG_Z:
        state = blocks.logZ[family];
        break;
      case K_LEAVES:
        state = blocks.leaves[family];
        break;
      case K_ICE:
        state = blocks.packedIce;
        break;
      default: {
        const m = boulderMaterial(
          biome,
          hash3(o.shapeSeed, o.x + CELL_DX[c]!, y, o.z + CELL_DZ[c]!),
        );
        state =
          m === BOULDER_STONE
            ? blocks.stone
            : m === BOULDER_COBBLE
              ? blocks.cobblestone
              : blocks.mossy;
      }
    }
    if (kind <= K_LOG_Z) {
      // logs replace air and leaves only
      if (here !== 0 && !isAnyLeaves(here, blocks)) continue;
    } else if (here !== 0) {
      continue;
    }
    // Trunks, boulders and ice spikes grow upwards from something solid: where a lower block
    // was not placed (the terrain is in the way) nothing is left hanging above the gap.
    if ((kind === K_LOG_Y || kind === K_STONE || kind === K_ICE) && y > 0) {
      if (blocks.opaque[column.getBlockStateId(lx, y - 1, lz)] !== 1) continue;
    }
    column.setBlockStateId(lx, y, lz, state);
  }
}

function isAnyLeaves(state: number, blocks: FeatureBlocks): boolean {
  for (const f of FAMILIES) if (blocks.leaves[f] === state) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------
// Plants: one cell each, read from the column itself

interface PlantRule {
  grass: number; // tall grass
  flower: number;
  flowers: number[]; // indices into FLOWER_IDS
  mushroom: number;
  pumpkin: number;
}

/**
 * Flowers and tall grass thin out in clearings: a low-frequency noise scales their density from
 * nothing (about half of the ground) to LUSH_PEAK times the rule's density, so stretches of open
 * grass remain between lush ones.
 */
const CLEARING_SCALE = 1 / 32;
const LUSH_PEAK = 2.4;

const PLANT_RULES: PlantRule[] = new Array<PlantRule>(BIOME_COUNT)
  .fill(null as unknown as PlantRule)
  .map(() => ({ grass: 0, flower: 0, flowers: [], mushroom: 0, pumpkin: 0 }));
function plant(biome: OverworldBiomeId, r: Partial<PlantRule>): void {
  PLANT_RULES[BIOME_INDEX[biome]] = {
    grass: 0,
    flower: 0,
    flowers: [],
    mushroom: 0,
    pumpkin: 0,
    ...r,
  };
}
// flower indices: 0 bluebell, 1 buttercup, 2 marigold, 3 violet, 4 daisy, 5 wild_rose, 6 lupine, 7 heather
plant('plains', { grass: 0.14, flower: 0.012, flowers: [1, 4, 0, 3, 2], pumpkin: 0.0005 });
plant('meadow', { grass: 0.18, flower: 0.07, flowers: [0, 1, 2, 3, 4, 5, 6, 7], pumpkin: 0.0006 });
plant('oakwood_forest', {
  grass: 0.09,
  flower: 0.006,
  flowers: [0, 3, 5, 4],
  mushroom: 0.004,
  pumpkin: 0.0003,
});
plant('birch_grove', {
  grass: 0.1,
  flower: 0.01,
  flowers: [0, 6, 4],
  mushroom: 0.001,
  pumpkin: 0.0003,
});
plant('pine_taiga', { grass: 0.05, flower: 0.004, flowers: [7, 6], mushroom: 0.003 });
plant('savanna', { grass: 0.2, flower: 0.004, flowers: [2, 6] });
plant('swampland', { grass: 0.12, flower: 0.008, flowers: [3, 0], mushroom: 0.006 });
plant('rainforest', { grass: 0.24, flower: 0.02, flowers: [5, 7, 2, 3], mushroom: 0.005 });

const CACTUS_CHANCE = 0.007;
const REEDS_CHANCE = 0.3;

const TOP_Y = new Int16Array(256);
const TOP_STATE = new Uint16Array(256);
const SECTION_BUFFER = new Uint16Array(4096);

/** Highest block that is neither air nor a fluid, per (x, z) of the column, from the column itself. */
function scanTops(column: ChunkColumn, blocks: FeatureBlocks): void {
  TOP_Y.fill(-1);
  TOP_STATE.fill(0);
  let remaining = 256;
  for (let sy = ChunkColumn.SECTION_COUNT - 1; sy >= 0 && remaining > 0; sy--) {
    const sec = column.getSection(sy);
    if (!sec) continue;
    if (sec.getBitsPerEntry() === 0) {
      const u = sec.uniformStateId;
      if (u === 0 || u === blocks.water || u === blocks.lava) continue;
      for (let i = 0; i < 256; i++) {
        if (TOP_Y[i]! < 0) {
          TOP_Y[i] = sy * 16 + 15;
          TOP_STATE[i] = u;
          remaining--;
        }
      }
      continue;
    }
    sec.copyBlockStatesTo(SECTION_BUFFER);
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const i = z * 16 + x;
        if (TOP_Y[i]! >= 0) continue;
        for (let ly = 15; ly >= 0; ly--) {
          const s = SECTION_BUFFER[(ly << 8) | (z << 4) | x]!;
          if (s !== 0 && s !== blocks.water && s !== blocks.lava) {
            TOP_Y[i] = sy * 16 + ly;
            TOP_STATE[i] = s;
            remaining--;
            break;
          }
        }
      }
    }
  }
}

function placePlants(
  column: ChunkColumn,
  blocks: FeatureBlocks,
  worldSeed: number,
  x0: number,
  z0: number,
  ctx: GroundContext,
): void {
  const plantSeed = deriveSeed(deriveSeed(worldSeed, 'features'), 'plants');
  const patchSeed = deriveSeed(plantSeed, 'patches');
  const heightSeed = deriveSeed(plantSeed, 'heights');

  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      const i = z * 16 + x;
      const topY = TOP_Y[i]!;
      if (topY < SEA_LEVEL || topY >= 318) continue; // under water, or no room above
      const wx = x0 + x;
      const wz = z0 + z;
      if (column.getBlockStateId(x, topY + 1, z) !== 0) continue; // snow, water, a tree...
      const top = TOP_STATE[i]!;
      const biome = BIOME_INDEX[column.biomes[i] as OverworldBiomeId] ?? 0;
      const u = hash3(plantSeed, wx, 0, wz);
      const y = topY + 1;

      if (top === blocks.sand) {
        // Cacti on desert sand
        if (biome === BIOME_INDEX.desert && u < CACTUS_CHANCE) {
          const h = 1 + Math.floor(hash3(heightSeed, wx, 1, wz) * 3);
          for (let k = 0; k < h && y + k < 320; k++) {
            if (column.getBlockStateId(x, y + k, z) !== 0) break;
            column.setBlockStateId(x, y + k, z, blocks.cactus);
          }
          continue;
        }
      }

      // Sugar reeds: ground level at the sea surface with water beside it
      if (
        topY === SEA_LEVEL &&
        (top === blocks.sand || top === blocks.grass || top === blocks.dirt) &&
        hash3(plantSeed, wx, 2, wz) < REEDS_CHANCE &&
        waterBeside(column, blocks, x, z, wx, wz, ctx)
      ) {
        const h = 1 + Math.floor(hash3(heightSeed, wx, 3, wz) * 3);
        for (let k = 0; k < h; k++) {
          if (column.getBlockStateId(x, y + k, z) !== 0) break;
          column.setBlockStateId(x, y + k, z, blocks.reeds);
        }
        continue;
      }

      const rule = PLANT_RULES[biome]!;
      if (top === blocks.grass || (top === blocks.mire && biome === BIOME_INDEX.swampland)) {
        const lush =
          LUSH_PEAK *
          Math.min(
            1,
            Math.max(0, ctx.clearingNoise(wx * CLEARING_SCALE, wz * CLEARING_SCALE) * 10),
          );
        // pumpkin, mushroom, flower, tall grass, in that order of priority
        let band = rule.pumpkin;
        if (top === blocks.grass && u < band) {
          column.setBlockStateId(x, y, z, blocks.pumpkin);
          continue;
        }
        band += rule.mushroom;
        if (u < band) {
          column.setBlockStateId(
            x,
            y,
            z,
            hash3(plantSeed, wx, 4, wz) < 0.5 ? blocks.brownMushroom : blocks.redMushroom,
          );
          continue;
        }
        if (top !== blocks.grass) continue;
        band += rule.flower * lush;
        if (u < band && rule.flowers.length > 0) {
          // flowers grow in patches of one kind, 8 x 8 blocks each
          const patch = hash3(patchSeed, wx >> 3, wz >> 3, 5);
          const kind = rule.flowers[Math.floor(patch * rule.flowers.length)]!;
          column.setBlockStateId(x, y, z, blocks.flowers[kind]!);
          continue;
        }
        band += rule.grass * lush;
        if (u < band) column.setBlockStateId(x, y, z, blocks.tallGrass);
      }
    }
  }

  placeCaveMushrooms(column, blocks, plantSeed, x0, z0);
}

/**
 * Whether one of the four neighbours of the ground block at (x, z) is water at the ground's own
 * height. Inside the column that is read from the column (a cave entrance can replace the water
 * by air); next to the column it follows from the terrain, which fills every open cell up to the
 * sea level with water and, because the carving stops below the surface, keeps it there.
 */
function waterBeside(
  column: ChunkColumn,
  blocks: FeatureBlocks,
  x: number,
  z: number,
  wx: number,
  wz: number,
  ctx: GroundContext,
): boolean {
  for (let k = 0; k < 4; k++) {
    const dx = k === 0 ? -1 : k === 1 ? 1 : 0;
    const dz = k === 2 ? -1 : k === 3 ? 1 : 0;
    const nx = x + dx;
    const nz = z + dz;
    if (nx >= 0 && nx < 16 && nz >= 0 && nz < 16) {
      if (column.getBlockStateId(nx, SEA_LEVEL, nz) === blocks.water) return true;
    } else if (sampleTerrainTopY(ctx.terrainSeed, wx + dx, wz + dz) < SEA_LEVEL) {
      return true;
    }
  }
  return false;
}

const CAVE_ATTEMPTS = 6;

/** Mushrooms on the floor of caves: air above stone, dirt or gravel, well below the surface. */
function placeCaveMushrooms(
  column: ChunkColumn,
  blocks: FeatureBlocks,
  plantSeed: number,
  x0: number,
  z0: number,
): void {
  const caveSeed = deriveSeed(plantSeed, 'cave');
  for (let a = 0; a < CAVE_ATTEMPTS; a++) {
    const x = Math.floor(hash3(caveSeed, x0, a, z0) * 16);
    const z = Math.floor(hash3(caveSeed, x0, a + 100, z0) * 16);
    if (hash3(caveSeed, x0 + x, a + 200, z0 + z) >= 0.5) continue;
    const topY = TOP_Y[z * 16 + x]!;
    const yStart = Math.min(
      topY - 6,
      8 + Math.floor(hash3(caveSeed, x0 + x, a + 300, z0 + z) * 48),
    );
    for (let y = yStart; y > yStart - 14 && y > 6; y--) {
      const below = column.getBlockStateId(x, y - 1, z);
      if (below === 0 || below === blocks.water || below === blocks.lava) continue;
      if (column.getBlockStateId(x, y, z) !== 0) continue;
      if (
        below !== blocks.stone &&
        below !== blocks.dirt &&
        below !== blocks.gravel &&
        below !== blocks.clay
      ) {
        break;
      }
      column.setBlockStateId(
        x,
        y,
        z,
        hash3(caveSeed, x0 + x, a + 400, z0 + z) < 0.5 ? blocks.brownMushroom : blocks.redMushroom,
      );
      break;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The stage

const ORIGIN_POOL: FeatureOrigin[] = Array.from({ length: MAX_ACCEPTED }, () => ({
  type: 0,
  x: 0,
  z: 0,
  baseY: 0,
  rank: 0,
  shapeSeed: 0,
}));

export function generateFeatures(
  _stageSeed: number,
  cx: number,
  cz: number,
  column: ChunkColumn,
): void {
  const worldSeed = column.worldSeed;
  if (worldSeed === undefined) {
    throw new Error('generateFeatures requires column.worldSeed to be set');
  }
  const blocks = getBlocks();
  const ctx = getGroundContext(worldSeed);
  const x0 = cx * 16;
  const z0 = cz * 16;

  const n = collectOrigins(worldSeed, x0, z0, true, ORIGIN_POOL);

  // Highest rank first, so that where two crowns meet the higher-ranked tree owns the cell
  const order: number[] = [];
  for (let i = 0; i < n; i++) order.push(i);
  order.sort((a, b) => {
    const d = ORIGIN_POOL[b]!.rank - ORIGIN_POOL[a]!.rank;
    return d !== 0
      ? d
      : ORIGIN_POOL[a]!.x - ORIGIN_POOL[b]!.x || ORIGIN_POOL[a]!.z - ORIGIN_POOL[b]!.z;
  });

  // The ground is scanned before anything is placed, so plants do not mistake a crown for the top
  scanTops(column, blocks);

  for (const i of order) placeOrigin(column, blocks, ORIGIN_POOL[i]!, 'solid', x0, z0, ctx);
  for (const i of order) {
    if (isTree(ORIGIN_POOL[i]!.type))
      placeOrigin(column, blocks, ORIGIN_POOL[i]!, 'leaves', x0, z0, ctx);
  }

  placePlants(column, blocks, worldSeed, x0, z0, ctx);
}

/** Cell list of one feature, for tests and tools: [dx, dy, dz, kind] relative to its origin and base height. */
export function describeFeature(
  type: number,
  shapeSeed: number,
  ox: number,
  oz: number,
): Array<[number, number, number, string]> {
  buildFeature(type, shapeSeed, ox, oz);
  const kinds = ['log_y', 'log_x', 'log_z', 'leaves', 'boulder', 'ice'];
  const out: Array<[number, number, number, string]> = [];
  for (let c = 0; c < cellCount; c++) {
    out.push([CELL_DX[c]!, CELL_DY[c]!, CELL_DZ[c]!, kinds[CELL_KIND[c]!]!]);
  }
  return out;
}

/**
 * Trees, boulders and ice spikes whose origin lies in the column (cx, cz), without generating any
 * blocks. For tests and tools.
 */
export function listFeatureOrigins(worldSeed: number, cx: number, cz: number): FeatureOrigin[] {
  const pool: FeatureOrigin[] = Array.from({ length: MAX_ACCEPTED }, () => ({
    type: 0,
    x: 0,
    z: 0,
    baseY: 0,
    rank: 0,
    shapeSeed: 0,
  }));
  const n = collectOrigins(worldSeed, cx * 16, cz * 16, false, pool);
  return pool.slice(0, n);
}

export const featureStage: TerrainStage = {
  name: 'features',
  generate: generateFeatures,
};
