import type { Player } from '../src/entity/player';
import type { ItemEntityManager } from '../src/entity/item-entity';
import {
  InventoryAction as A,
  CURSOR_SLOT,
  MessageType as T,
  type Messages,
} from '../src/net/protocol';

/** Requests contain operations, never trusted stack contents; shared Inventory preserves counts. */
export function transactInventory(
  player: Player,
  drops: ItemEntityManager,
  revision: number,
  request: Messages[T.InventoryTransaction],
): string | null {
  const inv = player.inventory;
  if (request.windowId !== 0) return 'Window is not owned or open';
  if (request.revision !== revision) return 'Inventory revision mismatch';
  if (player.dead) return 'Player is dead';
  if (request.action === A.SelectSlot) {
    if (request.slot > 8 || request.slots.length) return 'Invalid hotbar slot';
    inv.selectedSlot = request.slot;
    return null;
  }
  const dropping = request.action === A.DropOne || request.action === A.DropStack;
  const dragging = request.action === A.DragEven || request.action === A.DragOne;
  if (request.slot >= inv.slots.length && !(dropping && request.slot === CURSOR_SLOT))
    return 'Slot is not owned';
  if (!dragging && request.slots.length) return 'Unexpected drag slots';
  if (dragging) {
    if (request.slots.length === 0 || request.slots.length > inv.slots.length)
      return 'Invalid drag';
    for (let i = 0; i < request.slots.length; i++) {
      if (request.slots[i]! >= inv.slots.length) return 'Slot is not owned';
      for (let j = 0; j < i; j++)
        if (request.slots[i] === request.slots[j]) return 'Duplicate drag slot';
    }
  }
  switch (request.action) {
    case A.LeftClick:
      inv.leftClick(request.slot);
      break;
    case A.RightClick:
      inv.rightClick(request.slot);
      break;
    case A.QuickMove:
      inv.shiftClick(request.slot);
      break;
    case A.DragEven:
      inv.drag(request.slots, 'left');
      break;
    case A.DragOne:
      inv.drag(request.slots, 'right');
      break;
    case A.CollectAll:
      inv.doubleClick();
      break;
    case A.DropOne:
    case A.DropStack: {
      const target = request.slot === CURSOR_SLOT ? 'cursor' : request.slot;
      const stack = inv.peekDrop(target, request.action === A.DropStack);
      if (
        stack &&
        !drops.spawn(
          stack.id,
          stack.count,
          player.pos[0],
          player.pos[1] + player.eye,
          player.pos[2],
          { velocity: [Math.cos(player.yaw) * 3, 2, Math.sin(player.yaw) * 3], pickupDelay: 40 },
          stack,
        )
      )
        return 'Item entity capacity reached';
      inv.drop(target, request.action === A.DropStack);
      break;
    }
    default:
      return 'Unknown inventory action';
  }
  return null;
}
