import { test, expect } from '../harness/fixture';
import { regionMeanColor } from '../harness/pixels';

test('M00: page loads with 0 errors and clears to sky blue', async ({
  assertAndSaveScreenshot,
}) => {
  const png = await assertAndSaveScreenshot({ name: 'm00-clear', milestone: 'm00' });

  // Top-center region: width 100, height 50, centered horizontally, near the top
  const rect = {
    x: Math.floor(png.width / 2) - 50,
    y: 10,
    width: 100,
    height: 50,
  };

  const [r, g, b] = regionMeanColor(png, rect);

  // Convert RGB to Hue
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;

  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  let h = 0;

  if (max !== min) {
    const d = max - min;
    switch (max) {
      case rNorm:
        h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0);
        break;
      case gNorm:
        h = (bNorm - rNorm) / d + 2;
        break;
      case bNorm:
        h = (rNorm - gNorm) / d + 4;
        break;
    }
    h /= 6;
  }
  const hue = h * 360;

  // Ensure hue is between 190 and 215 (sky-blue)
  expect(hue).toBeGreaterThanOrEqual(190);
  expect(hue).toBeLessThanOrEqual(215);
});
