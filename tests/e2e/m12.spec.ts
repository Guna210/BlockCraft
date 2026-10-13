import { test, expect } from '../harness/fixture';
import type { PNG } from 'pngjs';
import { mkdirSync, copyFileSync } from 'node:fs';
import { waitForStreamingIdle } from './helpers/flight';
import { LCG } from '../../src/render/textures/noise';

function pixelLuminance(png: PNG, x: number, y: number): number {
  const i = (y * png.width + x) * 4;
  const r = png.data[i]!;
  const g = png.data[i + 1]!;
  const b = png.data[i + 2]!;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function rgbToHueLuminance(r: number, g: number, b: number): { hue: number; luminance: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const h = d === 0 ? 0 : max === r ? (g - b) / d : max === g ? 2 + (b - r) / d : 4 + (r - g) / d;
  return {
    hue: (((h * 60) % 360) + 360) % 360,
    luminance: 0.2126 * r + 0.7152 * g + 0.0722 * b,
  };
}

function regionStats(png: PNG, rect: { x: number; y: number; w: number; h: number }) {
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  const count = rect.w * rect.h;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = (y * png.width + x) * 4;
      rSum += png.data[i]!;
      gSum += png.data[i + 1]!;
      bSum += png.data[i + 2]!;
    }
  }
  const r = rSum / count;
  const g = gSum / count;
  const b = bSum / count;
  const { hue, luminance } = rgbToHueLuminance(r, g, b);
  return { r, g, b, hue, luminance };
}

function sampleRandomSkyPixels(png: PNG, topRows: number, sampleCount = 20, seed = 12006) {
  const rng = new LCG(seed);
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  for (let s = 0; s < sampleCount; s++) {
    const x = rng.nextInt(0, png.width - 1);
    const y = rng.nextInt(0, topRows - 1);
    const i = (y * png.width + x) * 4;
    rSum += png.data[i]!;
    gSum += png.data[i + 1]!;
    bSum += png.data[i + 2]!;
  }
  const r = rSum / sampleCount;
  const g = gSum / sampleCount;
  const b = bSum / sampleCount;
  return { r, g, b, ...rgbToHueLuminance(r, g, b) };
}

function countIsolatedStarPixels(png: PNG, maxY: number): number {
  let count = 0;
  for (let y = 1; y < maxY - 1; y++) {
    for (let x = 1; x < png.width - 1; x++) {
      const lum = pixelLuminance(png, x, y);
      if (lum < 80) continue;
      let darkNeighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (pixelLuminance(png, x + dx, y + dy) < 40) {
            darkNeighbors++;
          }
        }
      }
      if (darkNeighbors === 8) {
        count++;
      }
    }
  }
  return count;
}

function saveScreenshotToDocs(name: string): void {
  mkdirSync('docs/screenshots/M12a', { recursive: true });
  copyFileSync(`artifacts/M12a/${name}.png`, `docs/screenshots/M12a/${name}.png`);
}

