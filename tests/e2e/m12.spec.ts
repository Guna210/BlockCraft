import { test, expect } from '../harness/fixture';
import type { PNG } from 'pngjs';
import { mkdirSync, copyFileSync } from 'node:fs';
import { waitForStreamingIdle } from './helpers/flight';
import { isSkyPixel } from './helpers/sky-holes';
import { diffFraction } from '../harness/pixels';
import { LCG } from '../../src/render/textures/noise';
import {
  generateCloudGrid,
  CLOUD_CELL_SIZE,
  CLOUD_GRID_CELLS,
  CLOUD_Y_BOTTOM,
  CLOUD_Y_TOP,
  CLOUD_WIND_SPEED,
} from '../../src/render/clouds';
import { sunDirection } from '../../src/world/time';

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
    window.__blockcraft!.setClouds!('off');
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

  // 2a. Visual Review: m12-clouds-mountain.png, the same view from the mountain terrace
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.setTimeOfDay!(6000);
    api.look!(0, (25 * Math.PI) / 180);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  await assertAndSaveScreenshot({
    name: 'm12-clouds-mountain',
    milestone: 'M12b',
  });
  saveScreenshotToDocs('m12-clouds-mountain', 'M12b');

  // 2b. Visual Review: m12-clouds-overhead.png at noon, pitch ~25° up, looking along the wind
  // (+X), from a real low land column near spawn (eye around y=70-80)
  const lowEyeY = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    // Open low land: dry land with eye at y~70-80, picking the column whose surroundings
    // (within 16 blocks) rise least above it, so no cliff or canyon wall fills the shot.
    let best: { x: number; z: number; h: number; rise: number } | null = null;
    for (let x = -72; x <= 72; x += 4) {
      for (let z = -72; z <= 72; z += 4) {
        const h = api.getHeight!(x, z);
        if (h < 65 || h > 72) continue;
        let maxH = h;
        for (let dx = -16; dx <= 16; dx += 4) {
          for (let dz = -16; dz <= 16; dz += 4) {
            maxH = Math.max(maxH, api.getHeight!(x + dx, z + dz));
          }
        }
        const rise = maxH - h;
        if (!best || rise < best.rise) best = { x, z, h, rise };
      }
    }
    if (!best) throw new Error('no low land column found near spawn');
    const eyeY = best.h + 2.6;
    api.setTimeOfDay!(6000);
    api.teleport!(best.x + 0.5, eyeY, best.z + 0.5, 0, (25 * Math.PI) / 180);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return eyeY;
  });
  console.log('m12b sea-level eye y:', lowEyeY);
  expect(lowEyeY).toBeGreaterThanOrEqual(67);
  expect(lowEyeY).toBeLessThanOrEqual(80);
  await waitForStreamingIdle(page, 120_000);
  await assertAndSaveScreenshot({
    name: 'm12-clouds-overhead',
    milestone: 'M12b',
  });
  saveScreenshotToDocs('m12-clouds-overhead', 'M12b');

  // 3. Visual Review: m12-sun-glare-noon.png looking up toward the sun at noon with a cloud passing over the sun visibly blocking glare
  // Aim the centre ray exactly at the noon sun from a loaded land column whose ray passes
  // through the middle of a cloud slab (same seeded grid and wind offset as the renderer).
  const sun = sunDirection(6000);
  const sunYaw = Math.atan2(sun[2], sun[0]);
  const sunPitch = Math.asin(sun[1]);
  const grid = generateCloudGrid(12006, CLOUD_GRID_CELLS, CLOUD_GRID_CELLS, 0.35);
  const windOffset = (6000 / 20) * CLOUD_WIND_SPEED;
  const cellAt = (wx: number, wz: number): boolean => {
    const cx = Math.floor((wx - windOffset) / CLOUD_CELL_SIZE);
    const cz = Math.floor(wz / CLOUD_CELL_SIZE);
    const m = (n: number) => ((n % CLOUD_GRID_CELLS) + CLOUD_GRID_CELLS) % CLOUD_GRID_CELLS;
    return grid[m(cz) * CLOUD_GRID_CELLS + m(cx)]!;
  };
  const glareSpot = await page.evaluate(
    ({ sunDir, cands }) => {
      const api = window.__blockcraft!;
      const out: { x: number; z: number; eyeY: number }[] = [];
      for (const c of cands) {
        const h = api.getHeight!(c.x, c.z);
        // Skip canyon floors: nothing within 8 blocks may rise above head height
        let open = true;
        for (let dx = -8; dx <= 8 && open; dx += 4) {
          for (let dz = -8; dz <= 8; dz += 4) {
            if (api.getHeight!(c.x + dx, c.z + dz) > h + 2) {
              open = false;
              break;
            }
          }
        }
        if (open) out.push({ x: c.x, z: c.z, eyeY: h + 2 });
      }
      void sunDir;
      return out;
    },
    {
      sunDir: sun,
      cands: Array.from({ length: 33 * 33 }, (_, i) => ({
        x: -64 + (i % 33) * 4,
        z: -64 + Math.floor(i / 33) * 4,
      })),
    },
  );
  let spot: { x: number; z: number; eyeY: number } | null = null;
  for (const c of glareSpot) {
    // Ray from the camera along the sun direction; require the whole cross-section of the
    // ray through the slab (bottom and top) to sit inside a 3x3 block of active cells.
    const sample = (planeY: number) => {
      const t = (planeY - c.eyeY) / sun[1];
      return [c.x + sun[0] * t, c.z + sun[2] * t] as const;
    };
    const [bx, bz] = sample(CLOUD_Y_BOTTOM);
    const [tx, tz] = sample(CLOUD_Y_TOP);
    let all = true;
    for (const [px, pz] of [
      [bx, bz],
      [tx, tz],
    ] as const) {
      for (let dx = -1; dx <= 1 && all; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (!cellAt(px + dx * CLOUD_CELL_SIZE, pz + dz * CLOUD_CELL_SIZE)) {
            all = false;
            break;
          }
        }
      }
    }
    if (all) {
      spot = c;
      break;
    }
  }
  expect(spot, 'a land column whose sun ray crosses the middle of a cloud').not.toBeNull();
  await page.evaluate(
    async ({ s, yaw, pitch }) => {
      const api = window.__blockcraft!;
      api.setTimeOfDay!(6000);
      api.teleport!(s.x + 0.5, s.eyeY, s.z + 0.5, yaw, pitch);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    },
    { s: spot!, yaw: sunYaw, pitch: sunPitch },
  );

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

  // Comparison: the same view with clouds off shows the unobstructed sun disc and glare (near white)
  await page.evaluate(async () => {
    window.__blockcraft!.setClouds!('off');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const noonClearPng = await assertAndSaveScreenshot({
    name: 'm12-sun-glare-noon-clear',
    milestone: 'M12b',
  });
  const noonClearCenter = regionStats(noonClearPng, {
    x: Math.floor(noonClearPng.width / 2) - 20,
    y: Math.floor(noonClearPng.height / 2) - 20,
    w: 40,
    h: 40,
  });
  console.log('m12b noon glare center (clear sky):', JSON.stringify(noonClearCenter));
  expect(noonClearCenter.luminance).toBeGreaterThan(250);
  await page.evaluate(() => window.__blockcraft!.setClouds!('fancy'));

  // Reposition player back to overlooking west for sunset review
  await page.evaluate(() => {
    const y = window.__blockcraft!.getHeight!(2, 0) + 2;
    window.__blockcraft!.teleport!(2.5, y, 0.5, Math.PI, 0.08);
  });

  // 3. Visual Review: m12-sun-glare-sunset.png looking near sunset showing the disc and warm-tinted clouds
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.setTimeOfDay!(12000);
    api.look!(Math.PI, 0.08);
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

  // 5. Wind drift along +X: read the renderer's actual wind offset from the render stats.
  // tick() also advances world time (sky and sun change), so a pixel diff cannot isolate wind.
  const windBefore = await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return window.__blockcraft!.getRenderStats().cloudWindOffset;
  });
  const beforeDriftPng = await assertAndSaveScreenshot({
    name: 'm12-drift-before',
    milestone: 'M12b',
  });
  const windAfter = await page.evaluate(async () => {
    await window.__blockcraft!.tick!(60); // 3 seconds = 3 blocks drift along +X
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return window.__blockcraft!.getRenderStats().cloudWindOffset;
  });
  const afterDriftPng = await assertAndSaveScreenshot({
    name: 'm12-drift-after',
    milestone: 'M12b',
  });
  console.log('m12b wind offset before/after:', windBefore, windAfter);
  expect(windAfter - windBefore).toBeCloseTo(3 * CLOUD_WIND_SPEED, 1);
  expect(diffFraction(beforeDriftPng, afterDriftPng)).toBeGreaterThan(0.005);
});

