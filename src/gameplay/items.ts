import { BlockRegistry } from '../world/blocks/registry';
import type { MiningTool } from './mining';

export interface ItemDefinition {
  id: string;
  kind: 'block' | 'tool';
  maxStack: 64 | 16 | 1;
  block?: string;
  texture?: string;
  tool?: MiningTool;
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
