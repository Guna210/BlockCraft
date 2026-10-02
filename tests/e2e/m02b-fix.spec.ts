import { test, expect } from '../harness/fixture';
import { assertNotBlank, assertNoMissingTexture } from '../harness/pixels';
import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';

function regionMeanGR(
  png: PNG,
  rect: { x: number; y: number; width: number; height: number },
): number {
  let sumGR = 0;
  let count = 0;
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const idx = (png.width * y + x) << 2;
      const r = png.data[idx]!;
      const g = png.data[idx + 1]!;
      sumGR += g - r;
      count++;
    }
  }
  return count > 0 ? sumGR / count : 0;
}

test.describe('M02b-fix: Side-face texture orientation & tint sampling', () => {
  test('renders 3x3 grass_block wall with top grass fringe having mean (G - R) >= 15 higher than bottom dirt', async ({
    page,
    assertAndSaveScreenshot,
  }) => {
    // 1. Create flat world
    await page.evaluate(async () => {
      await window.__blockcraft!.createWorld!({
        name: 'test-m02b-fix-world',
        seed: 'blockcraft-test-seed-42',
        mode: 'survival',
        type: 'flat',
      });
    });

    await page.evaluate(async () => {
      await window.__blockcraft!.waitForTerrain!(4);
    });

    // 2. Clear obstruction blocks in front of camera and build 3x3 wall of grass_block at z = -5
    await page.evaluate(() => {
      // Clear ground in front of camera
      window.__blockcraft!.fill!(-2, 64, -6, 2, 65, 0, 'air');

      // Build 3x3 wall of grass_block at z = -5, x in [-1..1], y in [65..67]
      window.__blockcraft!.fill!(-1, 65, -5, 1, 67, -5, 'grass_block');
    });

    // Clear terrain promises cache and re-mesh terrain
    await page.evaluate(async () => {
      const wm = (
        window as unknown as {
          WorldManager: {
            getInstance: () => {
              pendingTerrainPromises: Map<string, unknown>;
            };
          };
        }
      ).WorldManager.getInstance();
      wm.pendingTerrainPromises.clear();
      await window.__blockcraft!.waitForTerrain!(4);
    });

    // 3. Position camera looking horizontally straight at center block (0, 65.5, -5)
    await page.evaluate(() => {
      const wm = (
        window as unknown as {
          WorldManager: {
            getInstance: () => {
              camera: {
                position: [number, number, number];
                yaw: number;
                pitch: number;
                updateView: () => void;
              } | null;
            };
          };
        }
      ).WorldManager.getInstance();
      if (wm.camera) {
        wm.camera.position[0] = 0;
        wm.camera.position[1] = 65.5; // center of block y = 65
        wm.camera.position[2] = -3.2; // 1.8 units away from z = -5 face
        wm.camera.yaw = -Math.PI / 2; // looking toward -Z
        wm.camera.pitch = 0; // horizontal look
        wm.camera.updateView();
      }
    });

    const png = await assertAndSaveScreenshot({ milestone: 'm02', name: 'm02b-fix-grass-side' });

    assertNotBlank(png);
    assertNoMissingTexture(png);

    // Save copy to docs/screenshots/M02b-fix/
    const docsDir = path.join(process.cwd(), 'docs', 'screenshots', 'M02b-fix');
    fs.mkdirSync(docsDir, { recursive: true });
    const docsPath = path.join(docsDir, 'm02b-fix-grass-side.png');
    fs.writeFileSync(docsPath, PNG.sync.write(png));

    // Center block face at (0, 65, -5) covers screen rectangle
    const blockRect = { x: 200, y: 40, width: 880, height: 600 };

    const top20Rect = {
      x: blockRect.x,
      y: blockRect.y,
      width: blockRect.width,
      height: Math.floor(blockRect.height * 0.2),
    };

    const bottom50Rect = {
      x: blockRect.x,
      y: blockRect.y + Math.floor(blockRect.height * 0.5),
      width: blockRect.width,
      height: Math.floor(blockRect.height * 0.5),
    };

    const topGR = regionMeanGR(png, top20Rect);
    const bottomGR = regionMeanGR(png, bottom50Rect);

    console.log(`[M02b-fix Grass Side E2E]`);
    console.log(`- Top 20% mean (G - R): ${topGR.toFixed(2)}`);
    console.log(`- Bottom 50% mean (G - R): ${bottomGR.toFixed(2)}`);
    console.log(`- Difference (Top - Bottom): ${(topGR - bottomGR).toFixed(2)}`);

    expect(topGR - bottomGR).toBeGreaterThanOrEqual(15.0);
  });
});
