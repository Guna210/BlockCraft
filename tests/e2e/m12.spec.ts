import { test, expect } from '../harness/fixture';
import type { PNG } from 'pngjs';
import { mkdirSync, copyFileSync } from 'node:fs';
import { waitForStreamingIdle } from './helpers/flight';
import { isSkyPixel } from './helpers/sky-holes';
import { diffFraction } from '../harness/pixels';
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

function saveScreenshotToDocs(name: string, milestone = 'M12a'): void {
  mkdirSync(`docs/screenshots/${milestone}`, { recursive: true });
  copyFileSync(`artifacts/${milestone}/${name}.png`, `docs/screenshots/${milestone}/${name}.png`);
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

test('M12a-fix RD8 noon and tick 10000 sky remain detectable above the fog edge', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    window.__blockcraft!.setClouds!('off');
    api.setRenderDistance!(8);
    await api.createWorld!({ seed: 'blockcraft-test-seed-42', type: 'default' });
    api.pause!();
    api.setGameMode!('creative');
    await api.waitForTerrain!(8);
    let top = 64;
    for (let x = -112; x <= 112; x += 8) {
      for (let z = -112; z <= 112; z += 8) top = Math.max(top, api.getHeight!(x, z));
    }
    // A horizontal overlook keeps the top quarter pure sky and shows the RD8 fog edge.
    api.teleport!(0.5, top + 12, 0.5, 0, 0);
    await api.waitForTerrain!(8);
  });
  await waitForStreamingIdle(page, 120_000);
  for (const ticks of [6000, 10000]) {
    await page.evaluate(async (time) => {
      window.__blockcraft!.setTimeOfDay!(time);
      window.__blockcraft!.look!(0, 0);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }, ticks);
    const name = ticks === 6000 ? 'm12a-fix-sky-noon' : 'm12a-fix-sky-10000';
    const png = await assertAndSaveScreenshot({ name, milestone: 'M12a-fix' });
    const rows = Math.floor(png.height / 4);
    let sky = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < png.width; x++) {
        if (isSkyPixel(png, x, y)) sky++;
      }
    }
    const fraction = sky / (rows * png.width);
    console.log(
      'm12a-fix real sky coverage',
      JSON.stringify({ ticks, sky, total: rows * png.width, fraction }),
    );
    expect(fraction, `pure sky classified at worldTime ${ticks}, RD8`).toBeGreaterThanOrEqual(0.98);
  }
  // Use a lower view for the visual review: the pure-sky overlook above hides
  // foreground terrain below the screen, so it cannot demonstrate the fog edge.
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    let localTop = 64;
    for (let x = -24; x <= 24; x += 4) {
      for (let z = -24; z <= 24; z += 4) localTop = Math.max(localTop, api.getHeight!(x, z));
    }
    api.setTimeOfDay!(6000);
    api.teleport!(0.5, localTop + 12, 0.5, 0, (-20 * Math.PI) / 180);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  await assertAndSaveScreenshot({ name: 'm12a-fix-fog-edge', milestone: 'M12a-fix' });
});

