import { describe, expect, it } from 'vitest';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { items } from '../../src/gameplay/items';
import {
  blockLoot,
  blockLootTable,
  rollBlockLoot,
  validateLootEntry,
} from '../../src/gameplay/loot';
import { BARE_HAND, canHarvest, type MiningTool } from '../../src/gameplay/mining';
import { crafting } from '../../src/gameplay/crafting';
import { smelting } from '../../src/gameplay/smelting';
import { OVERWORLD_ORE_IDS } from '../../src/gen/ores';
import { FLOWER_IDS } from '../../src/gen/features';
import { BIOME_DEFINITIONS } from '../../src/gen/biomes';
import { World } from '../../src/world/world';
import { PlayerController } from '../../src/engine/player-controller';
import { Camera } from '../../src/render/camera';
import { InputEngine } from '../../src/engine/input';

export type AcquisitionSource = 'drop' | 'loot' | 'crafting' | 'smelting';

export interface ExemptionEntry {
  readonly task: string;
  readonly reason: string;
}

/**
 * Minimal exemption table for registered items whose only acquisition source in survival
 * belongs to a later milestone (or are technical/non-obtainable block states).
 */
export const REACHABILITY_EXEMPTIONS: Readonly<Record<string, ExemptionEntry>> = {
  // Technical / non-inventory world states registered via BlockRegistry -> ItemRegistry parity
  air: { task: 'M02a', reason: 'Empty voxel state; not a collectible survival item' },
  foundation_stone: {
    task: 'M03b',
    reason: 'Unbreakable world floor (hardness Infinity)',
  },
  water: { task: 'M08a', reason: 'Source fluid block; not a collectible item drop' },
  lava: { task: 'M08a', reason: 'Source fluid block; not a collectible item drop' },
  wall_torch: {
    task: 'M09a',
    reason: 'Wall placement variant of torch; breaking drops torch',
  },
  fire: { task: 'M12c', reason: 'Transient hazard/weather block; drops nothing' },
  piston_head: { task: 'M15b', reason: 'Technical extended-piston arm; never placed or dropped' },
  sticky_piston_head: {
    task: 'M15b',
    reason: 'Technical extended-sticky-piston arm; never placed or dropped',
  },
  piston_moving: { task: 'M15b', reason: 'Technical block that stands in for a block in motion' },

  // Blocks that drop materials/dirt and are never obtainable as items
  grass_block: {
    task: 'M19b',
    reason:
      'never obtainable as an item: ores drop materials and grass drops dirt; SPEC has no silk-touch',
  },
  coal_ore: {
    task: 'M19b',
    reason:
      'never obtainable as an item: ores drop materials and grass drops dirt; SPEC has no silk-touch',
  },
  copper_ore: {
    task: 'M19b',
    reason:
      'never obtainable as an item: ores drop materials and grass drops dirt; SPEC has no silk-touch',
  },
  iron_ore: {
    task: 'M19b',
    reason:
      'never obtainable as an item: ores drop materials and grass drops dirt; SPEC has no silk-touch',
  },
  gold_ore: {
    task: 'M19b',
    reason:
      'never obtainable as an item: ores drop materials and grass drops dirt; SPEC has no silk-touch',
  },
  lumite_ore: {
    task: 'M19b',
    reason:
      'never obtainable as an item: ores drop materials and grass drops dirt; SPEC has no silk-touch',
  },

  // Crop farming / hamlet farm items (wheat never drops from tall_grass)
  wheat: {
    task: 'M19b',
    reason: 'Harvested from wheat crops in Wayfarer Hamlet farms (never drops from tall_grass)',
  },
  bread: {
    task: 'M19b',
    reason: 'Crafted from 3 wheat (requires wheat crops in M19b)',
  },
  hay_bale: {
    task: 'M19b',
    reason: 'Crafted from 9 wheat (requires wheat crops in M19b)',
  },

  // M11 / M13 passive & hostile creature drops and items crafted/smelted exclusively from them
  wild_berries: {
    task: 'M13e',
    reason: 'no task adds berry bushes yet (open SPEC gap)',
  },
  wool: { task: 'M13e', reason: 'Dropped or sheared from Tuftbuck passive creature' },
  raw_tuftbuck_shank: {
    task: 'M13e',
    reason: 'Dropped by Tuftbuck passive creature',
  },
  roast_tuftbuck_shank: {
    task: 'M13e',
    reason: 'Smelted from raw_tuftbuck_shank (Tuftbuck drop)',
  },
  raw_boar_chop: { task: 'M13e', reason: 'Dropped by Rootboar passive creature' },
  roast_boar_chop: {
    task: 'M13e',
    reason: 'Smelted from raw_boar_chop (Rootboar drop)',
  },
  tuber: { task: 'M13e', reason: 'Dug up by Rootboar passive creature' },
  baked_tuber: { task: 'M13e', reason: 'Smelted from tuber (Rootboar dig-up)' },
  egg: { task: 'M13e', reason: 'Laid by Dapplefowl passive creature' },
  feather: { task: 'M13e', reason: 'Dropped by Dapplefowl passive creature' },
  raw_fowl: { task: 'M13e', reason: 'Dropped by Dapplefowl passive creature' },
  roast_fowl: { task: 'M13e', reason: 'Smelted from raw_fowl (Dapplefowl drop)' },
  arrow: {
    task: 'M13d',
    reason: 'Crafted from feather (Dapplefowl drop in M13e) for bow projectiles',
  },
  shell_plate: { task: 'M13e', reason: 'Dropped by Mossback passive creature' },
  bark_strips: { task: 'M13f', reason: 'Dropped by Hollow hostile creature' },
  thorn: { task: 'M13f', reason: 'Dropped by Thornling hostile creature' },
  silk: { task: 'M13f', reason: 'Dropped by Skitterer hostile creature' },
  carapace: { task: 'M13f', reason: 'Dropped by Skitterer hostile creature' },
  bow: {
    task: 'M13d',
    reason: 'Crafted from silk (Skitterer drop in M13f)',
  },
  spore_powder: { task: 'M13f', reason: 'Dropped by Sporeburst hostile creature' },

  // M20 Hollowdeep dimension ores, creatures, and items
  skyshard_ore: {
    task: 'M20b',
    reason: 'Generates only in the Hollowdeep dimension (Hollowdeep generator)',
  },
  skyshard_crystal: {
    task: 'M20b',
    reason: 'Mined from Hollowdeep skyshard_ore (Hollowdeep generator)',
  },
  skyshard_pickaxe: {
    task: 'M20b',
    reason: 'Crafted from Hollowdeep skyshard_crystal (Hollowdeep generator)',
  },
  skyshard_axe: {
    task: 'M20b',
    reason: 'Crafted from Hollowdeep skyshard_crystal (Hollowdeep generator)',
  },
  skyshard_shovel: {
    task: 'M20b',
    reason: 'Crafted from Hollowdeep skyshard_crystal (Hollowdeep generator)',
  },
  skyshard_hoe: {
    task: 'M20b',
    reason: 'Crafted from Hollowdeep skyshard_crystal (Hollowdeep generator)',
  },
  skyshard_sword: {
    task: 'M20b',
    reason: 'Crafted from Hollowdeep skyshard_crystal (Hollowdeep generator)',
  },
  glowcap_stew: {
    task: 'M20c',
    reason: 'Crafted from Hollowdeep Glowcap fungus (M20c)',
  },
  luminous_membrane: {
    task: 'M20c',
    reason: 'Dropped by Hollowdeep Glowwing creature (M20c)',
  },
  emberite_scale: {
    task: 'M20c',
    reason: 'Dropped by Hollowdeep Magmaw creature (M20c)',
  },
};

