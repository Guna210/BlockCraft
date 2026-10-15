import { api } from './core';
import { WorldManager } from '../../world/world-manager';
function controller() {
  const c = WorldManager.getInstance().playerController;
  if (!c?.player) throw new Error('Create a world before querying inventory');
  return c;
}
api.giveItem = (id, count) => {
  if (!controller().player!.inventory.insert(id, count)) throw new Error('Inventory is full');
};
api.getInventory = () => controller().player!.inventory.snapshot(true);
api.selectHotbarSlot = (slot) => {
  controller().player!.selectedSlot = slot;
};

api.getInventoryCursor = () => controller().player!.inventory.cursorSnapshot();
