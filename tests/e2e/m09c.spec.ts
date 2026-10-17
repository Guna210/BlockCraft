import { expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { assertColorVariance, assertNoMissingTexture, assertNotBlank } from '../harness/pixels';
import { test } from '../harness/fixture';

async function newWorld(
  page: import('@playwright/test').Page,
  mode: 'survival' | 'creative' = 'survival',
) {
  await page.evaluate(async (worldMode) => {
    const api = window.__blockcraft!;
    await api.createWorld!({
      name: 'M09c HUD',
      seed: 'blockcraft-test-seed-42',
      mode: worldMode,
      type: 'flat',
    });
    api.pause!();
    api.setRenderDistance!(4);
    api.setTimeOfDay!(6000);
    api.teleport!(0.5, 65, 0.5, 0, -0.08);
    await api.tick!(1);
    await api.waitForTerrain!(1);
  }, mode);
}

function crop(png: PNG, x: number, y: number, width: number, height: number): PNG {
  const result = new PNG({ width, height });
  for (let row = 0; row < height; row++)
    png.data.copy(
      result.data,
      row * width * 4,
      ((y + row) * png.width + x) * 4,
      ((y + row) * png.width + x + width) * 4,
    );
  return result;
}

async function bubblePixels(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#hud-canvas');
    if (!canvas) return 0;
    const scale = Math.max(
      1,
      Math.min(Math.floor(canvas.width / 320), Math.floor(canvas.height / 240)),
    );
    const center = Math.floor(Math.floor(canvas.width / scale) / 2);
    const hotbarY = Math.floor(canvas.height / scale) - 22;
    const statusY = hotbarY - 6 - 11;
    const x0 = (center + 52) * scale;
    const y0 = (statusY - 10) * scale;
    const pixels = canvas.getContext('2d')!.getImageData(x0, y0, 78 * scale, 6 * scale).data;
    let visible = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! > 0) visible++;
    return visible;
  });
}

async function healthPixels(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#hud-canvas');
    if (!canvas) return 0;
    const scale = Math.max(
      1,
      Math.min(Math.floor(canvas.width / 320), Math.floor(canvas.height / 240)),
    );
    const center = Math.floor(Math.floor(canvas.width / scale) / 2);
    const statusY = Math.floor(canvas.height / scale) - 22 - 6 - 11;
    const pixels = canvas
      .getContext('2d')!
      .getImageData((center - 94) * scale, statusY * scale, 89 * scale, 7 * scale).data;
    let visible = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! > 0) visible++;
    return visible;
  });
}

async function crosshairShape(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#hud-canvas');
    if (!canvas) return { centerAlpha: 0, armPixels: 0 };
    const ctx = canvas.getContext('2d')!;
    const centerX = Math.floor(canvas.width / 2);
    const centerY = Math.floor(canvas.height / 2);
    const row = ctx.getImageData(centerX - 12, centerY, 25, 1).data;
    let armPixels = 0;
    for (let i = 3; i < row.length; i += 4) if (row[i]! > 0) armPixels++;
    const centerAlpha = ctx.getImageData(centerX, centerY, 1, 1).data[3]!;
    return { centerAlpha, armPixels };
  });
}

async function frameGraphPlotColumns(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#f3-overlay');
    if (!canvas) return 0;
    const scale = Math.max(
      1,
      Math.min(Math.floor(canvas.width / 320), Math.floor(canvas.height / 240)),
    );
    const pixels = canvas
      .getContext('2d')!
      .getImageData(10 * scale, 93 * scale, 262 * scale, 15 * scale);
    let litColumns = 0;
    const center = Math.floor(scale / 2);
    for (let x = 0; x < 262; x++) {
      for (let y = 0; y < 15; y++) {
        const index = ((y * scale + center) * pixels.width + x * scale + center) * 4;
        if (
          pixels.data[index] === 226 &&
          pixels.data[index + 1] === 180 &&
          pixels.data[index + 2] === 58
        ) {
          litColumns++;
          break;
        }
      }
    }
    return litColumns;
  });
}

test('survival HUD draws the requested health, hunger, armor and XP state', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await newWorld(page);
  await expect(page.locator('#hud-item-popup')).toBeHidden();
  const state = await page.evaluate(() => {
    const api = window.__blockcraft!;
    api.giveItem!('dirt', 64);
    api.giveItem!('copper_helmet', 1);
    api.giveItem!('iron_chestplate', 1);
    api.openScreen!('inventory');
    api.uiClickSlot!(1, 'left', true);
    api.uiClickSlot!(2, 'left', true);
    api.openScreen!('none');
    api.setVitals!({ health: 19, hunger: 13 });
    api.setXp!(7, 0.42);
    return { player: api.getPlayer!(), inventory: api.getInventory!() };
  });
  expect(state.player).toMatchObject({ health: 19, hunger: 13, xpLevel: 7, xpProgress: 0.42 });
  expect(state.inventory[36]?.id).toBe('copper_helmet');
  expect(state.inventory[37]?.id).toBe('iron_chestplate');
  await expect(page.locator('#hud-canvas')).toBeVisible();
  const shot = await assertAndSaveScreenshot({ name: 'm09-hud', milestone: 'M09c' });
  assertNotBlank(shot);
  assertNoMissingTexture(shot);
});

