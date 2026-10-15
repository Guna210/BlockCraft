import { items } from '../../src/gameplay/items';
import { describe, expect, it } from 'vitest';
import { Inventory } from '../../src/gameplay/inventory';
import { dropInventoryStack } from '../../src/gameplay/inventory-drop';
import { ItemEntityManager, ITEM_CAPACITY } from '../../src/entity/item-entity';
import { World } from '../../src/world/world';
import { PRNG } from '../../src/engine/rng';

function stack(inv: Inventory, slot: number, id: string, count: number) {
  inv.slots[slot] = { slot, id, count };
}
function checked(inv: Inventory, op: () => void) {
  const before = inv.counts();
  op();
  inv.assertInvariant(before);
}
it('keeps M07b storage snapshot and hotbar indices, adds detached equipment/cursor snapshots', () => {
  const inv = new Inventory();
  expect(inv.slots).toHaveLength(41);
  expect(inv.snapshot()).toHaveLength(36);
  expect(inv.snapshot(true)).toHaveLength(41);
  inv.insert('iron_helmet', 1);
  inv.shiftClick(0);
  expect(inv.snapshot(true)[36]).toEqual({ slot: 36, id: 'iron_helmet', count: 1 });
  inv.leftClick(36);
  inv.cursorSnapshot()!.count = 99;
  expect(inv.cursor?.count).toBe(1);
  inv.leftClick(0);
  inv.snapshot(true)[0]!.count = 99;
  expect(inv.held?.count).toBe(1);
});
it('left pick, place, swap and merge retain overflow', () => {
  const inv = new Inventory();
  stack(inv, 0, 'dirt', 60);
  stack(inv, 1, 'stone', 3);
  checked(inv, () => inv.leftClick(0));
  expect(inv.cursor).toEqual({ id: 'dirt', count: 60 });
  checked(inv, () => inv.leftClick(1));
  expect(inv.cursor).toEqual({ id: 'stone', count: 3 });
  expect(inv.slots[1]).toEqual({ slot: 1, id: 'dirt', count: 60 });
  checked(inv, () => inv.leftClick(2));
  expect(inv.cursor).toBeNull();
  stack(inv, 0, 'dirt', 10);
  inv.leftClick(0);
  checked(inv, () => inv.leftClick(1));
  expect(inv.slots[1]?.count).toBe(64);
  expect(inv.cursor?.count).toBe(6);
  checked(inv, () => inv.leftClick(1));
  expect(inv.cursor?.count).toBe(6);
  inv.leftClick(3);
  inv.leftClick(4);
  expect(inv.cursor).toBeNull();
});
for (const count of [1, 2, 3, 31, 32, 63, 64])
  it(`right splits ${count} rounding up to cursor, and places one`, () => {
    const inv = new Inventory();
    stack(inv, 0, 'dirt', count);
    checked(inv, () => inv.rightClick(0));
    expect(inv.cursor?.count).toBe(Math.ceil(count / 2));
    expect(inv.slots[0]?.count ?? 0).toBe(Math.floor(count / 2));
    checked(inv, () => inv.rightClick(1));
    expect(inv.slots[1]?.count).toBe(1);
    expect(inv.cursor?.count ?? 0).toBe(Math.ceil(count / 2) - 1);
  });
