import { test, expect } from '../harness/fixture';
import { assertNoMissingTexture, regionMeanColor, assertHueInRange, Rect } from '../harness/pixels';
import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';

test('M03c: Biome Grass Tinting E2E', async ({ page, assertAndSaveScreenshot }) => {
  // 1. Create Default World
  await page.evaluate(async () => {
    await window.__blockcraft!.createWorld!({
      name: 'm03c-tint-world',
      seed: 'blockcraft-test-seed-42',
      mode: 'survival',
      type: 'default',
    });
    await window.__blockcraft!.waitForTerrain!(4);
  });

  // 2. Locate Savanna and Rainforest grass areas
  const savannaPos = await page.evaluate(() => {
    return window.__blockcraft!.locate!('biome', 'savanna', [0, 64, 0]);
  });
  expect(savannaPos).not.toBeNull();

  const rainforestPos = await page.evaluate(() => {
    return window.__blockcraft!.locate!('biome', 'rainforest', [0, 64, 0]);
  });
  expect(rainforestPos).not.toBeNull();

  const [sx, sy, sz] = savannaPos!;
  const [rx, ry, rz] = rainforestPos!;

  // Generate real biome terrain and tints in Savanna area
  await page.evaluate(
    ({ x, z }) => {
      const wm = (
        window as unknown as {
          WorldManager: {
            getInstance(): {
              generateColumnMainThread(cx: number, cz: number): void;
            };
          };
        }
      ).WorldManager.getInstance();

      const centerCX = Math.floor(x / 16);
      const centerCZ = Math.floor(z / 16);
      for (let cx = centerCX - 1; cx <= centerCX + 1; cx++) {
        for (let cz = centerCZ - 1; cz <= centerCZ + 1; cz++) {
          wm.generateColumnMainThread(cx, cz);
        }
      }
    },
    { x: sx, z: sz },
  );

  // Position camera looking down at Savanna grass
  await page.evaluate(
    ({ x, y, z }) => {
      const wm = (
        window as unknown as {
          WorldManager: {
            getInstance(): {
              camera: { position: Float32Array; yaw: number; pitch: number; updateView(): void };
              pendingTerrainPromises: Map<string, unknown>;
            };
          };
        }
      ).WorldManager.getInstance();
      wm.camera.position[0] = x;
      wm.camera.position[1] = y + 8;
      wm.camera.position[2] = z + 6;
      wm.camera.yaw = -Math.PI / 2;
      wm.camera.pitch = -0.8;
      wm.camera.updateView();

      window.__blockcraft!.fill!(x - 10, y - 1, z - 10, x + 10, y - 1, z + 10, 'grass_block');
      window.__blockcraft!.fill!(x - 10, y, z - 10, x + 10, y + 15, z + 10, 'air');

      wm.pendingTerrainPromises.clear();
    },
    { x: sx, y: sy, z: sz },
  );

  // Wait for terrain and render
  await page.evaluate(async () => {
    await window.__blockcraft!.waitForTerrain!(2);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });

  // Verify surface block is grass_block
  const savannaBlock = await page.evaluate(
    ({ x, y, z }) => window.__blockcraft!.getBlock!(x, y - 1, z),
    { x: sx, y: sy, z: sz },
  );
  expect(savannaBlock.id).toBe('grass_block');

  // Screenshot Savanna Grass
  const pngSavanna = await assertAndSaveScreenshot({
    name: 'm03c-savanna-grass',
    milestone: 'm03',
  });
  assertNoMissingTexture(pngSavanna);

  // Generate real biome terrain and tints in Rainforest area
  await page.evaluate(
    ({ x, z }) => {
      const wm = (
        window as unknown as {
          WorldManager: {
            getInstance(): {
              generateColumnMainThread(cx: number, cz: number): void;
            };
          };
        }
      ).WorldManager.getInstance();

      const centerCX = Math.floor(x / 16);
      const centerCZ = Math.floor(z / 16);
      for (let cx = centerCX - 1; cx <= centerCX + 1; cx++) {
        for (let cz = centerCZ - 1; cz <= centerCZ + 1; cz++) {
          wm.generateColumnMainThread(cx, cz);
        }
      }
    },
    { x: rx, z: rz },
  );

  // Position camera looking down at Rainforest grass
  await page.evaluate(
    ({ x, y, z }) => {
      const wm = (
        window as unknown as {
          WorldManager: {
            getInstance(): {
              camera: { position: Float32Array; yaw: number; pitch: number; updateView(): void };
              pendingTerrainPromises: Map<string, unknown>;
            };
          };
        }
      ).WorldManager.getInstance();
      wm.camera.position[0] = x;
      wm.camera.position[1] = y + 8;
      wm.camera.position[2] = z + 6;
      wm.camera.yaw = -Math.PI / 2;
      wm.camera.pitch = -0.8;
      wm.camera.updateView();

      window.__blockcraft!.fill!(x - 10, y - 1, z - 10, x + 10, y - 1, z + 10, 'grass_block');
      window.__blockcraft!.fill!(x - 10, y, z - 10, x + 10, y + 15, z + 10, 'air');

      wm.pendingTerrainPromises.clear();
    },
    { x: rx, y: ry, z: rz },
  );

  await page.evaluate(async () => {
    await window.__blockcraft!.waitForTerrain!(2);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });

  const rainforestBlock = await page.evaluate(
    ({ x, y, z }) => window.__blockcraft!.getBlock!(x, y - 1, z),
    { x: rx, y: ry, z: rz },
  );
  expect(rainforestBlock.id).toBe('grass_block');

  // Screenshot Rainforest Grass
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

  // Copy screenshots to docs/screenshots/M03c/
  const screenshotsDir = path.resolve(process.cwd(), 'docs/screenshots/M03c');
  fs.mkdirSync(screenshotsDir, { recursive: true });

  const savannaSrc = path.resolve(process.cwd(), 'artifacts/m03/m03c-savanna-grass.png');
  const rainforestSrc = path.resolve(process.cwd(), 'artifacts/m03/m03c-rainforest-grass.png');

  if (fs.existsSync(savannaSrc)) {
    fs.copyFileSync(savannaSrc, path.join(screenshotsDir, 'm03c-savanna-grass.png'));
  }
  if (fs.existsSync(rainforestSrc)) {
    fs.copyFileSync(rainforestSrc, path.join(screenshotsDir, 'm03c-rainforest-grass.png'));
  }
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
