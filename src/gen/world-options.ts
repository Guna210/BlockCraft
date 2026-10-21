import { OVERWORLD_BIOME_IDS, type OverworldBiomeId } from './biomes';

/** The world types of the Create World screen (SPEC M18). */
export const WORLD_TYPES = ['default', 'flat', 'amplified', 'single_biome'] as const;
export type WorldType = (typeof WORLD_TYPES)[number];

/** What a generator needs to know beyond the seed: the world type and, for Single Biome, its biome. */
export interface TerrainVariant {
  type: WorldType;
  biome?: OverworldBiomeId;
}

/** Create World toggles stored with a world. Structures is read by the structure stage (M19b). */
export interface WorldOptions {
  structures: boolean;
  startingChest: boolean;
  biome?: OverworldBiomeId;
}

export const DEFAULT_WORLD_OPTIONS: Readonly<WorldOptions> = {
  structures: true,
  startingChest: false,
};

export function isWorldType(value: unknown): value is WorldType {
  return typeof value === 'string' && (WORLD_TYPES as readonly string[]).includes(value);
}

export function isOverworldBiome(value: unknown): value is OverworldBiomeId {
  return typeof value === 'string' && (OVERWORLD_BIOME_IDS as readonly string[]).includes(value);
}

/** Options of a stored world; a record written before the options existed loads with the defaults. */
export function normalizeWorldOptions(value: unknown): WorldOptions {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const options: WorldOptions = {
    structures:
      typeof raw['structures'] === 'boolean' ? raw['structures'] : DEFAULT_WORLD_OPTIONS.structures,
    startingChest:
      typeof raw['startingChest'] === 'boolean'
        ? raw['startingChest']
        : DEFAULT_WORLD_OPTIONS.startingChest,
  };
  if (isOverworldBiome(raw['biome'])) options.biome = raw['biome'];
  return options;
}

const DEFAULT_VARIANT: TerrainVariant = { type: 'default' };

/**
 * The variant the generator in this thread is producing. Terrain and biome samplers read it, so
 * every neighbour probe of one column (isolated voxels, caves, surface heights) agrees with the
 * column itself. `TerrainPipeline.generateColumn` sets it for the duration of one column; the
 * main thread also sets it to the open world's variant so `locate` and spawn probes agree with
 * what the workers generate.
 */
let activeVariant: TerrainVariant = DEFAULT_VARIANT;

export function terrainVariant(): Readonly<TerrainVariant> {
  return activeVariant;
}

export function setTerrainVariant(variant: TerrainVariant | undefined): void {
  activeVariant = variant && variant.type !== 'default' ? { ...variant } : DEFAULT_VARIANT;
}

/** Runs `fn` with `variant` active and restores the previous variant afterwards. */
export function withTerrainVariant<T>(variant: TerrainVariant | undefined, fn: () => T): T {
  const previous = activeVariant;
  setTerrainVariant(variant);
  try {
    return fn();
  } finally {
    activeVariant = previous;
  }
}

/** Highest y amplified terrain may reach. */
const AMPLIFIED_MAX_Y = 319;

/**
 * Terrain height spline output for the active variant. Default terrain is returned unchanged, so
 * its blocks (and `worldHash`) are exactly those of the default generator. Amplified stretches
 * everything above sea level: hills about ×2, peaks about ×2.2, clamped to y 319.
 */
export function shapeHeight(height: number): number {
  if (activeVariant.type !== 'amplified' || height <= 64) return height;
  const above = height - 64;
  return Math.min(AMPLIFIED_MAX_Y, 64 + above * (2 + Math.min(0.4, above / 400)));
}

/** Height above which density is pulled down so peaks round off below the build limit. */
export function densityCeiling(): number {
  return activeVariant.type === 'amplified' ? 290 : 220;
}
