import { PRNG, deriveSeed } from '../engine/rng';
import { items } from './items';

export interface LootEntry {
  id: string;
  count: number;
  min?: number;
  max?: number;
  chance?: number;
}

export interface RolledLoot {
  id: string;
  count: number;
}

export interface BlockLootTable {
  exclusive?: boolean;
  entries: readonly LootEntry[];
}

export type RawLootDefinition = LootEntry[] | { exclusive?: boolean; entries: LootEntry[] };

export function validateLootEntry(block: string, entry: LootEntry): void {
  const item = items.get(entry.id);
  const baseCount = entry.count ?? entry.min;
  if (!Number.isSafeInteger(baseCount) || baseCount <= 0 || baseCount > item.maxStack) {
    throw new Error(`Invalid block loot: ${block}`);
  }
  const min = entry.min ?? baseCount;
  const max = entry.max ?? baseCount;
  if (
    !Number.isSafeInteger(min) ||
    !Number.isSafeInteger(max) ||
    min <= 0 ||
    max < min ||
    max > item.maxStack
  ) {
    throw new Error(`Invalid block loot min/max: ${block}`);
  }
  const chance = entry.chance ?? 1;
  if (typeof chance !== 'number' || !Number.isFinite(chance) || chance < 0 || chance > 1) {
    throw new Error(`Invalid block loot chance: ${block}`);
  }
}

const tables = new Map<string, BlockLootTable>();
const files = import.meta.glob<Record<string, RawLootDefinition>>('../../data/loot/*.json', {
  eager: true,
  import: 'default',
});
for (const path of Object.keys(files).sort())
  for (const [block, def] of Object.entries(files[path]!)) {
    if (tables.has(block)) throw new Error(`Duplicate block loot: ${block}`);
    const exclusive = Array.isArray(def) ? false : Boolean(def.exclusive);
    const entries = Array.isArray(def) ? def : def.entries;
    if (!Array.isArray(entries)) {
      throw new Error(`Invalid block loot entries for: ${block}`);
    }
    for (const entry of entries) {
      validateLootEntry(block, entry);
    }
    tables.set(block, { exclusive, entries });
  }

const EMPTY: readonly LootEntry[] = [];

export function blockLootTable(block: string): BlockLootTable | undefined {
  return tables.get(block);
}

export function blockLoot(block: string): readonly LootEntry[] {
  return tables.get(block)?.entries ?? EMPTY;
}

function rollEntryCount(entry: LootEntry, rng: PRNG): number {
  const min = entry.min ?? entry.count;
  const max = entry.max ?? entry.count;
  if (min === max) return min;
  return min + Math.floor(rng.next() * (max - min + 1));
}

export function rollBlockLoot(
  block: string,
  worldSeed: number,
  x: number,
  y: number,
  z: number,
  breakCount: number = 0,
): RolledLoot[] {
  const table = tables.get(block);
  if (!table || table.entries.length === 0) return [];
  const entries = table.entries;
  const rng = new PRNG(deriveSeed(worldSeed, `loot:${x | 0},${y | 0},${z | 0}:${breakCount | 0}`));

  if (table.exclusive) {
    const roll = rng.next();
    let cumulative = 0;
    for (const entry of entries) {
      const chance = entry.chance ?? 1;
      cumulative += chance;
      if (roll < cumulative) {
        return [{ id: entry.id, count: rollEntryCount(entry, rng) }];
      }
    }
    return [];
  }

  const results: RolledLoot[] = [];
  for (const entry of entries) {
    const chance = entry.chance ?? 1;
    if (chance <= 0) continue;
    if (chance < 1 && rng.next() >= chance) continue;
    results.push({ id: entry.id, count: rollEntryCount(entry, rng) });
  }
  return results;
}
