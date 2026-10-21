import type { Position } from '../entity/physics';
import type { World } from '../world/world';
import { BlockRegistry } from '../world/blocks/registry';
import { FACING_VECTOR, type Facing } from '../world/shape-geometry';
import { TICKS_PER_DAY, timeOfDay } from '../world/time';

/** Returns the first sunrise tick after the current absolute world time. */
export function nextMorningAbsoluteTime(ticks: number): number {
  return (Math.floor(ticks / TICKS_PER_DAY) + 1) * TICKS_PER_DAY;
}

export function deathCauseForDamageSource(source: string | null | undefined): string {
  switch (source) {
    case 'drowning':
      return 'Drowned';
    case 'lava':
      return 'Burned in lava';
    case 'fire':
      return 'Burned in fire';
    case 'burning':
      return 'Burned';
    case 'fall':
      return 'Fell from a height';
    case 'starvation':
      return 'Starved';
    case 'cactus':
      return 'Pricked by a cactus';
    case 'suffocation':
      return 'Suffocated';
    case 'void':
      return 'Fell into the void';
    case 'killed':
      return 'Killed';
    default:
      return source ? `Killed (${source})` : 'Killed';
  }
}

export interface BedWorld {
  getBlockStateId(x: number, y: number, z: number): number;
  hasColumn(cx: number, cz: number): boolean;
  entityQuery: {
    query(bounds: {
      minX: number;
      minY: number;
      minZ: number;
      maxX: number;
      maxY: number;
      maxZ: number;
    }): Array<{
      type: string;
      category?: string;
      minX: number;
      minY: number;
      minZ: number;
      maxX: number;
      maxY: number;
      maxZ: number;
    }>;
  };
}

export interface BedPair {
  foot: Position;
  head: Position;
  facing: Facing;
}

export function bedPairAt(
  world: Pick<World, 'getBlockStateId'>,
  x: number,
  y: number,
  z: number,
): BedPair | null {
  const registry = BlockRegistry.getInstance();
  const state = registry.getResolvedState(world.getBlockStateId(x, y, z));
  if (!state || state.blockId !== 'bed') return null;
  const facing = String(state.properties.facing) as Facing;
  if (!FACING_VECTOR[facing]) return null;
  const offset = FACING_VECTOR[facing];
  const isHead = state.properties.part === 'head';
  const foot: Position = isHead ? [x - offset[0], y, z - offset[1]] : [x, y, z];
  const head: Position = isHead ? [x, y, z] : [x + offset[0], y, z + offset[1]];
  const footState = registry.getResolvedState(world.getBlockStateId(foot[0], foot[1], foot[2]));
  const headState = registry.getResolvedState(world.getBlockStateId(head[0], head[1], head[2]));
  if (
    footState?.blockId !== 'bed' ||
    footState.properties.part !== 'foot' ||
    String(footState.properties.facing) !== facing ||
    headState?.blockId !== 'bed' ||
    headState.properties.part !== 'head' ||
    String(headState.properties.facing) !== facing
  )
    return null;
  return { foot, head, facing };
}

/** Returns the bed-top player position, or the world spawn when the bed pair is obstructed. */
export function resolveBedRespawn(
  world: BedWorld,
  spawnPoint: Position | null,
  worldSpawn: Position,
  canFit: (x: number, y: number, z: number, height: number) => boolean,
): Position {
  if (!spawnPoint) return [...worldSpawn];
  const footX = Math.floor(spawnPoint[0]);
  const footY = Math.floor(spawnPoint[1] - 0.5);
  const footZ = Math.floor(spawnPoint[2]);
  const pair = bedPairAt(world as Pick<World, 'getBlockStateId'>, footX, footY, footZ);
  if (!pair) return [...worldSpawn];
  for (const cell of [pair.foot, pair.head]) {
    if (!world.hasColumn(Math.floor(cell[0] / 16), Math.floor(cell[2] / 16)))
      return [...worldSpawn];
  }
  const x = pair.foot[0] + 0.5;
  const y = pair.foot[1] + 9 / 16;
  const z = pair.foot[2] + 0.5;
  return canFit(x, y, z, 1.8) ? [x, y, z] : [...worldSpawn];
}

export function sleepRefusalReason(
  ticks: number,
  hostileNearby: boolean,
): 'day' | 'hostile' | null {
  const time = timeOfDay(ticks);
  if (time < 12500 || time > 23500) return 'day';
  if (hostileNearby) return 'hostile';
  return null;
}

export function hostileWithin(world: BedWorld, position: Position, radius = 8): boolean {
  const [x, y, z] = position;
  return world.entityQuery
    .query({
      minX: x - radius,
      minY: y - radius,
      minZ: z - radius,
      maxX: x + radius,
      maxY: y + radius,
      maxZ: z + radius,
    })
    .some((entity) => {
      if (entity.type !== 'hostile' && entity.category !== 'hostile') return false;
      const dx = (entity.minX + entity.maxX) / 2 - x;
      const dy = (entity.minY + entity.maxY) / 2 - y;
      const dz = (entity.minZ + entity.maxZ) / 2 - z;
      return Math.hypot(dx, dy, dz) <= radius;
    });
}
