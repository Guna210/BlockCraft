import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import type { Page } from '@playwright/test';
import { test, expect } from '../harness/fixture';
import { assertNotBlank, assertNoMissingTexture, diffFraction } from '../harness/pixels';
import { waitForStreamingIdle } from './helpers/flight';

const MILESTONE = 'M22c';

async function waitSettledFrames(page: Page, count = 2): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.__blockcraft!.getStreamingStats!().columnsFading), {
      timeout: 30_000,
    })
    .toBe(0);
  await page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        const step = (left: number) => {
          if (left <= 0) resolve();
          else requestAnimationFrame(() => step(left - 1));
        };
        step(n);
      }),
    count,
  );
}

async function projectPoint(
  page: Page,
  yaw: number,
  pitch: number,
  point: [number, number, number],
  size: { width: number; height: number },
): Promise<{ x: number; y: number }> {
  const { eye, fov } = await page.evaluate(() => {
    const stats = window.__blockcraft!.getRenderStats();
    return { eye: stats.cameraPosition, fov: stats.cameraFov };
  });
  const fwd = [Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw)];
  const right = [-Math.sin(yaw), 0, Math.cos(yaw)];
  const up = [
    right[1]! * fwd[2]! - right[2]! * fwd[1]!,
    right[2]! * fwd[0]! - right[0]! * fwd[2]!,
    right[0]! * fwd[1]! - right[1]! * fwd[0]!,
  ];
  const d = [point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]];
  const dot = (u: number[], v: number[]) => u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!;
  const depth = dot(d, fwd);
  const tanHalf = Math.tan((fov * Math.PI) / 360);
  const aspect = size.width / size.height;
  return {
    x: size.width / 2 + (dot(d, right) / (depth * tanHalf * aspect)) * (size.width / 2),
    y: size.height / 2 - (dot(d, up) / (depth * tanHalf)) * (size.height / 2),
  };
}

