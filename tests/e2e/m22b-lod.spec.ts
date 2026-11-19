import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from '../harness/fixture';
import { assertNoMissingTexture, assertNotBlank } from '../harness/pixels';
import { waitForStreamingIdle } from './helpers/flight';
import { findSkyHoles, isSkyPixel, MAX_HOLE_PIXELS } from './helpers/sky-holes';

const SEED = 'blockcraft-test-seed-42';

test('local creation and loading show monotonic terrain progress until they resolve', async ({
  page,
}) => {
  test.setTimeout(120_000);
  for (const load of [false, true]) {
    const result = await page.evaluate(async (load) => {
      const api = window.__blockcraft!;
      const name = 'm22b-loading';
      const progress: number[] = [];
      const read = () => {
        const bar = document.querySelector('#world-loading [role=progressbar]');
        if (bar) progress.push(Number(bar.getAttribute('aria-valuenow')));
      };
      const done = load
        ? api.loadWorld!(name)
        : api.createWorld!({ name, seed: 'm22b-loading', mode: 'creative', type: 'flat' });
      const screen = document.querySelector<HTMLElement>('#world-loading')!;
      const shownWhilePending = getComputedStyle(screen).display !== 'none';
      read();
      const observer = new MutationObserver(read);
      observer.observe(screen, {
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-valuenow'],
      });
      try {
        await done;
        read();
      } finally {
        observer.disconnect();
      }
      const hiddenOnResolve = getComputedStyle(screen).display === 'none';
      if (!load) await api.save!();
      return { progress, hiddenOnResolve, shownWhilePending };
    }, load);
    expect(result.shownWhilePending).toBe(true);
    expect(result.hiddenOnResolve).toBe(true);
    expect(result.progress[0]).toBe(0);
    expect(result.progress.at(-1)).toBe(81);
    expect(result.progress.some((value) => value > 0 && value < 81)).toBe(true);
    expect(result.progress).toEqual([...result.progress].sort((a, b) => a - b));
  }
});

async function setDistance(page: Page, distance: number): Promise<void> {
  await page.evaluate((distance) => window.__blockcraft!.setRenderDistance!(distance), distance);
}

