import { test, expect } from '@playwright/test';
import type { BlockCraftDebugAPI } from '../../src/debug/api/core';

declare global {
  interface Window {
    __blockcraft?: BlockCraftDebugAPI;
  }
}

test('M00 smoke test: page loads with 0 errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`Page error: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(`Console error: ${msg.text()}`);
    }
  });

  await page.goto('/?debug=1');

  // Wait for the ready promise on the debug API
  await page.waitForFunction(() => {
    return window.__blockcraft?.ready;
  });

  await page.evaluate(async () => {
    await window.__blockcraft!.ready();
  });

  expect(errors).toHaveLength(0);
});