function getOverworldWorldgenBlocks(): Set<string> {
  const blocks = new Set<string>([
    // Base terrain & surface stage (src/gen/terrain.ts, src/gen/surface.ts)
    'foundation_stone',
    'stone',
    'water',
    'lava',
    'sand',
    'gravel',
    'clay',
    'snow',
    'mire',
    'clayrock_white',
    'clayrock_light_gray',
    'clayrock_yellow',
    'clayrock_orange',
    'clayrock_terracotta',
    'clayrock_red',
    'clayrock_brown',
    'clayrock_dark_brown',
    // Fluid interaction in world (M08a)
    'blackglass',
    // Ores stage (src/gen/ores.ts)
    ...OVERWORLD_ORE_IDS,
    // Features stage (src/gen/features.ts)
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
    'cobblestone',
    'mossy_cobblestone',
    'packed_ice',
    'cactus',
    'pumpkin',
    'sugar_reeds',
    'tall_grass',
    'brown_mushroom',
    'red_mushroom',
    ...FLOWER_IDS,
  ]);

  for (const biome of Object.values(BIOME_DEFINITIONS)) {
    blocks.add(biome.surfaceRules.topBlock);
    blocks.add(biome.surfaceRules.fillerBlock);
  }

  return blocks;
}

export function computeSurvivalReachability(
  seedWorldBlocks: Iterable<string> = getOverworldWorldgenBlocks(),
  seedItems: Iterable<string> = [],
): Map<string, AcquisitionSource> {
  const registry = BlockRegistry.getInstance();
  const reached = new Map<string, AcquisitionSource>();
  const worldBlocks = new Set<string>(seedWorldBlocks);

  for (const itemId of seedItems) {
    reached.set(itemId, 'drop');
  }

  let changed = true;
  while (changed) {
    changed = false;

    // 1. Collect all currently available mining tools (starting with BARE_HAND)
    const availableTools: MiningTool[] = [BARE_HAND];
    for (const itemId of reached.keys()) {
      const def = items.get(itemId);
      if (def.tool) {
        availableTools.push(def.tool);
      }
    }

    // Any reachable block item can also be placed in the world and broken
    for (const itemId of reached.keys()) {
      const def = items.get(itemId);
      if (def.block) {
        worldBlocks.add(def.block);
      }
    }

    // 2. Harvest drops/loot from any world block breakable with available tools
    for (const blockId of worldBlocks) {
      const blockDef = registry.getBlockDefinition(blockId);
      if (!blockDef || !Number.isFinite(blockDef.hardness) || blockDef.hardness >= 1e8) {
        continue;
      }
      const harvestable = availableTools.some((tool) => canHarvest(blockDef, tool));
      if (!harvestable) continue;

      const loot = blockLoot(blockId);
      for (const entry of loot) {
        if ((entry.chance ?? 1) <= 0) continue;
        if (!reached.has(entry.id)) {
          const source: AcquisitionSource = entry.id === blockId ? 'drop' : 'loot';
          reached.set(entry.id, source);
          changed = true;
        }
      }
    }

    // 3. Crafting fixed-point step
    for (const recipe of crafting.recipes.values()) {
      if (reached.has(recipe.result.id)) continue;
      const specs = recipe.type === 'shaped' ? Object.values(recipe.key) : recipe.ingredients;
      const craftable = specs.every((spec) =>
        crafting.expandIngredient(spec).some((candidateId) => reached.has(candidateId)),
      );
      if (craftable) {
        reached.set(recipe.result.id, 'crafting');
        changed = true;
      }
    }

    // 4. Smelting fixed-point step (requires both input and at least one fuel)
    const hasFuel = [...reached.keys()].some((id) => smelting.isFuel(id));
    if (hasFuel) {
      for (const smelt of smelting.recipes.values()) {
        if (reached.has(smelt.output)) continue;
        if (reached.has(smelt.input)) {
          reached.set(smelt.output, 'smelting');
          changed = true;
        }
      }
    }
  }

  return reached;
}

