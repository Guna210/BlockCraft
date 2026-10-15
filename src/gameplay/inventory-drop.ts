import type { Inventory, InventoryTarget, CursorStack } from './inventory';
import type { ItemEntityManager } from '../entity/item-entity';
import type { Position } from '../entity/physics';

/** World boundary: a full entity pool leaves the source stack untouched. */
export function dropInventoryStack(
  inventory: Inventory,
  manager: ItemEntityManager,
  position: Position,
  target: InventoryTarget,
  whole = false,
): CursorStack | null {
  const stack = inventory.peekDrop(target, whole);
  if (!stack) return null;
  if (!manager.spawn(stack.id, stack.count, ...position)) return null;
  return inventory.drop(target, whole);
}
