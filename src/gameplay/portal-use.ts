import type { Player } from '../entity/player';
import type { World } from '../world/world';
import type { RayHit } from '../world/raycast';
import { PortalIndex, lightPortal } from '../world/portals';
import { getToolDurability } from './tools';
const offsets = {
  top: [0, 1, 0],
  bottom: [0, -1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
} as const;
/** Shared frame activation and Ember Flint wear. The caller checks the held item. */
export function useEmberFlint(
  world: World,
  index: PortalIndex,
  target: RayHit,
  player: Player | null,
): boolean {
  const [dx, dy, dz] = offsets[target.face];
  if (!lightPortal(world, index, target.x + dx, target.y + dy, target.z + dz)) return false;
  const held = player?.inventory.held;
  const durability = getToolDurability(held);
  if (player && held && player.mode === 'survival' && durability !== null) {
    held.damage = (held.damage ?? 0) + 1;
    if (held.damage >= durability) player.inventory.slots[player.inventory.selectedSlot] = null;
  }
  return true;
}
