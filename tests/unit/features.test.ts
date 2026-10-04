import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { World } from '../../src/world/world';
import { ChunkColumn } from '../../src/world/column';
import { TerrainPipeline, createDefaultPipeline, TerrainStage } from '../../src/gen/pipeline';
import { terrainShapeStage, SEA_LEVEL } from '../../src/gen/terrain';
import { biomeSurfaceStage } from '../../src/gen/surface';
import { caveStage } from '../../src/gen/caves';
import {
  FEATURE_TYPE_NAMES,
  FeatureType,
  describeFeature,
  listFeatureOrigins,
} from '../../src/gen/features';
import {
  caveEntranceAt,
  createGroundProbe,
  getGroundContext,
  probeGround,
  CAVE_ENTRANCE_THRESHOLD,
} from '../../src/gen/ground';
import { sampleBiome } from '../../src/gen/biomes';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { hashString } from '../../src/engine/rng';
import {
  FEATURE_IDS,
  FLOWERS,
  Ids,
  LEAVES,
  LOGS,
  areaOrigin,
  buildIds,
  findBiomeSpot,
  findCaveSpot,
  findFloating,
  generate,
} from './helpers/world-samples';

// M03f — surface features. Criterion owned: no floating single terrain blocks (8a), plus the
// seamlessness, support, density and water checks the task asks for.

const SEEDS = ['blockcraft-test-seed-42', 'blockcraft-alt-seed-7'];
const STANDARD = SEEDS[0]!;

