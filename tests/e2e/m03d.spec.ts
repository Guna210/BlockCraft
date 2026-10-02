import { test } from '../harness/fixture';
import { assertNotBlank, assertNoMissingTexture } from '../harness/pixels';
import * as fs from 'fs';
import * as path from 'path';

test.describe('M03d: Caves & Aquifers Visual & E2E Verification', () => {
  test('renders cave interior with assertNotBlank and assertNoMissingTexture', async ({
    page,
    assertAndSaveScreenshot,
  }) => {
    await page.evaluate(async () => {
      await window.__blockcraft!.createWorld!({
        seed: 'blockcraft-test-seed-42',
        type: 'default',
      });
      await window.__blockcraft!.waitForTerrain!(4);
    });

    // Find a large underground cave cavern block
    const cavePos = await page.evaluate(() => {
      // Search in loaded columns around origin for an underground air block with air neighbors
      for (let y = 25; y <= 45; y++) {
        for (let x = -30; x <= 30; x++) {
          for (let z = -30; z <= 30; z++) {
            const b = window.__blockcraft!.getBlock!(x, y, z);
            if (b.id === 'air') {
              const bAbove = window.__blockcraft!.getBlock!(x, y + 1, z);
              const bBelow = window.__blockcraft!.getBlock!(x, y - 1, z);
              const bNorth = window.__blockcraft!.getBlock!(x, y, z - 1);
              const bSouth = window.__blockcraft!.getBlock!(x, y, z + 1);

              // Ensure it's a cavern (air in multiple directions) and below surface
              const surfH = window.__blockcraft!.getHeight!(x, z);
              if (
                y < surfH - 10 &&
                bAbove.id === 'air' &&
                bBelow.id !== 'air' &&
                (bNorth.id === 'air' || bSouth.id === 'air')
              ) {
                return { x, y, z };
              }
            }
          }
        }
      }
      return { x: 0, y: 30, z: 0 };
    });

    // Position camera inside the cave looking along it
    await page.evaluate(({ x, y, z }) => {
      const wm = (
        window as unknown as {
          WorldManager: {
            getInstance(): {
              camera: { position: Float32Array; yaw: number; pitch: number; updateView(): void };
            };
          };
        }
      ).WorldManager.getInstance();

      wm.camera.position[0] = x + 0.5;
      wm.camera.position[1] = y + 1.62;
      wm.camera.position[2] = z + 0.5;
      wm.camera.yaw = 0.78; // ~45 deg
      wm.camera.pitch = -0.17; // ~ -10 deg
      wm.camera.updateView();
    }, cavePos);

    // Wait 2 frames for rendering
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );

    // Capture screenshot
    const png = await assertAndSaveScreenshot({
      name: 'm03d-cave',
      milestone: 'm03',
    });

    // Copy PNG to docs/screenshots/M03d/m03d-cave.png
    const destDir = path.resolve(process.cwd(), 'docs/screenshots/M03d');
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(
      path.resolve(process.cwd(), 'artifacts/m03/m03d-cave.png'),
      path.join(destDir, 'm03d-cave.png'),
    );

    // Assert pixel checks
    assertNotBlank(png);
    assertNoMissingTexture(png);
  });
});