test('M12c weather, rain streaks animation, desert climate check, and thunderstorm lightning', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  test.setTimeout(300_000);

  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.setRenderDistance!(4);
    await api.createWorld!({ seed: 'blockcraft-test-seed-42', type: 'default' });
    api.pause!();
    const pos = api.locate!('biome', 'plains', [0, 64, 0]) ?? [0, 80, 0];
    api.teleport!(pos[0] + 0.5, pos[1] + 1.6, pos[2] + 0.5);
    await api.waitForTerrain!(4);
  });
  await waitForStreamingIdle(page, 120_000);

  // Clouds off and the time of day fixed: the only thing that may change between the two frames
  // is the precipitation. A clear-weather control taken the same way proves that.
  const stand = await page.evaluate(() => {
    const api = window.__blockcraft!;
    api.setClouds!('off');
    api.look!(0, 0.2); // Look up slightly into falling rain streaks
    const p = api.getPlayer!().pos;
    return [p[0], p[1], p[2]] as [number, number, number];
  });

  // Each frame is taken from the same camera pose: ticking also runs player physics, which would
  // move the camera and change every pixel of the terrain.
  const framePair = async (state: 'clear' | 'rain', name: string) => {
    const place = async (): Promise<void> => {
      await page.evaluate(async (pos) => {
        const api = window.__blockcraft!;
        api.teleport!(pos[0], pos[1], pos[2], 0, 0.2);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }, stand);
    };
    await page.evaluate((weather) => {
      const api = window.__blockcraft!;
      api.setWeather!(weather);
      api.setTimeOfDay!(6000);
    }, state);
    await place();
    const first = await assertAndSaveScreenshot({ name: `${name}-1`, milestone: 'M12c' });
    // Advance 4 ticks (0.2s of falling rain streaks)
    await page.evaluate(async () => {
      await window.__blockcraft!.tick!(4);
    });
    await place();
    const second = await assertAndSaveScreenshot({ name: `${name}-2`, milestone: 'M12c' });
    return diffFraction(first, second);
  };

  const clearDiff = await framePair('clear', 'm12-clear-control');
  console.log('m12c plains clear-weather control frame diff fraction:', clearDiff);
  expect(clearDiff).toBeLessThan(0.005); // nothing but rain may move between frames

  const rainDiff = await framePair('rain', 'm12-rain-frame');
  console.log('m12c plains rain frame diff fraction:', rainDiff);
  expect(rainDiff).toBeGreaterThan(0.02); // consecutive frames differ by > 2%

  const rainAudio = await page.evaluate(() => window.__blockcraft!.getAudioStats!());
  expect(rainAudio.lastSounds).toContain('weather.rain');

  const plainsStats = await page.evaluate(() => window.__blockcraft!.getRenderStats());
  console.log('m12c plains weather stats:', JSON.stringify(plainsStats.weather));
  expect(plainsStats.weather.state).toBe('rain');
  expect(plainsStats.weather.activeParticles.rain).toBeGreaterThan(0);

  // 2. Desert biome: zero precipitation particles near player (use the stat)
  const desertBiome = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    const pos = api.locate!('biome', 'desert', [0, 64, 0]);
    if (!pos) throw new Error('no desert biome found near the origin');
    // Step into the interior of the located dry biome (desert/badlands) to avoid border particles
    const destX = pos[0];
    const destZ = pos[2] - 50;
    const groundY = (api.getHeight ? api.getHeight(destX, destZ) : pos[1]) || 70;
    api.teleport!(destX + 0.5, groundY + 1.6, destZ + 0.5);
    await api.waitForTerrain!(1);
    return api.getBiome!(destX, destZ);
  });
  expect(desertBiome).toBe('desert');
  await waitForStreamingIdle(page, 120_000);

  const desertStats = await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return window.__blockcraft!.getRenderStats();
  });
  console.log('m12c desert weather stats:', JSON.stringify(desertStats.weather));
  expect(desertStats.weather.activeParticles.rain).toBe(0);
  expect(desertStats.weather.activeParticles.snow).toBe(0);

  // 3. Thunderstorm visual review: docs/screenshots/M12c/m12-storm.png
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    const pos = api.locate!('biome', 'plains', [0, 64, 0]) ?? [0, 80, 0];
    api.setClouds!('fancy'); // the rain step above turned them off
    api.setWeather!('thunder');
    api.setTimeOfDay!(6000);
    // Hover 25 blocks up so a nearer ridge does not hide the strike point behind it.
    api.teleport!(pos[0] + 0.5, pos[1] + 26.6, pos[2] + 0.5);
    await api.waitForTerrain!(4);
    // The first thunder step strikes with seed = the tick it runs on (6001), at the angle of the
    // seeded generator's first value around the player; face that direction, slightly up.
    const strikeSeed = 6001;
    const firstValue = ((Math.imul(strikeSeed, 1664525) + 1013904223) >>> 0) / 4294967296;
    // The bolt spans cloud height (y=192) down to terrain ~30 blocks away.
    api.look!(firstValue * Math.PI * 2, 0.28);
    await api.tick!(1);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });

  await assertAndSaveScreenshot({
    name: 'm12-storm',
    milestone: 'M12c',
  });
  saveScreenshotToDocs('m12-storm', 'M12c');
});
