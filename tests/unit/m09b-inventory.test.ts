import { describe, expect, it } from 'vitest';
import { Inventory } from '../../src/gameplay/inventory';

function put(inv: Inventory, slot: number, id: string, count: number) {
  inv.slots[slot] = { slot, id, count };
}

describe('M09b left-click with an unstackable cursor stack', () => {
  it('swaps with the same unstackable item in a slot', () => {
    const inv = new Inventory();
    put(inv, 4, 'iron_pickaxe', 1);
    inv.leftClick(4);
    put(inv, 4, 'iron_pickaxe', 1);
    const heldBefore = inv.cursor;
    const slotBefore = inv.slots[4];
    const before = inv.counts();
    inv.leftClick(4);
    // Both stacks are exchanged, not left untouched: the objects trade places.
    expect(inv.slots[4]).not.toBe(slotBefore);
    expect(inv.slots[4]).toMatchObject({ slot: 4, id: 'iron_pickaxe', count: 1 });
    expect(inv.cursor).not.toBe(heldBefore);
    expect(inv.cursor).toEqual({ id: 'iron_pickaxe', count: 1 });
    expect(inv.counts()).toEqual(before);
    inv.assertInvariant(before);
  });

  it('swaps with a different unstackable item and still merges stackable items', () => {
    const inv = new Inventory();
    put(inv, 0, 'iron_pickaxe', 1);
    put(inv, 1, 'iron_axe', 1);
    inv.leftClick(0);
    inv.leftClick(1);
    expect(inv.slots[1]).toMatchObject({ id: 'iron_pickaxe', count: 1 });
    expect(inv.cursor).toEqual({ id: 'iron_axe', count: 1 });
    put(inv, 2, 'dirt', 40);
    inv.leftClick(1);
    inv.leftClick(0);
    put(inv, 3, 'dirt', 30);
    inv.leftClick(3);
    inv.leftClick(2);
    expect(inv.slots[2]!.count).toBe(64);
    expect(inv.cursor).toEqual({ id: 'dirt', count: 6 });
  });
});

describe('M09b returnCursor', () => {
  it('moves the cursor into storage', () => {
    const inv = new Inventory();
    put(inv, 0, 'dirt', 10);
    inv.leftClick(0);
    inv.returnCursor();
    expect(inv.cursor).toBeNull();
    expect(inv.counts().get('dirt')).toBe(10);
  });

  it('keeps what does not fit on the cursor and conserves counts', () => {
    const inv = new Inventory();
    for (let slot = 0; slot < 36; slot++) put(inv, slot, 'stone', 64);
    put(inv, 5, 'dirt', 60);
    put(inv, 6, 'dirt', 20);
    inv.leftClick(6);
    put(inv, 6, 'stone', 64);
    const before = inv.counts();
    inv.returnCursor();
    // Only 4 more dirt fit into the stack of 60.
    expect(inv.slots[5]!.count).toBe(64);
    expect(inv.cursor).toEqual({ id: 'dirt', count: 16 });
    inv.assertInvariant(before);
  });
});
