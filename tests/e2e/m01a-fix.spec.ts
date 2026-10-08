import { test, expect } from '../harness/fixture';
import type { Page } from '@playwright/test';

declare global {
  interface Window {
    __getErrorCalls: number;
  }
}

/** Counts every gl.getError() call the page makes from now on (the game calls it through the prototype). */
async function countGetErrorCalls(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__getErrorCalls = 0;
    const proto = WebGL2RenderingContext.prototype;
    const original = proto.getError;
    proto.getError = function (this: WebGL2RenderingContext) {
      window.__getErrorCalls++;
      return original.call(this);
    };
  });
}

/** Lets `frames` game frames run and returns the getError calls made meanwhile and the draws per frame. */
async function measureFrames(page: Page, frames: number) {
  return await page.evaluate(async (n) => {
    const before = window.__getErrorCalls;
    for (let i = 0; i < n; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    const calls = window.__getErrorCalls - before;
    return { calls, drawCalls: window.__blockcraft!.getRenderStats().drawCalls };
  }, frames);
}

const FRAMES = 8;

test.describe('M01a-fix: WebGL errors are read once per frame', () => {
  test('?debug=1 reads at most a couple of errors per frame in the default world', async ({
    page,
  }) => {
    await page.evaluate(() =>
      window.__blockcraft!.createWorld!({ seed: 'blockcraft-test-seed-42', type: 'default' }),
    );
    await countGetErrorCalls(page);

    const { calls, drawCalls } = await measureFrames(page, FRAMES);

    // The scene is big enough that a per-draw check would show: hundreds of draws per frame.
    expect(drawCalls).toBeGreaterThan(100);
    expect(calls).toBeGreaterThan(0); // the per-frame check is running
    expect(calls / FRAMES).toBeLessThanOrEqual(2);
  });

  test('?debug=1&glcheck=draw reads errors after every draw call', async ({ page }) => {
    await page.goto('/?debug=1&glcheck=draw');
    await page.evaluate(async () => {
      await window.__blockcraft!.ready();
    });
    await page.evaluate(() =>
      window.__blockcraft!.createWorld!({ seed: 'blockcraft-test-seed-42', type: 'default' }),
    );
    await countGetErrorCalls(page);

    const { calls, drawCalls } = await measureFrames(page, FRAMES);

    expect(drawCalls).toBeGreaterThan(100);
    // One call per draw in each of the frames that ran in the window (one frame of slack for the
    // frame that was already under way when counting started).
    expect(calls).toBeGreaterThanOrEqual(drawCalls * (FRAMES - 1));
  });
});