test('M12b clouds: extruded 3D volumes, fast 2D plane, wind drift, and sun glare', async ({
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

  // Set up player on overlook terrace
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
    api.fill!(-10, baseY - 2, -5, 4, baseY - 1, 5, 'stone');
    api.fill!(-10, baseY, -5, 4, baseY, 5, 'grass_block');
    api.setBlock!(-5, baseY + 1, -2, 'torch');
    api.setBlock!(-7, baseY + 1, 2, 'torch');
    api.teleport!(2.5, baseY + 1, 0.5, Math.PI, 0.12);
    await api.waitForTerrain!(4);
  });
  await waitForStreamingIdle(page, 120_000);

  // 1. Visual Review: m12-noon.png with clouds clearly visible in the sky at noon
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.setTimeOfDay!(6000);
    api.look!(Math.PI, 0.12);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });

  const noonCloudsPng = await assertAndSaveScreenshot({ name: 'm12-noon', milestone: 'M12b' });
  saveScreenshotToDocs('m12-noon', 'M12b');

  // Verify clouds are rendered: check that there are cloud pixels in the upper sky (neutral white/shaded, b - r < 60 and r > 160, distinct from sky-blue b - r > 110)
  const upperRows = Math.floor(noonCloudsPng.height * 0.4);
  let cloudPixels = 0;
  for (let y = 0; y < upperRows; y++) {
    for (let x = 0; x < noonCloudsPng.width; x++) {
      const i = (y * noonCloudsPng.width + x) * 4;
      const r = noonCloudsPng.data[i]!;
      const b = noonCloudsPng.data[i + 2]!;
      if (r > 160 && b - r < 60) cloudPixels++;
    }
  }
  console.log('m12b noon clouds cloudPixels:', cloudPixels);
  expect(cloudPixels).toBeGreaterThan(500);

  // 2. Visual Review: m12-clouds-overhead.png at noon, pitch ~25° up, from high ground (camera well below y=192)
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.setTimeOfDay!(6000);
    api.look!(Math.PI, (25 * Math.PI) / 180);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  await assertAndSaveScreenshot({
    name: 'm12-clouds-overhead',
    milestone: 'M12b',
  });
  saveScreenshotToDocs('m12-clouds-overhead', 'M12b');

  // 3. Visual Review: m12-sun-glare-noon.png looking up toward the sun at noon with a cloud passing over the sun visibly blocking glare
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.setTimeOfDay!(6000);
    // Position at x = -5 on terrace so cloud cell (cx=6, cz=2) is directly between camera and sun
    const y = api.getHeight!(-5, 0) + 2;
    api.teleport!(-5.0, y, 0.5, Math.PI / 2, (75 * Math.PI) / 180);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });

  const noonGlarePng = await assertAndSaveScreenshot({
    name: 'm12-sun-glare-noon',
    milestone: 'M12b',
  });
  saveScreenshotToDocs('m12-sun-glare-noon', 'M12b');

  // Verify that the opaque cloud blocks the sun disc and intense glare behind it:
  // The center region covered by the cloud underside is pale blue-grey (luminance < 235), not saturated white (>250)
  const noonGlareCenter = regionStats(noonGlarePng, {
    x: Math.floor(noonGlarePng.width / 2) - 20,
    y: Math.floor(noonGlarePng.height / 2) - 20,
    w: 40,
    h: 40,
  });
  console.log('m12b noon glare center (blocked by cloud):', JSON.stringify(noonGlareCenter));
  expect(noonGlareCenter.luminance).toBeLessThan(235);
  expect(noonGlareCenter.luminance).toBeGreaterThan(150);

  // Reposition player back to overlooking west for sunset review
  await page.evaluate(() => {
    const y = window.__blockcraft!.getHeight!(2, 0) + 2;
    window.__blockcraft!.teleport!(2.5, y, 0.5, Math.PI, 0.05);
  });

  // 3. Visual Review: m12-sun-glare-sunset.png looking near sunset showing the disc
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.setTimeOfDay!(12000);
    api.look!(Math.PI, 0.05);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });

  const sunsetGlarePng = await assertAndSaveScreenshot({
    name: 'm12-sun-glare-sunset',
    milestone: 'M12b',
  });
  saveScreenshotToDocs('m12-sun-glare-sunset', 'M12b');

  // Warm horizon hue at sunset
  const sunsetHorizon = regionStats(sunsetGlarePng, {
    x: 0,
    y: Math.floor(sunsetGlarePng.height * 0.4),
    w: sunsetGlarePng.width,
    h: Math.floor(sunsetGlarePng.height * 0.2),
  });
  console.log('m12b sunset glare horizon:', JSON.stringify(sunsetHorizon));
  expect(sunsetHorizon.hue).toBeGreaterThanOrEqual(0);
  expect(sunsetHorizon.hue).toBeLessThanOrEqual(45);

  // Center region of sunset sun disc has distinct pixel art values (not washed out to solid white)
  const sunsetDiscCenter = regionStats(sunsetGlarePng, {
    x: Math.floor(sunsetGlarePng.width / 2) - 10,
    y: Math.floor(sunsetGlarePng.height / 2) - 10,
    w: 20,
    h: 20,
  });
  console.log('m12b sunset disc center:', JSON.stringify(sunsetDiscCenter));
  expect(sunsetDiscCenter.luminance).toBeLessThan(235);
  expect(sunsetDiscCenter.r).toBeGreaterThan(180);

  // 4. Cloud modes: fast 2D option vs fancy 3D volumes vs off
  const fancyStats = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.setClouds!('fancy');
    api.look!(0, 0.35);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return api.getRenderStats();
  });

  const fastStats = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.setClouds!('fast');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return api.getRenderStats();
  });

  const offStats = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.setClouds!('off');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return api.getRenderStats();
  });

  console.log(
    'm12b cloud stats:',
    JSON.stringify({
      fancyTriangles: fancyStats.triangles,
      fastTriangles: fastStats.triangles,
      offTriangles: offStats.triangles,
    }),
  );
  expect(fancyStats.triangles).toBeGreaterThan(fastStats.triangles);
  expect(fastStats.triangles).toBeGreaterThan(offStats.triangles);

  // Restore fancy mode
  await page.evaluate(() => {
    window.__blockcraft!.setClouds!('fancy');
  });

  // 5. Wind drift along +X
  const beforeDriftPng = await assertAndSaveScreenshot({
    name: 'm12-drift-before',
    milestone: 'M12b',
  });
  await page.evaluate(async () => {
    await window.__blockcraft!.tick!(60); // 3 seconds = 3 blocks drift along +X
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const afterDriftPng = await assertAndSaveScreenshot({
    name: 'm12-drift-after',
    milestone: 'M12b',
  });
  const diff = diffFraction(beforeDriftPng, afterDriftPng);
  console.log('m12b wind drift diff fraction:', diff);
  expect(diff).toBeGreaterThan(0.005);
});
