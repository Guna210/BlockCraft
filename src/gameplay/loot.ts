import { items } from './items';

export interface LootEntry {
  id: string;
  count: number;
}
const tables = new Map<string, readonly LootEntry[]>();
const files = import.meta.glob<Record<string, LootEntry[]>>('../../data/loot/*.json', {
  eager: true,
  import: 'default',
});
for (const path of Object.keys(files).sort())
  for (const [block, entries] of Object.entries(files[path]!)) {
    if (tables.has(block)) throw new Error(`Duplicate block loot: ${block}`);
    for (const entry of entries) {
      items.get(entry.id);
      if (!Number.isSafeInteger(entry.count) || entry.count <= 0)
        throw new Error(`Invalid block loot: ${block}`);
    }
    tables.set(block, entries);
  }
const EMPTY: readonly LootEntry[] = [];
export function blockLoot(block: string): readonly LootEntry[] {
  return tables.get(block) ?? EMPTY;
}
