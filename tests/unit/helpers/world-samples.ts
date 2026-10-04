import { World } from '../../../src/world/world';
import { TerrainPipeline } from '../../../src/gen/pipeline';
import { caveEntranceAt, getGroundContext } from '../../../src/gen/ground';
import { sampleBiome } from '../../../src/gen/biomes';
import { BlockRegistry } from '../../../src/world/blocks/registry';

// Shared by tests/unit/features.test.ts and tests/unit/isolated-blocks.test.ts

// Every block id the feature stage can place. The stage never places stone, so a boulder made of
// stone is indistinguishable from terrain; it always rests on the ground, so it cannot float.
export const FEATURE_IDS = new Set([
  'oak_log',
  'birch_log',
  'pine_log',
  'rainwood_log',
  'acacia_log',
  'oak_leaves',
  'birch_leaves',
  'pine_leaves',
  'rainwood_leaves',
  'acacia_leaves',
  'tall_grass',
  'bluebell',
  'buttercup',
  'marigold',
  'violet',
  'daisy',
  'wild_rose',
  'lupine',
  'heather',
  'cactus',
  'sugar_reeds',
  'pumpkin',
  'brown_mushroom',
  'red_mushroom',
  'mossy_cobblestone',
  'cobblestone',
  'packed_ice',
]);
export const LOGS = new Set(['oak_log', 'birch_log', 'pine_log', 'rainwood_log', 'acacia_log']);
export const LEAVES = new Set([
  'oak_leaves',
  'birch_leaves',
  'pine_leaves',
  'rainwood_leaves',
  'acacia_leaves',
]);
export const FLOWERS = [
  'bluebell',
  'buttercup',
  'marigold',
  'violet',
  'daisy',
  'wild_rose',
  'lupine',
  'heather',
];

export interface Ids {
  name: string[]; // state id -> block id
  feature: Uint8Array;
  open: Uint8Array; // air, water, lava
}

export function buildIds(registry: BlockRegistry): Ids {
  const size = registry.getMaxStateId() + 1;
  const name: string[] = new Array<string>(size).fill('air');
  const feature = new Uint8Array(size);
  const open = new Uint8Array(size);
  for (const st of registry.getAllStateIds()) {
    const id = registry.getResolvedState(st)!.blockId;
    name[st] = id;
    if (FEATURE_IDS.has(id)) feature[st] = 1;
    if (id === 'air' || id === 'water' || id === 'lava') open[st] = 1;
  }
  return { name, feature, open };
}

/** A square of columns well inside one biome (a 3 x 3 pattern 24 blocks apart is that biome). */
const spotCache = new Map<string, [number, number] | null>();

export function findBiomeSpot(
  seed: number,
  biomes: string[],
  radius = 24,
): [number, number] | null {
  const key = `${seed}|${biomes.join(',')}|${radius}`;
  if (spotCache.has(key)) return spotCache.get(key)!;
  const step = Math.max(radius, 1);
  const ok = (x: number, z: number): boolean => {
    for (let dz = -radius; dz <= radius; dz += step) {
      for (let dx = -radius; dx <= radius; dx += step) {
        if (!biomes.includes(sampleBiome(seed, x + dx, z + dz))) return false;
      }
    }
    return true;
  };
  for (let r = 0; r < 6000; r += 32) {
    for (let a = -r; a <= r; a += 32) {
      for (const [x, z] of [
        [a, -r],
        [a, r],
        [-r, a],
        [r, a],
      ] as const) {
        if (ok(x, z)) {
          spotCache.set(key, [x, z]);
          return [x, z];
        }
      }
    }
  }
  spotCache.set(key, null);
  return null;
}

/** A spot where the cave stage may open the surface (entrance noise well above its threshold). */
export function findCaveSpot(seed: number): [number, number] | null {
  const ctx = getGroundContext(seed);
  for (let x = -1500; x < 1500; x += 16) {
    for (let z = -1500; z < 1500; z += 16) {
      if (caveEntranceAt(ctx, x, z) > 0.8) return [x, z];
    }
  }
  return null;
}

export function generate(
  pipeline: TerrainPipeline,
  worldSeed: number,
  world: World,
  cx0: number,
  cz0: number,
  size: number,
): void {
  for (let cx = cx0; cx < cx0 + size; cx++) {
    for (let cz = cz0; cz < cz0 + size; cz++) {
      pipeline.generateColumn(worldSeed, cx, cz, world.getColumn(cx, cz, true)!);
    }
  }
}

export function areaOrigin(center: [number, number], size: number): [number, number] {
  return [
    Math.floor(center[0] / 16) - Math.floor(size / 2),
    Math.floor(center[1] / 16) - Math.floor(size / 2),
  ];
}

/**
 * Non-feature, non-fluid, non-air blocks whose six neighbours are all air or fluid, inside the
 * interior of the generated columns (1 block in from the edge). Feature blocks are not tested
 * themselves; as neighbours they are solid, like any other block.
 */
export function findFloating(
  world: World,
  ids: Ids,
  cx0: number,
  cz0: number,
  size: number,
): { floating: string[]; solid: number } {
  const floating: string[] = [];
  let solid = 0;
  const free = (x: number, y: number, z: number): boolean => {
    if (y < 0) return false; // below the world floor counts as solid
    return ids.open[world.getBlockStateId(x, y, z)] === 1;
  };
  for (let x = cx0 * 16 + 1; x < (cx0 + size) * 16 - 1; x++) {
    for (let z = cz0 * 16 + 1; z < (cz0 + size) * 16 - 1; z++) {
      for (let y = 0; y < 320; y++) {
        const st = world.getBlockStateId(x, y, z);
        if (ids.open[st] === 1 || ids.feature[st] === 1) continue;
        solid++;
        if (
          free(x + 1, y, z) &&
          free(x - 1, y, z) &&
          free(x, y, z + 1) &&
          free(x, y, z - 1) &&
          free(x, y + 1, z) &&
          free(x, y - 1, z)
        ) {
          floating.push(`(${x},${y},${z}:${ids.name[st]})`);
        }
      }
    }
  }
  return { floating, solid };
}