describe('M10a survival reachability graph', () => {
  it('reaches every non-exempt survival item from starting worldgen blocks and keeps the exemption table minimal', () => {
    const reached = computeSurvivalReachability();

    // Verify tiered pickaxe progression is reached in order
    expect(reached.get('oak_log')).toBe('drop');
    expect(reached.get('oak_planks')).toBe('crafting');
    expect(reached.get('stick')).toBe('crafting');
    expect(reached.get('wooden_pickaxe')).toBe('crafting');
    expect(reached.get('cobblestone')).toBe('loot');
    expect(reached.get('stone_pickaxe')).toBe('crafting');
    expect(reached.get('raw_copper')).toBe('loot');
    expect(reached.get('copper_ingot')).toBe('smelting');
    expect(reached.get('copper_pickaxe')).toBe('crafting');
    expect(reached.get('raw_iron')).toBe('loot');
    expect(reached.get('iron_ingot')).toBe('smelting');
    expect(reached.get('iron_pickaxe')).toBe('crafting');
    expect(reached.get('lumite_shard')).toBe('loot');
    expect(reached.get('lumite_block')).toBe('crafting');
    expect(reached.get('raw_gold')).toBe('loot');
    expect(reached.get('gold_ingot')).toBe('smelting');
    expect(reached.get('blackglass')).toBe('drop');

    // Every registered item must be either reached OR in REACHABILITY_EXEMPTIONS, never both
    const unreachedWithoutExemption: string[] = [];
    const exemptedButReached: string[] = [];

    for (const itemId of items.items.keys()) {
      const isReached = reached.has(itemId);
      const isExempt = Object.prototype.hasOwnProperty.call(REACHABILITY_EXEMPTIONS, itemId);
      if (!isReached && !isExempt) {
        unreachedWithoutExemption.push(itemId);
      }
      if (isReached && isExempt) {
        exemptedButReached.push(itemId);
      }
    }

    expect(unreachedWithoutExemption).toEqual([]);
    expect(exemptedButReached).toEqual([]);

    for (const [id, entry] of Object.entries(REACHABILITY_EXEMPTIONS)) {
      expect(items.items.has(id), `Exemption '${id}' must be a registered item`).toBe(true);
      expect(entry.task).toMatch(/^M\d+/);
      expect(entry.reason.length).toBeGreaterThan(5);
    }
  });

  it('reaches all downstream M13, M19b and M20 crafted/smelted items once their base drops and Hollowdeep ore are available', () => {
    const worldBlocks = getOverworldWorldgenBlocks();
    worldBlocks.add('skyshard_ore');

    const baseDrops = [
      'wheat',
      'raw_tuftbuck_shank',
      'raw_boar_chop',
      'raw_fowl',
      'tuber',
      'feather',
      'silk',
    ];
    const reached = computeSurvivalReachability(worldBlocks, baseDrops);

    expect(reached.get('bread')).toBe('crafting');
    expect(reached.get('hay_bale')).toBe('crafting');
    expect(reached.get('roast_tuftbuck_shank')).toBe('smelting');
    expect(reached.get('roast_boar_chop')).toBe('smelting');
    expect(reached.get('roast_fowl')).toBe('smelting');
    expect(reached.get('baked_tuber')).toBe('smelting');
    expect(reached.get('arrow')).toBe('crafting');
    expect(reached.get('bow')).toBe('crafting');
    expect(reached.get('skyshard_crystal')).toBe('loot');
    expect(reached.get('skyshard_pickaxe')).toBe('crafting');
    expect(reached.get('skyshard_axe')).toBe('crafting');
    expect(reached.get('skyshard_shovel')).toBe('crafting');
    expect(reached.get('skyshard_hoe')).toBe('crafting');
    expect(reached.get('skyshard_sword')).toBe('crafting');
  });

  it('validates loot entry chance and min/max bounds on load', () => {
    expect(() => validateLootEntry('test', { id: 'coal', count: 1, chance: -0.1 })).toThrow(
      /chance/,
    );
    expect(() => validateLootEntry('test', { id: 'coal', count: 1, chance: 1.5 })).toThrow(
      /chance/,
    );
    expect(() => validateLootEntry('test', { id: 'coal', count: 2, min: 4, max: 2 })).toThrow(
      /min\/max/,
    );
    expect(() => validateLootEntry('test', { id: 'coal', count: 1, min: 0, max: 2 })).toThrow(
      /min\/max/,
    );
    expect(() => validateLootEntry('test', { id: 'coal', count: 1, min: 1, max: 99 })).toThrow(
      /min\/max/,
    );
  });

  it('keeps rolled loot counts within min-max and gives identical results for the same seed, position, and counter', () => {
    // (a) The same seed, position and counter give the same result
    for (let i = 0; i < 200; i++) {
      const seed = 1000 + i;
      const x = i * 3 - 50;
      const y = 16 + (i % 40);
      const z = -i * 5 + 20;
      const counter = i * 7;

      const copperA = rollBlockLoot('copper_ore', seed, x, y, z, counter);
      const copperB = rollBlockLoot('copper_ore', seed, x, y, z, counter);
      expect(copperA).toEqual(copperB);
      expect(copperA).toHaveLength(1);
      expect(copperA[0]!.id).toBe('raw_copper');
      expect(copperA[0]!.count).toBeGreaterThanOrEqual(2);
      expect(copperA[0]!.count).toBeLessThanOrEqual(5);

      const lumiteA = rollBlockLoot('lumite_ore', seed, x, y, z, counter);
      const lumiteB = rollBlockLoot('lumite_ore', seed, x, y, z, counter);
      expect(lumiteA).toEqual(lumiteB);
      expect(lumiteA).toHaveLength(1);
      expect(lumiteA[0]!.id).toBe('lumite_shard');
      expect(lumiteA[0]!.count).toBeGreaterThanOrEqual(2);
      expect(lumiteA[0]!.count).toBeLessThanOrEqual(4);

      for (const [oreId, dropId] of [
        ['coal_ore', 'coal'],
        ['iron_ore', 'raw_iron'],
        ['gold_ore', 'raw_gold'],
        ['skyshard_ore', 'skyshard_crystal'],
      ] as const) {
        expect(rollBlockLoot(oreId, seed, x, y, z, counter)).toEqual([{ id: dropId, count: 1 }]);
      }
    }

    // Breaking the same block at the same position in two worlds with the same seed spawns identical drops
    const runBreak = (worldSeed: number) => {
      const world = new World(false);
      world.worldSeed = worldSeed;
      expect(world.breakCount).toBe(0);
      world.fill(-2, 64, -2, 6, 64, 2, 'stone');
      world.setBlock(3, 66, 0, 'copper_ore');
      const controller = new PlayerController(
        new Camera(1),
        new InputEngine(document.createElement('canvas')),
        () => true,
      );
      controller.spawn(world, 0.5, 65, 0.5, 'survival');
      controller.player!.inventory.insert('stone_pickaxe', 1);
      controller.interaction!.input('attack', true);
      for (let t = 0; t < 40; t++) controller.interaction!.tick();
      expect(world.breakCount).toBe(1);
      return controller
        .itemEntities!.pool.filter((e) => e.active)
        .map((e) => ({ id: e.item.id, count: e.count }));
    };

    const broken1 = runBreak(424242);
    const broken2 = runBreak(424242);
    expect(broken1).toEqual(broken2);
    expect(broken1).toEqual(rollBlockLoot('copper_ore', 424242, 3, 66, 0, 0));

    // (b) The same position with different counters gives varied results
    // (e.g. over 1,000 breaks of one gravel position, flint appears between 5% and 15%)
    let flintsAtSamePos = 0;
    const TOTAL_BREAKS = 1000;
    for (let counter = 0; counter < TOTAL_BREAKS; counter++) {
      const roll = rollBlockLoot('gravel', 424242, 3, 66, 0, counter);
      expect(roll).toHaveLength(1);
      if (roll[0]!.id === 'flint') {
        flintsAtSamePos++;
      }
    }
    const flintFraction = flintsAtSamePos / TOTAL_BREAKS;
    expect(flintFraction).toBeGreaterThanOrEqual(0.05);
    expect(flintFraction).toBeLessThanOrEqual(0.15);
  });

  it('rolls exclusive loot tables to select at most one entry based on chances', () => {
    const table = blockLootTable('gravel');
    expect(table).toBeDefined();
    expect(table!.exclusive).toBe(true);
    expect(table!.entries).toHaveLength(2);

    for (let c = 0; c < 500; c++) {
      const roll = rollBlockLoot('gravel', 9999, 10, 64, -20, c);
      expect(roll).toHaveLength(1);
      expect(['flint', 'gravel']).toContain(roll[0]!.id);
      expect(roll[0]!.count).toBe(1);
    }
  });

  it('matches expected loot drop frequencies over 20,000 rolls and drops either flint or gravel (never both)', () => {
    const N = 20000;
    let apples = 0;
    let vines = 0;
    let seeds = 0;
    let flints = 0;
    let gravels = 0;
    const copperCounts = new Set<number>();
    const lumiteCounts = new Set<number>();

    for (let seed = 1; seed <= N; seed++) {
      // oak_leaves: self-drop + 0.005 apple
      const oak = rollBlockLoot('oak_leaves', seed, 10, 70, -15);
      expect(oak[0]).toEqual({ id: 'oak_leaves', count: 1 });
      if (oak.some((e) => e.id === 'apple' && e.count === 1)) {
        apples++;
      }

      // rainwood_leaves: self-drop + 0.05 vine
      const rainwood = rollBlockLoot('rainwood_leaves', seed, 10, 70, -15);
      expect(rainwood[0]).toEqual({ id: 'rainwood_leaves', count: 1 });
      if (rainwood.some((e) => e.id === 'vine' && e.count === 1)) {
        vines++;
      }

      // tall_grass: self-drop + 0.125 seed; never wheat
      const grass = rollBlockLoot('tall_grass', seed, 10, 70, -15);
      expect(grass[0]).toEqual({ id: 'tall_grass', count: 1 });
      expect(grass.some((e) => e.id === 'wheat')).toBe(false);
      if (grass.some((e) => e.id === 'seed' && e.count === 1)) {
        seeds++;
      }

      // gravel: 0.1 flint OR 0.9 gravel, never both
      const gravelRoll = rollBlockLoot('gravel', seed, 10, 70, -15);
      expect(gravelRoll).toHaveLength(1);
      expect(gravelRoll[0]!.count).toBe(1);
      if (gravelRoll[0]!.id === 'flint') {
        flints++;
      } else if (gravelRoll[0]!.id === 'gravel') {
        gravels++;
      } else {
        throw new Error(`Unexpected gravel drop: ${gravelRoll[0]!.id}`);
      }

      // copper_ore (2..5) & lumite_ore (2..4)
      copperCounts.add(rollBlockLoot('copper_ore', seed, 10, 30, -15)[0]!.count);
      lumiteCounts.add(rollBlockLoot('lumite_ore', seed, 10, 20, -15)[0]!.count);
    }

    // Apple rate: 0.5% target -> between 0.2% and 1.0% over 20,000 rolls
    const appleRate = apples / N;
    expect(appleRate).toBeGreaterThanOrEqual(0.002);
    expect(appleRate).toBeLessThanOrEqual(0.01);

    // Vine rate: 5% target -> between 4% and 6%
    const vineRate = vines / N;
    expect(vineRate).toBeGreaterThanOrEqual(0.04);
    expect(vineRate).toBeLessThanOrEqual(0.06);

    // Seed rate: 12.5% target -> between 11% and 14%
    const seedRate = seeds / N;
    expect(seedRate).toBeGreaterThanOrEqual(0.11);
    expect(seedRate).toBeLessThanOrEqual(0.14);

    // Gravel / flint: mutually exclusive (flints + gravels === N), flint rate ~10% (between 8.5% and 11.5%)
    expect(flints + gravels).toBe(N);
    const flintRate = flints / N;
    expect(flintRate).toBeGreaterThanOrEqual(0.085);
    expect(flintRate).toBeLessThanOrEqual(0.115);

    expect([...copperCounts].sort()).toEqual([2, 3, 4, 5]);
    expect([...lumiteCounts].sort()).toEqual([2, 3, 4]);
  });
});
