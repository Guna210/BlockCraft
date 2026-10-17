import fs from 'fs';
import path from 'path';
import { expect, test } from '../harness/fixture';
import { assertNoMissingTexture, assertNotBlank } from '../harness/pixels';
import type { Page } from '@playwright/test';

const MILESTONE = 'M10b';

async function newWorld(page: Page, name: string): Promise<void> {
  await page.evaluate(async (worldName) => {
    const api = window.__blockcraft!;
    await api.createWorld!({
      name: worldName,
      seed: 'blockcraft-test-seed-42',
      mode: 'survival',
      type: 'flat',
    });
    api.pause!();
    api.setRenderDistance!(4);
    api.setClouds!('off');
    api.setTimeOfDay!(6000);
    api.teleport!(0.5, 65, 0.5, 0, 0);
    await api.tick!(1);
    await api.waitForTerrain!(1);
  }, name);
}

async function clickRect(page: Page, rect: { x: number; y: number; w: number; h: number }) {
  await page.mouse.click(rect.x + rect.w / 2, rect.y + rect.h / 2);
}

async function saveDocScreenshot(
  page: Page,
  assertAndSaveScreenshot: (options: {
    name: string;
    milestone: string;
  }) => Promise<import('pngjs').PNG>,
  name: string,
): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const image = await assertAndSaveScreenshot({ name, milestone: MILESTONE });
  assertNotBlank(image);
  assertNoMissingTexture(image);
  const docs = path.join(process.cwd(), 'docs/screenshots/M10b');
  fs.mkdirSync(docs, { recursive: true });
  fs.copyFileSync(
    path.join(process.cwd(), `artifacts/${MILESTONE}/${name}.png`),
    path.join(docs, `${name}.png`),
  );
}

