import { test as base } from '@playwright/test';
import type { BlockCraftDebugAPI } from '../../src/debug/api/core';
import { PNG } from 'pngjs';
import fs from 'fs';
import path from 'path';

declare global {
  interface Window {
    __blockcraft?: BlockCraftDebugAPI;
  }
}

export interface ScreenshotOpts {
  name: string;
  milestone: string;
}

type FixtureContext = {
  assertAndSaveScreenshot: (opts: ScreenshotOpts) => Promise<PNG>;
  getRenderStats: () => Promise<ReturnType<BlockCraftDebugAPI['getRenderStats']>>;
};

export const test = base.extend<FixtureContext>({
  page: async ({ page }, use) => {
    const errors: string[] = [];

    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

    page.on('console', (msg) => {
      const type = msg.type();
      const text = msg.text();
      if (type === 'error') {
        errors.push(`console.error: ${text}`);
      } else if (type === 'warning' && text.toLowerCase().includes('webgl')) {
        errors.push(`WebGL warning: ${text}`);
      }
    });

    page.on('requestfailed', (req) => {
      errors.push(`requestfailed: ${req.url()} (${req.failure()?.errorText})`);
    });

    page.on('response', (res) => {
      if (res.status() >= 400) {
        errors.push(`HTTP ${res.status()}: ${res.request().url()}`);
      }
    });

    await page.goto('/?debug=1');

    await page.waitForFunction(() => {
      return window.__blockcraft?.ready;
    });

    await page.evaluate(async () => {
      await window.__blockcraft!.ready();
    });

    await use(page);

    const stats = await page.evaluate(() => window.__blockcraft!.getRenderStats());

    if (errors.length > 0) {
      throw new Error(`Test failed due to recorded errors:\n${errors.join('\n')}`);
    }

    if (stats.glErrors > 0) {
      throw new Error(`Test failed: glErrors > 0 (${stats.glErrors})`);
    }

    if (stats.missingTextures.length > 0) {
      throw new Error(`Test failed: missing textures found: ${stats.missingTextures.join(', ')}`);
    }
  },

  assertAndSaveScreenshot: async ({ page }, use) => {
    const screenshotDir = path.join(process.cwd(), 'artifacts');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    const capture = async (opts: ScreenshotOpts): Promise<PNG> => {
      const milestone = opts.milestone;
      const mDir = path.join(screenshotDir, milestone);
      if (!fs.existsSync(mDir)) {
        fs.mkdirSync(mDir, { recursive: true });
      }

      const filePath = path.join(mDir, `${opts.name}.png`);
      const buffer = await page.screenshot({ path: filePath });

      return PNG.sync.read(buffer);
    };

    await use(capture);
  },

  getRenderStats: async ({ page }, use) => {
    await use(async () => {
      return await page.evaluate(() => window.__blockcraft!.getRenderStats());
    });
  },
});

export { expect } from '@playwright/test';
