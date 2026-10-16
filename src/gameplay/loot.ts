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

const tables = new Map<string, readonly LootEntry[]>();
const files = import.meta.glob<Record<string, LootEntry[]>>('../../data/loot/*.json', {
  eager: true,
  import: 'default',
});
for (const path of Object.keys(files).sort())
  for (const [block, entries] of Object.entries(files[path]!)) {
    if (tables.has(block)) throw new Error(`Duplicate block loot: ${block}`);
    for (const entry of entries) {
      validateLootEntry(block, entry);
    }
    tables.set(block, entries);
  }

const EMPTY: readonly LootEntry[] = [];

export function blockLoot(block: string): readonly LootEntry[] {
  return tables.get(block) ?? EMPTY;
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
): RolledLoot[] {
  const entries = blockLoot(block);
  if (entries.length === 0) return [];
  const rng = new PRNG(deriveSeed(worldSeed, `loot:${x | 0},${y | 0},${z | 0}`));

  // If all entries have fractional chances partitioning 1 (e.g. gravel: 0.1 flint / 0.9 gravel),
  // roll once so the drops are mutually exclusive (one or the other, never both).
  if (
    entries.length > 1 &&
    entries.every((e) => e.chance !== undefined && e.chance > 0 && e.chance < 1) &&
    Math.abs(entries.reduce((sum, e) => sum + (e.chance ?? 1), 0) - 1) < 1e-9
  ) {
    const roll = rng.next();
    let cumulative = 0;
    let chosen = entries[entries.length - 1]!;
    for (const entry of entries) {
      cumulative += entry.chance!;
      if (roll < cumulative) {
        chosen = entry;
        break;
      }
    }
    return [{ id: chosen.id, count: rollEntryCount(chosen, rng) }];
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