async function waitForLod(page: Page, distance: number): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.__blockcraft!.getLodStats!().coverageRadius), {
      timeout: 240_000,
    })
    .toBe(distance);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test('RD16 reaches the fog without holes and RD32 keeps the RD12 column count', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  test.setTimeout(1_100_000);
  await page.evaluate(async (seed) => {
    const api = window.__blockcraft!;
    api.setRenderDistance!(12);
    await api.createWorld!({
      name: 'm22b-horizon',
      seed,
      mode: 'creative',
      type: 'default',
      spawning: false,
    });
    api.pause!();
    api.setTimeOfDay!(6000);
    api.setWeather!('clear');
    api.setClouds!('off');
  }, SEED);
  await waitForStreamingIdle(page, 240_000);
  const baseline = await page.evaluate(() => window.__blockcraft!.getRenderStats().chunksLoaded);
  expect(baseline).toBeGreaterThan(0);
  const eye = await page.evaluate(() => {
    const api = window.__blockcraft!;
    const [x, y, z] = api.getPlayer!().pos;
    const eyeOffset = api.getRenderStats().cameraPosition[1] - y;
    let top = 0;
    for (let dx = -144; dx <= 144; dx += 8) {
      for (let dz = -144; dz <= 144; dz += 8) top = Math.max(top, api.getHeight!(x + dx, z + dz));
    }
    api.teleport!(x, top + 40 - eyeOffset, z, 0, -Math.PI / 10);
    return top + 40;
  });

  await page.evaluate(() => window.__blockcraft!.setSetting!('lod', true));
  await setDistance(page, 16);
  await waitForLod(page, 16);
  const rd16 = await page.evaluate(() => {
    const api = window.__blockcraft!;
    return { lod: api.getLodStats!(), render: api.getRenderStats() };
  });
  const horizon = await assertAndSaveScreenshot({ milestone: 'M22b', name: 'm22-lod-rd16' });
  const holes = findSkyHoles(horizon);
  let upperSky = 0;
  const topRows = Math.round(horizon.height / 10);
  for (let y = 0; y < topRows; y++) {
    for (let x = 0; x < horizon.width; x++) if (isSkyPixel(horizon, x, y)) upperSky++;
  }
  console.log('M22b RD16', JSON.stringify({ baseline, eye, ...rd16, holes, upperSky }));
  expect(rd16.render.drawCalls).toBeLessThanOrEqual(1500);
  expect(rd16.render.chunksLoaded).toBe(baseline);
  expect(rd16.lod.fullDetailRadius).toBe(12);
  expect(rd16.lod.coverageRadius).toBe(16);
  expect(rd16.lod.visibleTiles).toBeGreaterThan(0);
  expect(rd16.lod.drawSubmissions).toBeGreaterThan(0);
  assertNotBlank(horizon);
  assertNoMissingTexture(horizon);
  expect(holes.largestEnclosed).toBeLessThanOrEqual(MAX_HOLE_PIXELS);
  expect(upperSky / (topRows * horizon.width)).toBeGreaterThan(0.5);

  await page.evaluate(() => window.__blockcraft!.look!(Math.PI / 2, -Math.PI / 18));
  await setDistance(page, 32);
  await waitForLod(page, 32);
  const rd32 = await page.evaluate(() => {
    const api = window.__blockcraft!;
    return { lod: api.getLodStats!(), render: api.getRenderStats() };
  });
  console.log('M22b RD32', JSON.stringify(rd32));
  expect(rd32.render.chunksLoaded).toBe(baseline);
  expect(rd32.lod.coverageRadius).toBe(32);
  expect(rd32.lod.pendingJobs).toBe(0);
  expect(rd32.lod.tiles).toBeGreaterThan(rd16.lod.tiles);
  expect(rd32.lod.visibleTiles).toBeGreaterThan(0);
  const screenshot = await assertAndSaveScreenshot({ milestone: 'M22b', name: 'm22-lod-horizon' });
  assertNotBlank(screenshot);
  assertNoMissingTexture(screenshot);
  await page.evaluate(() => {
    const api = window.__blockcraft!;
    api.setSetting!('fov', 56);
    api.look!(Math.PI / 2, -Math.PI / 8);
  });
  await assertAndSaveScreenshot({ milestone: 'M22b', name: 'm22-lod-seam' });
  await page.evaluate(() => {
    const api = window.__blockcraft!;
    api.look!(Math.PI / 2, 1.55);
    api.setSetting!('lod', false);
    api.setSetting!('fov', 70);
  });
  expect(await page.evaluate(() => window.__blockcraft!.getStreamingStats!().renderDistance)).toBe(
    32,
  );
  await waitForStreamingIdle(page, 600_000);
  await page.evaluate(() => window.__blockcraft!.look!(Math.PI / 2, -Math.PI / 18));
  assertNotBlank(await assertAndSaveScreenshot({ milestone: 'M22b', name: 'm22-lod-off' }));
  fs.mkdirSync('docs/screenshots/M22b', { recursive: true });
  for (const name of ['m22-lod-horizon', 'm22-lod-off', 'm22-lod-seam']) {
    fs.copyFileSync('artifacts/M22b/' + name + '.png', 'docs/screenshots/M22b/' + name + '.png');
  }
});

test('LOD defaults off at RD16 and restores full detail live', async ({ page }) => {
  test.setTimeout(360_000);
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    await api.createWorld!({
      name: 'm22b-disabled',
      seed: 'flat',
      mode: 'creative',
      type: 'flat',
      spawning: false,
    });
    api.pause!();
    api.look!(0, 1.55);
    api.setRenderDistance!(16);
  });
  await waitForStreamingIdle(page, 240_000);
  const snapshot = () =>
    page.evaluate(() => {
      const api = window.__blockcraft!;
      return { lod: api.getLodStats!(), full: api.getRenderStats().chunksLoaded };
    });
  const disabled = { tiles: 0, pendingJobs: 0, drawSubmissions: 0, fullDetailRadius: 16 };
  const initial = await snapshot();
  console.log('M22b RD16 disabled', JSON.stringify(initial));
  expect(initial).toMatchObject({ lod: disabled, full: 35 ** 2 });
  await page.evaluate(() => window.__blockcraft!.setSetting!('lod', true));
  await waitForLod(page, 16);
  expect((await snapshot()).lod.tiles).toBeGreaterThan(0);
  await page.evaluate(() => window.__blockcraft!.setSetting!('lod', false));
  expect(await snapshot()).toMatchObject({ lod: disabled });
});
