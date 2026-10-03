import { test, expect } from '../harness/fixture';
import {
  assertNoMissingTexture,
  assertNotBlank,
  regionMeanColor,
  assertHueInRange,
  Rect,
} from '../harness/pixels';
import { PNG } from 'pngjs';
import type { Page } from '@playwright/test';

interface WorldManagerHandle {
  camera: { position: Float32Array; yaw: number; pitch: number; updateView(): void };
  pendingTerrainPromises: Map<string, unknown>;
  generateColumnMainThread(cx: number, cz: number): void;
}

declare global {
  interface Window {
    WorldManager?: { getInstance(): WorldManagerHandle };
  }
}

interface HeldFrames {
  __rafNative: (cb: FrameRequestCallback) => number;
  __rafQueue: FrameRequestCallback[];
}

/**
 * Stops the game's requestAnimationFrame loop until renderFrames() is called. Under SwiftShader
 * every frame that draws the freshly uploaded terrain takes seconds of main-thread time, which
 * starves createWorld, waitForTerrain and the workers (createWorld takes ~24 s with the loop
 * running and ~1.5 s without it). Nothing in these tests depends on frames being drawn while
 * terrain is generated; they only need a rendered frame before each screenshot.
 */
async function holdFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as HeldFrames;
    w.__rafNative = window.requestAnimationFrame.bind(window);
    w.__rafQueue = [];
    window.requestAnimationFrame = (cb: FrameRequestCallback) => w.__rafQueue.push(cb);
  });
}

/**
 * Draws three game frames (the game re-requests its next frame, which stays held). A single
 * frame after a long pause is not yet settled: it renders every surface with the wrong tint and
 * texture detail, and from the second frame on the image is stable.
 */
async function renderFrames(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const w = window as unknown as HeldFrames;
    for (let i = 0; i < 3; i++) {
      for (const cb of w.__rafQueue.splice(0)) w.__rafNative(cb);
      await new Promise((r) => w.__rafNative(() => w.__rafNative(r)));
    }
  });
}

/**
 * Replaces a 13 x 13 patch of the surface near `located` with flat grass and clear air above it,
 * frames it from above and waits until it is meshed and rendered.
 *
 * The patch centre is clamped so that the whole patch and the camera stay inside the chunk that
 * contains `located`. The camera sits 8 blocks above the patch and 6 blocks behind its centre
 * (+z), facing -z at pitch -0.8, so the screen centre lands on the patch. Only that one chunk
 * needs its own mesh; mesh radius 1 adds the surroundings.
 */
async function frameGrassPatch(
  page: Page,
  located: [number, number, number],
): Promise<{ x: number; y: number; z: number }> {
  const centre = await page.evaluate(
    ({ x, y, z }) => {
      const wm = window.WorldManager!.getInstance();
      const cx = Math.floor(x / 16);
      const cz = Math.floor(z / 16);
      wm.generateColumnMainThread(cx, cz);

      const px = Math.min(Math.max(x, cx * 16 + 6), cx * 16 + 9);
      const pz = Math.min(Math.max(z, cz * 16 + 6), cz * 16 + 9);

      wm.camera.position[0] = px;
      wm.camera.position[1] = y + 8;
      wm.camera.position[2] = pz + 6;
      wm.camera.yaw = -Math.PI / 2;
      wm.camera.pitch = -0.8;
      wm.camera.updateView();

      window.__blockcraft!.fill!(px - 6, y - 1, pz - 6, px + 6, y - 1, pz + 6, 'grass_block');
      window.__blockcraft!.fill!(px - 6, y, pz - 6, px + 6, y + 15, pz + 6, 'air');

      wm.pendingTerrainPromises.delete(`${cx},${cz}`);
      return { x: px, z: pz };
    },
    { x: located[0], y: located[1], z: located[2] },
  );

  await page.evaluate(() => window.__blockcraft!.waitForTerrain!(1));
  await renderFrames(page);
  return { x: centre.x, y: located[1], z: centre.z };
}

