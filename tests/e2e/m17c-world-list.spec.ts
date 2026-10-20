import { test, expect } from '../harness/fixture';
import { assertNoMissingTexture, assertNotBlank } from '../harness/pixels';

const WORLD_LIST = 'M17c world list';
const WORLD_OTHER = 'M17c Other';
const WORLD_UI = 'M17c New World';
const WORLD_RENAMED = 'M17c Renamed';
const WORLD_CREATED = 'M17c Created';

async function createSavedWorld(
  page: import('@playwright/test').Page,
  name: string,
): Promise<void> {
  await page.evaluate(async (worldName) => {
    const api = window.__blockcraft!;
    await api.createWorld!({
      name: worldName,
      seed: `seed-${worldName}`,
      mode: 'survival',
      type: 'flat',
    });
    api.pause!();
    api.setRenderDistance!(4);
    api.setClouds!('off');
    api.setTimeOfDay!(6000);
    api.teleport!(7.25, 65, 4.5, 2.3, -0.2);
    api.setBlock!(5, 65, 6, 'chest', { facing: 'north', pair: 'single' });
    api.setBlock!(6, 65, 6, 'stone');
    api.setBlock!(7, 65, 6, 'oak_planks');
    api.setBlock!(8, 65, 6, 'torch');
    await api.waitForTerrain!(2);
    await api.save!();
  }, name);
}

type StoreCounts = Record<'worlds' | 'regions' | 'players' | 'entities' | 'blockEntities', number>;

/** Counts each world's records directly from IndexedDB, using each store's actual key shape. */
function worldRecordCounts(
  page: import('@playwright/test').Page,
  world: string,
): Promise<StoreCounts> {
  return page.evaluate(
    (name) =>
      new Promise<StoreCounts>((resolve, reject) => {
        const stores: StoreCounts = {
          worlds: 0,
          regions: 0,
          players: 0,
          entities: 0,
          blockEntities: 0,
        };
        const open = indexedDB.open('blockcraft-saves');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const names = Object.keys(stores) as Array<keyof StoreCounts>;
          let remaining = names.length;
          for (const storeName of names) {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const query = storeName === 'worlds' ? name : IDBKeyRange.bound([name], [name, []]);
            const request = store.count(query);
            request.onerror = () => {
              db.close();
              reject(request.error);
            };
            request.onsuccess = () => {
              stores[storeName] = request.result;
              remaining--;
              if (remaining === 0) {
                db.close();
                resolve(stores);
              }
            };
          }
        };
      }),
    world,
  );
}

function rowButtonPosition(
  row: number,
  action: 'select' | 'rename' | 'copy' | 'delete',
): { x: number; y: number } {
  // The 1280×720 review viewport fits the 320×240 UI at 3×. These are the real canvas buttons.
  const buttonOffsets = {
    select: { x: 72, width: 41 },
    rename: { x: 72 + 41 + 2, width: 43 },
    copy: { x: 72 + 41 + 2 + 43 + 2, width: 33 },
    delete: { x: 72 + 41 + 2 + 43 + 2 + 33 + 2, width: 42 },
  };
  const button = buttonOffsets[action];
  return {
    x: (63 + 8 + button.x + button.width / 2) * 3,
    y: (7 + 28 + row * 53 + 31 + 7.5) * 3,
  };
}

async function clickRowButton(
  page: import('@playwright/test').Page,
  row: number,
  action: 'select' | 'rename' | 'copy' | 'delete',
): Promise<void> {
  await page.locator('#world-list-canvas').click({ position: rowButtonPosition(row, action) });
}

async function enterWorldName(page: import('@playwright/test').Page, value: string): Promise<void> {
  await page.keyboard.press('Control+A');
  await page.keyboard.type(value);
}

async function clickModalConfirm(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('#world-list-canvas').click({ position: { x: 875, y: 479 } });
}

