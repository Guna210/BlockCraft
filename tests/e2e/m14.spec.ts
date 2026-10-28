import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../harness/fixture';
import { assertNotBlank, assertNoMissingTexture } from '../harness/pixels';

test.beforeEach(async ({ page }) => {
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    await api.createWorld!({
      name: 'M14',
      seed: 'blockcraft-test-seed-42',
      mode: 'creative',
      type: 'flat',
      spawning: false,
    });
    api.pause!();
    api.setRenderDistance!(4);
    api.setClouds!('off');
    api.setTimeOfDay!(6000);
    api.teleport!(0.5, 65, 8.5, 0, 0);
    await api.waitForTerrain!(1);
  });
  await page.mouse.click(640, 360);
});

test('M14: 27 charges chain-detonate within 200 ticks with no main-thread frame over 100 ms', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.teleport!(0.5, 65, 20.5, 0, 0);
    api.fill!(-1, 65, -1, 1, 67, 1, 'blast_charge');
    await api.waitForTerrain!(1);
  });
  const result = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    const startTick = api.getExplosionStats!().tick;
    api.resetFrameStats!();
    const id = api.primeBlastCharge!(0, 65, 0);
    api.resume!();
    while (
      api.getExplosionStats!().tick - startTick < 200 &&
      api.getExplosionStats!().detonations < 27
    )
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const stats = api.getExplosionStats!();
    const frame = api.getFrameStats!();
    if (stats.detonations === 27) {
      while (api.getExplosionStats!().pending > 0)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await api.waitForTerrain!(1);
    }
    const cleanupFrame = api.getFrameStats!();
    const completed = api.getExplosionStats!();
    api.pause!();
    let blocks = 0;
    for (let x = -1; x <= 1; x++)
      for (let y = 65; y <= 67; y++)
        for (let z = -1; z <= 1; z++) if (api.getBlock!(x, y, z).id === 'blast_charge') blocks++;
    return {
      id,
      ticks: (stats.detonations === 27 ? stats.lastDetonationTick : stats.tick) - startTick,
      blocks,
      primed: api.getEntities!({ type: 'primed_blast_charge' }).length,
      ...stats,
      frame,
      cleanupFrame,
      completed,
    };
  });
  console.log('M14 chain', JSON.stringify(result));
  expect(result.id).not.toBeNull();
  expect(result.detonations).toBe(27);
  expect(result.blocks).toBe(0);
  expect(result.primed).toBe(0);
  expect(result.ticks).toBeLessThanOrEqual(200);
  expect(result.frame.frames).toBeGreaterThan(0);
  // The real fixed-tick loop runs inside this timer, including all catch-up ticks and rendering.
  expect(
    Math.max(result.frame.frameCpuMsMax, result.cleanupFrame.frameCpuMsMax),
  ).toBeLessThanOrEqual(100);
  expect(result.frame.pumpMsMax).toBeLessThanOrEqual(100);
  expect(result.completed.pending).toBe(0);
  expect(result.completed.maxExplosionMs).toBeLessThanOrEqual(100);
});

test('M14: three-thick Blackglass blocks all player damage; open player at distance 3 takes damage', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const api = window.__blockcraft!;
    api.setGameMode!('survival');
    api.teleport!(6.5, 65, 0.5, 0, 0);
    api.fill!(2, 64, -5, 4, 70, 5, 'blackglass');
    const before = api.getPlayer!().health;
    api.explode!(0.5, 65.9, 0.5, 4);
    const shielded = api.getPlayer!().health;
    let wall = 0;
    for (let x = 2; x <= 4; x++)
      for (let y = 64; y <= 70; y++)
        for (let z = -5; z <= 5; z++) if (api.getBlock!(x, y, z).id === 'blackglass') wall++;
    api.teleport!(3.5, 65, 20.5, 0, 0);
    api.explode!(0.5, 65.9, 20.5, 4);
    return { before, shielded, open: api.getPlayer!().health, wall };
  });
  console.log('M14 exposure', JSON.stringify(result));
  expect(result.shielded).toBe(result.before);
  expect(result.open).toBeLessThan(result.before);
  expect(result.wall).toBe(3 * 7 * 11);
});

test('M14: irregular crater admits sky light to its floor', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.teleport!(9.5, 74, 12.5, -2.2, -0.65);
    api.explode!(0.5, 64.5, 0.5, 4);
    await api.tick!(30);
    api.teleport!(9.5, 74, 12.5, -2.2, -0.65);
    await api.waitForTerrain!(1);
  });
  const floor = await page.evaluate(() => {
    const api = window.__blockcraft!;
    const samples: Array<{ x: number; z: number; y: number; sky: number }> = [];
    for (let z = -5; z <= 5; z++)
      for (let x = -5; x <= 5; x++) {
        const y = api.getHeight!(x, z);
        if (y < 64) samples.push({ x, z, y, sky: api.getLight!(x, y + 1, z).sky });
      }
    return samples;
  });
  console.log('M14 crater', JSON.stringify(floor));
  expect(floor.length).toBeGreaterThan(10);
  expect(new Set(floor.map((p) => p.y)).size).toBeGreaterThan(1);
  expect(floor.every((p) => p.sky === 15)).toBe(true);
  const png = await assertAndSaveScreenshot({ name: 'm14-crater', milestone: 'M14' });
  assertNotBlank(png);
  assertNoMissingTexture(png);
  fs.mkdirSync('docs/screenshots/M14', { recursive: true });
  fs.copyFileSync(
    path.join('artifacts', 'M14', 'm14-crater.png'),
    'docs/screenshots/M14/m14-crater.png',
  );
});
