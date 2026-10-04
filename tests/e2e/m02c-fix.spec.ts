import { test, expect } from '../harness/fixture';
import { assertNoMissingTexture, assertNotBlank, diffFraction } from '../harness/pixels';
import type { Page } from '@playwright/test';

interface HeldFrames {
  __rafNative: (cb: FrameRequestCallback) => number;
  __rafQueue: FrameRequestCallback[];
}

/**
 * Holds the game's requestAnimationFrame loop, which simulates a long main-thread stall: no frame
 * is drawn until drawFrames() is called. (Same technique as tests/e2e/m03c.spec.ts.)
 */
async function holdFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as HeldFrames;
    w.__rafNative = window.requestAnimationFrame.bind(window);
    w.__rafQueue = [];
    window.requestAnimationFrame = (cb: FrameRequestCallback) => w.__rafQueue.push(cb);
  });
}

/** Draws exactly `count` game frames and waits until the last one has been presented. */
async function drawFrames(page: Page, count: number): Promise<void> {
  await page.evaluate(async (n) => {
    const w = window as unknown as HeldFrames;
    for (let i = 0; i < n; i++) {
      for (const cb of w.__rafQueue.splice(0)) w.__rafNative(cb);
      await new Promise((r) => w.__rafNative(() => w.__rafNative(r)));
    }
  }, count);
}

/** Tilts the spawn camera down so that the frame shows grass, dirt and stone. It stays static afterwards. */
async function lookDown(page: Page): Promise<void> {
  await page.evaluate(() => {
    const wm = (
      window as unknown as {
        WorldManager: { getInstance: () => { camera: { pitch: number; updateView(): void } } };
      }
    ).WorldManager.getInstance();
    wm.camera.pitch = -0.7;
    wm.camera.updateView();
  });
}

interface TintCacheHandle {
  clearAll(): void;
}

test.describe('M02c-fix: world load time and the stale first frame', () => {
  test('after a stall the first frame drawn equals the third frame (static camera)', async ({
    page,
    assertAndSaveScreenshot,
  }) => {
    await holdFrames(page);
    await page.evaluate(() =>
      window.__blockcraft!.createWorld!({ seed: 'blockcraft-test-seed-42', type: 'default' }),
    );

    await lookDown(page);

    await drawFrames(page, 1);
    const first = await assertAndSaveScreenshot({ milestone: 'm02c-fix', name: 'first-frame' });
    assertNotBlank(first);
    assertNoMissingTexture(first);

    await drawFrames(page, 2);
    const third = await assertAndSaveScreenshot({ milestone: 'm02c-fix', name: 'third-frame' });

    expect(diffFraction(first, third)).toBeLessThan(0.01);
  });

  test('a frame that has to create new column tint textures equals the settled frame', async ({
    page,
    assertAndSaveScreenshot,
  }) => {
    await holdFrames(page);
    await page.evaluate(() =>
      window.__blockcraft!.createWorld!({ seed: 'blockcraft-test-seed-42', type: 'default' }),
    );
    await lookDown(page);
    await drawFrames(page, 3);
    const settled = await assertAndSaveScreenshot({ milestone: 'm02c-fix', name: 'settled-frame' });
    assertNotBlank(settled);

    // Forget every column's tint textures: the next frame creates them all again, like the first
    // frame that sees newly uploaded columns.
    await page.evaluate(() => {
      const wm = (
        window as unknown as {
          WorldManager: {
            getInstance: () => { chunkRenderer: { tintCache: TintCacheHandle } };
          };
        }
      ).WorldManager.getInstance();
      wm.chunkRenderer.tintCache.clearAll();
    });

    await drawFrames(page, 1);
    const rebuilt = await assertAndSaveScreenshot({ milestone: 'm02c-fix', name: 'rebuilt-frame' });
    expect(diffFraction(rebuilt, settled)).toBeLessThan(0.01);
  });

  test('default createWorld completes and a terrain frame is drawn within 20 s (SPEC 2.3)', async ({
    page,
    assertAndSaveScreenshot,
  }) => {
    const timing = await page.evaluate(async () => {
      const t0 = performance.now();
      await window.__blockcraft!.createWorld!({
        name: 'm02c-fix-load',
        seed: 'blockcraft-test-seed-42',
        mode: 'survival',
        type: 'default',
      });
      const resolved = performance.now();
      while (window.__blockcraft!.getRenderStats().drawCalls === 0) {
        await new Promise((r) => setTimeout(r, 20));
        if (performance.now() - t0 > 60000) break;
      }
      const firstTerrainFrame = performance.now();
      return { createWorldMs: resolved - t0, firstTerrainFrameMs: firstTerrainFrame - t0 };
    });

    test.info().annotations.push({
      type: 'timing',
      description: `createWorld ${timing.createWorldMs.toFixed(0)} ms, first terrain frame ${timing.firstTerrainFrameMs.toFixed(0)} ms`,
    });

    expect(timing.createWorldMs).toBeLessThan(20000);
    expect(timing.firstTerrainFrameMs).toBeLessThan(20000);

    const stats = await page.evaluate(() => window.__blockcraft!.getRenderStats());
    expect(stats.drawCalls).toBeGreaterThan(0);
    expect(stats.chunksLoaded).toBeGreaterThan(0);

    // The canvas shows terrain, not only the sky clear colour
    const png = await assertAndSaveScreenshot({ milestone: 'm02c-fix', name: 'default-world' });
    assertNotBlank(png);
    assertNoMissingTexture(png);
  });
});
