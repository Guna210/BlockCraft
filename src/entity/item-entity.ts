import { PRNG, deriveSeed } from '../engine/rng';
import { BlockCollision, EPSILON, type Position } from './physics';
import type { Player } from './player';
import type { World } from '../world/world';
import { items, type ItemAffix, type ItemDefinition } from '../gameplay/items';

export const ITEM_CAPACITY = 256;
export const ITEM_LIFETIME = 6000;
export class ItemEntity {
  active = false;
  id = 0;
  item: ItemDefinition = items.get('stone');
  damage?: number | null;
  affix?: ItemAffix;
  count = 0;
  age = 0;
  /** Ticks before the player can collect the item; thrown items use it so they are not re-collected. */
  pickupDelay = 0;
  phase = 0;
  readonly pos: Position = [0, 0, 0];
  readonly previous: Position = [0, 0, 0];
  readonly vel: Position = [0, 0, 0];
}
export interface EntitySnapshot {
  id: number;
  type: string;
  pos: Position;
  health: number;
  state: string;
  item: string;
  count: number;
  age: number;
  damage?: number | null;
  affix?: ItemAffix;
}
/** Dedicated bounded manager; IDs and plain snapshots can join M13a's entity API later. */
export class ItemEntityManager {
  readonly pool = Array.from({ length: ITEM_CAPACITY }, () => new ItemEntity());
  readonly collision: BlockCollision;
  onPickup: ((entity: ItemEntity) => void) | null = null;
  private readonly random: PRNG;
  private nextId = 1;
  constructor(readonly world: World) {
    this.collision = new BlockCollision(world);
    this.random = new PRNG(deriveSeed(world.worldSeed, 'item-pop'));
  }
  spawn(
    id: string,
    count: number,
    x: number,
    y: number,
    z: number,
    thrown?: { velocity: Position; pickupDelay: number },
    variant: { damage?: number | null; affix?: ItemAffix } = {},
  ): ItemEntity | null {
    const item = items.get(id);
    if (!Number.isInteger(count) || count < 1 || count > item.maxStack)
      throw new Error('Item entity count exceeds stack size');
    let entity: ItemEntity | null = null;
    for (let n = 0; n < ITEM_CAPACITY; n++)
      if (!this.pool[n]!.active) {
        entity = this.pool[n]!;
        break;
      }
    if (!entity) return null;
    entity.active = true;
    entity.id = this.nextId++;
    entity.item = item;
    entity.count = count;
    entity.damage = variant.damage;
    entity.affix = variant.affix;
    entity.age = 0;
    entity.phase = this.random.next() * Math.PI * 2;
    entity.pos[0] = entity.previous[0] = x;
    entity.pos[1] = entity.previous[1] = y;
    entity.pos[2] = entity.previous[2] = z;
    entity.pickupDelay = thrown?.pickupDelay ?? 0;
    if (thrown) {
      entity.vel[0] = thrown.velocity[0];
      entity.vel[1] = thrown.velocity[1];
      entity.vel[2] = thrown.velocity[2];
    } else {
      entity.vel[0] = (this.random.next() - 0.5) * 1.6;
      entity.vel[1] = 2 + this.random.next();
      entity.vel[2] = (this.random.next() - 0.5) * 1.6;
    }
    return entity;
  }
  tick(player: Player): void {
    for (let i = 0; i < this.pool.length; i++) {
      const entity = this.pool[i]!;
      if (!entity.active) continue;
      if (++entity.age >= ITEM_LIFETIME) {
        entity.active = false;
        continue;
      }
      for (let axis = 0; axis < 3; axis++) entity.previous[axis] = entity.pos[axis]!;
      // Keep bounded items in unloaded columns until streaming restores their collision data.
      if (!this.world.hasColumn(Math.floor(entity.pos[0] / 16), Math.floor(entity.pos[2] / 16)))
        continue;
      entity.vel[1] = Math.max(-20, entity.vel[1] - 12 * 0.05);
      for (let axis = 0; axis < 3; axis++) {
        const delta = entity.vel[axis]! * 0.05;
        if (
          !this.world.hasColumn(
            Math.floor((entity.pos[0] + (axis === 0 ? delta : 0)) / 16),
            Math.floor((entity.pos[2] + (axis === 2 ? delta : 0)) / 16),
          )
        ) {
          entity.vel[axis] = 0;
          continue;
        }
        const moved = this.collision.sweep(entity.pos, 0.25, axis, delta, 0.125);
        entity.pos[axis]! += moved;
        entity.vel[axis] = Math.abs(moved - delta) > EPSILON ? 0 : entity.vel[axis]! * 0.96;
      }
      // Only compatible stacks combine, without exceeding the item's declared limit.
      for (let j = 0; j < i; j++) {
        const other = this.pool[j]!;
        if (
          !other.active ||
          other.item !== entity.item ||
          (other.damage ?? null) !== (entity.damage ?? null) ||
          other.affix !== entity.affix ||
          (other.pos[0] - entity.pos[0]) ** 2 +
            (other.pos[1] - entity.pos[1]) ** 2 +
            (other.pos[2] - entity.pos[2]) ** 2 >
            0.25
        )
          continue;
        const count = Math.min(entity.count, entity.item.maxStack - other.count);
        other.count += count;
        entity.count -= count;
        if (count > 0) other.age = Math.max(other.age, entity.age);
        if (entity.count === 0) {
          entity.active = false;
          break;
        }
      }
      if (
        !entity.active ||
        entity.age < Math.max(4, entity.pickupDelay) ||
        player.detached ||
        player.dead
      )
        continue;
      const dx = player.pos[0] - entity.pos[0],
        dy = player.pos[1] + 0.6 - (entity.pos[1] + 0.125),
        dz = player.pos[2] - entity.pos[2];
      const distance = Math.hypot(dx, dy, dz);
      if (distance > 1.5) continue;
      const variant = {
        ...(entity.damage !== undefined ? { damage: entity.damage } : {}),
        ...(entity.affix !== undefined ? { affix: entity.affix } : {}),
      };
      if (player.inventory.capacity(entity.item.id, variant) < entity.count) continue;
      if (distance < 0.4) {
        if (player.inventory.insert(entity.item.id, entity.count, variant)) {
          entity.active = false;
          this.onPickup?.(entity);
        }
      } else {
        // Attraction is velocity; collision remains authoritative, so walls cannot be crossed.
        const pull = 6 / distance;
        entity.vel[0] = dx * pull;
        entity.vel[1] = dy * pull;
        entity.vel[2] = dz * pull;
      }
    }
  }
  snapshot(player: Player, filter?: { type?: string; radius?: number }): EntitySnapshot[] {
    if (filter?.type && filter.type !== 'item') return [];
    return this.pool
      .filter(
        (e) =>
          e.active &&
          (filter?.radius === undefined ||
            Math.hypot(
              e.pos[0] - player.pos[0],
              e.pos[1] - player.pos[1],
              e.pos[2] - player.pos[2],
            ) <= filter.radius),
      )
      .map((e) => ({
        id: e.id,
        type: 'item',
        pos: [...e.pos] as Position,
        health: 5,
        state: 'dropped',
        item: e.item.id,
        count: e.count,
        age: e.age,
        ...(e.damage !== undefined ? { damage: e.damage } : {}),
        ...(e.affix !== undefined ? { affix: e.affix } : {}),
      }));
  }
}
