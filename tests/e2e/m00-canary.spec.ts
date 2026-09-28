import { test } from '../harness/fixture';
import { assertNotBlank, assertNoMissingTexture } from '../harness/pixels';

test('Canary: Page error should fail the test', async ({ page }) => {
  test.fail(true, 'Expected to fail due to pageerror');

  // Inject a script that throws an error asynchronously to trigger a pageerror
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('Canary page error');
    }, 10);
  });

  // Wait a tick for the error to be caught by the fixture
  await page.waitForTimeout(50);
});

test('Canary: Blank canvas should fail assertNotBlank', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  test.fail(true, 'Expected to fail due to blank canvas');

  // Clear canvas to black
  await page.evaluate(() => {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2');
    if (gl) {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  });

  const png = await assertAndSaveScreenshot({ name: 'canary-blank' });
  assertNotBlank(png);
});

test('Canary: Magenta canvas should fail assertNoMissingTexture', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  test.fail(true, 'Expected to fail due to missing texture sentinel color');

  // Clear canvas to magenta
  await page.evaluate(() => {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2');
    if (gl) {
      gl.clearColor(1, 0, 1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  });

  const png = await assertAndSaveScreenshot({ name: 'canary-magenta' });
  assertNoMissingTexture(png);
});
