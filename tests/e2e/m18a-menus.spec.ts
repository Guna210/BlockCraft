import { test, expect } from '../harness/fixture';
import type { Page } from '@playwright/test';
import { assertColorVariance, assertNoMissingTexture, assertNotBlank } from '../harness/pixels';

// The 1280×720 review viewport fits the UI at 3×: the visible UI is 426×240 pixels and the
// world-list panel's top-left corner is UI (63, 7). These are the real on-screen controls.
const UI_SCALE = 3;
const PANEL = { x: 63, y: 7 };
const ui = (x: number, y: number) => ({ x: x * UI_SCALE, y: y * UI_SCALE });

const LIST_CREATE = { x: 330, y: 636 };
const CREATE_BUTTON = { x: 875, y: 479 };
const SEED_FIELD = ui(PANEL.x + 9 + 141, PANEL.y + 61 + 8);
const TYPE_TOGGLE = ui(PANEL.x + 153 + 69, PANEL.y + 84 + 8.5);
// The pause panel is 188×100, centred on the 426×240 UI: its buttons are 120×20 at x + 34.
const PAUSE_PANEL = { x: Math.floor((426 - 188) / 2), y: Math.floor((240 - 100) / 2) };
const SAVE_AND_QUIT = ui(PAUSE_PANEL.x + 34 + 60, PAUSE_PANEL.y + 62 + 10);

const worldList = (page: Page) => page.locator('#world-list-canvas');

interface CreateOptions {
  name?: string;
  seed?: string;
  typeClicks?: number;
}

/** Main menu → Singleplayer → Create → fill in the form → Create, by pointer and keyboard only. */
async function createWorldThroughUi(page: Page, options: CreateOptions): Promise<void> {
  await page.getByRole('button', { name: 'Singleplayer' }).click();
  const canvas = worldList(page);
  await expect(canvas).toBeVisible();
  await canvas.click({ position: LIST_CREATE });
  await expect(canvas).toHaveAttribute('aria-label', /^Create world name\. New World\./);
  // The default name is selected, so typing replaces it.
  if (options.name) await page.keyboard.type(options.name);
  if (options.seed !== undefined) {
    await canvas.click({ position: SEED_FIELD });
    await page.keyboard.type(options.seed);
  }
  for (let i = 0; i < (options.typeClicks ?? 0); i++) await canvas.click({ position: TYPE_TOGGLE });
  await canvas.click({ position: CREATE_BUTTON });
  await expect(canvas).toBeHidden({ timeout: 120_000 });
  await expect(page.locator('#main-menu')).toBeHidden();
}

/** Esc → Save & Quit, back to the main menu. */
async function saveAndQuit(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect
    .poll(() => page.evaluate(() => window.__blockcraft!.getScreen!().name))
    .toBe('pause');
  const button = await page.evaluate(() => window.__blockcraft!.getScreen!().saveQuitButton);
  // The click lands where the pause menu actually drew its button.
  expect(button).not.toBeNull();
  expect(SAVE_AND_QUIT.x).toBeGreaterThan(button!.x);
  expect(SAVE_AND_QUIT.x).toBeLessThan(button!.x + button!.w);
  expect(SAVE_AND_QUIT.y).toBeGreaterThan(button!.y);
  expect(SAVE_AND_QUIT.y).toBeLessThan(button!.y + button!.h);
  await page.mouse.click(SAVE_AND_QUIT.x, SAVE_AND_QUIT.y);
  await expect(page.getByRole('button', { name: 'Singleplayer' })).toBeVisible({ timeout: 60_000 });
}

