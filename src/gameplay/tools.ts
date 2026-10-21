import { items, type ItemAffix } from './items';
import { BARE_HAND, type MiningTool } from './mining';

export type ToolType = MiningTool['type'];
export type ToolTierName = 'wood' | 'stone' | 'copper' | 'iron' | 'skyshard';
export type ToolItemInput =
  string | null | undefined | { readonly id: string; readonly affix?: ItemAffix };

export interface ToolTierStats {
  readonly name: ToolTierName;
  readonly harvestLevel: 0 | 1 | 2 | 3 | 4;
  readonly miningSpeed: number;
  readonly durability: number;
  readonly swordDamage: number;
  readonly craftedFrom: string;
}

/** Appendix A.2 tool tier definitions. */
export const TOOL_TIERS: Readonly<Record<ToolTierName, ToolTierStats>> = {
  wood: {
    name: 'wood',
    harvestLevel: 0,
    miningSpeed: 2,
    durability: 59,
    swordDamage: 4,
    craftedFrom: '#any_planks',
  },
  stone: {
    name: 'stone',
    harvestLevel: 1,
    miningSpeed: 4,
    durability: 131,
    swordDamage: 5,
    craftedFrom: 'cobblestone',
  },
  copper: {
    name: 'copper',
    harvestLevel: 2,
    miningSpeed: 5,
    durability: 190,
    swordDamage: 5,
    craftedFrom: 'copper_ingot',
  },
  iron: {
    name: 'iron',
    harvestLevel: 3,
    miningSpeed: 6,
    durability: 250,
    swordDamage: 6,
    craftedFrom: 'iron_ingot',
  },
  skyshard: {
    name: 'skyshard',
    harvestLevel: 4,
    miningSpeed: 9,
    durability: 2000,
    swordDamage: 8,
    craftedFrom: 'skyshard_crystal',
  },
};

const TIER_BY_LEVEL: readonly ToolTierStats[] = [
  TOOL_TIERS.wood,
  TOOL_TIERS.stone,
  TOOL_TIERS.copper,
  TOOL_TIERS.iron,
  TOOL_TIERS.skyshard,
];

const SPECIAL_DURABILITY: Readonly<Record<string, number>> = {
  iron_shears: 250,
  bow: 384,
  shield: 336,
  ember_flint: 64,
};

/** Armor defense points (half-armor icons) per piece, read from `armorPoints` in data/items. */
export const ARMOR_DEFENSE: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(
    [...items.items.values()]
      .filter((def) => def.armorPoints !== undefined)
      .map((def) => [def.id, def.armorPoints!]),
  ),
);

export function getToolTierByLevel(level: number): ToolTierStats | null {
  return TIER_BY_LEVEL[level] ?? null;
}

export function getItemToolTier(itemId?: string | null): ToolTierStats | null {
  if (!itemId) return null;
  const def = items.items.get(itemId);
  if (!def?.tool || def.tool.type === 'shears' || def.tool.type === 'none') return null;
  return getToolTierByLevel(def.tool.tier);
}

function itemIdOf(item?: ToolItemInput): string | null | undefined {
  return typeof item === 'string' || item == null ? item : item.id;
}

function hasAffix(item: ToolItemInput, affix: ItemAffix): boolean {
  return typeof item === 'object' && item !== null && item.affix === affix;
}

export function getMiningTool(item?: ToolItemInput): MiningTool {
  const itemId = itemIdOf(item);
  if (!itemId) return BARE_HAND;
  const def = items.items.get(itemId);
  if (!def?.tool) return BARE_HAND;
  const tierStats = getItemToolTier(itemId);
  if (tierStats) {
    return {
      type: def.tool.type,
      tier: tierStats.harvestLevel,
      speed: tierStats.miningSpeed,
    };
  }
  return def.tool;
}

export function getMiningSpeed(item?: ToolItemInput): number {
  const speed = getMiningTool(item).speed;
  return hasAffix(item, 'Swift') ? speed * 1.2 : speed;
}

export function getHarvestLevel(item?: ToolItemInput): number {
  return getMiningTool(item).tier;
}

export function getToolDurability(item?: ToolItemInput): number | null {
  const itemId = itemIdOf(item);
  if (!itemId) return null;
  const special = SPECIAL_DURABILITY[itemId];
  const tier = getItemToolTier(itemId);
  const durability = special !== undefined ? special : tier?.durability;
  if (durability === undefined) return null;
  return hasAffix(item, 'Sturdy') ? Math.round(durability * 1.5) : durability;
}

export function getToolAttackDamageForType(type: ToolType, tier: ToolTierName): number {
  const stats = TOOL_TIERS[tier];
  switch (type) {
    case 'sword':
      return stats.swordDamage;
    case 'axe':
      return stats.swordDamage - 1;
    case 'pickaxe':
      return stats.swordDamage - 2;
    case 'shovel':
      return stats.swordDamage - 3;
    case 'hoe':
    default:
      return 1;
  }
}

export function getAttackDamage(item?: ToolItemInput): number {
  const itemId = itemIdOf(item);
  if (!itemId) return 1;
  const def = items.items.get(itemId);
  if (!def?.tool) return 1 + Number(hasAffix(item, 'Keen'));
  const tier = getItemToolTier(itemId);
  const base = tier ? getToolAttackDamageForType(def.tool.type, tier.name) : 1;
  return base + Number(hasAffix(item, 'Keen'));
}

export function getArmorDefense(itemId?: string | null): number {
  if (!itemId) return 0;
  return ARMOR_DEFENSE[itemId] ?? 0;
}

export function getTotalArmorDefense(equippedIds: Iterable<string | null | undefined>): number {
  let total = 0;
  for (const id of equippedIds) {
    total += getArmorDefense(id);
  }
  return total;
}
