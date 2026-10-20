import type { EntityWorld } from './world';
import type { ItemEntityManager } from '../item-entity';
import { items } from '../../gameplay/items';

/** What a spawner may create entities in. */
export interface EntitySpawnContext {
  ecs: EntityWorld;
  items: ItemEntityManager;
}

/** Spawn variations a type may support; breeding asks for `{ baby: true }`. */
export interface EntitySpawnOptions {
  baby?: boolean;
}

/** Creates one entity at the position and returns its id. */
export type EntitySpawner = (
  ctx: EntitySpawnContext,
  x: number,
  y: number,
  z: number,
  options?: EntitySpawnOptions,
) => number;

/** Spawner for a family of types `<prefix><name>`; returns null when `name` is not one of them. */
export type EntityFamilySpawner = (
  ctx: EntitySpawnContext,
  name: string,
  x: number,
  y: number,
  z: number,
) => number | null;

const types = new Map<string, EntitySpawner>();
const families = new Map<string, EntityFamilySpawner>();

/** Registers a spawnable type such as a creature id. */
export function registerEntityType(type: string, spawner: EntitySpawner): void {
  if (types.has(type)) throw new Error(`Duplicate entity type: ${type}`);
  types.set(type, spawner);
}

export function hasEntityType(type: string): boolean {
  return types.has(type);
}

export function registerEntityFamily(prefix: string, spawner: EntityFamilySpawner): void {
  if (families.has(prefix)) throw new Error(`Duplicate entity family: ${prefix}`);
  families.set(prefix, spawner);
}

/** Spawns a registered type; throws `Unknown entity type: <type>` for anything else. */
export function spawnEntity(
  ctx: EntitySpawnContext,
  type: string,
  x: number,
  y: number,
  z: number,
  options?: EntitySpawnOptions,
): number {
  if (![x, y, z].every(Number.isFinite)) throw new Error('Spawn position must be finite');
  const spawner = types.get(type);
  if (spawner) return spawner(ctx, x, y, z, options);
  for (const [prefix, family] of families)
    if (type.startsWith(prefix)) {
      const id = family(ctx, type.slice(prefix.length), x, y, z);
      if (id !== null) return id;
    }
  throw new Error(`Unknown entity type: ${type}`);
}

// 'item:<itemId>' drops one of that item as an item entity.
registerEntityFamily('item:', (ctx, id, x, y, z) => {
  if (!items.items.has(id)) return null;
  const entity = ctx.items.spawn(id, 1, x, y, z);
  if (!entity) throw new Error('Item entity capacity reached');
  return entity.id;
});
