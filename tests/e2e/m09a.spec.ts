import { test, expect } from '../harness/fixture';

test('M09a debug inventory appends equipment, preserves storage entries and exposes a detached cursor field', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const a = window.__blockcraft!;
    await a.createWorld!({
      name: 'M09a',
      seed: 'blockcraft-test-seed-42',
      mode: 'survival',
      type: 'flat',
    });
    a.pause!();
    a.giveItem!('dirt', 64);
    a.giveItem!('iron_helmet', 1);
    a.giveItem!('bread', 5);
    const snapshot = a.getInventory!();
    snapshot[0]!.count = 1;
    return { inventory: a.getInventory!(), cursor: a.getInventoryCursor!() };
  });
  expect(result.inventory).toHaveLength(41);
  expect(result.inventory.slice(0, 3)).toEqual([
    { slot: 0, id: 'dirt', count: 64 },
    { slot: 1, id: 'iron_helmet', count: 1 },
    { slot: 2, id: 'bread', count: 5 },
  ]);
  expect(result.inventory.slice(3).every((stack) => stack === null)).toBe(true);
  expect(result.cursor).toBeNull();
});