test('M03c: Biome Grass Tinting E2E', async ({ page, assertAndSaveScreenshot }) => {
  // 1. Create Default World (meshes radius 4 around the spawn)
  await holdFrames(page);
  await page.evaluate(async () => {
    await window.__blockcraft!.createWorld!({
      name: 'm03c-tint-world',
      seed: 'blockcraft-test-seed-42',
      mode: 'survival',
      type: 'default',
    });
  });

  // 2. Locate Savanna and Rainforest grass areas
  const savannaPos = await page.evaluate(() =>
    window.__blockcraft!.locate!('biome', 'savanna', [0, 64, 0]),
  );
  expect(savannaPos).not.toBeNull();

  const rainforestPos = await page.evaluate(() =>
    window.__blockcraft!.locate!('biome', 'rainforest', [0, 64, 0]),
  );
  expect(rainforestPos).not.toBeNull();

  const [sx, sy, sz] = savannaPos!;
  const [rx, ry, rz] = rainforestPos!;

  // 3. Savanna grass: generate real terrain and tints, frame a grass patch from above
  const savannaCentre = await frameGrassPatch(page, [sx, sy, sz]);

  const savannaBlock = await page.evaluate(
    ({ x, y, z }) => window.__blockcraft!.getBlock!(x, y - 1, z),
    savannaCentre,
  );
  expect(savannaBlock.id).toBe('grass_block');

  const pngSavanna = await assertAndSaveScreenshot({
    name: 'm03c-savanna-grass',
    milestone: 'm03',
  });
  assertNoMissingTexture(pngSavanna);

  // 4. Rainforest grass
  const rainforestCentre = await frameGrassPatch(page, [rx, ry, rz]);

  const rainforestBlock = await page.evaluate(
    ({ x, y, z }) => window.__blockcraft!.getBlock!(x, y - 1, z),
    rainforestCentre,
  );
  expect(rainforestBlock.id).toBe('grass_block');

  const pngRainforest = await assertAndSaveScreenshot({
    name: 'm03c-rainforest-grass',
    milestone: 'm03',
  });
  assertNoMissingTexture(pngRainforest);

  // Compare mean grass color of center region (200x100) after verifying grass hue
  const centerRect: Rect = { x: 500, y: 350, width: 200, height: 100 };

  // Assert at least 60% of pixels in grass region fall within grass hue range 40-140°
  assertHueInRange(pngSavanna, centerRect, [40, 140], 0.6);
  assertHueInRange(pngRainforest, centerRect, [40, 140], 0.6);

  const savannaMean = regionMeanColor(pngSavanna, centerRect);
  const rainforestMean = regionMeanColor(pngRainforest, centerRect);

  const diffR = Math.abs(savannaMean[0] - rainforestMean[0]);
  const diffG = Math.abs(savannaMean[1] - rainforestMean[1]);
  const diffB = Math.abs(savannaMean[2] - rainforestMean[2]);
  const maxDiff = Math.max(diffR, diffG, diffB);

  console.log(`[E2E Grass Tint Comparison]
    Savanna Grass RGB: [${savannaMean.map((c) => c.toFixed(1)).join(', ')}]
    Rainforest Grass RGB: [${rainforestMean.map((c) => c.toFixed(1)).join(', ')}]
    Max Channel Diff: ${maxDiff.toFixed(1)} (target >= 20)
  `);

  expect(maxDiff).toBeGreaterThanOrEqual(20);
});

test('M03c: M01c test scene grass top face green hue assertion', async ({
  page,
  getRenderStats,
}) => {
  await page.evaluate(async () => {
    await window.__blockcraft!.showTestScene!();
  });

  const stats = await getRenderStats();
  expect(stats.missingTextures).toEqual([]);

  const screenshotBuf = await page.screenshot();
  const png = PNG.sync.read(screenshotBuf);

  assertNoMissingTexture(png);

  // Grass cube is located in front-center (col 2, row 4). Top face rect is around x: 500..550, y: 350..380
  const grassTopRect: Rect = { x: 500, y: 350, width: 50, height: 30 };
  assertHueInRange(png, grassTopRect, [80, 140], 0.6);
});

test('M03c: Chunk border grass tint continuity E2E', async ({ page, assertAndSaveScreenshot }) => {
  // 1. Create Default World
  await holdFrames(page);
  await page.evaluate(async () => {
    await window.__blockcraft!.createWorld!({
      name: 'm03c-border-world',
      seed: 'blockcraft-test-seed-42',
      mode: 'survival',
      type: 'default',
    });
  });

  // 2. Flat grass plane spanning the chunk border x=16, framed so that the border runs through
  // the middle of the screen: the camera is 8 blocks above y=70 and 6 blocks behind the centre.
  await page.evaluate(() => {
    const wm = window.WorldManager!.getInstance();

    wm.camera.position[0] = 16.0;
    wm.camera.position[1] = 78.0;
    wm.camera.position[2] = 6.0;
    wm.camera.yaw = -Math.PI / 2;
    wm.camera.pitch = -0.8;
    wm.camera.updateView();

    window.__blockcraft!.fill!(8, 70, -8, 24, 70, 8, 'grass_block');
    window.__blockcraft!.fill!(8, 71, -8, 24, 90, 8, 'air');
    // Only the four edited columns (x 0..31, z -16..15) are re-meshed; the rest stay cached.
    for (const key of ['0,-1', '1,-1', '0,0', '1,0']) wm.pendingTerrainPromises.delete(key);
  });

  await page.evaluate(() => window.__blockcraft!.waitForTerrain!(1));
  await renderFrames(page);

  const png = await assertAndSaveScreenshot({ name: 'm03c-border-tint', milestone: 'm03' });

  assertNoMissingTexture(png);

  // Sample strips on either side of the x=16 border
  const stripLeftRect: Rect = { x: 580, y: 350, width: 50, height: 100 };
  const stripRightRect: Rect = { x: 650, y: 350, width: 50, height: 100 };

  // The framing must show grass: both strips are mostly green (80-140°)
  assertHueInRange(png, stripLeftRect, [80, 140], 0.6);
  assertHueInRange(png, stripRightRect, [80, 140], 0.6);

  const meanLeft = regionMeanColor(png, stripLeftRect);
  const meanRight = regionMeanColor(png, stripRightRect);

  // A dark grey region (the old, mis-framed view) also has a hue of about 128°, so require the
  // strips to be clearly green as well: green channel at least 15 above red.
  expect(meanLeft[1] - meanLeft[0]).toBeGreaterThanOrEqual(15);
  expect(meanRight[1] - meanRight[0]).toBeGreaterThanOrEqual(15);

  const diffR = Math.abs(meanLeft[0] - meanRight[0]);
  const diffG = Math.abs(meanLeft[1] - meanRight[1]);
  const diffB = Math.abs(meanLeft[2] - meanRight[2]);
  const maxBorderDiff = Math.max(diffR, diffG, diffB);

  console.log(`[E2E Border Tint Continuity]
    Left Strip RGB: [${meanLeft.map((c) => c.toFixed(1)).join(', ')}]
    Right Strip RGB: [${meanRight.map((c) => c.toFixed(1)).join(', ')}]
    Max Border Diff: ${maxBorderDiff.toFixed(1)} (target <= 12)
  `);

  expect(maxBorderDiff).toBeLessThanOrEqual(12);
});

