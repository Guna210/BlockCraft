import { test, expect } from '../harness/fixture';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { assertNotBlank, assertNoMissingTexture } from '../harness/pixels';
import { assertHealthy, connect, second } from './helpers/m21c';
import { prepareContainerWorld } from './helpers/m21b-fix-world';

const worldRoot = join(process.cwd(), 'artifacts', 'm21b-fix-containers-world');

async function lookAtBlock(
  page: import('@playwright/test').Page,
  block: { x: number; y: number; z: number },
): Promise<void> {
  await page.evaluate((target) => {
    const api = window.__blockcraft!;
    const player = api.getPlayer!();
    const dx = target.x + 0.5 - player.pos[0];
    const dy = target.y + 0.5 - (player.pos[1] + 1.62);
    const dz = target.z + 0.5 - player.pos[2];
    api.look!(Math.atan2(dz, dx), Math.atan2(dy, Math.hypot(dx, dz)));
  }, block);
}

async function openContainer(
  page: import('@playwright/test').Page,
  block: { x: number; y: number; z: number },
  expected: 'chest' | 'crafting',
): Promise<void> {
  await lookAtBlock(page, block);
  await page.evaluate(() => window.__blockcraft!.input!('use', true));
  await expect
    .poll(() => page.evaluate(() => window.__blockcraft!.getScreen!().name), { timeout: 10000 })
    .toBe(expected);
  await page.evaluate(() => window.__blockcraft!.input!('use', false));
}

