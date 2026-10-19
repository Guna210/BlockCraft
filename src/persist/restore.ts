import type { ItemEntityManager } from '../entity/item-entity';
import type { Player } from '../entity/player';
import { setWorldTime } from '../world/time';
import type { World } from '../world/world';
import { weatherManager } from '../world/weather';
import {
  applyPlayerData,
  deserializeInventory,
  deserializeItemEntities,
  deserializePlayerData,
  deserializeWorldMetadata,
  type SerializedPlayerData,
  type SerializedWorldMetadata,
} from './serializers';
import type { RestoredColumn } from './save-manager';
import type { EntityRecord, PlayerRecord, WorldRecord } from './world-store';

/**
 * Puts a saved column into the world and re-attaches what belongs to it. Order matters: the
 * column's pending ticks come first, so a block entity's own tick is not queued twice; block
 * entities then come back with their saved state; the Current engine registers the column's
 * components (and the powered-door memory), and settles once its neighbours are present.
 * `World.setColumn` is the restore hook. Light is not saved: the streamer's light stage computes it
 * for every column it brings in, saved or generated.
 */
export function applyRestoredColumn(world: World, restored: RestoredColumn): void {
  const { column } = restored;
  world.setColumn(column);
  if (restored.ticks) world.ticks.addRebased(restored.ticks.ticks, restored.ticks.time);
  for (const entity of restored.blockEntities) world.blockEntities.restore(entity);
  world.current.restoreColumn(column);
  world.current.mechanics.restorePoweredOpenables(restored.doors);
  world.current.settleRestored();
}

/** The world-level state of a saved world: clocks, weather and the break counter. */
export function applyWorldRecord(world: World, record: WorldRecord): SerializedWorldMetadata {
  const meta = deserializeWorldMetadata(record.meta);
  setWorldTime(meta.timeOfDay);
  weatherManager.setState({
    weather: meta.weather,
    manualOverride: meta.manualOverride,
    strikeCounter: meta.strikeCounter,
    lastTick: meta.lastTick,
    elapsed: meta.elapsed,
  });
  world.breakCount = meta.breakCount;
  world.ticks.time = record.ticksTime;
  return meta;
}

export function readPlayerData(record: PlayerRecord): SerializedPlayerData {
  return deserializePlayerData(record.data);
}

/** Position, vitals, XP, spawn point and inventory of the saved player. */
export function applyPlayerRecord(player: Player, record: PlayerRecord): SerializedPlayerData {
  const data = deserializePlayerData(record.data);
  applyPlayerData(player, data);
  deserializeInventory(record.inventory, player.inventory);
  return data;
}

/** Ground items come back where they lay, with their velocity, age and pickup delay. */
export function applyEntityRecord(items: ItemEntityManager, record: EntityRecord): number {
  const saved = deserializeItemEntities(record.items);
  for (const item of saved) {
    const entity = items.spawn(
      item.id,
      item.count,
      item.position[0],
      item.position[1],
      item.position[2],
      {
        velocity: item.velocity,
        pickupDelay: item.pickupDelay,
      },
    );
    if (entity) entity.age = item.age;
  }
  return saved.length;
}
