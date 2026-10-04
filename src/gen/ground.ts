import { deriveSeed } from '../engine/rng';
import { makeSimplex2D } from './noise';
import { BIOME_DEFINITIONS, OverworldBiomeId, sampleBiome } from './biomes';
import { SEA_LEVEL } from './terrain';
import { sampleTerrainTopY } from './terrain-height';

/**
 * What the earlier stages (terrain shape, biome surface, caves) leave at the top of a column,
 * predicted without generating it. Two things need it:
 *
 * Two things need it:
 *
 *  - the caves stage, to tell whether a neighbouring cell next to a chunk border holds a snow
 *    block (`isSnowBlockAt`);
 *  - the feature stage (M03f), whose trees, boulders and ice spikes cover several columns. Every
 *    column that a feature reaches must decide from the same inputs whether the feature exists, so
 *    the decision cannot read the origin column's blocks; it reads this prediction instead.
 *
 * It repeats the rules of `generateSurfaceRules` for dry land and the entrance rule of
 * `generateCaves`. `tests/unit/features.test.ts` compares it with generated columns, so a change
 * to either stage that is not mirrored here fails there.
 */

/** Cave entrance noise at or above this value lets the caves stage carve up to the surface. */
export const CAVE_ENTRANCE_THRESHOLD = 0.65;

export interface GroundContext {
  worldSeed: number;
  terrainSeed: number;
  /** Surface-stage patch noise (mire in swamps, gravel on stony heights). */
  patchNoise: (x: number, z: number) => number;
  /** Cave-stage entrance noise, sampled at (wx * 0.05, wz * 0.05). */
  entranceNoise: (x: number, z: number) => number;
  /** Feature-stage noise that opens clearings between lush stretches of flowers and tall grass. */
  clearingNoise: (x: number, z: number) => number;
}

let cachedWorldSeed: number | null = null;
let cachedContext: GroundContext | null = null;

export function getGroundContext(worldSeed: number): GroundContext {
  if (cachedWorldSeed === worldSeed && cachedContext) return cachedContext;
  const surfaceSeed = deriveSeed(worldSeed, 'biome_surface');
  const caveSeed = deriveSeed(worldSeed, 'caves');
  cachedContext = {
    worldSeed,
    terrainSeed: deriveSeed(worldSeed, 'terrain_shape'),
    patchNoise: makeSimplex2D(deriveSeed(surfaceSeed, 'surface_patches')),
    entranceNoise: makeSimplex2D(deriveSeed(caveSeed, 'entrance')),
    clearingNoise: makeSimplex2D(deriveSeed(deriveSeed(worldSeed, 'features'), 'clearings')),
  };
  cachedWorldSeed = worldSeed;
  return cachedContext;
}

export interface GroundProbe {
  biome: OverworldBiomeId;
  /** Highest solid block (before any feature), or a value below SEA_LEVEL when under water. */
  topY: number;
  /** Largest height difference to the four orthogonal neighbours. */
  slope: number;
  /** True when the surface stage puts a snow block on top of the top block. */
  snow: boolean;
  /** Block id of the top block after the surface stage; '' when the column is under water. */
  topBlock: string;
}

export function createGroundProbe(): GroundProbe {
  return { biome: 'plains', topY: 0, slope: 0, snow: false, topBlock: '' };
}

/** Cave entrance noise at a block; values at or above CAVE_ENTRANCE_THRESHOLD can open the surface. */
export function caveEntranceAt(ctx: GroundContext, wx: number, wz: number): number {
  return ctx.entranceNoise(wx * 0.05, wz * 0.05);
}

export function probeGround(ctx: GroundContext, wx: number, wz: number, out: GroundProbe): void {
  const biome = sampleBiome(ctx.worldSeed, wx, wz);
  const topY = sampleTerrainTopY(ctx.terrainSeed, wx, wz);
  out.biome = biome;
  out.topY = topY;
  out.slope = 0;
  out.snow = false;
  out.topBlock = '';
  if (topY < SEA_LEVEL) return; // under water

  const slope = Math.max(
    Math.abs(topY - sampleTerrainTopY(ctx.terrainSeed, wx - 1, wz)),
    Math.abs(topY - sampleTerrainTopY(ctx.terrainSeed, wx + 1, wz)),
    Math.abs(topY - sampleTerrainTopY(ctx.terrainSeed, wx, wz - 1)),
    Math.abs(topY - sampleTerrainTopY(ctx.terrainSeed, wx, wz + 1)),
  );
  out.slope = slope;

  const rules = BIOME_DEFINITIONS[biome].surfaceRules;
  if (slope >= 4) {
    out.topBlock = 'stone'; // steep slopes expose stone in every biome
  } else if (rules.hasClayrockStrata) {
    out.topBlock = rules.topBlock;
  } else if (rules.hasMirePatches) {
    out.topBlock = ctx.patchNoise(wx * 0.1, wz * 0.1) > 0.25 ? 'mire' : rules.topBlock;
  } else if (rules.hasGravelPatches && biome === 'stony_heights') {
    out.topBlock = ctx.patchNoise(wx * 0.08, wz * 0.08) > 0.2 ? 'gravel' : 'stone';
  } else {
    out.topBlock = rules.topBlock;
    out.snow = !!rules.hasSnowTop && topY >= (rules.snowlineY ?? 64);
  }
}

/**
 * Whether the block at (wx, y, wz) is a snow block placed by the surface stage. The surface stage
 * puts a snow block on top of the top block of every dry, non-cliff column of a snowy biome
 * above its snow line, and nothing else in the Overworld adds solid blocks above the terrain.
 */
export function isSnowBlockAt(
  worldSeed: number,
  terrainStageSeed: number,
  wx: number,
  y: number,
  wz: number,
): boolean {
  if (y <= SEA_LEVEL) return false;
  const topY = sampleTerrainTopY(terrainStageSeed, wx, wz);
  if (topY + 1 !== y) return false;
  const rules = BIOME_DEFINITIONS[sampleBiome(worldSeed, wx, wz)].surfaceRules;
  if (!rules.hasSnowTop || topY < (rules.snowlineY ?? 64)) return false;
  const slope = Math.max(
    Math.abs(topY - sampleTerrainTopY(terrainStageSeed, wx - 1, wz)),
    Math.abs(topY - sampleTerrainTopY(terrainStageSeed, wx + 1, wz)),
    Math.abs(topY - sampleTerrainTopY(terrainStageSeed, wx, wz - 1)),
    Math.abs(topY - sampleTerrainTopY(terrainStageSeed, wx, wz + 1)),
  );
  return slope < 4;
}
