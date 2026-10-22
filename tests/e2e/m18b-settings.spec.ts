import { PNG } from 'pngjs';
import { test, expect } from '../harness/fixture';
import { diffFraction } from '../harness/pixels';

const worldList = (page: import('@playwright/test').Page) => page.locator('#world-list-canvas');

async function createWorldThroughMenu(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Singleplayer' }).click();
  const canvas = worldList(page);
  await expect(canvas).toBeVisible();
  await canvas.click({ position: { x: 330, y: 636 } });
  await expect(canvas).toHaveAttribute('aria-label', /^Create world name\./);
  await page.keyboard.type('Settings Test');
  await canvas.click({ position: { x: 875, y: 479 } });
  await expect(canvas).toBeHidden({ timeout: 120_000 });
}

async function openPauseSettings(page: import('@playwright/test').Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect
    .poll(() => page.evaluate(() => window.__blockcraft!.getScreen!().name))
    .toBe('pause');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('#settings-screen')).toBeVisible();
}

test.describe('M18b settings', () => {
  test('render distance and FOV apply through settings controls', async ({
    page,
    assertAndSaveScreenshot,
  }) => {
    test.setTimeout(360_000);
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.locator('#settings-screen')).toBeVisible();
    expect(await page.evaluate(() => window.__blockcraft!.getSettings!())).toMatchObject({
      renderDistance: 8,
      fov: 70,
    });
    const review = await assertAndSaveScreenshot({
      name: 'm18-settings',
      milestone: 'M18b',
    });
    expect(review.width).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Done' }).click();

    await createWorldThroughMenu(page);
    await expect
      .poll(() => page.evaluate(() => window.__blockcraft!.getStreamingStats!().renderDistance))
      .toBe(8);
    await expect
      .poll(() => page.evaluate(() => window.__blockcraft!.getRenderStats().chunksLoaded))
      .toBeGreaterThan(0);
    // RD 4 retains a 13×13 data ring. Wait until the default RD 8 view has loaded beyond it.
    await expect
      .poll(() => page.evaluate(() => window.__blockcraft!.getRenderStats().chunksLoaded), {
        timeout: 60_000,
      })
      .toBeGreaterThan(169);
    const initialChunks = await page.evaluate(
      () => window.__blockcraft!.getRenderStats().chunksLoaded,
    );

    await openPauseSettings(page);
    for (let click = 0; click < 4; click++)
      await page.getByRole('button', { name: 'Render distance decrease' }).click();
    expect((await page.evaluate(() => window.__blockcraft!.getSettings!())).renderDistance).toBe(4);
    await page.waitForTimeout(3000);
    const reducedChunks = await page.evaluate(
      () => window.__blockcraft!.getRenderStats().chunksLoaded,
    );
    expect(reducedChunks).toBeLessThan(initialChunks);
    await page.getByRole('button', { name: 'Done' }).click();
    await page.keyboard.press('Escape');

    const before = PNG.sync.read(await page.locator('#game-canvas').screenshot());
    await openPauseSettings(page);
    const fov = page.getByRole('slider', { name: 'Field of view' });
    const box = await fov.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width * 0.9, box!.y + box!.height / 2);
    expect((await page.evaluate(() => window.__blockcraft!.getSettings!())).fov).toBeGreaterThan(
      70,
    );
    await page.getByRole('button', { name: 'Done' }).click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    const after = PNG.sync.read(await page.locator('#game-canvas').screenshot());
    expect(diffFraction(before, after)).toBeGreaterThan(0.1);
  });

  test('rebinding jump uses K instead of Space and shared keys show a conflict warning', async ({
    page,
  }) => {
    test.setTimeout(360_000);
    await createWorldThroughMenu(page);
    await openPauseSettings(page);
    await page.getByRole('button', { name: 'KEYS 1' }).click();
    await page.getByRole('button', { name: /Rebind Jump/ }).click();
    await page.keyboard.press('k');
    expect((await page.evaluate(() => window.__blockcraft!.getSettings!())).keyBindings.jump).toBe(
      'KeyK',
    );
    await page.getByRole('button', { name: 'Done' }).click();
    await page.keyboard.press('Escape');
    await page.keyboard.down('w');
    await page.waitForTimeout(150);
    await page.keyboard.up('w');

    await expect
      .poll(() => page.evaluate(() => window.__blockcraft!.getPlayer!().onGround), {
        timeout: 30_000,
      })
      .toBe(true);
    const groundedY = (await page.evaluate(() => window.__blockcraft!.getPlayer!())).pos[1];
    await page.keyboard.down('k');
    await expect
      .poll(() => page.evaluate(() => window.__blockcraft!.getPlayer!().pos[1]), {
        timeout: 10_000,
      })
      .toBeGreaterThan(groundedY + 0.4);
    await page.keyboard.up('k');
    await expect
      .poll(() => page.evaluate(() => window.__blockcraft!.getPlayer!().onGround), {
        timeout: 6000,
      })
      .toBe(true);

    const landedY = (await page.evaluate(() => window.__blockcraft!.getPlayer!())).pos[1];
    await page.keyboard.down('Space');
    await page.waitForTimeout(180);
    const afterSpace = await page.evaluate(() => window.__blockcraft!.getPlayer!());
    await page.keyboard.up('Space');
    expect(afterSpace.onGround).toBe(true);
    expect(afterSpace.pos[1]).toBeLessThanOrEqual(landedY + 0.05);

    await openPauseSettings(page);
    await page.getByRole('button', { name: 'KEYS 1' }).click();
    await page.getByRole('button', { name: /Rebind Move forward/ }).click();
    await page.keyboard.press('k');
    await expect(page.getByRole('alert')).toHaveText(/KEY CONFLICT:.*\(K\)/);
  });
});
