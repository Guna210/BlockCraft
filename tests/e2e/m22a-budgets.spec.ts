import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../harness/fixture';
import { assertNotBlank } from '../harness/pixels';
import { fly, waitForStreamingIdle } from './helpers/flight';

const seed = 'blockcraft-test-seed-42';
type Camera = { position: Float32Array; yaw: number; pitch: number; updateView(): void };
type Host = { WorldManager: { getInstance(): { camera: Camera } } };

test('terrain renders when the multi-draw extension is unavailable', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    const prototype = WebGL2RenderingContext.prototype;
    const getExtension = prototype.getExtension;
    Object.defineProperty(prototype, 'getExtension', {
      configurable: true,
      value(this: WebGL2RenderingContext, name: string) {
        return name === 'WEBGL_multi_draw' ? null : Reflect.apply(getExtension, this, [name]);
      },
    });
  });
  await page.reload();
  await page.waitForFunction(() => window.__blockcraft?.ready);
  await page.evaluate(async () => {
    await window.__blockcraft!.ready();
    await window.__blockcraft!.createWorld!({
      name: 'm22a-fallback',
      seed: 'blockcraft-test-seed-42',
      mode: 'survival',
      type: 'flat',
    });
    await window.__blockcraft!.waitForTerrain!(4);
  });
  const result = await page.evaluate(() => window.__blockcraft!.getRenderStats());
  expect(result.chunksVisible).toBeGreaterThan(0);
  expect(result.drawCalls).toBeGreaterThan(0);
  assertNotBlank(await assertAndSaveScreenshot({ milestone: 'm22a', name: 'm22a-fallback' }));
});

test('underground visibility preserves pixels while culling sections', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  test.setTimeout(300_000);
  await page.evaluate(async (seed) => {
    await window.__blockcraft!.createWorld!({
      name: 'm22a-cave',
      seed,
      mode: 'survival',
      type: 'default',
    });
    const camera = (window as unknown as Host).WorldManager.getInstance().camera;
    camera.position.set([-66, 120, -217]);
    camera.updateView();
    await window.__blockcraft!.waitForTerrain!(8);
    camera.position.set([-69.5, 19.5, -222.5]);
    camera.yaw = (39 * Math.PI) / 180;
    camera.pitch = (-12 * Math.PI) / 180;
    camera.updateView();
    await window.__blockcraft!.waitForTerrain!(8);
    window.__blockcraft!.setDebugLight!(true);
    window.__blockcraft!.setFluidAnimationPaused!(true);
  }, seed);
  await waitForStreamingIdle(page, 180_000);
  const scene = await page.evaluate(() => ({
    camera: window.__blockcraft!.getBlock!(-70, 19, -223).id,
    surface: window.__blockcraft!.getHeight!(-70, -223),
  }));
  expect(scene.camera).toBe('air');
  expect(scene.surface).toBeGreaterThan(39);
  const sample = async (cave: boolean, frustum: boolean, name: string) => {
    await page.evaluate(
      async ({ cave, frustum }) => {
        window.__blockcraft!.setCulling!({ cave, frustum });
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      },
      { cave, frustum },
    );
    const render = await page.evaluate(() => {
      const stats = window.__blockcraft!.getRenderStats();
      return {
        visible: stats.chunksVisible,
        drawCalls: stats.drawCalls,
        drawSubmissions: stats.drawSubmissions,
      };
    });
    const png = await assertAndSaveScreenshot({ milestone: 'm22a', name });
    return { ...render, png };
  };
  const enabled = await sample(true, true, 'm22a-culling-on');
  const disabled = await sample(false, false, 'm22a-culling-off');
  assertNotBlank(enabled.png);
  assertNotBlank(disabled.png);
  const dir = path.resolve('docs/screenshots/M22a');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ['m22a-culling-on', 'm22a-culling-off'])
    fs.copyFileSync(path.resolve(`artifacts/m22a/${name}.png`), path.join(dir, `${name}.png`));
  expect(enabled.png.width).toBe(disabled.png.width);
  expect(enabled.png.height).toBe(disabled.png.height);
  let different = 0;
  for (let i = 0; i < enabled.png.data.length; i += 4) {
    if (
      enabled.png.data[i] !== disabled.png.data[i] ||
      enabled.png.data[i + 1] !== disabled.png.data[i + 1] ||
      enabled.png.data[i + 2] !== disabled.png.data[i + 2]
    )
      different++;
  }
  const ratio = enabled.visible / disabled.visible;
  const pixelDiff = different / (enabled.png.width * enabled.png.height);
  const multiDraw = await page.evaluate(() =>
    Boolean(
      (
        window as unknown as {
          WorldManager: { getInstance(): { chunkRenderer: { multiDraw: unknown } } };
        }
      ).WorldManager.getInstance().chunkRenderer.multiDraw,
    ),
  );
  console.log(
    'M22a cave',
    JSON.stringify({
      enabled: enabled.visible,
      disabled: disabled.visible,
      enabledDrawCalls: enabled.drawCalls,
      enabledDrawSubmissions: enabled.drawSubmissions,
      disabledDrawCalls: disabled.drawCalls,
      disabledDrawSubmissions: disabled.drawSubmissions,
      ratio,
      pixelDiff,
      multiDraw,
    }),
  );
  expect(disabled.visible).toBeGreaterThan(0);
  expect(ratio).toBeLessThanOrEqual(0.4);
  expect(pixelDiff).toBeLessThan(0.005);
});

