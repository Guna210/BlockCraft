import { test, expect } from '../harness/fixture';
import type { Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeMessage, MessageType as T, type Messages } from '../../src/net/protocol';
import { assertHealthy, connect, second } from './helpers/m21c';

async function heartPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#hud-canvas')!;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0;
    for (let i = 0; i < data.length; i += 4)
      if (data[i] === 234 && data[i + 1] === 69 && data[i + 2] === 91 && data[i + 3] === 255) red++;
    return red;
  });
}

test('real drowning updates multiplayer hearts, death cause, remote visibility and server-authorized respawn', async ({
  page,
  browser,
  assertAndSaveScreenshot,
}) => {
  await mkdir('artifacts', { recursive: true });
  const root = await mkdtemp(join(process.cwd(), 'artifacts/m21b-fix2-world-'));
  const processServer = spawn(
    process.execPath,
    [
      'dist-server/main.js',
      '--port',
      '0',
      '--world',
      root,
      '--seed',
      'blockcraft-test-seed-42',
      '--reset-world',
      '--view-distance',
      '2',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const exited = new Promise<void>((resolve) => processServer.once('exit', () => resolve()));
  const b = await second(browser);
  const snapshots: Messages[T.PlayerVitals][] = [];
  let hello: Messages[T.ServerHello] | null = null;
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload === 'string') return;
      const result = decodeMessage(new Uint8Array(payload));
      if (!result.ok) return;
      if (result.message.type === T.PlayerVitals) snapshots.push(result.message);
      if (result.message.type === T.ServerHello) hello = result.message;
    }),
  );
  try {
    const port = await new Promise<number>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Server readiness timeout')), 20000);
      processServer.stdout.on('data', (chunk) => {
        output += String(chunk);
        const match = output.match(/listening on (\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
      processServer.once('error', reject);
    });
    for (const p of [page, b.page])
      await p.evaluate(() => window.__blockcraft!.setRenderDistance!(2));
    await connect(page, 'Vitals-A', port);
    await connect(b.page, 'Vitals-B', port);
    await expect.poll(() => snapshots[0]?.health).toBe(20);
    const id = hello!.entityId;
    const spawnPoint = hello!.spawn;
    await expect
      .poll(() =>
        b.page.evaluate(
          (id) => window.__blockcraft!.getRemoteEntities!().some((e) => e.id === id),
          id,
        ),
      )
      .toBe(true);
    for (const p of [page, b.page])
      await p.evaluate(() => {
        window.__blockcraft!.look!(0, 1.4);
        return window.__blockcraft!.waitForTerrain!(1);
      });
    const fullHearts = await heartPixels(page);
    expect(fullHearts).toBeGreaterThan(0);
    // Standard-seed spawn borders a real pool. Walk into it and sink without jumping.
    expect(await page.evaluate(() => window.__blockcraft!.getBlock!(3, 64, 0).id)).toBe('water');
    await page.evaluate(() => {
      const api = window.__blockcraft!;
      api.look!(0, 1.4);
      api.input!('forward', true);
    });
    await expect
      .poll(() => page.evaluate(() => window.__blockcraft!.getPlayer!().pos[0]))
      .toBeGreaterThan(3);
    await page.evaluate(() => window.__blockcraft!.input!('forward', false));
    // Observe health and the actual HUD in one animation frame, avoiding a Node
    // round trip between a transient vital update and the frame that draws it.
    const damaged = await page.evaluate(
      (fullHearts) =>
        new Promise<{ health: number; red: number }>((resolve, reject) => {
          const start = performance.now();
          const trace: unknown[] = [];
          let lastHealth = 20;
          const observe = () => {
            const api = window.__blockcraft!,
              health = api.getPlayer!().health;
            const canvas = document.querySelector<HTMLCanvasElement>('#hud-canvas')!;
            const data = canvas
              .getContext('2d')!
              .getImageData(0, 0, canvas.width, canvas.height).data;
            let red = 0;
            for (let i = 0; i < data.length; i += 4)
              if (
                data[i] === 234 &&
                data[i + 1] === 69 &&
                data[i + 2] === 91 &&
                data[i + 3] === 255
              )
                red++;
            if (health !== lastHealth) {
              trace.push({
                health,
                red,
                screen: api.getScreen!().name,
                ms: performance.now() - start,
              });
              lastHealth = health;
            }
            if (health > 0 && health < 20 && red < fullHearts) {
              resolve({ health, red });
              return;
            }
            if (health <= 0 || performance.now() - start > 40000) {
              reject(new Error('No live damaged HUD frame: ' + JSON.stringify(trace)));
              return;
            }
            requestAnimationFrame(observe);
          };
          requestAnimationFrame(observe);
        }),
      fullHearts,
    );
    expect(damaged.health).toBeGreaterThan(0);
    expect(damaged.health).toBeLessThan(20);
    expect(damaged.red).toBeLessThan(fullHearts);
    expect(snapshots.some((v) => v.health === damaged.health)).toBe(true);
    await expect
      .poll(() => page.evaluate(() => window.__blockcraft!.getScreen!().name), { timeout: 40000 })
      .toBe('death');
    expect(await page.evaluate(() => window.__blockcraft!.getScreen!().cause)).toBe('Drowned');
    expect(snapshots.at(-1)).toMatchObject({ health: 0, dead: true, deathCause: 'Drowned' });
    await expect
      .poll(() =>
        b.page.evaluate(
          (id) => window.__blockcraft!.getRemoteEntities!().some((e) => e.id === id),
          id,
        ),
      )
      .toBe(false);
    await assertAndSaveScreenshot({ name: 'm21b-fix2-death', milestone: 'M21b-fix2' });
    const button = await page.evaluate(() => window.__blockcraft!.getScreen!().respawnButton);
    expect(button).not.toBeNull();
    await page.mouse.click(button!.x + button!.w / 2, button!.y + button!.h / 2);
    await expect.poll(() => page.evaluate(() => window.__blockcraft!.getScreen!().name)).toBeNull();
    await expect.poll(() => page.evaluate(() => window.__blockcraft!.getPlayer!().health)).toBe(20);
    const alive = await page.evaluate(() => window.__blockcraft!.getPlayer!());
    expect(snapshots.at(-1)?.dead).toBe(false);
    expect(alive.pos[0]).toBeCloseTo(spawnPoint[0], 1);
    expect(alive.pos[1]).toBeCloseTo(spawnPoint[1], 1);
    expect(alive.pos[2]).toBeCloseTo(spawnPoint[2], 1);
    await expect.poll(() => heartPixels(page)).toBe(fullHearts);
    await expect
      .poll(() =>
        b.page.evaluate(
          (id) => window.__blockcraft!.getRemoteEntities!().some((e) => e.id === id),
          id,
        ),
      )
      .toBe(true);
    await assertHealthy(b.page, b.errors);
  } finally {
    if (processServer.exitCode === null) processServer.kill('SIGTERM');
    await exited;
    await b.context.close();
    await rm(root, { recursive: true, force: true });
  }
});
