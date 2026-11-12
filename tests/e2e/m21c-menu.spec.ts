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
  await expect(form.getByRole('status')).toHaveText('Connected', { timeout: 60000 });
  await form.getByRole('button', { name: 'Back' }).click();
  await expect(form).toBeHidden();
  await page.getByRole('button', { name: 'Multiplayer', exact: true }).click();
  await expect(form.getByLabel('Server address')).toHaveValue('ws://localhost:3001');
  await expect(form.getByLabel('Player name')).toHaveValue(/^menu-/);
});