test('flight meets the frame, upload, worker and draw budgets', async ({ page }) => {
  test.setTimeout(600_000);
  const startTime = Date.now();
  await page.evaluate(
    async (seed) =>
      window.__blockcraft!.createWorld!({
        name: 'm22a-flight',
        seed,
        mode: 'survival',
        type: 'default',
      }),
    seed,
  );
  const firstFrameMs = Date.now() - startTime;
  const firstFrame = await page.evaluate(() => window.__blockcraft!.getRenderStats());
  expect(firstFrame.chunksVisible).toBeGreaterThan(0);
  await waitForStreamingIdle(page, 180_000);
  const start = await page.evaluate(() => {
    const p = (window as unknown as Host).WorldManager.getInstance().camera.position;
    return { x: p[0]!, y: p[1]!, z: p[2]! };
  });
  await page.evaluate(() => {
    window.__blockcraft!.resetFrameStats!();
    window.__blockcraft!.resetSectionWorkSamples!();
  });
  await fly(page, { from: start, to: { ...start, x: start.x + 1000 }, speed: 30 });
  const result = await page.evaluate(() => ({
    frame: window.__blockcraft!.getFrameStats!(),
    phases: window.__blockcraft!.getRenderPhaseStats!(),
    worker: window.__blockcraft!.getWorkerStats!(),
    render: window.__blockcraft!.getRenderStats(),
  }));
  console.log('M22a flight', JSON.stringify({ firstFrameMs, ...result }));
  expect(result.frame.frames).toBeGreaterThan(10);
  expect(result.frame.frameCpuMsP95).toBeLessThanOrEqual(8);
  expect(result.frame.uploadMsP95).toBeLessThanOrEqual(3);
  expect(result.worker.sectionWorkSamples).toBeGreaterThan(0);
  expect(result.worker.sectionWorkMsP95).toBeLessThanOrEqual(6);
  expect(result.worker.meshMsP95).toBeLessThanOrEqual(6);
  expect(result.frame.drawCallsMax).toBeLessThanOrEqual(1500);
  expect(firstFrameMs).toBeLessThanOrEqual(20_000);
});

test('heap growth after a 2000-block out-and-back is at most 15 percent', async ({ page }) => {
  test.setTimeout(600_000);
  await page.evaluate(
    async (seed) =>
      window.__blockcraft!.createWorld!({
        name: 'm22a-heap',
        seed,
        mode: 'survival',
        type: 'default',
      }),
    seed,
  );
  await waitForStreamingIdle(page, 180_000);
  const start = await page.evaluate(() => {
    const p = (window as unknown as Host).WorldManager.getInstance().camera.position;
    return { x: p[0]!, y: p[1]!, z: p[2]! };
  });
  const warm = { ...start, x: start.x + 400 };
  await fly(page, { from: start, to: warm, speed: 60 });
  await fly(page, { from: warm, to: start, speed: 60 });
  await waitForStreamingIdle(page, 180_000);
  const heap = () =>
    page.evaluate(() => {
      const gc = (window as unknown as { gc?: () => void }).gc;
      if (!gc) throw new Error('GC is not exposed');
      gc();
      gc();
      return (performance as unknown as { memory: { usedJSHeapSize: number } }).memory
        .usedJSHeapSize;
    });
  const probeBaseline = await heap();
  await page.evaluate(() => {
    (window as unknown as { m22aHeapProbe?: number[] }).m22aHeapProbe = Array.from(
      { length: 8_000_000 },
      (_, index) => index + 0.5,
    );
  });
  const probe = await page.evaluate(
    () => (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize,
  );
  expect(probe - probeBaseline).toBeGreaterThanOrEqual(32 * 1024 * 1024);
  await page.evaluate(() => {
    delete (window as unknown as { m22aHeapProbe?: number[] }).m22aHeapProbe;
  });
  const before = await heap();
  const end = { ...start, x: start.x + 2000 };
  await fly(page, { from: start, to: end, speed: 60 });
  await fly(page, { from: end, to: start, speed: 60 });
  await waitForStreamingIdle(page, 180_000);
  const after = await heap();
  const growth = (after - before) / before;
  console.log('M22a heap', JSON.stringify({ before, after, growth }));
  expect(growth).toBeLessThanOrEqual(0.15);
});
