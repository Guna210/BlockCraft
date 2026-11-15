// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Player } from '../../src/entity/player';
import {
  clickCraftGrid,
  clickKilnSlot,
  clickWindowSlot,
  dragWindowSlots,
  quickMoveInventoryToWindow,
  quickMoveWindowToInventory,
  type WindowSlotAccess,
} from '../../src/gameplay/inventory-window';
import { Inventory, type CursorStack } from '../../src/gameplay/inventory';
import type { KilnState } from '../../src/gameplay/kiln';

function copyAccess(slots: Array<CursorStack | null>): WindowSlotAccess {
  return {
    length: slots.length,
    get: (slot) => (slots[slot] ? { ...slots[slot]! } : null),
    set: (slot, stack) => {
      slots[slot] = stack ? { ...stack } : null;
    },
  };
}

describe('inventory window helpers with copy-returning slots', () => {
  it('shift-click merges inventory items into a copied chest stack and conserves counts', () => {
    const inventory = new Inventory();
    inventory.insert('oak_planks', 10);
    const chest: Array<CursorStack | null> = [{ id: 'oak_planks', count: 5 }];

    quickMoveInventoryToWindow(inventory, copyAccess(chest), 0);

    expect(chest[0]).toMatchObject({ id: 'oak_planks', count: 15 });
    expect(inventory.slots[0]).toBeNull();
    expect(chest.reduce((sum, stack) => sum + (stack?.count ?? 0), 0)).toBe(15);
  });

  it('writes back click and drag changes after reading detached slot copies', () => {
    const clickedInventory = new Inventory();
    clickedInventory.cursor = { id: 'oak_planks', count: 4 };
    const clicked: Array<CursorStack | null> = [{ id: 'oak_planks', count: 10 }];
    clickWindowSlot(clickedInventory, copyAccess(clicked), 0, 'right');
    expect(clicked[0]).toMatchObject({ id: 'oak_planks', count: 11 });
    expect(clickedInventory.cursor).toMatchObject({ id: 'oak_planks', count: 3 });

    const draggedInventory = new Inventory();
    draggedInventory.cursor = { id: 'oak_planks', count: 8 };
    const dragged: Array<CursorStack | null> = [{ id: 'oak_planks', count: 5 }, null];
    dragWindowSlots(draggedInventory, [0, 1], 'left', copyAccess(dragged));
    expect(dragged).toEqual([
      { id: 'oak_planks', count: 9 },
      { id: 'oak_planks', count: 4 },
    ]);
    expect(draggedInventory.cursor).toBeNull();
  });

  it('writes back quick moves from detached slots, including partial inventory capacity', () => {
    const inventory = new Inventory();
    for (let slot = 0; slot < 35; slot++) inventory.slots[slot] = { slot, id: 'dirt', count: 64 };
    inventory.slots[35] = { slot: 35, id: 'oak_planks', count: 63 };
    const chest: Array<CursorStack | null> = [{ id: 'oak_planks', count: 3 }];

    quickMoveWindowToInventory(inventory, copyAccess(chest), 0);

    expect(inventory.slots[35]).toMatchObject({ id: 'oak_planks', count: 64 });
    expect(chest[0]).toMatchObject({ id: 'oak_planks', count: 2 });
  });

  it('writes back craft-grid click and shift-click changes', () => {
    const clickedInventory = new Inventory();
    const clicked = [{ id: 'oak_planks', count: 3 }];
    clickCraftGrid(clickedInventory, clicked, 0, 'left', false);
    expect(clicked[0]).toBeNull();
    expect(clickedInventory.cursor).toMatchObject({ id: 'oak_planks', count: 3 });

    const shiftedInventory = new Inventory();
    shiftedInventory.insert('oak_planks', 4);
    const shifted = [{ id: 'oak_planks', count: 3 }];
    clickCraftGrid(shiftedInventory, shifted, 0, 'left', true);
    expect(shifted[0]).toBeNull();
    expect(shiftedInventory.slots[0]).toMatchObject({ id: 'oak_planks', count: 7 });
  });

  it('writes back copied kiln input, fuel and output slots', () => {
    const inventory = new Inventory();
    const player = { inventory, xpLevel: 0, xpProgress: 0 } as unknown as Player;
    const kiln: KilnState = {
      input: { id: 'oak_planks', count: 5, damage: null },
      fuel: { id: 'coal', count: 5, damage: null },
      output: { id: 'iron_ingot', count: 3, damage: null },
      burnRemaining: 0,
      burnTotal: 0,
      cookProgress: 0,
      storedXp: 1,
    };

    inventory.cursor = { id: 'oak_planks', count: 10 };
    clickKilnSlot(player, kiln, 0, 'left', false);
    expect(kiln.input).toMatchObject({ id: 'oak_planks', count: 15 });
    expect(inventory.cursor).toBeNull();

    inventory.insert('coal', 7);
    clickKilnSlot(player, kiln, 3, 'left', true);
    expect(kiln.fuel).toMatchObject({ id: 'coal', count: 12 });
    expect(inventory.slots[0]).toBeNull();

    inventory.slots.fill(null);
    clickKilnSlot(player, kiln, 2, 'left', true);
    expect(kiln.output).toBeNull();
    expect(inventory.slots[9]).toMatchObject({ id: 'iron_ingot', count: 3 });
    expect(player.xpProgress).toBeGreaterThan(0);
  });
});
