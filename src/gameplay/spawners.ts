import {
  blockEntityRegistry,
  type BlockEntityInstance,
  type BlockEntityState,
} from '../world/block-entities';
import type { World } from '../world/world';
import { EntityKindC, TransformC } from '../entity/ecs/components';
import { hasEntityType } from '../entity/ecs/entity-types';
import { hasEntityModel } from '../entity/ecs/model';
import { MobC } from '../entity/ai/components';
import { mobRuntimeForWorld, type MobRuntime } from '../entity/ai/runtime';
import { MOB_CAPS } from '../entity/spawning';
import type { EntityMiniature } from '../render/entities';

export interface SpawnerState extends BlockEntityState {
  /** The creature type it spawns (a registered entity type). */
  creature: string;
  /** Active ticks left before the next spawn cycle. */
  delay: number;
}

export const DEFAULT_SPAWNER_CREATURE = 'hollow';
/** The spawner works only while the player is this close to the block's centre (3D). */
export const SPAWNER_ACTIVATION_RANGE = 16;
/** Spawn spots are at most this far from the spawner horizontally, and one block up or down. */
export const SPAWNER_SPAWN_RADIUS = 4;
export const SPAWNER_SPAWN_HEIGHT = 1;
/** No spawn while this many of its creature are within SPAWNER_CAP_RANGE of it. */
export const SPAWNER_NEARBY_CAP = 6;
export const SPAWNER_CAP_RANGE = 8;
export const SPAWNER_ATTEMPTS = 4;
export const SPAWNER_MAX_SPAWNS = 2;
/** The delay after a spawn cycle is drawn from this range of ticks. */
export const SPAWNER_MIN_DELAY = 200;
export const SPAWNER_MAX_DELAY = 800;
export const SPAWNER_FIRST_DELAY = 40;
/** Ticks between checks while the player is near, and while the player is away. */
export const SPAWNER_NEAR_INTERVAL = 10;
export const SPAWNER_FAR_INTERVAL = 100;
/** Within this distance the spawner checks every SPAWNER_NEAR_INTERVAL ticks. */
export const SPAWNER_WATCH_RANGE = 40;
/** Within this distance the spawner shows its spinning creature. */
export const SPAWNER_MINIATURE_RANGE = 32;

const miniatures = new WeakMap<World, Map<string, BlockEntityInstance<SpawnerState>>>();
const miniatureList: EntityMiniature[] = [];

function key(entity: BlockEntityInstance): string {
  return entity.x + ',' + entity.y + ',' + entity.z;
}

/** Distance from the player's feet to the spawner block's centre, or Infinity with no player. */
function playerDistance(runtime: MobRuntime | undefined, entity: BlockEntityInstance): number {
  const player = runtime?.player();
  if (!player) return Infinity;
  return Math.hypot(
    player.pos[0] - (entity.x + 0.5),
    player.pos[1] - (entity.y + 0.5),
    player.pos[2] - (entity.z + 0.5),
  );
}

function setMiniature(world: World, entity: BlockEntityInstance<SpawnerState>, shown: boolean) {
  let shownHere = miniatures.get(world);
  if (!shown) {
    shownHere?.delete(key(entity));
    return;
  }
  if (!shownHere) {
    shownHere = new Map();
    miniatures.set(world, shownHere);
  }
  shownHere.set(key(entity), entity);
}

/**
 * The spinning creatures of the spawners near the player, for the entity renderer. Spawners add and
 * remove themselves on their ticks, so the list holds only spawners within SPAWNER_MINIATURE_RANGE.
 */
export function spawnerMiniatures(world: World | null): readonly EntityMiniature[] {
  miniatureList.length = 0;
  const shownHere = world ? miniatures.get(world) : undefined;
  if (!world || !shownHere) return miniatureList;
  for (const [k, entity] of shownHere) {
    if (world.blockEntities.get(entity.x, entity.y, entity.z) !== entity) {
      shownHere.delete(k);
      continue;
    }
    if (hasEntityModel(entity.state.creature))
      miniatureList.push({ model: entity.state.creature, x: entity.x, y: entity.y, z: entity.z });
  }
  return miniatureList;
}

