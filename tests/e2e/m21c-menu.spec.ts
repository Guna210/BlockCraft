import { test, expect } from '../harness/fixture';

test('multiplayer form validates addresses and remembers connection details', async ({ page }) => {
  await page.getByRole('button', { name: 'Multiplayer', exact: true }).click();
  const form = page.locator('#multiplayer-screen');
  await expect(form).toBeVisible();
  await form.getByLabel('Player name').fill(`menu-${Date.now()}`);
  await form.getByLabel('Server address').fill('not an address');
  await form.getByRole('button', { name: 'Connect' }).click();
  await expect(form.getByRole('status')).toHaveText('Invalid server address');
  await form.getByLabel('Server address').fill('ws://localhost:3001');
  await form.getByRole('button', { name: 'Connect' }).click();
  await expect(form).toBeHidden({ timeout: 60000 });
  await expect
    .poll(() => page.evaluate(() => window.__blockcraft?.getPlayer?.().dimension))
    .toBe('overworld');
  await page.keyboard.press('Escape');
  const quit = await page.evaluate(() => window.__blockcraft!.getScreen!().saveQuitButton!);
  await page.mouse.click(quit.x + quit.w / 2, quit.y + quit.h / 2);
  await expect(form).toBeHidden();
  await page.getByRole('button', { name: 'Multiplayer', exact: true }).click();
  await expect(form.getByLabel('Server address')).toHaveValue('ws://localhost:3001');
  await expect(form.getByLabel('Player name')).toHaveValue(/^menu-/);
  await form.getByRole('button', { name: 'Back', exact: true }).click();
  await page.evaluate(() => window.__blockcraft!.createWorld!({ type: 'flat', mode: 'creative' }));
  expect(await page.evaluate(() => window.__blockcraft!.getNetStats!().connected)).toBe(false);
  expect(await page.evaluate(() => window.__blockcraft!.getPlayer!().mode)).toBe('creative');
});