test('M03c-fix2: natural flat grassland shows no stone seam across a chunk border', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await holdFrames(page);
  await page.evaluate(async () => {
    await window.__blockcraft!.createWorld!({
      name: 'm03c-fix2-border-world',
      seed: 'blockcraft-test-seed-42',
      mode: 'survival',
      type: 'default',
    });
  });

  // Find untouched flat grassland straddling a chunk border x = 16k: an 8 x 8 window whose
  // columns all differ by at most 1 in height and whose outer columns are grass-topped. createWorld has already
  // generated and meshed chunks -4..4, so nothing is edited and no re-mesh is needed.
  const spot = await page.evaluate(() => {
    const api = window.__blockcraft!;
    for (let k = -3; k <= 3; k++) {
      const bx = k * 16;
      const heights = new Map<string, number>();
      const grass = new Set<string>();
      for (let x = bx - 4; x < bx + 4; x++) {
        for (let z = -64; z < 64; z++) {
          const h = api.getHeight!(x, z);
          heights.set(`${x},${z}`, h);
          if (api.getBlock!(x, h, z).id === 'grass_block') grass.add(`${x},${z}`);
        }
      }
      for (let z0 = -64; z0 + 8 <= 64; z0++) {
        let lo = 999;
        let hi = -999;
        let ok = true;
        for (let x = bx - 4; x < bx + 4 && ok; x++) {
          for (let z = z0; z < z0 + 8; z++) {
            const key = `${x},${z}`;
            const h = heights.get(key)!;
            // The two columns beside the border are what the test inspects, so only the
            // columns further away have to be grass for the window to count as grassland.
            if (!grass.has(key) && x !== bx - 1 && x !== bx) {
              ok = false;
              break;
            }
            lo = Math.min(lo, h);
            hi = Math.max(hi, h);
          }
        }
        if (ok && hi - lo <= 1) return { bx, z0, y: hi };
      }
    }
    return null;
  });
  expect(spot).not.toBeNull();
  const { bx, z0, y } = spot!;

  // Every column along both sides of the border is grass-topped, none is stone
  const borderTops = await page.evaluate(
    ({ bx, z0 }) => {
      const api = window.__blockcraft!;
      const ids: string[] = [];
      for (const x of [bx - 1, bx]) {
        for (let z = z0; z < z0 + 8; z++) ids.push(api.getBlock!(x, api.getHeight!(x, z), z).id);
      }
      return ids;
    },
    { bx, z0 },
  );
  expect(borderTops).toHaveLength(16);
  expect(borderTops.filter((id) => id === 'stone')).toEqual([]);
  expect(borderTops.every((id) => id === 'grass_block')).toBe(true);

  // Frame the border from above: screen centre on (bx, z0 + 4)
  await page.evaluate(
    ({ bx, z0, y }) => {
      const wm = window.WorldManager!.getInstance();
      wm.camera.position[0] = bx;
      wm.camera.position[1] = y + 8;
      wm.camera.position[2] = z0 + 4 + 6;
      wm.camera.yaw = -Math.PI / 2;
      wm.camera.pitch = -0.8;
      wm.camera.updateView();
    },
    { bx, z0, y },
  );
  await renderFrames(page);

  const png = await assertAndSaveScreenshot({ name: 'm03c-fix2-border', milestone: 'm03' });
  assertNotBlank(png);
  assertNoMissingTexture(png);
  assertHueInRange(png, { x: 500, y: 350, width: 280, height: 100 }, [80, 140], 0.6);
});