test('M10b crafts logs into planks, sticks, a workbench, and a wooden pickaxe through UI clicks', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await newWorld(page, 'M10b crafting chain');

  const firstStage = await page.evaluate(() => {
    const api = window.__blockcraft!;
    api.giveItem!('oak_log', 3);
    api.openScreen!('inventory');
    api.uiClickSlot!(0, 'left');
    api.uiClickSlot!(41, 'left');
    api.uiClickSlot!(45, 'left', true);
    const planks = api.getInventory!()[0];
    api.uiClickSlot!(0, 'left');
    api.uiClickSlot!(41, 'right');
    api.uiClickSlot!(43, 'right');
    api.uiClickSlot!(0, 'left');
    api.uiClickSlot!(45, 'left');
    api.uiClickSlot!(1, 'left');
    api.uiClickSlot!(0, 'left');
    api.uiClickSlot!(41, 'right');
    api.uiClickSlot!(42, 'right');
    api.uiClickSlot!(43, 'right');
    api.uiClickSlot!(44, 'right');
    api.uiClickSlot!(0, 'left');
    api.uiClickSlot!(45, 'left');
    api.uiClickSlot!(2, 'left');
    api.openScreen!('none');
    return { planks, inventory: api.getInventory!() };
  });
  expect(firstStage.planks).toMatchObject({ id: 'oak_planks', count: 12 });
  expect(firstStage.inventory[0]).toMatchObject({ id: 'oak_planks', count: 6 });
  expect(firstStage.inventory[1]).toMatchObject({ id: 'stick', count: 4 });
  expect(firstStage.inventory[2]).toMatchObject({ id: 'workbench', count: 1 });

  const bookSearch = await page.evaluate(() => {
    const api = window.__blockcraft!;
    api.openScreen!('crafting');
    return api.getScreen!().recipeBookButton!;
  });
  await clickRect(page, bookSearch);
  const searchField = await page.evaluate(() => window.__blockcraft!.getScreen!().searchField!);
  await clickRect(page, searchField);
  await page.keyboard.type('iron pickaxe');
  let list = await page.evaluate(() => window.__blockcraft!.getScreen!());
  const unavailableRow = list.recipeIds.indexOf('iron_pickaxe');
  expect(unavailableRow).toBeGreaterThanOrEqual(0);
  const inventoryBeforeUnavailable = await page.evaluate(() =>
    window.__blockcraft!.getInventory!(),
  );
  await page.evaluate((row) => window.__blockcraft!.uiClickSlot!(51 + row, 'left'), unavailableRow);
  expect(await page.evaluate(() => window.__blockcraft!.getInventory!())).toEqual(
    inventoryBeforeUnavailable,
  );

  await page.keyboard.press('Control+A');
  await page.keyboard.type('wooden pickaxe');
  list = await page.evaluate(() => window.__blockcraft!.getScreen!());
  await clickRect(page, list.recipeFilterButton!);
  list = await page.evaluate(() => window.__blockcraft!.getScreen!());
  expect(list.craftableOnly).toBe(true);
  expect(list.recipeIds[0]).toBe('wooden_pickaxe');
  await page.evaluate(() => window.__blockcraft!.uiClickSlot!(51, 'left'));

  const filled = await page.evaluate(() => {
    const api = window.__blockcraft!;
    return { screen: api.getScreen!(), inventory: api.getInventory!() };
  });
  expect(filled.screen.name).toBe('crafting');
  expect(filled.screen.recipeIds[0]).toBe('wooden_pickaxe');
  expect(filled.inventory[0]).toBeNull();
  expect(filled.inventory[1]).toBeNull();
  expect(filled.inventory[2]).toMatchObject({ id: 'workbench', count: 1 });
  await clickRect(page, filled.screen.recipeBookButton!);
  const closedBook = await page.evaluate(() => window.__blockcraft!.getScreen!());
  await saveDocScreenshot(page, assertAndSaveScreenshot, 'm10-workbench');
  await clickRect(page, closedBook.recipeBookButton!);
  await saveDocScreenshot(page, assertAndSaveScreenshot, 'm10-recipe-book');

  const final = await page.evaluate(() => {
    const api = window.__blockcraft!;
    api.uiClickSlot!(9, 'left');
    api.uiClickSlot!(13, 'left');
    api.openScreen!('none');
    return api.getInventory!();
  });
  expect(final[0]).toMatchObject({ id: 'oak_planks', count: 3 });
  expect(final[1]).toMatchObject({ id: 'stick', count: 2 });
  expect(final[2]).toMatchObject({ id: 'workbench', count: 1 });
  expect(final[3]).toMatchObject({ id: 'wooden_pickaxe', count: 1 });
});

test('M10b right-click opens a workbench or paired chest screen', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await newWorld(page, 'M10b containers');
  await page.evaluate(() => {
    const api = window.__blockcraft!;
    api.setBlock!(2, 66, 0, 'workbench');
    api.input!('use', true);
  });
  await page.evaluate(async () => {
    await window.__blockcraft!.tick!(1);
    window.__blockcraft!.input!('use', false);
  });
  expect(await page.evaluate(() => window.__blockcraft!.getScreen!().name)).toBe('crafting');

  await page.evaluate(() => {
    const api = window.__blockcraft!;
    api.openScreen!('none');
    api.setBlock!(2, 66, 0, 'chest', { facing: 'north', pair: 'single' });
    api.setBlock!(3, 66, 0, 'chest', { facing: 'north', pair: 'single' });
    api.giveItem!('oak_planks', 16);
    api.input!('use', true);
  });
  await page.evaluate(async () => {
    await window.__blockcraft!.tick!(1);
    window.__blockcraft!.input!('use', false);
  });
  const chest = await page.evaluate(() => window.__blockcraft!.getScreen!());
  expect(chest.name).toBe('chest');
  expect(chest.doubleChest).toBe(true);
  await page.evaluate(() => window.__blockcraft!.uiClickSlot!(54, 'left', true));
  expect(await page.evaluate(() => window.__blockcraft!.getInventory!()[0])).toBeNull();
  await saveDocScreenshot(page, assertAndSaveScreenshot, 'm10-double-chest');
});
