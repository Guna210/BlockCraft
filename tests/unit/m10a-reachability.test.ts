import { describe, expect, it } from 'vitest';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { items } from '../../src/gameplay/items';
import { blockLoot } from '../../src/gameplay/loot';
import { BARE_HAND, canHarvest, type MiningTool } from '../../src/gameplay/mining';
import { crafting } from '../../src/gameplay/crafting';
import { smelting } from '../../src/gameplay/smelting';
import { OVERWORLD_ORE_IDS } from '../../src/gen/ores';
import { FLOWER_IDS } from '../../src/gen/features';
import { BIOME_DEFINITIONS } from '../../src/gen/biomes';

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

  // Blocks that drop other items unless harvested with the Silk Touch affix (M19b)
  grass_block: {
    task: 'M19b',
    reason: 'Drops dirt unless mined with a Silk Touch affixed tool',
  },
  coal_ore: {
    task: 'M19b',
    reason: 'Drops coal unless mined with a Silk Touch affixed tool',
  },
  copper_ore: {
    task: 'M19b',
    reason: 'Drops raw_copper unless mined with a Silk Touch affixed tool',
  },
  iron_ore: {
    task: 'M19b',
    reason: 'Drops raw_iron unless mined with a Silk Touch affixed tool',
  },
  gold_ore: {
    task: 'M19b',
    reason: 'Drops raw_gold unless mined with a Silk Touch affixed tool',
  },
  lumite_ore: {
    task: 'M19b',
    reason: 'Drops lumite_shard unless mined with a Silk Touch affixed tool',
  },

  // M11 / M13 passive & hostile creature drops and items crafted/smelted exclusively from them
  wild_berries: {
    task: 'M13e',
    reason: 'Harvested from berry bushes not placed in M03f worldgen',
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
    task: 'M20a',
    reason: 'Generates only in the Hollowdeep dimension (Appendix A.4)',
  },
  skyshard_crystal: {
    task: 'M20a',
    reason: 'Mined from Hollowdeep skyshard_ore',
  },
  skyshard_pickaxe: {
    task: 'M20a',
    reason: 'Crafted from Hollowdeep skyshard_crystal',
  },
  skyshard_axe: {
    task: 'M20a',
    reason: 'Crafted from Hollowdeep skyshard_crystal',
  },
  skyshard_shovel: {
    task: 'M20a',
    reason: 'Crafted from Hollowdeep skyshard_crystal',
  },
  skyshard_hoe: {
    task: 'M20a',
    reason: 'Crafted from Hollowdeep skyshard_crystal',
  },
  skyshard_sword: {
    task: 'M20a',
    reason: 'Crafted from Hollowdeep skyshard_crystal',
  },
  glowcap_stew: {
    task: 'M20a',
    reason: 'Crafted from Hollowdeep Glowcap fungus',
  },
  luminous_membrane: {
    task: 'M20b',
    reason: 'Dropped by Hollowdeep Glowwing creature',
  },
  emberite_scale: {
    task: 'M20b',
    reason: 'Dropped by Hollowdeep Magmaw creature',
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

  it('reaches all downstream M13 and M20 crafted/smelted items once their base creature drops and Hollowdeep ore are available', () => {
    const worldBlocks = getOverworldWorldgenBlocks();
    worldBlocks.add('skyshard_ore');

    const baseDrops = [
      'raw_tuftbuck_shank',
      'raw_boar_chop',
      'raw_fowl',
      'tuber',
      'feather',
      'silk',
    ];
    const reached = computeSurvivalReachability(worldBlocks, baseDrops);

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
});