it('right place rejects mismatches, full stacks and incompatible equipment', () => {
  const inv = new Inventory();
  inv.cursor = { id: 'dirt', count: 5 };
  stack(inv, 0, 'stone', 1);
  stack(inv, 1, 'dirt', 64);
  stack(inv, 2, 'dirt', 63);
  for (const slot of [0, 1, 36, 37, 38, 39]) checked(inv, () => inv.rightClick(slot));
  expect(inv.cursor.count).toBe(5);
  checked(inv, () => inv.rightClick(2));
  expect(inv.cursor.count).toBe(4);
  expect(inv.slots[2]?.count).toBe(64);
});
it('shift routes hotbar to main, main to hotbar, merging before empty slots', () => {
  const inv = new Inventory();
  stack(inv, 0, 'dirt', 12);
  stack(inv, 12, 'dirt', 60);
  checked(inv, () => inv.shiftClick(0));
  expect(inv.slots[12]?.count).toBe(64);
  expect(inv.slots[9]?.count).toBe(8);
  expect(inv.slots[0]).toBeNull();
  checked(inv, () => inv.shiftClick(9));
  expect(inv.slots[0]?.count).toBe(8);
});
it('shift overflow stays at source; a full destination is a no-op', () => {
  const inv = new Inventory();
  for (let i = 9; i < 36; i++) stack(inv, i, 'dirt', 64);
  stack(inv, 0, 'dirt', 10);
  inv.slots[15]!.count = 62;
  checked(inv, () => inv.shiftClick(0));
  expect(inv.slots[0]?.count).toBe(8);
  expect(inv.slots[15]?.count).toBe(64);
  const before = inv.snapshot(true);
  checked(inv, () => inv.shiftClick(0));
  expect(inv.snapshot(true)).toEqual(before);
});
for (const [piece, slot] of [
  ['helmet', 36],
  ['chestplate', 37],
  ['leggings', 38],
  ['boots', 39],
] as const)
  for (const tier of ['copper', 'iron'])
    it(`${tier} ${piece} shift equips only its matching slot; equipment exits main then hotbar`, () => {
      const inv = new Inventory();
      const id = `${tier}_${piece}`;
      stack(inv, 0, id, 1);
      checked(inv, () => inv.shiftClick(0));
      expect(inv.slots[slot]?.id).toBe(id);
      checked(inv, () => inv.shiftClick(slot));
      expect(inv.slots[9]?.id).toBe(id);
      checked(inv, () => inv.shiftClick(9));
      for (let i = 9; i < 36; i++) stack(inv, i, 'dirt', 64);
      checked(inv, () => inv.shiftClick(slot));
      expect(inv.slots[0]?.id).toBe(id);
      inv.leftClick(0);
      for (let other = 36; other < 40; other++)
        if (other !== slot) {
          checked(inv, () => inv.leftClick(other));
          checked(inv, () => inv.rightClick(other));
          checked(inv, () => inv.drag([other], 'left'));
          expect(inv.slots[other]).toBeNull();
        }
      checked(inv, () => inv.leftClick(slot));
      expect(inv.slots[slot]?.id).toBe(id);
    });
it('occupied armor slot does not swap on shift; storage receives the item', () => {
  const inv = new Inventory();
  stack(inv, 36, 'iron_helmet', 1);
  stack(inv, 0, 'copper_helmet', 1);
  checked(inv, () => inv.shiftClick(0));
  expect(inv.slots[36]?.id).toBe('iron_helmet');
  expect(inv.slots[9]?.id).toBe('copper_helmet');
});
it('offhand accepts ordinary stacks and shields, shifts to main then hotbar without loss', () => {
  const inv = new Inventory();
  inv.cursor = { id: 'dirt', count: 64 };
  inv.leftClick(40);
  checked(inv, () => inv.shiftClick(40));
  expect(inv.slots[9]?.count).toBe(64);
  for (let i = 9; i < 36; i++) stack(inv, i, 'dirt', 64);
  inv.cursor = { id: 'shield', count: 1 };
  inv.rightClick(40);
  checked(inv, () => inv.shiftClick(40));
  expect(inv.slots[0]?.id).toBe('shield');
});
for (let slots = 1; slots <= 9; slots++)
  for (const button of ['left', 'right'] as const)
    it(`${button} drag math over ${slots} slots for every cursor count 1–64`, () => {
      for (let count = 1; count <= 64; count++) {
        const inv = new Inventory();
        inv.cursor = { id: 'dirt', count };
        const targets = Array.from({ length: slots }, (_, i) => i);
        checked(inv, () => inv.drag(targets, button));
        const each = button === 'left' ? Math.floor(count / slots) : 1;
        for (let i = 0; i < slots; i++)
          expect(inv.slots[i]?.count ?? 0).toBe(button === 'right' && i >= count ? 0 : each);
        expect(inv.cursor?.count ?? 0).toBe(
          button === 'left' ? count % slots : Math.max(0, count - slots),
        );
      }
    });