function patchMeanLuma(png: PNG, cx: number, cy: number, radius = 3): number {
  const x0 = Math.max(0, Math.round(cx) - radius);
  const x1 = Math.min(png.width - 1, Math.round(cx) + radius);
  const y0 = Math.max(0, Math.round(cy) - radius);
  const y1 = Math.min(png.height - 1, Math.round(cy) + radius);
  let sum = 0;
  let count = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const idx = (y * png.width + x) * 4;
      const r = png.data[idx] ?? 0;
      const g = png.data[idx + 1] ?? 0;
      const b = png.data[idx + 2] ?? 0;
      sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

function regionMeanDiff(a: PNG, b: PNG, x0: number, y0: number, x1: number, y1: number): number {
  let sum = 0;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (y * a.width + x) * 4;
      sum +=
        (Math.abs((a.data[idx] ?? 0) - (b.data[idx] ?? 0)) +
          Math.abs((a.data[idx + 1] ?? 0) - (b.data[idx + 1] ?? 0)) +
          Math.abs((a.data[idx + 2] ?? 0) - (b.data[idx + 2] ?? 0))) /
        (3 * 255);
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

test.describe('M22c post-processing', () => {
  test('defaults render bit-identical before and after toggling all three effects on and back off', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.evaluate(async () => {
      const a = window.__blockcraft!;
      await a.createWorld!({
        name: 'm22c-roundtrip',
        mode: 'creative',
        type: 'flat',
        seed: 'blockcraft-test-seed-42',
        spawning: false,
      });
      a.pause!();
      a.setRenderDistance!(4);
      a.setClouds!('off');
      a.setTimeOfDay!(6000);
      a.setFluidAnimationPaused!(true);
      a.teleport!(0.5, 67, 0.5, 0.4, -0.15);
      await a.tick!(0);
      await a.waitForTerrain!(4);
    });
    await waitForStreamingIdle(page, 60_000);
    await waitSettledFrames(page, 3);

    const initialSettings = await page.evaluate(() => window.__blockcraft!.getSettings!());
    expect(initialSettings).toMatchObject({ fxaa: false, bloom: false, godRays: false });
    const initialStats = await page.evaluate(() => window.__blockcraft!.getPostFx!());
    expect(initialStats.enabled).toBe(false);
    expect(initialStats.passes).toEqual([]);
    expect(initialStats.targetSize).toEqual([0, 0]);

    const baseline = PNG.sync.read(await page.locator('#game-canvas').screenshot());
    assertNotBlank(baseline);

    await page.evaluate(() => {
      const a = window.__blockcraft!;
      a.setSetting!('fxaa', true);
      a.setSetting!('bloom', true);
      a.setSetting!('godRays', true);
    });
    await waitSettledFrames(page, 2);
    const activeStats = await page.evaluate(() => window.__blockcraft!.getPostFx!());
    expect(activeStats.enabled).toBe(true);
    expect(activeStats.passes).toEqual(['bloom', 'godRays', 'fxaa']);
    expect(activeStats.targetSize[0]).toBeGreaterThan(0);

    await page.evaluate(() => {
      const a = window.__blockcraft!;
      a.setSetting!('fxaa', false);
      a.setSetting!('bloom', false);
      a.setSetting!('godRays', false);
    });
    await waitSettledFrames(page, 2);
    const restoredStats = await page.evaluate(() => window.__blockcraft!.getPostFx!());
    expect(restoredStats.enabled).toBe(false);
    expect(restoredStats.passes).toEqual([]);

    const restored = PNG.sync.read(await page.locator('#game-canvas').screenshot());
    expect(diffFraction(baseline, restored)).toBe(0);
  });

  test('each toggle changes the frame and keeps FluidDepth water absorption intact', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.evaluate(async () => {
      const a = window.__blockcraft!;
      await a.createWorld!({
        name: 'm22c-each-toggle',
        mode: 'creative',
        type: 'flat',
        seed: 'blockcraft-test-seed-42',
        spawning: false,
      });
      a.pause!();
      a.setRenderDistance!(4);
      a.setClouds!('off');
      a.setTimeOfDay!(1200);
      a.setFluidAnimationPaused!(true);

      // Clear staging area east of spawn.
      a.fill!(4, 65, -10, 22, 78, 10, 'air');
      // Shallow 1-block pool over bright sand (z = -4..-1) and deep 7-block pool over stone (z = 1..4).
      a.fill!(12, 63, -4, 18, 63, -1, 'sand');
      a.fill!(12, 64, -4, 18, 64, -1, 'water');
      a.fill!(12, 57, 1, 18, 57, 4, 'stone');
      a.fill!(12, 58, 1, 18, 64, 4, 'water');
      // Silhouette arch & emissive lumite pillar for edges, bloom, and god rays.
      a.fill!(19, 65, -5, 19, 73, -3, 'stone');
      a.fill!(19, 65, 3, 19, 73, 5, 'stone');
      a.fill!(19, 72, -3, 19, 73, 3, 'stone');
      a.setBlock!(14, 65, -5, 'lumite_block');
      a.setBlock!(14, 66, -5, 'lumite_block');

      a.teleport!(6.0, 67.0, 0.0, 0.05, -0.15);
      await a.tick!(0);
      await a.waitForTerrain!(4);
    });
    await waitForStreamingIdle(page, 60_000);
    await waitSettledFrames(page, 2);

    const canvas = page.locator('#game-canvas');
    const offPng = PNG.sync.read(await canvas.screenshot());
    assertNotBlank(offPng);
    assertNoMissingTexture(offPng);

    const shallowPt = await projectPoint(page, 0.05, -0.15, [15.0, 64.9, -2.5], offPng);
    const deepPt = await projectPoint(page, 0.05, -0.15, [15.0, 64.9, 2.5], offPng);

    expect(patchMeanLuma(offPng, shallowPt.x, shallowPt.y, 4)).toBeGreaterThan(
      patchMeanLuma(offPng, deepPt.x, deepPt.y, 4) + 10,
    );

    // 1. FXAA only: smooths staircase edges (expected > 0.2% changed pixels) and preserves water depth.
    await page.evaluate(() => window.__blockcraft!.setSetting!('fxaa', true));
    await waitSettledFrames(page, 2);
    const fxaaPng = PNG.sync.read(await canvas.screenshot());
    expect(diffFraction(offPng, fxaaPng)).toBeGreaterThan(0.002);
    expect(patchMeanLuma(fxaaPng, shallowPt.x, shallowPt.y, 4)).toBeGreaterThan(
      patchMeanLuma(fxaaPng, deepPt.x, deepPt.y, 4) + 10,
    );

    // 2. Bloom only: emits soft halo around lumite_block (expected > 0.1% changed pixels) and preserves water depth.
    await page.evaluate(() => {
      const a = window.__blockcraft!;
      a.setSetting!('fxaa', false);
      a.setSetting!('bloom', true);
    });
    await waitSettledFrames(page, 2);
    const bloomPng = PNG.sync.read(await canvas.screenshot());
    expect(diffFraction(offPng, bloomPng)).toBeGreaterThan(0.001);
    expect(patchMeanLuma(bloomPng, shallowPt.x, shallowPt.y, 4)).toBeGreaterThan(
      patchMeanLuma(bloomPng, deepPt.x, deepPt.y, 4) + 10,
    );

    // 3. God rays only: casts shafts from the morning sun (expected > 0.5% changed pixels) and preserves water depth.
    await page.evaluate(() => {
      const a = window.__blockcraft!;
      a.setSetting!('bloom', false);
      a.setSetting!('godRays', true);
    });
    await waitSettledFrames(page, 2);
    const godRaysPng = PNG.sync.read(await canvas.screenshot());
    expect(diffFraction(offPng, godRaysPng)).toBeGreaterThan(0.005);
    expect(patchMeanLuma(godRaysPng, shallowPt.x, shallowPt.y, 4)).toBeGreaterThan(
      patchMeanLuma(godRaysPng, deepPt.x, deepPt.y, 4) + 10,
    );
    const grStats = await page.evaluate(() => window.__blockcraft!.getPostFx!());
    expect(grStats.passes).toEqual(['godRays']);
  });

  test('live UI toggles work without reload or remesh and handle resize, underwater, and night', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.evaluate(async () => {
      const a = window.__blockcraft!;
      await a.createWorld!({
        name: 'm22c-ui-resize',
        mode: 'creative',
        type: 'flat',
        seed: 'blockcraft-test-seed-42',
        spawning: false,
      });
      a.pause!();
      a.setRenderDistance!(4);
      a.setTimeOfDay!(1200);
      a.setFluidAnimationPaused!(true);
      a.fill!(4, 60, -2, 8, 65, 2, 'water');
      await a.tick!(0);
      await a.waitForTerrain!(4);
      a.resume!();
    });
    await waitForStreamingIdle(page, 60_000);

    // Let any corner-column eviction from setRenderDistance(4) complete while ticking before pausing.
    let stableCount = 0;
    let prevMeshed = -1;
    await expect
      .poll(
        async () => {
          const cur = await page.evaluate(() => window.__blockcraft!.getRenderStats().chunksMeshed);
          stableCount = cur === prevMeshed ? stableCount + 1 : 0;
          prevMeshed = cur;
          return stableCount;
        },
        { timeout: 30_000, intervals: [150] },
      )
      .toBeGreaterThanOrEqual(3);

    const beforeMeshed = await page.evaluate(() => {
      window.__blockcraft!.pause!();
      window.__blockcraft!.resetSectionWorkSamples!();
      return window.__blockcraft!.getRenderStats().chunksMeshed;
    });

    // Toggle all three live through the Settings screen UI.
    await page.keyboard.press('Escape');
    await expect
      .poll(() => page.evaluate(() => window.__blockcraft!.getScreen!().name))
      .toBe('pause');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.locator('#settings-screen')).toBeVisible();

    await page.getByRole('button', { name: /FXAA/ }).click();
    await page.getByRole('button', { name: /Bloom/ }).click();
    await page.getByRole('button', { name: /God rays/ }).click();

    await page.getByRole('button', { name: 'Done' }).click();
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__blockcraft!.pause!());
    await waitSettledFrames(page, 2);

    const liveSettings = await page.evaluate(() => window.__blockcraft!.getSettings!());
    expect(liveSettings).toMatchObject({ fxaa: true, bloom: true, godRays: true });
    const afterStats = await page.evaluate(() => ({
      chunksMeshed: window.__blockcraft!.getRenderStats().chunksMeshed,
      sectionWorkSamples: window.__blockcraft!.getWorkerStats!().sectionWorkSamples,
    }));
    expect(afterStats.chunksMeshed).toBe(beforeMeshed);
    expect(afterStats.sectionWorkSamples).toBe(0);

    const statsBeforeResize = await page.evaluate(() => window.__blockcraft!.getPostFx!());
    expect(statsBeforeResize.enabled).toBe(true);
    expect(statsBeforeResize.passes).toEqual(['bloom', 'godRays', 'fxaa']);
    expect(statsBeforeResize.targetSize).toEqual([1280, 720]);

    // Resize updates the offscreen render targets cleanly with zero GL/console errors.
    await page.setViewportSize({ width: 960, height: 540 });
    await waitSettledFrames(page, 3);
    const resizedStats = await page.evaluate(() => window.__blockcraft!.getPostFx!());
    expect(resizedStats.targetSize).toEqual([960, 540]);

    await page.setViewportSize({ width: 1280, height: 720 });
    await waitSettledFrames(page, 3);
    const restoredSizeStats = await page.evaluate(() => window.__blockcraft!.getPostFx!());
    expect(restoredSizeStats.targetSize).toEqual([1280, 720]);

    // Underwater disables god rays cleanly while keeping post-processing error-free.
    await page.evaluate(async () => {
      const a = window.__blockcraft!;
      a.teleport!(6.5, 62.5, 0.5, 0, 0);
      await a.tick!(0);
    });
    await waitSettledFrames(page, 2);
    const underwaterCheck = await page.evaluate(() => ({
      underwater: window.__blockcraft!.getRenderStats().underwater,
      postfx: window.__blockcraft!.getPostFx!(),
    }));
    expect(underwaterCheck.underwater).toBe(true);
    expect(underwaterCheck.postfx.passMs.godRays).toBe(0);

    // Night disables god rays cleanly above water too.
    await page.evaluate(async () => {
      const a = window.__blockcraft!;
      a.teleport!(0.5, 67, 0.5, 0, 0);
      a.setTimeOfDay!(18000);
      await a.tick!(0);
    });
    await waitSettledFrames(page, 2);
    const nightStats = await page.evaluate(() => window.__blockcraft!.getPostFx!());
    expect(nightStats.passMs.godRays).toBe(0);
  });

  test('bloom brightens pixels adjacent to lumite without blooming sunlit sand and saves visual screenshots', async ({
    page,
    assertAndSaveScreenshot,
  }) => {
    test.setTimeout(240_000);
    await page.evaluate(async () => {
      const a = window.__blockcraft!;
      await a.createWorld!({
        name: 'm22c-visuals',
        mode: 'creative',
        type: 'flat',
        seed: 'blockcraft-test-seed-42',
        spawning: false,
      });
      a.pause!();
      a.setRenderDistance!(4);
      a.setClouds!('off');
      a.setTimeOfDay!(18000);
      a.setFluidAnimationPaused!(true);

      // Night cavern courtyard with lumite blocks and a recessed lava pool on dark stone.
      a.fill!(2, 63, -7, 14, 75, 7, 'stone');
      a.fill!(3, 65, -6, 12, 73, 6, 'air');
      a.fill!(4, 64, -5, 11, 64, 5, 'stone');
      // Recessed lava pool on the right.
      a.fill!(8, 64, 1, 10, 64, 3, 'lava');
      // Lumite pillar on the left, standing in front of dark unlit stone wall (x = 13).
      a.fill!(9, 65, -2, 9, 67, -1, 'lumite_block');

      a.teleport!(3.5, 67.2, 0.5, 0.0, -0.14);
      await a.tick!(0);
      await a.waitForTerrain!(4);
    });
    await waitForStreamingIdle(page, 60_000);
    await waitSettledFrames(page, 2);

    const reviewDir = path.resolve('docs/screenshots/M22c');
    fs.mkdirSync(reviewDir, { recursive: true });

    const bloomOff = await assertAndSaveScreenshot({ milestone: MILESTONE, name: 'm22-bloom-off' });
    assertNotBlank(bloomOff);
    assertNoMissingTexture(bloomOff);

    await page.evaluate(() => window.__blockcraft!.setSetting!('bloom', true));
    await waitSettledFrames(page, 2);

    const bloomOn = await assertAndSaveScreenshot({ milestone: MILESTONE, name: 'm22-bloom' });
    assertNotBlank(bloomOn);
    assertNoMissingTexture(bloomOn);

    fs.copyFileSync(
      path.resolve(`artifacts/${MILESTONE}/m22-bloom-off.png`),
      path.join(reviewDir, 'm22-bloom-off.png'),
    );
    fs.copyFileSync(
      path.resolve(`artifacts/${MILESTONE}/m22-bloom.png`),
      path.join(reviewDir, 'm22-bloom.png'),
    );

    // Sample dark stone wall pixel 7px above the top edge of the lumite pillar (inside its glow halo).
    const lumiteEdgePt = await projectPoint(page, 0.0, -0.14, [9.0, 68.0, -1.0], bloomOff);
    const lumaOff = patchMeanLuma(bloomOff, lumiteEdgePt.x, lumiteEdgePt.y - 7, 3);
    const lumaOn = patchMeanLuma(bloomOn, lumiteEdgePt.x, lumiteEdgePt.y - 7, 3);
    expect(lumaOn).toBeGreaterThan(lumaOff + 2.0);

    // Non-emissive sunlit sand & snow terrace at noon should change negligibly (< 0.005).
    await page.evaluate(async () => {
      const a = window.__blockcraft!;
      a.setTimeOfDay!(6000);
      a.setSetting!('bloom', false);
      a.fill!(-12, 64, -12, 0, 64, 12, 'sand');
      a.fill!(-12, 65, -12, 0, 72, 12, 'air');
      a.fill!(-10, 64, -4, -6, 64, 0, 'snow');
      a.teleport!(-4.0, 67.5, -1.0, Math.PI, -0.55);
      await a.tick!(0);
      await a.waitForTerrain!(2);
    });
    await waitSettledFrames(page, 2);
    const sandOff = PNG.sync.read(await page.locator('#game-canvas').screenshot());

    await page.evaluate(() => window.__blockcraft!.setSetting!('bloom', true));
    await waitSettledFrames(page, 2);
    const sandOn = PNG.sync.read(await page.locator('#game-canvas').screenshot());

    const sandMeanDiff = regionMeanDiff(
      sandOff,
      sandOn,
      Math.floor(sandOff.width * 0.25),
      Math.floor(sandOff.height * 0.25),
      Math.floor(sandOff.width * 0.75),
      Math.floor(sandOff.height * 0.55),
    );
    expect(sandMeanDiff).toBeLessThan(0.005);

    // Capture m22-godrays.png facing the rising morning sun behind an open stone/leaf colonnade.
    await page.evaluate(async () => {
      const a = window.__blockcraft!;
      a.setSetting!('bloom', false);
      a.setSetting!('godRays', true);
      a.setSetting!('fxaa', true);
      a.setClouds!('fancy');
      a.setTimeOfDay!(1200);
      a.fill!(2, 65, -12, 22, 78, 12, 'air');
      a.fill!(2, 64, -12, 22, 64, 12, 'grass_block');
      a.fill!(6, 64, -4, 11, 64, 4, 'water');
      // Colonnade pillars & lintel partially occluding the morning sun disk.
      a.fill!(16, 65, -4, 16, 73, -4, 'oak_log');
      a.fill!(16, 65, 0, 16, 72, 0, 'oak_log');
      a.fill!(16, 65, 4, 16, 73, 4, 'oak_log');
      a.fill!(16, 71, -4, 16, 72, 4, 'oak_leaves');
      a.teleport!(3.0, 66.8, -0.5, 0.08, 0.22);
      await a.tick!(0);
      await a.waitForTerrain!(2);
    });
    await waitSettledFrames(page, 2);

    const godRaysShot = await assertAndSaveScreenshot({
      milestone: MILESTONE,
      name: 'm22-godrays',
    });
    assertNotBlank(godRaysShot);
    assertNoMissingTexture(godRaysShot);
    fs.copyFileSync(
      path.resolve(`artifacts/${MILESTONE}/m22-godrays.png`),
      path.join(reviewDir, 'm22-godrays.png'),
    );
  });

  test('LOD at RD16 with bloom on does not brighten distant LOD terrain and emits zero GL errors', async ({
    page,
  }) => {
    test.setTimeout(600_000);
    await page.evaluate(async () => {
      const a = window.__blockcraft!;
      a.setRenderDistance!(12);
      await a.createWorld!({
        name: 'm22c-lod-bloom',
        seed: 'blockcraft-test-seed-42',
        mode: 'creative',
        type: 'default',
        spawning: false,
      });
      a.pause!();
      a.setTimeOfDay!(6000);
      a.setWeather!('clear');
      a.setClouds!('off');
      a.setFluidAnimationPaused!(true);
    });
    await waitForStreamingIdle(page, 240_000);
    await page.evaluate(() => {
      const a = window.__blockcraft!;
      const [x, y, z] = a.getPlayer!().pos;
      const eyeOffset = a.getRenderStats().cameraPosition[1] - y;
      let top = 0;
      for (let dx = -144; dx <= 144; dx += 8) {
        for (let dz = -144; dz <= 144; dz += 8) top = Math.max(top, a.getHeight!(x + dx, z + dz));
      }
      a.teleport!(x, top + 40 - eyeOffset, z, 0, -Math.PI / 10);
      a.setSetting!('lod', true);
      a.setRenderDistance!(16);
    });
    await expect
      .poll(() => page.evaluate(() => window.__blockcraft!.getLodStats!().coverageRadius), {
        timeout: 240_000,
      })
      .toBe(16);
    await waitSettledFrames(page, 3);

    const lodStats = await page.evaluate(() => window.__blockcraft!.getLodStats!());
    expect(lodStats.visibleTiles).toBeGreaterThan(0);

    const lodBloomOff = PNG.sync.read(await page.screenshot());
    assertNotBlank(lodBloomOff);
    assertNoMissingTexture(lodBloomOff);

    await page.evaluate(() => window.__blockcraft!.setSetting!('bloom', true));
    await waitSettledFrames(page, 3);

    const postFxStats = await page.evaluate(() => window.__blockcraft!.getPostFx!());
    expect(postFxStats.enabled).toBe(true);
    expect(postFxStats.passes).toEqual(['bloom']);

    const lodBloomOn = PNG.sync.read(await page.screenshot());
    assertNotBlank(lodBloomOn);
    assertNoMissingTexture(lodBloomOn);

    // Distant LOD terrain band (between upper sky and near foreground) must not brighten under bloom.
    const distantDiff = regionMeanDiff(
      lodBloomOff,
      lodBloomOn,
      Math.floor(lodBloomOff.width * 0.15),
      Math.floor(lodBloomOff.height * 0.2),
      Math.floor(lodBloomOff.width * 0.85),
      Math.floor(lodBloomOff.height * 0.55),
    );
    expect(distantDiff).toBeLessThan(0.005);
  });
});
