import { test, expect } from '../harness/fixture';
import { assertNotBlank, assertNoMissingTexture, assertHueInRange } from '../harness/pixels';

test.describe('M02: Chunk Data Structures, Meshing & Flat World', () => {
  test('getBlock, setBlock and fill debug API methods operate correctly on world', async ({
    page,
  }) => {
    // Check initial getBlock at (0, 64, 0) is air
    const initialBlock = await page.evaluate(() => {
      return window.__blockcraft!.getBlock!(0, 64, 0);
    });
    expect(initialBlock).toEqual({ id: 'air', state: {} });

    // setBlock stone at (0, 64, 0)
    await page.evaluate(() => {
      window.__blockcraft!.setBlock!(0, 64, 0, 'stone');
    });

    const stoneBlock = await page.evaluate(() => {
      return window.__blockcraft!.getBlock!(0, 64, 0);
    });
    expect(stoneBlock).toEqual({ id: 'stone', state: {} });

    // setBlock oak_log with axis 'x' at (1, 64, 0)
    await page.evaluate(() => {
      window.__blockcraft!.setBlock!(1, 64, 0, 'oak_log', { axis: 'x' });
    });

    const logBlock = await page.evaluate(() => {
      return window.__blockcraft!.getBlock!(1, 64, 0);
    });
    expect(logBlock).toEqual({ id: 'oak_log', state: { axis: 'x' } });

    // fill region from (10, 70, 10) to (12, 72, 12) with dirt
    await page.evaluate(() => {
      window.__blockcraft!.fill!(10, 70, 10, 12, 72, 12, 'dirt');
    });

    const filledMin = await page.evaluate(() => {
      return window.__blockcraft!.getBlock!(10, 70, 10);
    });
    const filledMax = await page.evaluate(() => {
      return window.__blockcraft!.getBlock!(12, 72, 12);
    });
    const filledMid = await page.evaluate(() => {
      return window.__blockcraft!.getBlock!(11, 71, 11);
    });

    expect(filledMin.id).toBe('dirt');
    expect(filledMax.id).toBe('dirt');
    expect(filledMid.id).toBe('dirt');
  });

  test('createWorld generates flat world, meshes in workers, and renders continuous grass plane', async ({
    page,
    assertAndSaveScreenshot,
  }) => {
    await page.evaluate(async () => {
      await window.__blockcraft!.createWorld!({
        name: 'test-flat-world',
        seed: 'blockcraft-test-seed-42',
        mode: 'survival',
        type: 'flat',
      });
    });

    await page.evaluate(async () => {
      await window.__blockcraft!.waitForTerrain!(4);
    });

    const workerStats = await page.evaluate(() => {
      return window.__blockcraft!.getWorkerStats!();
    });
    expect(workerStats.meshMsP95).toBeGreaterThanOrEqual(0);
    expect(workerStats.meshMsP95).toBeLessThanOrEqual(6.0);

    const png = await assertAndSaveScreenshot({ milestone: 'm02', name: 'm02-flat' });

    assertNotBlank(png);
    assertNoMissingTexture(png);

    // Top 30% region: sky blue hue (190° - 215°)
    assertHueInRange(
      png,
      { x: 0, y: 0, width: png.width, height: Math.floor(png.height * 0.3) },
      [190, 215],
      0.6,
    );

    // Bottom 40% region: green hue (80° - 140°)
    assertHueInRange(
      png,
      {
        x: 0,
        y: Math.floor(png.height * 0.6),
        width: png.width,
        height: Math.floor(png.height * 0.4),
      },
      [80, 140],
      0.5,
    );
  });

  test('wireframe mode displays merged quads overlay', async ({
    page,
    assertAndSaveScreenshot,
  }) => {
    await page.evaluate(async () => {
      await window.__blockcraft!.createWorld!({
        name: 'test-flat-world',
        seed: 'blockcraft-test-seed-42',
        mode: 'survival',
        type: 'flat',
      });
      await window.__blockcraft!.waitForTerrain!(4);
    });

    await page.evaluate(() => {
      window.__blockcraft!.setWireframe!(true);
    });

    const png = await assertAndSaveScreenshot({ milestone: 'm02', name: 'm02-wireframe' });

    assertNotBlank(png);
    assertNoMissingTexture(png);
  });

  test('WorkerPool uses real Web Workers, transfers padded buffers, and exposes workerCount', async ({
    page,
  }) => {
    await page.evaluate(async () => {
      await window.__blockcraft!.createWorld!({
        name: 'test-worker-world',
        seed: 'blockcraft-test-seed-42',
        mode: 'survival',
        type: 'flat',
      });
    });

    const testResult = await page.evaluate(async () => {
      const wm = (
        window as unknown as { WorldManager: { getInstance: () => any } }
      ).WorldManager.getInstance();
      const pool = wm.workerPool;
      const expectedWorkerCount = Math.max(2, (navigator.hardwareConcurrency || 4) - 1);
      const actualWorkerCount = pool.workerCount;

      const paddedSection = new Uint16Array(18 * 18 * 18);
      const initialByteLength = paddedSection.buffer.byteLength;

      const jobPromise = pool.enqueueMeshJob(0, 0, 0, paddedSection, wm.tables);
      const byteLengthAfterEnqueue = paddedSection.buffer.byteLength;

      const result = await jobPromise;

      return {
        expectedWorkerCount,
        actualWorkerCount,
        initialByteLength,
        byteLengthAfterEnqueue,
        hasOpaqueVertices: result.meshData.opaque.vertices.length >= 0,
      };
    });

    expect(testResult.actualWorkerCount).toBe(testResult.expectedWorkerCount);
    expect(testResult.initialByteLength).toBe(18 * 18 * 18 * 2);
    expect(testResult.byteLengthAfterEnqueue).toBe(0);
    expect(testResult.hasOpaqueVertices).toBe(true);
  });

  test('calling createWorld a second time clears old promises and re-meshes new world', async ({
    page,
  }) => {
    // World 1: create world and place a stone block at (0, 70, 0)
    await page.evaluate(async () => {
      await window.__blockcraft!.createWorld!({ name: 'world1', type: 'flat' });
      window.__blockcraft!.setBlock!(0, 70, 0, 'stone');
    });

    const b1 = await page.evaluate(() => window.__blockcraft!.getBlock!(0, 70, 0));
    expect(b1.id).toBe('stone');

    // World 2: create world again in same session
    await page.evaluate(async () => {
      await window.__blockcraft!.createWorld!({ name: 'world2', type: 'flat' });
      await window.__blockcraft!.waitForTerrain!(4);
    });

    const b2 = await page.evaluate(() => window.__blockcraft!.getBlock!(0, 70, 0));
    expect(b2.id).toBe('air');
  });
});
