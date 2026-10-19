import { test, expect } from '../harness/fixture';

test.beforeEach(async ({ page }) => {
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    await api.createWorld!({
      name: 'M11b',
      seed: 'blockcraft-m11b-test',
      mode: 'survival',
      type: 'flat',
    });
    api.pause!();
    // Adopt the camera's initial spawn view before positioning for interaction tests.
    api.input!('forward', true);
    api.input!('forward', false);
    api.teleport!(0.5, 65, 0.5, 0, 0);
    await api.tick!(1);
  });
});

async function clickRespawn(page: import('@playwright/test').Page) {
  const button = await page.evaluate(() => window.__blockcraft!.getScreen!().respawnButton);
  expect(button).not.toBeNull();
  await page.mouse.click(button!.x + button!.w / 2, button!.y + button!.h / 2);
}

test('kill opens a cause screen, drops inventory at death, and respawns at world spawn without a bed', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  const initial = await page.evaluate(() => {
    const api = window.__blockcraft!;
    api.giveItem!('stone', 6);
    api.setXp!(12, 0.75);
    api.giveItem!('iron_helmet', 1);
    api.giveItem!('iron_chestplate', 1);
    api.giveItem!('iron_leggings', 1);
    api.giveItem!('iron_boots', 1);
    api.giveItem!('shield', 1);
    api.openScreen!('inventory');
    const inventory = api.getInventory!();
    const equip: Array<[string, number]> = [
      ['iron_helmet', 36],
      ['iron_chestplate', 37],
      ['iron_leggings', 38],
      ['iron_boots', 39],
      ['shield', 40],
    ];
    for (const [id, target] of equip) {
      const source = inventory.find((stack) => stack?.id === id)!.slot;
      api.uiClickSlot!(source, 'left');
      api.uiClickSlot!(target, 'left');
    }
    api.openScreen!('none');
    return api.getPlayer!().pos;
  });

  await page.evaluate(() => window.__blockcraft!.kill!(0));
  const screen = await page.evaluate(() => window.__blockcraft!.getScreen!());
  expect(screen.name).toBe('death');
  expect(screen.cause).toBe('Killed');
  expect(await page.evaluate(() => window.__blockcraft!.getPlayer!().xpLevel)).toBe(0);
  expect(await page.evaluate(() => window.__blockcraft!.getPlayer!().xpProgress)).toBe(0);
  const dropped = await page.evaluate(() =>
    window.__blockcraft!.getEntities!({ type: 'item', radius: 4 }),
  );
  expect(dropped.some((entity) => entity.item === 'stone' && entity.count === 6)).toBe(true);
  for (const item of ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'shield'])
    expect(dropped.some((entity) => entity.item === item && entity.count === 1)).toBe(true);
  const afterRepeatedKill = await page.evaluate(() => {
    const api = window.__blockcraft!;
    api.kill!(0);
    return api.getEntities!({ type: 'item', radius: 4 }).map(({ id, item, count }) => ({
      id,
      item,
      count,
    }));
  });
  expect(afterRepeatedKill).toEqual(dropped.map(({ id, item, count }) => ({ id, item, count })));
  expect(
    dropped
      .filter((entity) => entity.item === 'stone')
      .every((entity) => Math.hypot(...entity.pos.map((part, i) => part - initial[i]!)) < 2),
  ).toBe(true);
  expect(
    await page.evaluate(() => window.__blockcraft!.getInventory!().every((stack) => !stack)),
  ).toBe(true);
  await assertAndSaveScreenshot({ name: 'm11-death', milestone: 'M11' });

  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__blockcraft!.openScreen!('none'));
  expect(await page.evaluate(() => window.__blockcraft!.getScreen!().name)).toBe('death');
  await clickRespawn(page);
  const respawned = await page.evaluate(() => window.__blockcraft!.getPlayer!());
  expect(respawned.health).toBe(20);
  expect(respawned.pos).toEqual(initial);
});

test('sleeping at night advances to morning and respawn uses the bed spawn', async ({ page }) => {
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.setBlock!(1, 65, 0, 'bed', { facing: 'east', part: 'foot' });
    api.setBlock!(2, 65, 0, 'bed', { facing: 'east', part: 'head' });
    api.setTimeOfDay!(5 * 24000 + 13000);
    api.look!(0, -0.84);
    api.input!('use', true);
    await api.tick!(1);
    api.input!('use', false);
  });

  await expect
    .poll(() => page.evaluate(() => window.__blockcraft!.getTimeOfDay!()), { timeout: 2500 })
    .toBe(0);
  expect(await page.evaluate(() => window.__blockcraft!.getWorldTime!())).toBe(6 * 24000);
  const spawnPoint = await page.evaluate(() => window.__blockcraft!.getPlayer!().spawnPoint);
  expect(spawnPoint).toEqual([1.5, 65 + 9 / 16, 0.5]);

  await page.evaluate(() => {
    const api = window.__blockcraft!;
    api.setTimeOfDay!(13000);
    api.giveItem!('stone', 2);
    api.kill!(0);
  });
  expect(await page.evaluate(() => window.__blockcraft!.getScreen!().name)).toBe('death');
  await clickRespawn(page);
  const respawned = await page.evaluate(() => window.__blockcraft!.getPlayer!());
  expect(respawned.pos[0]).toBeCloseTo(1.5);
  expect(respawned.pos[1]).toBeCloseTo(65 + 9 / 16);
  expect(respawned.pos[2]).toBeCloseTo(0.5);
});

test('damage shows the red vignette and the low-health HUD response', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.fill!(-1, 64, -1, 1, 68, 1, 'glass');
    api.fill!(0, 65, 0, 0, 67, 0, 'water');
    await api.waitForTerrain!(1);
    api.teleport!(0.5, 65, 0.5, 0, 0);
    api.setVitals!({ health: 6, air: 0 });
    await api.tick!(20);
  });
  const health = await page.evaluate(() => window.__blockcraft!.getPlayer!().health);
  expect(health).toBeGreaterThan(0);
  expect(health).toBeLessThanOrEqual(4);
  await expect(page.locator('#damage-vignette')).toBeVisible();
  const vignetteOpacity = await page
    .locator('#damage-vignette')
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).opacity));
  expect(vignetteOpacity).toBeGreaterThan(0.1);
  await assertAndSaveScreenshot({ name: 'm11-hurt', milestone: 'M11' });
});