test('M12a time of day, noon sky, sunset west horizon glow, and midnight stars', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.setRenderDistance!(4);
    await api.createWorld!({ seed: 'blockcraft-test-seed-42', type: 'default' });
    api.pause!();
    await api.waitForTerrain!(4);
  });
  await waitForStreamingIdle(page, 120_000);

  // Position player on a high overlook facing West (-X, yaw = Math.PI) with two torches on the ground ahead
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.setGameMode!('creative');
    let maxH = 64;
    for (let x = -64; x <= 16; x += 2) {
      for (let z = -32; z <= 32; z += 2) {
        const h = api.getHeight!(x, z);
        if (h > maxH) maxH = h;
      }
    }
    const baseY = maxH + 2;
    // Build a small stone/grass overlook terrace at x = 0..8, z = -4..4 so foreground terrain and torches are visible below the horizon
    api.fill!(-10, baseY - 2, -5, 4, baseY - 1, 5, 'stone');
    api.fill!(-10, baseY, -5, 4, baseY, 5, 'grass_block');
    api.setBlock!(-5, baseY + 1, -2, 'torch');
    api.setBlock!(-7, baseY + 1, 2, 'torch');
    api.teleport!(2.5, baseY + 1, 0.5, Math.PI, -0.02);
    await api.waitForTerrain!(4);
  });
  await waitForStreamingIdle(page, 120_000);

  // 1. Noon (6000): top 15% sky region has sky-blue hue [190, 215] and luminance > 150
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.setTimeOfDay!(6000);
    api.look!(Math.PI, -0.02);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });

  const noonPng = await assertAndSaveScreenshot({ name: 'm12-noon-ref', milestone: 'M12a' });
  saveScreenshotToDocs('m12-noon-ref');
  const top15Rows = Math.floor(noonPng.height * 0.15);
  const noonTopRegion = regionStats(noonPng, { x: 0, y: 0, w: noonPng.width, h: top15Rows });
  const noonSamples = sampleRandomSkyPixels(noonPng, top15Rows, 20, 12006);

  console.log('m12a noon', JSON.stringify({ noonTopRegion, noonSamples }));
  expect(noonTopRegion.hue).toBeGreaterThanOrEqual(190);
  expect(noonTopRegion.hue).toBeLessThanOrEqual(215);
  expect(noonTopRegion.luminance).toBeGreaterThan(150);
  expect(noonSamples.hue).toBeGreaterThanOrEqual(190);
  expect(noonSamples.hue).toBeLessThanOrEqual(215);
  expect(noonSamples.luminance).toBeGreaterThan(150);

  // 2. Sunset (12000) looking West (yaw = Math.PI): horizon band (middle 20% vertically) hue in 0..45 deg
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.setTimeOfDay!(12000);
    api.look!(Math.PI, 0.08);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });

  const sunsetPng = await assertAndSaveScreenshot({ name: 'm12-sunset', milestone: 'M12a' });
  saveScreenshotToDocs('m12-sunset');
  const horizonRect = {
    x: 0,
    y: Math.floor(sunsetPng.height * 0.4),
    w: sunsetPng.width,
    h: Math.floor(sunsetPng.height * 0.2),
  };
  const sunsetHorizon = regionStats(sunsetPng, horizonRect);
  console.log('m12a sunset', JSON.stringify({ sunsetHorizon, horizonRect }));
  expect(sunsetHorizon.hue).toBeGreaterThanOrEqual(0);
  expect(sunsetHorizon.hue).toBeLessThanOrEqual(45);

  // 3. Midnight (18000): top 15% luminance < 40, upper third has > 50 isolated bright star pixels
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.setTimeOfDay!(18000);
    api.look!(Math.PI, 0.08);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });

  const midnightPng = await assertAndSaveScreenshot({ name: 'm12-midnight', milestone: 'M12a' });
  saveScreenshotToDocs('m12-midnight');
  const midnightTopRegion = regionStats(midnightPng, {
    x: 0,
    y: 0,
    w: midnightPng.width,
    h: top15Rows,
  });
  const midnightSamples = sampleRandomSkyPixels(midnightPng, top15Rows, 20, 12018);
  const upperThirdRows = Math.floor(midnightPng.height / 3);
  const isolatedStars = countIsolatedStarPixels(midnightPng, upperThirdRows);

  console.log(
    'm12a midnight',
    JSON.stringify({ midnightTopRegion, midnightSamples, isolatedStars }),
  );
  expect(midnightTopRegion.luminance).toBeLessThan(40);
  expect(midnightSamples.luminance).toBeLessThan(40);
  expect(isolatedStars).toBeGreaterThan(50);

  // 4. Moon billboard phases: look directly toward the moon at midnight on day 0 (full moon) vs day 4 (new moon)
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.setTimeOfDay!(18000); // Day 0, phase 0 (full moon)
    api.look!(Math.PI / 2, (75 * Math.PI) / 180);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const fullMoonPng = await assertAndSaveScreenshot({
    name: 'm12-moon-phase0',
    milestone: 'M12a',
  });
  const centerRect = {
    x: Math.floor(fullMoonPng.width / 2) - 16,
    y: Math.floor(fullMoonPng.height / 2) - 16,
    w: 32,
    h: 32,
  };
  const fullMoonCenter = regionStats(fullMoonPng, centerRect);

  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.setTimeOfDay!(4 * 24000 + 18000); // Day 4, phase 4 (new moon)
    api.look!(Math.PI / 2, (75 * Math.PI) / 180);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const newMoonPng = await assertAndSaveScreenshot({
    name: 'm12-moon-phase4',
    milestone: 'M12a',
  });
  const newMoonCenter = regionStats(newMoonPng, centerRect);
  console.log('m12a moon phases', JSON.stringify({ fullMoonCenter, newMoonCenter }));
  expect(fullMoonCenter.luminance).toBeGreaterThan(150);
  expect(newMoonCenter.luminance).toBeLessThan(80);
  expect(fullMoonCenter.luminance - newMoonCenter.luminance).toBeGreaterThan(90);

  // 5. Verify debug.tick(n) advances worldTime deterministically from midnight (18000) to noon (6000 next day)
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.look!(Math.PI, 0.08);
    await api.tick!(12000);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const nextDayNoonPng = await assertAndSaveScreenshot({
    name: 'm12-next-noon-check',
    milestone: 'M12a',
  });
  const nextDayNoonTop = regionStats(nextDayNoonPng, {
    x: 0,
    y: 0,
    w: nextDayNoonPng.width,
    h: top15Rows,
  });
  expect(nextDayNoonTop.luminance).toBeGreaterThan(150);
  expect(nextDayNoonTop.hue).toBeGreaterThanOrEqual(190);
  expect(nextDayNoonTop.hue).toBeLessThanOrEqual(215);
});
