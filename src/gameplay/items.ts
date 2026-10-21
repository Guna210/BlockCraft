import { BlockRegistry } from '../world/blocks/registry';
import type { MiningTool } from './mining';

export type ItemAffix = 'Keen' | 'Sturdy' | 'Swift';
export const ITEM_AFFIXES: readonly ItemAffix[] = Object.freeze(['Keen', 'Sturdy', 'Swift']);

export function isItemAffix(value: unknown): value is ItemAffix {
  return typeof value === 'string' && ITEM_AFFIXES.includes(value as ItemAffix);
}

export interface ItemDefinition {
  id: string;
  kind: 'block' | 'tool' | 'armor' | 'food' | 'material';
  maxStack: 64 | 16 | 1;
  block?: string;
  texture?: string;
  tool?: MiningTool;
  armorSlot?: 'head' | 'chest' | 'legs' | 'feet';
  armorPoints?: number;
  hunger?: number;
  saturation?: number;
}

/** Category data is loaded once; definitions are shared by inventory and rendering. */
export class ItemRegistry {
  readonly items = new Map<string, ItemDefinition>();
  constructor() {
    const files = import.meta.glob<Record<string, Omit<ItemDefinition, 'id'>>>(
      '../../data/items/*.json',
      { eager: true, import: 'default' },
    );
    for (const path of Object.keys(files).sort())
      for (const [id, data] of Object.entries(files[path]!)) {
        if (this.items.has(id)) throw new Error(`Duplicate item: ${id}`);
        if (![64, 16, 1].includes(data.maxStack)) throw new Error(`Invalid stack size: ${id}`);
        if ((data.kind === 'tool' || data.kind === 'armor') && data.maxStack !== 1)
          throw new Error(`Equipment must be unstackable: ${id}`);
        if (
          data.kind === 'armor' &&
          (!['head', 'chest', 'legs', 'feet'].includes(data.armorSlot ?? '') ||
            !Number.isInteger(data.armorPoints) ||
            data.armorPoints! < 0 ||
            data.armorPoints! > 20)
        )
          throw new Error(`Invalid armor definition: ${id}`);
        if (
          data.kind === 'food' &&
          (!Number.isInteger(data.hunger) ||
            data.hunger! < 0 ||
            !Number.isFinite(data.saturation) ||
            data.saturation! < 0)
        )
          throw new Error(`Invalid food values: ${id}`);
        if (data.block && BlockRegistry.getInstance().getDefaultStateId(data.block) === undefined)
          throw new Error(`Unknown item block: ${id}`);
        this.items.set(id, { ...data, id });
      }
  }
  get(id: string): ItemDefinition {
    const item = this.items.get(id);
    if (!item) throw new Error(`Unknown item: ${id}`);
    return item;
  }
}

export const items = new ItemRegistry();