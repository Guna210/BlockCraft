import { PRNG, deriveSeed } from '../engine/rng';
import { items, type ItemAffix } from './items';
import { getToolDurability } from './tools';

export interface ChestLootEntry {
  readonly id: string;
  readonly weight: number;
  readonly count: readonly [min: number, max: number];
  /** Fraction of maximum durability remaining, rolled inclusively between the two fractions. */
  readonly durability?: readonly [minFrac: number, maxFrac: number];
  readonly affixChance?: number;
}

export interface ChestLootTable {
  readonly rolls: readonly [min: number, max: number];
  readonly entries: readonly ChestLootEntry[];
}

export interface RolledChestStack {
  readonly id: string;
  readonly count: number;
  readonly damage?: number;
  readonly affix?: ItemAffix;
}

const AFFIXES: readonly ItemAffix[] = ['Keen', 'Sturdy', 'Swift'];
const rawTables = import.meta.glob<ChestLootTable>('../../data/loot/chests/*.json', {
  eager: true,
  import: 'default',
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateRange(
  value: unknown,
  label: string,
  integer: boolean,
  minLimit: number,
  maxLimit: number,
): readonly [number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== 'number' ||
    typeof value[1] !== 'number' ||
    !Number.isFinite(value[0]) ||
    !Number.isFinite(value[1]) ||
    (integer && (!Number.isSafeInteger(value[0]) || !Number.isSafeInteger(value[1]))) ||
    value[0] < minLimit ||
    value[1] > maxLimit ||
    value[1] < value[0]
  ) {
    throw new Error('Invalid chest loot ' + label);
  }
  return Object.freeze([value[0], value[1]]) as readonly [number, number];
}

export function validateChestLootTable(id: string, value: unknown): ChestLootTable {
  if (!id || !isRecord(value) || !Array.isArray(value.entries)) {
    throw new Error('Invalid chest loot table: ' + id);
  }
  const rolls = validateRange(value.rolls, id + ' rolls', true, 0, 1000);
  const entries: ChestLootEntry[] = value.entries.map((entryValue, index) => {
    if (!isRecord(entryValue) || typeof entryValue.id !== 'string') {
      throw new Error('Invalid chest loot entry ' + id + ':' + index);
    }
    const item = items.get(entryValue.id);
    const weight = entryValue.weight;
    const count = validateRange(
      entryValue.count,
      id + ' count for ' + entryValue.id,
      true,
      1,
      item.maxStack,
    );
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) {
      throw new Error('Invalid chest loot weight for ' + entryValue.id);
    }

    let durability: readonly [number, number] | undefined;
    if (entryValue.durability !== undefined) {
      if (getToolDurability(entryValue.id) === null) {
        throw new Error('Chest loot durability requires a durable item: ' + entryValue.id);
      }
      durability = validateRange(entryValue.durability, id + ' durability', false, 0, 1);
    }
    const affixChance = entryValue.affixChance;
    if (
      affixChance !== undefined &&
      (typeof affixChance !== 'number' ||
        !Number.isFinite(affixChance) ||
        affixChance < 0 ||
        affixChance > 1)
    ) {
      throw new Error('Invalid chest loot affix chance for ' + entryValue.id);
    }
    return Object.freeze({
      id: entryValue.id,
      weight,
      count,
      ...(durability ? { durability } : {}),
      ...(affixChance !== undefined ? { affixChance } : {}),
    });
  });
  if (rolls[0] > 0 && entries.length === 0) {
    throw new Error('Chest loot table requires entries when rolls are nonzero: ' + id);
  }
  return Object.freeze({ rolls, entries: Object.freeze(entries) });
}

const loadedTables = Object.freeze(
  Object.fromEntries(
    Object.entries(rawTables)
      .sort(([pathA], [pathB]) => pathA.localeCompare(pathB))
      .map(([path, value]) => {
        const filename = path.split('/').at(-1) ?? '';
        const id = filename.replace(/\.json$/, '');
        return [id, validateChestLootTable(id, value)];
      }),
  ),
) as Readonly<Record<string, ChestLootTable>>;

export function chestLootTable(id: string): ChestLootTable | undefined {
  return loadedTables[id];
}

function pickEntry(entries: readonly ChestLootEntry[], rng: PRNG): ChestLootEntry {
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng.next() * totalWeight;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) return entry;
  }
  return entries[entries.length - 1]!;
}

function rollInclusive(range: readonly [number, number], rng: PRNG): number {
  return range[0] + Math.floor(rng.next() * (range[1] - range[0] + 1));
}

function rollFraction(range: readonly [number, number], rng: PRNG): number {
  return range[0] + rng.next() * (range[1] - range[0]);
}

/** Rolls a table using only its definition, world seed and chest coordinates. */
export function rollChestLoot(
  table: ChestLootTable,
  worldSeed: number,
  x: number,
  y: number,
  z: number,
  tableId = 'inline',
  lootIndex = 0,
): RolledChestStack[] {
  if (!Number.isSafeInteger(worldSeed) || ![x, y, z, lootIndex].every(Number.isSafeInteger)) {
    throw new Error('Chest loot seeds and coordinates must be safe integers');
  }
  const rng = new PRNG(
    deriveSeed(worldSeed, 'chest-loot:' + tableId + ':' + x + ',' + y + ',' + z + ':' + lootIndex),
  );
  const rollCount = rollInclusive(table.rolls, rng);
  const result: RolledChestStack[] = [];
  for (let roll = 0; roll < rollCount; roll++) {
    if (table.entries.length === 0) break;
    const entry = pickEntry(table.entries, rng);
    const count = rollInclusive(entry.count, rng);
    const affix =
      entry.affixChance !== undefined && rng.next() < entry.affixChance
        ? AFFIXES[Math.floor(rng.next() * AFFIXES.length)]!
        : undefined;
    const durability = entry.durability;
    const maxDurability = durability ? getToolDurability({ id: entry.id, affix }) : null;
    const damage =
      durability && maxDurability !== null
        ? Math.round(maxDurability * (1 - rollFraction(durability, rng)))
        : undefined;
    result.push({
      id: entry.id,
      count,
      ...(damage !== undefined ? { damage } : {}),
      ...(affix !== undefined ? { affix } : {}),
    });
  }
  return result;
}

export function rollChestLootById(
  id: string,
  worldSeed: number,
  x: number,
  y: number,
  z: number,
  lootIndex = 0,
): RolledChestStack[] {
  const table = chestLootTable(id);
  return table ? rollChestLoot(table, worldSeed, x, y, z, id, lootIndex) : [];
}