test('hotbar selection follows number keys and the mouse wheel, and respects capture', async ({
  page,
}) => {
  await newWorld(page);
  await page.keyboard.press('5');
  await expect
    .poll(() => page.evaluate(() => window.__blockcraft!.getPlayer!().selectedSlot))
    .toBe(4);
  const popup = page.locator('#hud-item-popup');
  await expect(popup).toHaveCSS('opacity', '1');
  await expect.poll(() => popup.evaluate((canvas) => getComputedStyle(canvas).opacity)).toBe('0');
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, 100);
  await expect
    .poll(() => page.evaluate(() => window.__blockcraft!.getPlayer!().selectedSlot))
    .toBe(5);
  await page.evaluate(() => window.__blockcraft!.openScreen!('inventory'));
  await page.keyboard.press('7');
  await page.mouse.wheel(0, 100);
  expect(await page.evaluate(() => window.__blockcraft!.getPlayer!().selectedSlot)).toBe(5);
});

test('creative mode keeps the HUD to its hotbar and crosshair', async ({ page }) => {
  await newWorld(page, 'creative');
  expect(await healthPixels(page)).toBe(0);
  const crosshair = await crosshairShape(page);
  expect(crosshair.armPixels).toBeGreaterThan(0);
  expect(crosshair.centerAlpha).toBe(0);
  await page.evaluate(() => window.__blockcraft!.setGameMode!('survival'));
  await expect.poll(() => healthPixels(page)).toBeGreaterThan(0);
});

test("air bubbles appear only while the player's head is underwater", async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await newWorld(page);
  expect(await bubblePixels(page)).toBe(0);
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.setVitals!({ air: 180 });
    api.setBlock!(0, 66, 0, 'water');
    await api.tick!(1);
    await api.waitForTerrain!(1);
  });
  await expect
    .poll(() => page.evaluate(() => window.__blockcraft!.getRenderStats().underwater))
    .toBe(true);
  expect(await bubblePixels(page)).toBeGreaterThan(0);
  const shot = await assertAndSaveScreenshot({ name: 'm09-underwater', milestone: 'M09c' });
  assertNotBlank(shot);
  assertNoMissingTexture(shot);

  await page.evaluate(() => window.__blockcraft!.teleport!(4.5, 65, 0.5, 0, -0.08));
  await expect
    .poll(() => page.evaluate(() => window.__blockcraft!.getRenderStats().underwater))
    .toBe(false);
  expect(await bubblePixels(page)).toBe(0);
});

test('F3 shows stats and a frame graph with the current getBiome value', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await newWorld(page);
  await expect
    .poll(() => page.evaluate(() => window.__blockcraft!.getRenderStats().fps))
    .toBeGreaterThan(0);
  await page.evaluate(() => {
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.code === 'F3')
          (window as unknown as { f3DefaultPrevented: boolean }).f3DefaultPrevented =
            event.defaultPrevented;
      },
      { once: true },
    );
  });
  await page.keyboard.press('F3');
  expect(
    await page.evaluate(
      () => (window as unknown as { f3DefaultPrevented: boolean }).f3DefaultPrevented,
    ),
  ).toBe(true);
  const overlay = page.locator('#f3-overlay');
  await expect(overlay).toBeVisible();
  await page.waitForTimeout(3000);
  await expect.poll(() => frameGraphPlotColumns(page), { timeout: 5000 }).toBeGreaterThan(30);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const api = window.__blockcraft!;
        const player = api.getPlayer!();
        return (
          document.querySelector<HTMLCanvasElement>('#f3-overlay')?.dataset.biome ===
          api.getBiome!(Math.floor(player.pos[0]), Math.floor(player.pos[2]))
        );
      }),
    )
    .toBe(true);
  const shot = await assertAndSaveScreenshot({ name: 'm09-f3', milestone: 'M09c' });
  assertNotBlank(shot);
  assertNoMissingTexture(shot);
  assertColorVariance(crop(shot, 0, 0, 850, 350), 10);
  await page.keyboard.press('F3');
  await expect(overlay).toBeHidden();
});