it('drag deduplicates targets, excludes mismatches/full/equipment and retains capacity remainder', () => {
  const inv = new Inventory();
  inv.cursor = { id: 'dirt', count: 11 };
  stack(inv, 0, 'dirt', 63);
  stack(inv, 2, 'stone', 1);
  stack(inv, 3, 'dirt', 64);
  checked(inv, () => inv.drag([0, 0, 1, 2, 3, 36], 'left'));
  expect(inv.slots[0]?.count).toBe(64);
  expect(inv.slots[1]?.count).toBe(5);
  expect(inv.cursor?.count).toBe(5);
  checked(inv, () => inv.drag([], 'right'));
});
it('max-one tools never merge above one, including drag and collect', () => {
  const inv = new Inventory();
  stack(inv, 0, 'iron_pickaxe', 1);
  inv.cursor = { id: 'iron_pickaxe', count: 1 };
  for (const op of [
    () => inv.leftClick(0),
    () => inv.rightClick(0),
    () => inv.drag([0, 1], 'left'),
    () => inv.doubleClick(),
  ])
    checked(inv, op);
  expect(inv.slots[0]?.count).toBe(1);
  expect(inv.slots[1]?.count).toBe(1);
});
it('double collect uses partial stacks first, including offhand, and takes a partial full stack up to max', () => {
  const inv = new Inventory();
  inv.cursor = { id: 'dirt', count: 1 };
  stack(inv, 0, 'dirt', 64);
  stack(inv, 3, 'dirt', 10);
  stack(inv, 40, 'dirt', 20);
  stack(inv, 2, 'stone', 4);
  checked(inv, () => inv.doubleClick());
  expect(inv.cursor.count).toBe(64);
  expect(inv.slots[0]?.count).toBe(31);
  expect(inv.slots[3]).toBeNull();
  expect(inv.slots[40]).toBeNull();
  expect(inv.slots[2]?.count).toBe(4);
  checked(inv, () => inv.doubleClick());
  inv.leftClick(5);
  checked(inv, () => inv.doubleClick());
  expect(inv.cursor).toBeNull();
});
it('invalid slots are rejected atomically, including a later invalid drag target', () => {
  const inv = new Inventory();
  inv.cursor = { id: 'dirt', count: 10 };
  for (const slot of [-1, 41, 1.5, NaN, Infinity]) {
    for (const op of [
      () => inv.leftClick(slot),
      () => inv.rightClick(slot),
      () => inv.shiftClick(slot),
      () => inv.drag([0, slot], 'left'),
      () => inv.drop(slot),
    ])
      expect(op).toThrow();
    expect(inv.cursor.count).toBe(10);
    expect(inv.slots.every((s) => !s)).toBe(true);
  }
});
it('invariant detects loss, duplication, bad counts, slot identity and incompatible armor', () => {
  const inv = new Inventory();
  stack(inv, 0, 'dirt', 3);
  const before = inv.counts();
  inv.slots[0]!.count++;
  expect(() => inv.assertInvariant(before)).toThrow();
  inv.slots[0]!.count = 0;
  expect(() => inv.assertInvariant()).toThrow();
  inv.slots[0]!.count = 65;
  expect(() => inv.assertInvariant()).toThrow();
  stack(inv, 36, 'dirt', 1);
  expect(() => inv.assertInvariant()).toThrow();
});
it('drop one/all from slots, equipment and cursor spawns through M07b; full pool leaves source untouched', () => {
  const inv = new Inventory();
  const manager = new ItemEntityManager(new World(false));
  stack(inv, 0, 'dirt', 12);
  expect(dropInventoryStack(inv, manager, [0, 65, 0], 0)).toEqual({ id: 'dirt', count: 1 });
  expect(inv.slots[0]?.count).toBe(11);
  expect(dropInventoryStack(inv, manager, [0, 65, 0], 0, true)?.count).toBe(11);
  inv.cursor = { id: 'stone', count: 5 };
  expect(dropInventoryStack(inv, manager, [0, 65, 0], 'cursor')?.count).toBe(1);
  expect(dropInventoryStack(inv, manager, [0, 65, 0], 'cursor', true)?.count).toBe(4);
  stack(inv, 36, 'iron_helmet', 1);
  expect(dropInventoryStack(inv, manager, [0, 65, 0], 36)?.id).toBe('iron_helmet');
  expect(dropInventoryStack(inv, manager, [0, 65, 0], 36)).toBeNull();
  expect(manager.pool.filter((e) => e.active).map((e) => [e.item.id, e.count])).toEqual([
    ['dirt', 1],
    ['dirt', 11],
    ['stone', 1],
    ['stone', 4],
    ['iron_helmet', 1],
  ]);
  for (let i = 5; i < ITEM_CAPACITY; i++) manager.spawn('dirt', 1, 0, 65, 0);
  inv.cursor = { id: 'dirt', count: 64 };
  const before = inv.counts();
  expect(dropInventoryStack(inv, manager, [0, 65, 0], 'cursor', true)).toBeNull();
  inv.assertInvariant(before);
});
describe('seeded sequences preserve independent count totals', () => {
  for (const seed of [1, 42, 123456, 987654321])
    it(`seed ${seed}: 3000 mixed operations`, () => {
      const inv = new Inventory();
      const rng = new PRNG(seed);
      const random = (n: number) => Math.floor(rng.next() * n);
      const initial = [
        ['dirt', 191],
        ['stone', 130],
        ['iron_helmet', 2],
        ['copper_boots', 2],
        ['shield', 1],
      ] as const;
      for (const [id, count] of initial) inv.insert(id, count);
      const baseline = new Map<string, number>(initial);
      const dropped = new Map<string, number>();
      for (let i = 0; i < 3000; i++) {
        const slot = random(41);
        switch (random(i < 2000 ? 6 : 7)) {
          case 0:
            inv.leftClick(slot);
            break;
          case 1:
            inv.rightClick(slot);
            break;
          case 2:
            inv.shiftClick(slot);
            break;
          case 3:
            inv.drag(
              Array.from({ length: random(10) }, () => random(41)),
              'left',
            );
            break;
          case 4:
            inv.drag(
              Array.from({ length: random(10) }, () => random(41)),
              'right',
            );
            break;
          case 5:
            inv.doubleClick();
            break;
          case 6: {
            const stack = inv.drop(random(2) ? slot : 'cursor', !!random(2));
            if (stack) dropped.set(stack.id, (dropped.get(stack.id) ?? 0) + stack.count);
          }
        }
        inv.assertInvariant();
        const actual = [...inv.snapshot(true), inv.cursorSnapshot()];
        for (const [id, count] of baseline) {
          const remaining = actual.reduce(
            (sum, stack) => sum + (stack?.id === id ? stack.count : 0),
            0,
          );
          expect(remaining + (dropped.get(id) ?? 0)).toBe(count);
        }
        expect(actual.every((stack) => !stack || baseline.has(stack.id))).toBe(true);
      }
    });
});

