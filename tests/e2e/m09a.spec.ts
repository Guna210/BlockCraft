import { assertNotBlank, assertNoMissingTexture } from '../harness/pixels';
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

test('M09a clay drops four lumps and renders the additional item atlas through M07b', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  const result = await page.evaluate(async () => {
    const a = window.__blockcraft!;
    await a.createWorld!({
      name: 'M09a clay',
      seed: 'blockcraft-test-seed-42',
      mode: 'survival',
      type: 'flat',
    });
    a.pause!();
    a.teleport!(0.5, 65, 0.5, 0, 0);
    await a.tick!(1);
    a.setBlock!(3, 66, 0, 'clay');
    await a.waitForTerrain!(1);
    a.input!('attack', true);
    let ticks = 0;
    while (a.getBlock!(3, 66, 0).id !== 'air' && ticks < 30) {
      await a.tick!(1);
      ticks++;
    }
    a.input!('attack', false);
    await a.tick!(1);
    return {
      block: a.getBlock!(3, 66, 0),
      entities: a.getEntities!({ type: 'item' }),
    };
  });
  expect(result.block.id).toBe('air');
  expect(result.entities).toHaveLength(1);
  expect(result.entities[0]).toMatchObject({ item: 'clay_lump', count: 4 });
  const shot = await assertAndSaveScreenshot({ name: 'm09a-clay-drop', milestone: 'M09a' });
  assertNotBlank(shot);
  assertNoMissingTexture(shot);
  const stats = await page.evaluate(() => window.__blockcraft!.getDropStats!());
  expect(stats).toMatchObject({ items: 1, itemDraws: 1, particleDraws: 1, triangles: 34 });
});
