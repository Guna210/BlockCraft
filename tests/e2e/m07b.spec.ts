import { test, expect } from '../harness/fixture';
import { assertNotBlank, assertNoMissingTexture, diffFraction } from '../harness/pixels';

test.beforeEach(async ({ page }) => {
  await page.evaluate(async () => {
    const a = window.__blockcraft!;
    await a.createWorld!({
      name: 'M07b',
      mode: 'survival',
      type: 'flat',
      seed: 'blockcraft-test-seed-42',
    });
    a.pause!();
    a.teleport!(0.5, 65, 0.5, 0, 0);
    await a.tick!(1);
  });
});

test('M07b stone: bare hands take 7.5 seconds without loot; selected wooden pick takes 1.15 seconds and drops cobblestone', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const a = window.__blockcraft!;
    a.setBlock!(3, 66, 0, 'stone');
    await a.waitForTerrain!(1);
    a.input!('attack', true);
    let bareTicks = 0;
    while (a.getBlock!(3, 66, 0).id === 'stone' && bareTicks < 160) {
      await a.tick!(1);
      bareTicks++;
    }
    a.input!('attack', false);
    const bareEntities = a.getEntities!({ type: 'item' }),
      bareInventory = a.getInventory!();
    a.giveItem!('dirt', 1);
    a.giveItem!('wooden_pickaxe', 1);
    a.selectHotbarSlot!(1);
    a.setBlock!(3, 66, 0, 'stone');
    await a.waitForTerrain!(1);
    a.input!('attack', true);
    let pickTicks = 0;
    while (a.getBlock!(3, 66, 0).id === 'stone' && pickTicks < 30) {
      await a.tick!(1);
      pickTicks++;
    }
    a.input!('attack', false);
    return {
      bareTicks,
      pickTicks,
      bareEntities,
      bareInventory,
      entities: a.getEntities!({ type: 'item' }),
      player: a.getPlayer!(),
      inventory: a.getInventory!(),
    };
  });
  console.log('M07b stone evidence', JSON.stringify(result));
  expect(result.bareTicks / 20).toBeGreaterThanOrEqual(7.3);
  expect(result.bareTicks / 20).toBeLessThanOrEqual(7.7);
  expect(result.bareEntities).toEqual([]);
  expect(result.bareInventory.every((s) => s === null)).toBe(true);
  expect(result.pickTicks / 20).toBeGreaterThanOrEqual(1.05);
  expect(result.pickTicks / 20).toBeLessThanOrEqual(1.25);
  expect(result.entities).toHaveLength(1);
  expect(result.entities[0]).toMatchObject({ type: 'item', item: 'cobblestone', count: 1 });
  expect(result.player.selectedSlot).toBe(1);
  expect(result.inventory[1]?.id).toBe('wooden_pickaxe');
});

test('M07b log: a dropped log is picked up within 20 simulated ticks while standing on it and increases inventory', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const a = window.__blockcraft!;
    a.setBlock!(3, 66, 0, 'oak_log');
    a.giveItem!('oak_log', 2);
    a.selectHotbarSlot!(8);
    await a.waitForTerrain!(1);
    a.input!('attack', true);
    await a.tick!(60);
    a.input!('attack', false);
    const dropped = a.getEntities!({ type: 'item' });
    a.teleport!(3.5, 65, 0.5, 0, 0);
    let pickupTicks = 0;
    while (a.getEntities!({ type: 'item' }).length && pickupTicks < 20) {
      await a.tick!(1);
      pickupTicks++;
    }
    return {
      dropped,
      pickupTicks,
      remaining: a.getEntities!({ type: 'item' }),
      inventory: a.getInventory!(),
    };
  });
  console.log('M07b log evidence', JSON.stringify(result));
  expect(result.dropped).toHaveLength(1);
  expect(result.dropped[0]).toMatchObject({ item: 'oak_log', count: 1 });
  expect(result.pickupTicks).toBeLessThanOrEqual(20);
  expect(result.remaining).toEqual([]);
  expect(
    result.inventory.filter((s) => s?.id === 'oak_log').reduce((sum, s) => sum + s!.count, 0),
  ).toBe(3);
});

test('M07b selected block placement consumes only successful survival placements; creative breaks emit particles without loot', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const a = window.__blockcraft!;
    a.giveItem!('oak_log', 2);
    a.selectHotbarSlot!(0);
    a.setBlock!(3, 66, 0, 'stone');
    a.input!('use', true);
    await a.tick!(1);
    a.input!('use', false);
    const placed = a.getBlock!(2, 66, 0),
      after = a.getInventory!()[0];
    a.setBlock!(1, 66, 0, 'stone');
    a.input!('use', true);
    await a.tick!(1);
    a.input!('use', false);
    const rejected = a.getInventory!()[0];
    a.setGameMode!('creative');
    a.input!('attack', true);
    await a.tick!(1);
    a.input!('attack', false);
    return {
      placed,
      after,
      rejected,
      entities: a.getEntities!(),
      particles: a.getDropStats!().particles,
    };
  });
  expect(result.placed).toEqual({ id: 'oak_log', state: { axis: 'x' } });
  expect(result.after?.count).toBe(1);
  expect(result.rejected?.count).toBe(1);
  expect(result.entities).toEqual([]);
  expect(result.particles).toBe(16);
});

test('M07b visual: floating item rotates, textured break particles are visible and draw batches stay bounded', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await page.evaluate(async () => {
    const a = window.__blockcraft!;
    a.setTimeOfDay!(6000);
    a.setBlock!(3, 66, 0, 'oak_log');
    await a.waitForTerrain!(1);
    a.input!('attack', true);
    await a.tick!(60);
    a.input!('attack', false);
    // Let the older item bob by itself, then break a second nearby log for fresh debris.
    await a.tick!(24);
    a.setBlock!(3, 66, 1, 'oak_log');
    a.look!(Math.atan2(1, 3), 0);
    await a.waitForTerrain!(1);
    a.input!('attack', true);
    await a.tick!(60);
    a.input!('attack', false);
    a.teleport!(1, 65, -1, Math.atan2(2, 2.5), -0.08);
    await a.tick!(2);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  });
  const state = await page.evaluate(() => ({
    entities: window.__blockcraft!.getEntities!(),
    stats: window.__blockcraft!.getDropStats!(),
  }));
  expect(state.entities.length).toBeGreaterThan(0);
  expect(state.stats.particles).toBe(16);
  expect(state.stats.itemDraws).toBe(1);
  expect(state.stats.particleDraws).toBe(1);
  const shot = await assertAndSaveScreenshot({ name: 'm07-drops', milestone: 'M07b' });
  assertNotBlank(shot);
  assertNoMissingTexture(shot);
  await page.evaluate(async () => {
    await window.__blockcraft!.tick!(8);
  });
  const rotated = await assertAndSaveScreenshot({ name: 'm07-drops-rotated', milestone: 'M07b' });
  expect(diffFraction(shot, rotated)).toBeGreaterThan(0.0001);
  console.log('M07b visual evidence', JSON.stringify(state));
});