it('equipment extraction fills empty main storage before merging into hotbar', () => {
  const inv = new Inventory();
  stack(inv, 0, 'dirt', 60);
  stack(inv, 40, 'dirt', 10);
  checked(inv, () => inv.shiftClick(40));
  expect(inv.slots[9]?.count).toBe(10);
  expect(inv.slots[0]?.count).toBe(60);
  expect(inv.slots[40]).toBeNull();
});

it('left equipment swap is allowed only for the matching armor type', () => {
  const inv = new Inventory();
  stack(inv, 36, 'copper_helmet', 1);
  inv.cursor = { id: 'iron_helmet', count: 1 };
  checked(inv, () => inv.leftClick(36));
  expect(inv.slots[36]?.id).toBe('iron_helmet');
  expect(inv.cursor?.id).toBe('copper_helmet');
});
it('equipment remains at source when both storage regions are full', () => {
  const inv = new Inventory();
  inv.insert('dirt', 36 * 64);
  stack(inv, 36, 'iron_helmet', 1);
  stack(inv, 40, 'shield', 1);
  const before = inv.snapshot(true);
  checked(inv, () => inv.shiftClick(36));
  checked(inv, () => inv.shiftClick(40));
  expect(inv.snapshot(true)).toEqual(before);
  expect(inv.insert('dirt', 1)).toBe(false);
});

it('the operation engine also respects a declared 16-stack maximum', () => {
  // No current SPEC item uses 16; exercise that supported registry limit locally.
  const item = items.get('dirt');
  const previous = item.maxStack;
  item.maxStack = 16;
  try {
    const inv = new Inventory();
    inv.insert('dirt', 31);
    expect(inv.slots[0]?.count).toBe(16);
    expect(inv.slots[1]?.count).toBe(15);
    inv.leftClick(0);
    checked(inv, () => inv.leftClick(1));
    expect(inv.cursor?.count).toBe(15);
    expect(inv.slots[1]?.count).toBe(16);
    checked(inv, () => inv.drag([2, 3], 'left'));
    expect(inv.slots[2]?.count).toBe(7);
    expect(inv.slots[3]?.count).toBe(7);
    checked(inv, () => inv.doubleClick());
    expect(inv.cursor?.count).toBe(16);
    expect(inv.slots[1]?.count).toBe(15);
  } finally {
    item.maxStack = previous;
  }
});

it('placing a cursor copied from a slot record binds the destination slot correctly', () => {
  const inv = new Inventory();
  const fromStorage = { slot: 0, id: 'dirt', count: 5 };
  inv.cursor = fromStorage;
  expect(inv.cursorSnapshot()).toEqual({ id: 'dirt', count: 5 });
  checked(inv, () => inv.leftClick(9));
  expect(inv.slots[9]).toEqual({ slot: 9, id: 'dirt', count: 5 });
  expect(fromStorage.slot).toBe(0);
  expect(inv.cursor).toBeNull();
});
