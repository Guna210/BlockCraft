import { test, expect } from '../harness/fixture';
import {
  assertNotBlank,
  assertNoMissingTexture,
  assertColorVariance,
  diffFraction,
} from '../harness/pixels';

test('M01: 5x5 texture grid test scene renders correctly and updates on camera rotation', async ({
  page,
  assertAndSaveScreenshot,
  getRenderStats,
}) => {
  // Trigger test scene rendering and wait for first rendered frame
  await page.evaluate(async () => {
    await window.__blockcraft!.showTestScene!();
  });

  const stats = await getRenderStats();
  expect(stats.missingTextures).toEqual([]);
  expect(stats.textureAtlasSize[0]).toBeGreaterThan(0);
  expect(stats.textureAtlasSize[1]).toBeGreaterThan(0);

  // Take initial screenshot
  const png1 = await assertAndSaveScreenshot({ name: 'm01-texture-grid', milestone: 'm01' });

  // Pixel assertions
  assertNotBlank(png1);
  assertNoMissingTexture(png1);
  assertColorVariance(png1, 18);

  // Rotate camera 90 degrees (from yaw -PI/2 to 0) via debug look API directly
  await page.evaluate(() => {
    window.__blockcraft!.look!(0, -0.62);
  });

  // Wait for a rendered frame
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );

  // Take rotated screenshot
  const png2 = await assertAndSaveScreenshot({
    name: 'm01-texture-grid-rotated',
    milestone: 'm01',
  });

  // Verify camera movement changed at least 30% of pixels
  const diff = diffFraction(png1, png2);
  expect(diff).toBeGreaterThan(0.3);
});