test('multiplayer chest windows share items and crafting closes when a player walks away', async ({
  page,
  browser,
}) => {
  await rm(worldRoot, { recursive: true, force: true });
  await prepareContainerWorld(worldRoot);
  const processServer = spawn(
    process.execPath,
    [
      'dist-server/main.js',
      '--port',
      '0',
      '--world',
      worldRoot,
      '--seed',
      'blockcraft-test-seed-42',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const b = await second(browser);
  let output = '';
  processServer.stdout.on('data', (chunk) => (output += String(chunk)));
  processServer.stderr.on('data', (chunk) => (output += String(chunk)));
  const exited = new Promise<void>((resolve) => processServer.once('exit', () => resolve()));
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Server readiness timeout. ${output}`)),
        20000,
      );
      let readinessOutput = '';
      processServer.stdout.on('data', (chunk) => {
        readinessOutput += String(chunk);
        const match = readinessOutput.match(/listening on (\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
      processServer.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      processServer.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Owned server exited before ready (${code}). ${output}`));
      });
    });

    await connect(page, 'Ada', port);
    await connect(b.page, 'Bea', port);
    const chest = { x: 3, y: 251, z: 0 };
    const workbench = { x: 0, y: 251, z: 0 };

    await openContainer(page, chest, 'chest');
    await page.evaluate(() => {
      const api = window.__blockcraft!;
      api.uiClickSlot!(27, 'left');
      api.uiClickSlot!(0, 'right');
      api.uiClickSlot!(0, 'right');
    });
    await expect
      .poll(() => page.evaluate(() => window.__blockcraft!.getInventoryCursor!()?.count))
      .toBe(22);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.__blockcraft!.getScreen!().name)).toBeNull();

    await openContainer(b.page, chest, 'chest');
    const firstSlot = await b.page.evaluate(() => window.__blockcraft!.getScreen!().slots[0]!);
    await b.page.mouse.move(firstSlot.x + firstSlot.w / 2, firstSlot.y + firstSlot.h / 2);
    await expect
      .poll(() => b.page.evaluate(() => window.__blockcraft!.getScreen!().tooltip))
      .toContain('OAK PLANKS');
    await b.page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    const screenshotDir = join(process.cwd(), 'artifacts', 'M21b-fix');
    await mkdir(screenshotDir, { recursive: true });
    const screenshotPath = join(screenshotDir, 'm21b-fix-chest.png');
    const image = PNG.sync.read(await b.page.screenshot({ path: screenshotPath }));
    assertNotBlank(image);
    assertNoMissingTexture(image);
    const docs = join(process.cwd(), 'docs', 'screenshots', 'M21b-fix');
    await mkdir(docs, { recursive: true });
    await copyFile(screenshotPath, join(docs, 'm21b-fix-chest.png'));
    await b.page.keyboard.press('Escape');
    await expect
      .poll(() => b.page.evaluate(() => window.__blockcraft!.getScreen!().name))
      .toBeNull();

    await openContainer(page, workbench, 'crafting');
    const recipeBook = await page.evaluate(
      () => window.__blockcraft!.getScreen!().recipeBookButton!,
    );
    await page.mouse.click(recipeBook.x + recipeBook.w / 2, recipeBook.y + recipeBook.h / 2);
    const search = await page.evaluate(() => window.__blockcraft!.getScreen!().searchField!);
    await page.mouse.click(search.x + search.w / 2, search.y + search.h / 2);
    await page.keyboard.type('chest');
    const row = await page.evaluate(() =>
      window.__blockcraft!.getScreen!().recipeIds.indexOf('chest'),
    );
    expect(row).toBeGreaterThanOrEqual(0);
    await page.evaluate(
      (recipeRow) => window.__blockcraft!.uiClickSlot!(51 + recipeRow, 'left'),
      row,
    );
    try {
      await expect
        .poll(
          () =>
            page.evaluate(() =>
              window.__blockcraft!.getInventory!().reduce(
                (count, stack) => count + (stack?.id === 'oak_planks' ? stack.count : 0),
                0,
              ),
            ),
          { timeout: 15000 },
        )
        .toBe(6);
    } catch (error) {
      console.log(
        'M21b-fix recipe-fill diagnosis',
        JSON.stringify({
          screen: await page.evaluate(() => window.__blockcraft!.getScreen!()),
          inventory: await page.evaluate(() => window.__blockcraft!.getInventory!()),
          cursor: await page.evaluate(() => window.__blockcraft!.getInventoryCursor!()),
          output,
        }),
      );
      throw error;
    }
    await page.evaluate(() => window.__blockcraft!.uiClickSlot!(9, 'left', true));
    try {
      await expect
        .poll(
          () =>
            page.evaluate(() =>
              window.__blockcraft!.getInventory!().reduce(
                (count, stack) => count + (stack?.id === 'chest' ? stack.count : 0),
                0,
              ),
            ),
          { timeout: 15000 },
        )
        .toBe(2);
    } catch (error) {
      console.log(
        'M21b-fix crafting diagnosis',
        JSON.stringify({
          screen: await page.evaluate(() => window.__blockcraft!.getScreen!()),
          inventory: await page.evaluate(() => window.__blockcraft!.getInventory!()),
          cursor: await page.evaluate(() => window.__blockcraft!.getInventoryCursor!()),
          output,
        }),
      );
      throw error;
    }

    const start = await page.evaluate(() => {
      const api = window.__blockcraft!;
      api.look!(Math.PI / 2, 0);
      api.input!('forward', true);
      api.input!('jump', true);
      const manager = (
        window as unknown as {
          WorldManager: {
            getInstance(): {
              playerController: {
                input: { captured: boolean; getAction(action: string): boolean };
              };
            };
          };
        }
      ).WorldManager.getInstance();
      return {
        pos: api.getPlayer!().pos,
        captured: manager.playerController.input.captured,
        forward: manager.playerController.input.getAction('forward'),
      };
    });
    expect(start).toMatchObject({ captured: false, forward: true });
    try {
      await expect
        .poll(
          () =>
            page.evaluate((pos) => {
              const player = window.__blockcraft!.getPlayer!().pos;
              return Math.hypot(player[0] - pos[0], player[2] - pos[2]);
            }, start.pos),
          { timeout: 10000 },
        )
        .toBeGreaterThan(4);
      await expect
        .poll(() => page.evaluate(() => window.__blockcraft!.getScreen!().name), { timeout: 15000 })
        .toBeNull();
      await expect
        .poll(() =>
          page.evaluate(() =>
            window.__blockcraft!.getInventory!().some((stack) => stack?.id === 'chest'),
          ),
        )
        .toBe(true);
    } finally {
      await page.evaluate(() => {
        window.__blockcraft!.input!('forward', false);
        window.__blockcraft!.input!('jump', false);
      });
    }
    await assertHealthy(b.page, b.errors);
  } finally {
    if (processServer.exitCode === null) processServer.kill('SIGTERM');
    await exited;
    await b.context.close();
    await rm(worldRoot, { recursive: true, force: true });
  }
});