describe('M03f — surface features', () => {
  let registry: BlockRegistry;
  let ids: Ids;

  beforeEach(() => {
    BlockRegistry.resetInstance();
    registry = BlockRegistry.getInstance();
    ids = buildIds(registry);
  });

  // -------------------------------------------------------------------------------------------
  // 8a. Owned criterion
  // -------------------------------------------------------------------------------------------
  for (const seedStr of SEEDS) {
    it(`8a: zero floating single terrain blocks at any height in at least 300 columns (${seedStr})`, () => {
      const seed = hashString(seedStr);
      const spots: Array<[string, [number, number] | null]> = [
        ['forest', findBiomeSpot(seed, ['oakwood_forest'])],
        ['desert', findBiomeSpot(seed, ['desert'])],
        ['mountain', findBiomeSpot(seed, ['frost_peaks', 'stony_heights'])],
        ['cave-heavy', findCaveSpot(seed)],
      ];
      const pipeline = createDefaultPipeline();
      let columns = 0;
      let solid = 0;
      const all: string[] = [];
      for (const [, spot] of spots) {
        expect(spot).not.toBeNull();
        const world = new World(false);
        const [cx0, cz0] = areaOrigin(spot!, 10);
        generate(pipeline, seed, world, cx0, cz0, 10);
        columns += 100;
        const r = findFloating(world, ids, cx0, cz0, 10);
        solid += r.solid;
        all.push(...r.floating);
      }
      expect(columns).toBeGreaterThanOrEqual(300);
      expect(solid).toBeGreaterThan(1_000_000); // the sample really contains terrain
      expect(all, `${all.length} floating blocks, first: ${all.slice(0, 20).join(' ')}`).toEqual(
        [],
      );
    }, 20000);
  }

  it('8a (detector): a stage that leaves one floating stone block makes the check fail', () => {
    const seed = hashString(STANDARD);
    const spot = findBiomeSpot(seed, ['oakwood_forest'])!;
    const [cx0, cz0] = areaOrigin(spot, 3);
    const floatingStage: TerrainStage = {
      name: 'mutant_floating_block',
      generate: (_s, cx, cz, column) => {
        if (cx === cx0 + 1 && cz === cz0 + 1) {
          // one stone block in the air above the surface of the middle column
          column.setBlockStateId(8, 250, 8, registry.getDefaultStateId('stone')!);
        }
      },
    };
    const pipeline = new TerrainPipeline();
    for (const st of createDefaultPipeline().getStages()) pipeline.addStage(st);
    pipeline.addStage(floatingStage);
    const world = new World(false);
    generate(pipeline, seed, world, cx0, cz0, 3);
    const found = findFloating(world, ids, cx0, cz0, 3);
    expect(found.floating).toHaveLength(1);
    expect(found.floating[0]).toBe(`(${(cx0 + 1) * 16 + 8},250,${(cz0 + 1) * 16 + 8}:stone)`);
  }, 20000);

  // -------------------------------------------------------------------------------------------
  // 8b. Seamlessness
  // -------------------------------------------------------------------------------------------
  it('8b: a 3x3 block of columns generated in two different orders has an identical worldHash', () => {
    const seed = hashString(STANDARD);
    const pipeline = createDefaultPipeline();
    const spots = [
      findBiomeSpot(seed, ['oakwood_forest']),
      findBiomeSpot(seed, ['rainforest']),
      findBiomeSpot(seed, ['pine_taiga']),
      findBiomeSpot(seed, ['desert']),
    ];
    let withFeatures = 0;
    for (const spot of spots) {
      expect(spot).not.toBeNull();
      const [cx0, cz0] = areaOrigin(spot!, 3);
      const cells: Array<[number, number]> = [];
      for (let cz = 0; cz < 3; cz++)
        for (let cx = 0; cx < 3; cx++) cells.push([cx0 + cx, cz0 + cz]);
      const shuffled = [4, 0, 8, 2, 6, 1, 7, 3, 5].map((i) => cells[i]!);

      const forward = new World(false);
      const reverse = new World(false);
      const mixed = new World(false);
      for (const [cx, cz] of cells)
        pipeline.generateColumn(seed, cx, cz, forward.getColumn(cx, cz, true)!);
      for (const [cx, cz] of [...cells].reverse())
        pipeline.generateColumn(seed, cx, cz, reverse.getColumn(cx, cz, true)!);
      for (const [cx, cz] of shuffled)
        pipeline.generateColumn(seed, cx, cz, mixed.getColumn(cx, cz, true)!);
      const x0 = cx0 * 16;
      const z0 = cz0 * 16;
      const hash = forward.worldHash(x0, z0, x0 + 47, z0 + 47);
      expect(reverse.worldHash(x0, z0, x0 + 47, z0 + 47)).toBe(hash);
      expect(mixed.worldHash(x0, z0, x0 + 47, z0 + 47)).toBe(hash);

      // A column generated on its own (no neighbour present) equals the same column in the block
      const alone = new World(false);
      pipeline.generateColumn(seed, cx0 + 1, cz0 + 1, alone.getColumn(cx0 + 1, cz0 + 1, true)!);
      expect(alone.worldHash(x0 + 16, z0 + 16, x0 + 31, z0 + 31)).toBe(
        forward.worldHash(x0 + 16, z0 + 16, x0 + 31, z0 + 31),
      );

      // the block contains features, so the comparison means something
      for (let x = x0; x < x0 + 48 && withFeatures < 1000000; x++) {
        for (let z = z0; z < z0 + 48; z++) {
          for (let y = 65; y < 140; y++) {
            if (ids.feature[forward.getBlockStateId(x, y, z)] === 1) withFeatures++;
          }
        }
      }
    }
    expect(withFeatures).toBeGreaterThan(1000);
  }, 20000);

  // -------------------------------------------------------------------------------------------
  // 8c. Support
  // -------------------------------------------------------------------------------------------
  it('8c: every tree stands on grass, dirt or snow-covered ground; every plant has a valid block below; cacti stand on sand; reeds have water beside them', () => {
    const seeds = SEEDS.map((s) => hashString(s));
    const pipeline = createDefaultPipeline();
    const names = ids.name;
    const counts: Record<string, number> = {};
    const problems: string[] = [];
    const bump = (k: string): void => {
      counts[k] = (counts[k] ?? 0) + 1;
    };

    const biomeList = [
      'oakwood_forest',
      'rainforest',
      'pine_taiga',
      'snowy_tundra',
      'swampland',
      'savanna',
      'desert',
      'meadow',
      'birch_grove',
      'plains',
      'stony_heights',
    ];
    for (const seed of seeds) {
      for (const biome of biomeList) {
        const spot = findBiomeSpot(seed, [biome]);
        if (!spot) continue;
        const world = new World(false);
        const size = 5;
        const [cx0, cz0] = areaOrigin(spot, size);
        generate(pipeline, seed, world, cx0, cz0, size);
        const at = (x: number, y: number, z: number): string =>
          names[world.getBlockStateId(x, y, z)]!;
        for (let x = cx0 * 16 + 1; x < (cx0 + size) * 16 - 1; x++) {
          for (let z = cz0 * 16 + 1; z < (cz0 + size) * 16 - 1; z++) {
            for (let y = 5; y < 300; y++) {
              const id = at(x, y, z);
              if (!FEATURE_IDS.has(id) || id === 'cobblestone' || id === 'mossy_cobblestone')
                continue;
              const below = at(x, y - 1, z);
              const where = `${id} at (${x},${y},${z}) on ${below}`;
              if (LEAVES.has(id)) continue;
              if (LOGS.has(id)) {
                bump('log');
                const connected =
                  LOGS.has(at(x + 1, y, z)) ||
                  LOGS.has(at(x - 1, y, z)) ||
                  LOGS.has(at(x, y, z + 1)) ||
                  LOGS.has(at(x, y, z - 1)) ||
                  LOGS.has(at(x, y + 1, z));
                if (LOGS.has(below)) continue;
                const plantBelow = below === 'tall_grass' || FLOWERS.includes(below);
                if (below === 'air' || LEAVES.has(below) || (plantBelow && id === 'acacia_log')) {
                  // a branch or a bend: it hangs from another log (a leaning acacia branch can
                  // stand over a plant that grew in the open cell beneath it)
                  if (!connected) problems.push(`loose ${where}`);
                } else if (below === 'grass_block' || below === 'dirt') {
                  bump('tree base');
                } else if (below === 'snow') {
                  bump('tree base on snow');
                  const under = at(x, y - 2, z);
                  if (under !== 'grass_block' && under !== 'dirt')
                    problems.push(`snow over ${under}: ${where}`);
                } else {
                  problems.push(`tree base ${where}`);
                }
                continue;
              }
              if (id === 'tall_grass' || FLOWERS.includes(id)) {
                bump(id);
                if (below !== 'grass_block') problems.push(where);
              } else if (id === 'pumpkin') {
                bump(id);
                if (below !== 'grass_block') problems.push(where);
              } else if (id === 'brown_mushroom' || id === 'red_mushroom') {
                bump(id);
                if (!['grass_block', 'dirt', 'mire', 'stone', 'gravel', 'clay'].includes(below)) {
                  problems.push(where);
                }
              } else if (id === 'cactus') {
                bump(id);
                // a cactus stands on sand, or on a cactus that stands on sand
                let b = below;
                let yy = y - 1;
                while (b === 'cactus') b = at(x, --yy, z);
                if (b !== 'sand') problems.push(where);
              } else if (id === 'sugar_reeds') {
                if (below === 'sugar_reeds') continue;
                bump(id);
                if (!['sand', 'grass_block', 'dirt'].includes(below)) problems.push(where);
                const wet =
                  at(x + 1, y - 1, z) === 'water' ||
                  at(x - 1, y - 1, z) === 'water' ||
                  at(x, y - 1, z + 1) === 'water' ||
                  at(x, y - 1, z - 1) === 'water';
                if (!wet) problems.push(`reeds without water beside them: ${where}`);
              } else if (id === 'packed_ice') {
                if (below === 'packed_ice') continue;
                bump(id);
                // an ice spike stands on the snow of a snowy biome, or on the bare ground beside it
                if (!['snow', 'grass_block', 'dirt', 'stone'].includes(below)) {
                  problems.push(`ice spike ${where}`);
                }
              }
            }
          }
        }
      }
    }
    expect(
      problems,
      `${problems.length} problems, first: ${problems.slice(0, 15).join(' | ')}`,
    ).toEqual([]);
    // the sample contains every kind of feature this check covers
    for (const k of [
      'tree base',
      'tall_grass',
      'pumpkin',
      'cactus',
      'sugar_reeds',
      'brown_mushroom',
      'red_mushroom',
    ]) {
      expect(counts[k] ?? 0, `no ${k} in the sample`).toBeGreaterThan(0);
    }
    for (const f of FLOWERS) expect(counts[f] ?? 0, `no ${f} in the sample`).toBeGreaterThan(0);
    console.log(`[8c support] ${JSON.stringify(counts)}`);
  }, 20000);

  // -------------------------------------------------------------------------------------------
  // 8d. Densities
  // -------------------------------------------------------------------------------------------
  it('8d: trees per column by biome; none in desert; cacti in desert; 2x2 pines and 2x2 rainwoods exist within 2000 blocks', () => {
    for (const seedStr of SEEDS) {
      const seed = hashString(seedStr);
      const perColumn: Record<string, number> = {};
      const sampled: Record<string, number> = {};
      const biomes = [
        'oakwood_forest',
        'rainforest',
        'plains',
        'desert',
        'birch_grove',
        'pine_taiga',
        'savanna',
        'snowy_tundra',
        'swampland',
        'meadow',
      ];
      for (const biome of biomes) {
        // the first 40 columns (scan at 16-block spacing) whose centre and four corners are the biome
        let columns = 0;
        let trees = 0;
        for (let r = 0; r < 2500 && columns < 40; r += 16) {
          for (let a = -r; a <= r && columns < 40; a += 16) {
            for (const [x, z] of [
              [a, -r],
              [a, r],
              [-r, a],
              [r, a],
            ] as const) {
              if (columns >= 40) break;
              const cx = Math.floor(x / 16);
              const cz = Math.floor(z / 16);
              let inside = true;
              for (const [dx, dz] of [
                [0, 0],
                [0, 15],
                [15, 0],
                [15, 15],
                [8, 8],
              ] as const) {
                if (sampleBiome(seed, cx * 16 + dx, cz * 16 + dz) !== biome) inside = false;
              }
              if (!inside) continue;
              columns++;
              for (const o of listFeatureOrigins(seed, cx, cz)) {
                if (o.type <= FeatureType.Acacia) trees++;
              }
            }
          }
        }
        sampled[biome] = columns;
        perColumn[biome] = columns > 0 ? trees / columns : NaN;
      }
      console.log(
        `[8d trees per 16x16 column, ${seedStr}] ` +
          biomes.map((b) => `${b} ${perColumn[b]!.toFixed(2)} (${sampled[b]} columns)`).join(', '),
      );
      expect(perColumn['desert']).toBe(0);
      if (Number.isNaN(perColumn['plains']!)) continue;
      for (const dense of ['oakwood_forest', 'rainforest']) {
        if (Number.isNaN(perColumn[dense]!)) continue;
        expect(perColumn[dense]!, `${dense} (${seedStr})`).toBeGreaterThan(
          perColumn['plains']! * 4,
        );
        expect(perColumn[dense]!).toBeGreaterThan(2.5);
      }
      expect(perColumn['plains']!).toBeLessThan(1.5);
      expect(perColumn['savanna']!).toBeLessThan(1.5);
      expect(perColumn['snowy_tundra']!).toBeLessThan(1.5);
    }

    // cacti appear in the desert
    const seed = hashString(STANDARD);
    const desert = findBiomeSpot(seed, ['desert'])!;
    const world = new World(false);
    const [cx0, cz0] = areaOrigin(desert, 4);
    generate(createDefaultPipeline(), seed, world, cx0, cz0, 4);
    let cacti = 0;
    let trees = 0;
    for (let x = cx0 * 16; x < (cx0 + 4) * 16; x++) {
      for (let z = cz0 * 16; z < (cz0 + 4) * 16; z++) {
        for (let y = 60; y < 140; y++) {
          const id = ids.name[world.getBlockStateId(x, y, z)]!;
          if (id === 'cactus') cacti++;
          if (LOGS.has(id)) trees++;
        }
      }
    }
    expect(cacti).toBeGreaterThan(0);
    expect(trees).toBe(0);

    // 2x2 pines and 2x2 rainwoods within 2000 blocks of the origin (standard seed)
    const found: Record<string, { x: number; z: number; baseY: number } | undefined> = {};
    for (const [biome, type, key] of [
      ['pine_taiga', FeatureType.PineBig, 'pine'],
      ['rainforest', FeatureType.RainwoodBig, 'rainwood'],
    ] as const) {
      for (let x = -2000; x <= 2000 && !found[key]; x += 16) {
        for (let z = -2000; z <= 2000 && !found[key]; z += 16) {
          if (sampleBiome(seed, x + 8, z + 8) !== biome) continue;
          const cx = Math.floor(x / 16);
          const cz = Math.floor(z / 16);
          for (const o of listFeatureOrigins(seed, cx, cz)) {
            if (o.type === type) found[key] = { x: o.x, z: o.z, baseY: o.baseY };
          }
        }
      }
      expect(found[key], `a 2x2 ${key} within 2000 blocks`).toBeDefined();
      const f = found[key]!;
      expect(Math.abs(f.x)).toBeLessThanOrEqual(2000);
      expect(Math.abs(f.z)).toBeLessThanOrEqual(2000);
      // generate it and look for the 2x2 trunk
      const w = new World(false);
      const pipeline = createDefaultPipeline();
      const cx = Math.floor(f.x / 16);
      const cz = Math.floor(f.z / 16);
      generate(pipeline, seed, w, cx - 1, cz - 1, 3);
      const log = `${key}_log`;
      for (const [dx, dz] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        for (let dy = 0; dy < 14; dy++) {
          const b = w.getBlock(f.x + dx, f.baseY + dy, f.z + dz);
          expect(b.id, `${log} at ${f.x + dx},${f.baseY + dy},${f.z + dz}`).toBe(log);
          expect(b.state['axis']).toBe('y');
        }
      }
      const under = w.getBlock(f.x, f.baseY - 1, f.z).id;
      expect(['grass_block', 'snow']).toContain(under);
      console.log(`[8d] 2x2 ${key} at (${f.x}, ${f.baseY}, ${f.z}), ${FEATURE_TYPE_NAMES[type]}`);
    }
  }, 20000);

  it('8d (consistency): every origin the stage lists has its trunk in the generated world, and the shapes vary', () => {
    const seed = hashString(STANDARD);
    const pipeline = createDefaultPipeline();
    const spot = findBiomeSpot(seed, ['oakwood_forest'])!;
    const world = new World(false);
    const [cx0, cz0] = areaOrigin(spot, 5);
    generate(pipeline, seed, world, cx0, cz0, 5);
    let origins = 0;
    for (let cx = cx0; cx < cx0 + 5; cx++) {
      for (let cz = cz0; cz < cz0 + 5; cz++) {
        for (const o of listFeatureOrigins(seed, cx, cz)) {
          origins++;
          const b = world.getBlock(o.x, o.baseY, o.z);
          if (o.type <= FeatureType.Acacia) {
            expect(
              LOGS.has(b.id),
              `trunk of ${FEATURE_TYPE_NAMES[o.type]} at ${o.x},${o.baseY},${o.z}`,
            ).toBe(true);
          }
        }
      }
    }
    expect(origins).toBeGreaterThan(30);

    // tree shapes vary in height and crown from tree to tree
    for (const type of [
      FeatureType.Oak,
      FeatureType.Birch,
      FeatureType.PineSmall,
      FeatureType.RainwoodBig,
      FeatureType.Acacia,
    ]) {
      const heights = new Set<number>();
      const crowns = new Set<number>();
      const shapes = new Set<string>();
      for (let i = 0; i < 40; i++) {
        const cells = describeFeature(type, hashString(`shape-${i}`), i * 7, i * 3);
        heights.add(Math.max(...cells.map((c) => c[1])));
        crowns.add(cells.filter((c) => c[3] === 'leaves').length);
        shapes.add(cells.map((c) => c.join(',')).join(';'));
      }
      expect(heights.size, `heights of ${FEATURE_TYPE_NAMES[type]}`).toBeGreaterThan(1);
      expect(crowns.size, `crowns of ${FEATURE_TYPE_NAMES[type]}`).toBeGreaterThan(5);
      expect(shapes.size, `shapes of ${FEATURE_TYPE_NAMES[type]}`).toBeGreaterThan(20);
    }
  }, 20000);

  // -------------------------------------------------------------------------------------------
  // 8e. Water and replacement
  // -------------------------------------------------------------------------------------------
  it('8e: no feature block below the water surface (a cave mushroom under rock excepted), and no feature replaces terrain or water', () => {
    const seeds = SEEDS.map((s) => hashString(s));
    const full = createDefaultPipeline();
    const base = new TerrainPipeline();
    base.addStage(terrainShapeStage);
    base.addStage(biomeSurfaceStage);
    base.addStage(caveStage);
    const problems: string[] = [];
    let featureBlocks = 0;
    let changed = 0;
    let nearWater = 0;

    for (const seed of seeds) {
      for (const biome of [
        'beach',
        'river',
        'swampland',
        'oakwood_forest',
        'rainforest',
        'stony_shore',
        'pine_taiga',
      ]) {
        const spot = findBiomeSpot(seed, [biome], 8) ?? findBiomeSpot(seed, [biome], 0);
        if (!spot) continue;
        const size = 4;
        const [cx0, cz0] = areaOrigin(spot, size);
        const withFeatures = new World(false);
        const without = new World(false);
        generate(full, seed, withFeatures, cx0, cz0, size);
        generate(base, seed, without, cx0, cz0, size);
        for (let x = cx0 * 16; x < (cx0 + size) * 16; x++) {
          for (let z = cz0 * 16; z < (cz0 + size) * 16; z++) {
            for (let y = 5; y < 300; y++) {
              const a = without.getBlockStateId(x, y, z);
              const b = withFeatures.getBlockStateId(x, y, z);
              const id = ids.name[b]!;
              if (a !== b) {
                changed++;
                // only air becomes something, and only a feature block or a boulder
                if (a !== 0) problems.push(`${ids.name[a]} replaced by ${id} at (${x},${y},${z})`);
                if (ids.feature[b] !== 1 && id !== 'stone')
                  problems.push(`unexpected ${id} at (${x},${y},${z})`);
              }
              if (ids.feature[b] === 1) {
                featureBlocks++;
                if (y <= SEA_LEVEL) {
                  // At or below the water surface. Only a mushroom on the floor of a cave is
                  // allowed there, and only with rock above it before any water.
                  let roof = false;
                  for (let yy = y + 1; yy < 320; yy++) {
                    const above = ids.name[withFeatures.getBlockStateId(x, yy, z)]!;
                    if (above === 'water') {
                      problems.push(`${id} at (${x},${y},${z}) is under water`);
                      break;
                    }
                    if (above !== 'air' && !FEATURE_IDS.has(above)) {
                      roof = true;
                      break;
                    }
                  }
                  const cave = (id === 'brown_mushroom' || id === 'red_mushroom') && roof;
                  if (!cave) {
                    problems.push(`${id} at (${x},${y},${z}) is at or below the water surface`);
                  }
                }
                if (ids.name[withFeatures.getBlockStateId(x, y + 1, z)] === 'water')
                  problems.push(`${id} at (${x},${y},${z}) has water above it`);
                if (ids.name[a] === 'water')
                  problems.push(`${id} at (${x},${y},${z}) replaced water`);
                if (
                  ids.name[withFeatures.getBlockStateId(x + 1, y - 1, z)] === 'water' ||
                  ids.name[withFeatures.getBlockStateId(x - 1, y - 1, z)] === 'water'
                ) {
                  nearWater++;
                }
              }
            }
          }
        }
      }
    }
    expect(
      problems,
      `${problems.length} problems, first: ${problems.slice(0, 15).join(' | ')}`,
    ).toEqual([]);
    expect(featureBlocks).toBeGreaterThan(10000);
    expect(changed).toBeGreaterThan(10000);
    console.log(
      `[8e] ${featureBlocks} feature blocks, ${nearWater} of them beside water, 0 problems`,
    );
  }, 20000);

  // -------------------------------------------------------------------------------------------
  // Guards for the pieces the stage relies on
  // -------------------------------------------------------------------------------------------
  it('probeGround agrees with the generated columns (top height, top block, snow) outside cave entrances', () => {
    const base = new TerrainPipeline();
    base.addStage(terrainShapeStage);
    base.addStage(biomeSurfaceStage);
    base.addStage(caveStage);
    let compared = 0;
    const mismatches: string[] = [];
    for (const seedStr of SEEDS) {
      const seed = hashString(seedStr);
      const ctx = getGroundContext(seed);
      const probe = createGroundProbe();
      for (const biome of [
        'oakwood_forest',
        'plains',
        'desert',
        'snowy_tundra',
        'swampland',
        'rainforest',
        'stony_heights',
        'savanna',
      ]) {
        const spot = findBiomeSpot(seed, [biome], 8) ?? findBiomeSpot(seed, [biome], 0);
        if (!spot) continue;
        const world = new World(false);
        const [cx0, cz0] = areaOrigin(spot, 3);
        generate(base, seed, world, cx0, cz0, 3);
        for (let x = cx0 * 16; x < (cx0 + 3) * 16; x += 3) {
          for (let z = cz0 * 16; z < (cz0 + 3) * 16; z += 3) {
            if (caveEntranceAt(ctx, x, z) >= CAVE_ENTRANCE_THRESHOLD) continue;
            probeGround(ctx, x, z, probe);
            let top = -1;
            for (let y = 319; y >= 0; y--) {
              const n = ids.name[world.getBlockStateId(x, y, z)]!;
              if (n !== 'air' && n !== 'water' && n !== 'lava') {
                top = y;
                break;
              }
            }
            compared++;
            if (probe.topBlock === '') {
              if (top >= SEA_LEVEL) mismatches.push(`(${x},${z}) probe says water, top is ${top}`);
              continue;
            }
            const realTop = probe.snow ? top - 1 : top;
            const realId = ids.name[world.getBlockStateId(x, realTop, z)]!;
            if (realTop !== probe.topY)
              mismatches.push(
                `(${x},${z}) top ${top}${probe.snow ? ' (snow)' : ''} vs probe ${probe.topY}`,
              );
            else if (
              realId !== probe.topBlock &&
              !(probe.topBlock.startsWith('clayrock') || realId.startsWith('clayrock'))
            ) {
              mismatches.push(`(${x},${z}) block ${realId} vs probe ${probe.topBlock}`);
            } else if (probe.snow && ids.name[world.getBlockStateId(x, top, z)] !== 'snow') {
              mismatches.push(`(${x},${z}) probe expects snow on top`);
            }
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(400);
    expect(
      mismatches,
      `${mismatches.length} of ${compared}: ${mismatches.slice(0, 10).join(' | ')}`,
    ).toEqual([]);
  }, 20000);

  it('the feature code uses no implementation-approximated math and no Math.random', () => {
    const files = ['src/gen/features.ts', 'src/gen/ground.ts', 'src/mesh/models.ts'];
    for (const f of files) {
      const text = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, f).not.toMatch(
        /Math\.(sin|cos|tan|asin|acos|atan|atan2|pow|exp|log|log2|log10|cbrt|hypot|random)\b/,
      );
    }
  });

  it('plants and logs keep the block ids the registry reports (no stale state ids)', () => {
    for (const id of FEATURE_IDS) {
      expect(registry.getBlockDefinition(id), id).toBeDefined();
    }
    expect(ChunkColumn.SECTION_COUNT).toBe(20);
  });
});
