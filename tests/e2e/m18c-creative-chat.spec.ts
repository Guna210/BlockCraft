import { test, expect } from '../harness/fixture';
import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';
import fs from 'node:fs/promises';
import { assertNotBlank, assertNoMissingTexture } from '../harness/pixels';

async function world(page: Page, mode: 'survival' | 'creative' = 'creative'): Promise<void> {
  await page.evaluate(async (mode) => {
    await window.__blockcraft!.createWorld!({
      name: 'M18c',
      seed: 'blockcraft-test-seed-42',
      type: 'flat',
      mode,
    });
    await window.__blockcraft!.waitForTerrain!(2);
    window.__blockcraft!.pause!();
  }, mode);
}
async function command(page: Page, line: string): Promise<void> {
  await page.keyboard.press('/');
  await expect(page.getByRole('textbox', { name: 'Chat message or command' })).toHaveValue('/');
  await page.keyboard.type(line.slice(1));
  await page.keyboard.press('Enter');
}

test.describe('M18c creative, local chat and commands', () => {
  test('commands typed in chat give 5 iron ingots, teleport, and report unknown commands safely', async ({
    page,
    assertAndSaveScreenshot,
  }) => {
    await world(page);
    const ironCount = () =>
      page.evaluate(() =>
        window.__blockcraft!.getInventory!().reduce(
          (total, stack) => total + (stack?.id === 'iron_ingot' ? stack.count : 0),
          0,
        ),
      );
    const before = await ironCount();
    await command(page, '/give @s iron_ingot 5');
    await expect.poll(ironCount).toBe(before + 5);
    await expect(page.getByRole('log')).toContainText('Gave 5 iron_ingot');
    await command(page, '/tp 100 120 100');
    await expect
      .poll(() => page.evaluate(() => window.__blockcraft!.getPlayer!().pos))
      .toEqual([100, 120, 100]);
    await command(page, '/unknown_command');
    await expect(page.locator('[data-error=true]')).toHaveText(
      'Error: Unknown command: /unknown_command',
    );
    await page.keyboard.press('t');
    await expect(page.locator('#chat-input')).toBeFocused();
    const image = await assertAndSaveScreenshot({ name: 'm18-chat', milestone: 'M18c' });
    assertNotBlank(image);
    assertNoMissingTexture(image);
    await page.keyboard.press('Escape');
    await command(page, '/seed');
    await expect(page.getByRole('log')).toContainText('Seed: blockcraft-test-seed-42');
  });

  test('creative search glass shows only glass items, infinite stacks and delete slot work', async ({
    page,
    assertAndSaveScreenshot,
  }) => {
    await world(page);
    await page.keyboard.press('e');
    await expect(page.getByRole('dialog', { name: 'Creative inventory' })).toBeVisible();
    await page.getByRole('tab', { name: 'Food', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search all items' }).fill('glass');
    const ids = await page
      .locator('[data-item-id]')
      .evaluateAll((buttons) => buttons.map((button) => (button as HTMLElement).dataset.itemId!));
    expect(ids.length).toBeGreaterThan(1);
    expect(ids.every((id) => id.includes('glass'))).toBe(true);
    const glass = page.locator('[data-item-id=glass]');
    await glass.click();
    expect(await page.evaluate(() => window.__blockcraft!.getInventoryCursor!())).toMatchObject({
      id: 'glass',
      count: 64,
    });
    await page.locator('[data-inventory-slot="0"]').click();
    await glass.click();
    expect(await page.evaluate(() => window.__blockcraft!.getInventoryCursor!())).toMatchObject({
      id: 'glass',
      count: 64,
    });
    await page.locator('[data-inventory-slot="1"]').click();
    expect(
      await page.evaluate(() => window.__blockcraft!.getInventory!().slice(0, 2)),
    ).toMatchObject([
      { id: 'glass', count: 64 },
      { id: 'glass', count: 64 },
    ]);
    await glass.click();
    await page.getByRole('button', { name: 'DELETE', exact: true }).click();
    expect(await page.evaluate(() => window.__blockcraft!.getInventoryCursor!())).toBeNull();
    expect(await page.locator('[data-item-id]').count()).toBe(ids.length);
    const image = await assertAndSaveScreenshot({ name: 'm18-creative', milestone: 'M18c' });
    assertNotBlank(image);
    assertNoMissingTexture(image);
    await page.keyboard.press('Escape');
    await command(page, '/gamemode survival');
    await page.keyboard.press('e');
    await expect
      .poll(() => page.evaluate(() => window.__blockcraft!.getScreen!().name))
      .toBe('inventory');
    await expect(page.locator('#creative-inventory')).toBeHidden();
  });

  test('time, weather, fill, locate and summon reach live game systems', async ({ page }) => {
    await world(page);
    await command(page, '/time set midnight');
    await expect.poll(() => page.evaluate(() => window.__blockcraft!.getTimeOfDay!())).toBe(18000);
    await command(page, '/weather rain');
    await expect(page.getByRole('log')).toContainText('Weather set to rain');
    await command(page, '/fill 0 70 0 1 70 1 glass');
    await expect(page.getByRole('log')).toContainText('Filled 4 blocks with glass');
    expect(await page.evaluate(() => window.__blockcraft!.getBlock!(1, 70, 1).id)).toBe('glass');
    await command(page, '/fill 0 71 0 16 86 15 stone');
    await expect(page.locator('[data-error=true]')).toHaveText(/exceeds the 4096 block cap/);
    expect(await page.evaluate(() => window.__blockcraft!.getBlock!(0, 71, 0).id)).toBe('air');
    await command(page, '/locate ore iron_ore');
    await expect(page.getByRole('log')).toContainText('No iron_ore found in search range');
    await command(page, '/locate structure wayfarer_hamlet');
    await expect(page.getByRole('log')).toContainText(/wayfarer_hamlet at/);
    await command(page, '/summon tuftbuck 4 70 4');
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.__blockcraft!.getEntities!({ type: 'tuftbuck' }).some(
            (entity) => entity.pos[0] === 4 && entity.pos[1] === 70 && entity.pos[2] === 4,
          ),
        ),
      )
      .toBe(true);
    await command(page, '/summon item:iron_ingot 5 70 5');
    await expect(page.getByRole('log')).toContainText('Summoned item:iron_ingot');
    await command(page, '/summon invalid_entity');
    await expect(page.locator('[data-error=true]')).toContainText(
      'Unknown entity type: invalid_entity',
    );
  });

  test('chat captures typing, releases pointer lock, completes arguments and restores history drafts', async ({
    page,
  }) => {
    await world(page);
    await page.locator('#game-canvas').click();
    await expect
      .poll(() => page.evaluate(() => document.pointerLockElement?.id))
      .toBe('game-canvas');
    await page.keyboard.press('/');
    const field = page.locator('#chat-input');
    await expect(field).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.pointerLockElement)).toBeNull();
    await page.locator('#game-canvas').click({ position: { x: 1000, y: 100 } });
    await expect.poll(() => page.evaluate(() => document.pointerLockElement)).toBeNull();
    await page.keyboard.type('give @s iron_i');
    await page.keyboard.press('Tab');
    await expect(field).toHaveValue('/give @s iron_ingot');
    await page.keyboard.type(' 5');
    await page.keyboard.press('Enter');
    await page.keyboard.press('t');
    const selectedBefore = await page.evaluate(
      () => window.__blockcraft!.getPlayer!().selectedSlot,
    );
    await page.keyboard.type('draft weq123');
    expect(await page.evaluate(() => window.__blockcraft!.getPlayer!().selectedSlot)).toBe(
      selectedBefore,
    );
    await expect.poll(() => page.evaluate(() => window.__blockcraft!.getScreen!().name)).toBeNull();
    await page.keyboard.press('ArrowUp');
    await expect(field).toHaveValue('/give @s iron_ingot 5');
    await page.keyboard.press('ArrowDown');
    await expect(field).toHaveValue('draft weq123');
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.exitPointerLock());
  });

  test('plain local messages fade out and default F2 offers a local screenshot', async ({
    page,
  }) => {
    await world(page);
    await page.keyboard.press('t');
    await page.keyboard.type('A quiet place to build');
    await page.keyboard.press('Enter');
    const message = page.getByRole('log').getByText('You: A quiet place to build');
    await expect(message).toBeVisible();
    await expect(message).toHaveCount(0, { timeout: 15_000 });
    const requests: string[] = [];
    page.on('request', (request) => {
      if (/^https?:/.test(request.url())) requests.push(request.url());
    });
    await page.keyboard.press('F2');
    const link = page.getByRole('link', { name: 'Download screenshot (PNG)' });
    await expect(link).toBeVisible({ timeout: 15_000 });
    await expect(link).toHaveAttribute('href', /^blob:/);
    expect(requests).toEqual([]);
  });

  test('chat, command and screenshot actions remap through settings; screenshot is a nonblank local PNG', async ({
    page,
  }) => {
    await world(page);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'KEYS 3', exact: true }).click();
    for (const [action, key] of [
      ['Open chat', 'y'],
      ['Open command', 'Backslash'],
      ['Screenshot', 'F6'],
    ]) {
      await page.getByRole('button', { name: new RegExp(`Rebind ${action}`) }).click();
      await page.keyboard.press(key!);
    }
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('t');
    await expect(page.locator('#chat-input')).toBeHidden();
    await page.keyboard.press('y');
    await expect(page.locator('#chat-input')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Backslash');
    await expect(page.locator('#chat-input')).toHaveValue('/');
    await page.keyboard.press('Escape');
    await page.keyboard.press('F2');
    await expect(page.locator('#screenshot-download')).toHaveCount(0);
    expect(
      (await page.evaluate(() => window.__blockcraft!.getSettings!())).keyBindings.screenshot,
    ).toBe('F6');
    await expect(page.locator('#chat-input')).toBeHidden();
    await page.keyboard.press('F6');
    const link = page.getByRole('link', { name: 'Download screenshot (PNG)' });
    await expect(link).toBeVisible({ timeout: 15_000 });
    await expect(link).toHaveAttribute('href', /^blob:/);
    const downloadPromise = page.waitForEvent('download');
    await link.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.png$/);
    const path = await download.path();
    expect(path).not.toBeNull();
    const image = PNG.sync.read(await fs.readFile(path!));
    expect(image.width).toBe(1280);
    expect(image.height).toBe(720);
    assertNotBlank(image);
    assertNoMissingTexture(image);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'KEYS 3', exact: true }).click();
    await page.getByRole('button', { name: /Rebind Open chat/ }).click();
    await page.mouse.click(100, 100, { button: 'middle' });
    await page.getByRole('button', { name: /Rebind Screenshot/ }).click();
    await page.mouse.click(100, 100, { button: 'right' });
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.locator('#game-canvas').click({ button: 'middle' });
    await expect(page.locator('#chat-input')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.pointerLockElement)).toBeNull();
    await page.keyboard.press('Escape');
    const oldUrl = await link.getAttribute('href');
    await page.locator('#game-canvas').click({ button: 'right' });
    await expect(link).not.toHaveAttribute('href', oldUrl!);
  });
});