test.describe('M18a menus', () => {
  test('full flow: main menu → Singleplayer → Create World → play → Esc → Save & Quit → world list', async ({
    page,
  }) => {
    const menu = page.locator('#main-menu');
    await expect(menu).toBeVisible();
    await expect(page.getByRole('button', { name: 'Singleplayer' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Credits' })).toBeVisible();
    await expect(page.getByRole('button', { name: /settings|multiplayer/i })).toHaveCount(0);

    // Credits and back.
    await page.getByRole('button', { name: 'Credits' }).click();
    await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('button', { name: 'Singleplayer' })).toBeVisible();

    await createWorldThroughUi(page, { seed: 'abc' });
    expect(await page.evaluate(() => window.__blockcraft!.getScreen!().name)).toBeNull();

    await saveAndQuit(page);
    await expect(menu).toBeVisible();
    // A world is not running behind the menu any more, and its save is listed.
    await expect
      .poll(async () =>
        (await page.evaluate(() => window.__blockcraft!.listWorlds!())).map((w) => w.name),
      )
      .toContain('New World');

    await page.getByRole('button', { name: 'Singleplayer' }).click();
    await expect(worldList(page)).toBeVisible();
    await expect(worldList(page)).toHaveAttribute('aria-label', /New World/);
  });

  test('two worlds created through the UI with seed "abc" have the same worldHash', async ({
    page,
  }) => {
    const hashes: string[] = [];
    for (const name of ['Seed A', 'Seed B']) {
      await createWorldThroughUi(page, { name, seed: 'abc' });
      await page.evaluate(() => window.__blockcraft!.waitForTerrain!(2));
      hashes.push(await page.evaluate(() => window.__blockcraft!.worldHash!(-32, -32, 31, 31)));
      await saveAndQuit(page);
    }
    expect(hashes[0]).toMatch(/^[0-9a-f]{8}$/);
    expect(hashes[1]).toBe(hashes[0]);
    const names = (await page.evaluate(() => window.__blockcraft!.listWorlds!())).map(
      (w) => w.name,
    );
    expect(names).toEqual(expect.arrayContaining(['Seed A', 'Seed B']));
  });

  test('a Flat world from the Create World screen has the flat layers', async ({ page }) => {
    await createWorldThroughUi(page, { name: 'Flat One', typeClicks: 1 });
    const layers = await page.evaluate(async () => {
      const api = window.__blockcraft!;
      await api.waitForTerrain!(1);
      const result: Record<string, string> = {};
      for (const [x, z] of [
        [0, 0],
        [7, -5],
        [-9, 12],
      ])
        for (const y of [1, 40, 60, 61, 63, 64, 65])
          result[`${x},${y},${z}`] = api.getBlock!(x!, y, z!).id;
      return { result, height: api.getHeight!(3, 3) };
    });
    for (const [key, id] of Object.entries(layers.result)) {
      const y = Number(key.split(',')[1]);
      const expected = y <= 60 ? 'stone' : y <= 63 ? 'dirt' : y === 64 ? 'grass_block' : 'air';
      expect(id, key).toBe(expected);
    }
    expect(layers.height).toBe(64);
  });

  test('an Amplified world from the Create World screen rises above y 250', async ({ page }) => {
    test.setTimeout(240_000);
    await createWorldThroughUi(page, {
      name: 'Tall One',
      seed: 'blockcraft-test-seed-42',
      typeClicks: 2,
    });
    const maxHeight = await page.evaluate(() => {
      const api = window.__blockcraft!;
      // Generate the whole sampled 256×256 area, then read its heights.
      api.worldHash!(-128, -128, 127, 127);
      let max = 0;
      for (let x = -128; x < 128; x += 2)
        for (let z = -128; z < 128; z += 2) max = Math.max(max, api.getHeight!(x, z));
      return max;
    });
    expect(maxHeight).toBeGreaterThan(250);
    expect(maxHeight).toBeLessThanOrEqual(319);
  });

  test('starting a world tears the panorama down completely; Save & Quit streams it again', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const menuState = () => page.evaluate(() => window.__blockcraft!.getMenuState!());

    // On the menu: the panorama streams in and puts meshes on the GPU.
    await expect
      .poll(async () => (await menuState()).sectionMeshes, { timeout: 120_000 })
      .toBeGreaterThan(20);
    const onMenu = await menuState();
    expect(onMenu.panorama).toBe(true);
    expect(onMenu.panoramaStarts).toBe(1);
    expect(onMenu.lastTeardown).toBeNull();

    await createWorldThroughUi(page, { name: 'Teardown', seed: 'abc' });
    await page.evaluate(() => window.__blockcraft!.waitForTerrain!(2));
    const playing = await menuState();
    expect(playing.menuVisible).toBe(false);
    expect(playing.panorama).toBe(false);

    // At teardown every queued and running panorama job was cancelled and every mesh freed.
    const teardown = playing.lastTeardown!;
    expect(teardown.meshesBefore).toBeGreaterThan(20);
    expect(teardown.genQueue).toBe(0);
    expect(teardown.lightQueue).toBe(0);
    expect(teardown.meshQueue).toBe(0);
    expect(teardown.sectionMeshes).toBe(0);
    // Every GL buffer the panorama created was deleted again.
    expect(teardown.glBuffers).toBeLessThanOrEqual(teardown.glBuffersAtStart);

    // The meshes on the GPU now are the new world's alone: none belongs to a column it lacks.
    expect(playing.meshedColumns).toBeGreaterThan(0);
    expect(playing.meshedColumnsOutsideWorld).toBe(0);

    // Back on the menu the panorama starts streaming again.
    await saveAndQuit(page);
    await expect.poll(async () => (await menuState()).panoramaStarts, { timeout: 30_000 }).toBe(2);
    await expect
      .poll(async () => (await menuState()).sectionMeshes, { timeout: 120_000 })
      .toBeGreaterThan(20);
    const again = await menuState();
    expect(again.panorama).toBe(true);
    expect(again.menuVisible).toBe(true);
  });

  test('main menu over the live panorama (m18-main-menu.png)', async ({
    page,
    assertAndSaveScreenshot,
    getRenderStats,
  }) => {
    test.setTimeout(180_000);
    await expect(page.locator('#main-menu')).toBeVisible();
    // The panorama starts a second after the menu, streams in and fades up.
    await expect
      .poll(async () => (await getRenderStats()).chunksMeshed, { timeout: 120_000 })
      .toBeGreaterThan(40);
    await page.waitForTimeout(2500);
    const image = await assertAndSaveScreenshot({ name: 'm18-main-menu', milestone: 'M18a' });
    assertNotBlank(image);
    assertNoMissingTexture(image);
    assertColorVariance(image, 20);
  });
});
