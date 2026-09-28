import { test, expect } from '@playwright/test';

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
    return (window as any).__blockcraft?.ready;
  });

  await page.evaluate(async () => {
    await (window as any).__blockcraft.ready();
  });

  expect(errors).toHaveLength(0);
});