/** Hostiles in loaded columns, and the spawner's creature within SPAWNER_CAP_RANGE of it. */
function countMobs(runtime: MobRuntime, entity: BlockEntityInstance<SpawnerState>) {
  const ecs = runtime.ecs,
    world = runtime.world;
  let hostile = 0,
    nearby = 0;
  for (const id of ecs.query(MobC, TransformC)) {
    const pos = ecs.get(id, TransformC)!.pos;
    if (
      ecs.get(id, MobC)!.category === 'hostile' &&
      world.hasColumn(Math.floor(pos[0] / 16), Math.floor(pos[2] / 16))
    )
      hostile++;
    if (
      ecs.get(id, EntityKindC)?.type === entity.state.creature &&
      Math.abs(pos[0] - (entity.x + 0.5)) <= SPAWNER_CAP_RANGE &&
      Math.abs(pos[1] - (entity.y + 0.5)) <= SPAWNER_CAP_RANGE &&
      Math.abs(pos[2] - (entity.z + 0.5)) <= SPAWNER_CAP_RANGE
    )
      nearby++;
  }
  return { hostile, nearby };
}

/** Solid below, two passable cells, block light 0, and a column the light engine has lit. */
export function spawnerSpotOk(runtime: MobRuntime, x: number, y: number, z: number): boolean {
  const world = runtime.world,
    engine = world.lightEngine;
  if (!world.hasColumn(Math.floor(x / 16), Math.floor(z / 16))) return false;
  if (!engine || (engine.onlyLitColumns && !engine.isLit(Math.floor(x / 16), Math.floor(z / 16))))
    return false;
  if (runtime.classify(x, y - 1, z) !== 'solid') return false;
  if (runtime.classify(x, y, z) !== 'passable' || runtime.classify(x, y + 1, z) !== 'passable')
    return false;
  return world.getLight(x, y, z).block === 0;
}

/**
 * One spawner tick. Away from the player (or with spawning off) it does nothing at all; nearby it
 * counts its delay down and, when the delay runs out, tries a few spots in the dark around it.
 * Returns the number of creatures spawned.
 */
export function tickSpawner(entity: BlockEntityInstance<SpawnerState>, world: World): number {
  const runtime = mobRuntimeForWorld(world);
  const distance = playerDistance(runtime, entity);
  setMiniature(world, entity, distance <= SPAWNER_MINIATURE_RANGE);
  if (!runtime || !runtime.spawningEnabled || distance > SPAWNER_ACTIVATION_RANGE) return 0;
  if (!hasEntityType(entity.state.creature)) return 0;
  entity.state.delay -= SPAWNER_NEAR_INTERVAL;
  if (entity.state.delay > 0) return 0;
  entity.state.delay =
    SPAWNER_MIN_DELAY + Math.floor(runtime.random() * (SPAWNER_MAX_DELAY - SPAWNER_MIN_DELAY + 1));
  const counts = countMobs(runtime, entity);
  let spawned = 0;
  for (let attempt = 0; attempt < SPAWNER_ATTEMPTS && spawned < SPAWNER_MAX_SPAWNS; attempt++) {
    if (counts.hostile >= MOB_CAPS.hostile || counts.nearby >= SPAWNER_NEARBY_CAP) break;
    const span = SPAWNER_SPAWN_RADIUS * 2 + 1;
    const x = entity.x + Math.floor(runtime.random() * span) - SPAWNER_SPAWN_RADIUS;
    const z = entity.z + Math.floor(runtime.random() * span) - SPAWNER_SPAWN_RADIUS;
    const y =
      entity.y +
      Math.floor(runtime.random() * (SPAWNER_SPAWN_HEIGHT * 2 + 1)) -
      SPAWNER_SPAWN_HEIGHT;
    if (!spawnerSpotOk(runtime, x, y, z)) continue;
    runtime.spawn(entity.state.creature, x + 0.5, y, z + 0.5);
    spawned++;
    counts.hostile++;
    counts.nearby++;
  }
  return spawned;
}

/** Ticks until the next check: often while the player could reach it soon, rarely otherwise. */
export function spawnerTickDelay(entity: BlockEntityInstance<SpawnerState>, world: World): number {
  return playerDistance(mobRuntimeForWorld(world), entity) <= SPAWNER_WATCH_RANGE
    ? SPAWNER_NEAR_INTERVAL
    : SPAWNER_FAR_INTERVAL;
}

export function registerSpawnerBlockEntity(): void {
  blockEntityRegistry.register<SpawnerState>({
    blockId: 'spawner',
    tickInterval: SPAWNER_NEAR_INTERVAL,
    create: () => ({ creature: DEFAULT_SPAWNER_CREATURE, delay: SPAWNER_FIRST_DELAY }),
    tick: (entity, world) => {
      tickSpawner(entity, world);
    },
    nextTickDelay: spawnerTickDelay,
    afterRemoved: (entity, world) => setMiniature(world, entity, false),
  });
}

registerSpawnerBlockEntity();