test('M17c: world list renders thumbnails and supports select, rename, duplicate and delete', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await createSavedWorld(page, WORLD_OTHER);
  await createSavedWorld(page, WORLD_LIST);

  const initial = await page.evaluate(() => window.__blockcraft!.listWorlds!());
  expect(initial.map((world) => world.name)).toEqual([WORLD_LIST, WORLD_OTHER]);
  expect(initial.every((world) => world.hasThumbnail)).toBe(true);
  expect(
    initial.every(
      (world) => Object.keys(world).sort().join(',') === 'hasThumbnail,lastPlayed,name',
    ),
  ).toBe(true);

  await page.evaluate(() => window.__blockcraft!.openWorldList!());
  const canvas = page.locator('#world-list-canvas');
  await expect(canvas).toBeVisible();

  // Duplicate from the real list UI so the third saved world carries an actual captured thumbnail.
  const initialOtherRow = initial.findIndex((world) => world.name === WORLD_OTHER);
  await clickRowButton(page, initialOtherRow, 'copy');
  await expect(canvas).toHaveAttribute('aria-label', /duplicate world name/i);
  await enterWorldName(page, WORLD_UI);
  await clickModalConfirm(page);
  await expect
    .poll(async () => (await page.evaluate(() => window.__blockcraft!.listWorlds!())).length)
    .toBe(3);

  const reviewWorlds = await page.evaluate(() => window.__blockcraft!.listWorlds!());
  expect(reviewWorlds.map((world) => world.name)).toContain(WORLD_UI);
  expect(reviewWorlds.every((world) => world.hasThumbnail)).toBe(true);
  expect(
    reviewWorlds.every((world) => Number.isFinite(world.lastPlayed) && world.lastPlayed > 0),
  ).toBe(true);

  await page.evaluate(() => window.__blockcraft!.openWorldList!());
  const label = await canvas.getAttribute('aria-label');
  expect(label).toContain('Selected');
  expect(label).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  const listImage = await assertAndSaveScreenshot({ name: 'm17-world-list', milestone: 'M17c' });
  assertNotBlank(listImage);
  assertNoMissingTexture(listImage);

  const countsBefore = await worldRecordCounts(page, WORLD_LIST);
  const otherBefore = await worldRecordCounts(page, WORLD_OTHER);
  expect(Object.values(countsBefore).every((count) => count > 0)).toBe(true);
  expect(Object.values(otherBefore).every((count) => count > 0)).toBe(true);

  const currentRows = await page.evaluate(() => window.__blockcraft!.listWorlds!());
  const targetRow = currentRows.findIndex((world) => world.name === WORLD_LIST);
  expect(targetRow).toBeGreaterThanOrEqual(0);
  await clickRowButton(page, targetRow, 'delete');
  await expect(canvas).toHaveAttribute(
    'aria-label',
    new RegExp(`Confirm deleting world ${WORLD_LIST}`),
  );
  await clickModalConfirm(page);
  await expect
    .poll(async () =>
      (await page.evaluate(() => window.__blockcraft!.listWorlds!())).some(
        (world) => world.name === WORLD_LIST,
      ),
    )
    .toBe(false);
  expect(await worldRecordCounts(page, WORLD_LIST)).toEqual({
    worlds: 0,
    regions: 0,
    players: 0,
    entities: 0,
    blockEntities: 0,
  });
  expect(await worldRecordCounts(page, WORLD_OTHER)).toEqual(otherBefore);

  // A clash is rejected with a screen-visible message before any world is created.
  await canvas.click({ position: { x: 330, y: 636 } });
  await page.keyboard.type(WORLD_OTHER);
  await clickModalConfirm(page);
  await expect(canvas).toHaveAttribute('aria-label', /already exists/i);
  await canvas.click({ position: { x: 690, y: 479 } });

  const copyCounts = await worldRecordCounts(page, WORLD_UI);
  expect(copyCounts).toEqual(otherBefore);

  const rowsBeforeRename = await page.evaluate(() => window.__blockcraft!.listWorlds!());
  const uiRow = rowsBeforeRename.findIndex((world) => world.name === WORLD_UI);
  await clickRowButton(page, uiRow, 'rename');
  await enterWorldName(page, WORLD_RENAMED);
  await clickModalConfirm(page);
  await expect
    .poll(async () =>
      (await page.evaluate(() => window.__blockcraft!.listWorlds!())).some(
        (world) => world.name === WORLD_RENAMED,
      ),
    )
    .toBe(true);
  expect(await worldRecordCounts(page, WORLD_UI)).toEqual({
    worlds: 0,
    regions: 0,
    players: 0,
    entities: 0,
    blockEntities: 0,
  });

  const rowsBeforeSelect = await page.evaluate(() => window.__blockcraft!.listWorlds!());
  const renamedRow = rowsBeforeSelect.findIndex((world) => world.name === WORLD_RENAMED);
  await clickRowButton(page, renamedRow, 'select');
  await expect(canvas).toBeHidden({ timeout: 120_000 });
  const selectedBlock = await page.evaluate(() => window.__blockcraft!.getBlock!(5, 65, 6).id);
  expect(selectedBlock).toBe('chest');

  await page.evaluate(() => window.__blockcraft!.openWorldList!());
  await canvas.click({ position: { x: 330, y: 636 } });
  await expect(canvas).toHaveAttribute('aria-label', /create world name/i);
  await page.keyboard.type(WORLD_CREATED);
  await clickModalConfirm(page);
  await expect(canvas).toBeHidden({ timeout: 120_000 });
  await expect
    .poll(async () =>
      (await page.evaluate(() => window.__blockcraft!.listWorlds!())).some(
        (world) => world.name === WORLD_CREATED,
      ),
    )
    .toBe(true);
});
