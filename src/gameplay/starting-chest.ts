import type { World } from '../world/world';
import type { SpawnPoint } from '../world/spawn';
import { chestStorageAt, type ChestFacing, type ChestSlot } from './chests';

/** What the Create World "Starting Chest" toggle puts next to the spawn (decisions/M18a-menus.md). */
export const STARTING_CHEST_ITEMS: readonly ChestSlot[] = [
  { id: 'oak_log', count: 8 },
  { id: 'bread', count: 4 },
  { id: 'wooden_pickaxe', count: 1 },
  { id: 'wooden_axe', count: 1 },
  { id: 'torch', count: 16 },
];

// Each neighbour of the spawn column, with the facing that turns the chest's front to the spawn.
const NEIGHBOURS: ReadonlyArray<{ dx: number; dz: number; facing: ChestFacing }> = [
  { dx: 1, dz: 0, facing: 'west' },
  { dx: -1, dz: 0, facing: 'east' },
  { dx: 0, dz: 1, facing: 'north' },
  { dx: 0, dz: -1, facing: 'south' },
];

/**
 * Places a filled single chest on the ground next to the spawn and returns its position. Prefers a
 * neighbour whose block at spawn height is air and stands on something solid; otherwise the first
 * neighbour is used as it is.
 */
export function placeStartingChest(
  world: World,
  spawn: SpawnPoint,
): { x: number; y: number; z: number } {
  const y = spawn.topY + 1;
  const free = (dx: number, dz: number) =>
    world.getBlock(spawn.x + dx, y, spawn.z + dz).id === 'air' &&
    world.getBlock(spawn.x + dx, y - 1, spawn.z + dz).id !== 'air';
  const spot = NEIGHBOURS.find((n) => free(n.dx, n.dz)) ?? NEIGHBOURS[0]!;
  const x = spawn.x + spot.dx;
  const z = spawn.z + spot.dz;
  world.setBlock(x, y, z, 'chest', { facing: spot.facing, pair: 'single' });
  const storage = chestStorageAt(world, x, y, z);
  if (!storage) throw new Error('The starting chest has no storage');
  STARTING_CHEST_ITEMS.forEach((stack, slot) => {
    storage.halves[0]!.slots[slot] = { ...stack };
  });
  return { x, y, z };
}
