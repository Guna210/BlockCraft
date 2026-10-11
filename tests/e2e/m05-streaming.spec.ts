import { test, expect } from '../harness/fixture';
import { fly, waitForStreamingIdle } from './helpers/flight';

test('M05 streamed-light stage throughput on a flight', async ({ page }) => {
  await page.evaluate(async () => {
    await window.__blockcraft!.createWorld!({ seed: 'blockcraft-test-seed-42' });
  });
  await waitForStreamingIdle(page, 120_000);
  const start = await page.evaluate(() => {
    const wm = (
      window as unknown as {
        WorldManager: { getInstance(): { camera: { position: Float32Array } } };
      }
    ).WorldManager.getInstance();
    const p = wm.camera.position;
    return { x: p[0]!, y: p[1]!, z: p[2]! };
  });
  const before = await page.evaluate(() => ({
    time: performance.now(),
    stream: window.__blockcraft!.getStreamingStats!(),
    render: window.__blockcraft!.getRenderStats(),
  }));
  await fly(page, { from: start, to: { ...start, x: start.x + 1000 }, speed: 30 });
  const after = await page.evaluate(() => ({
    time: performance.now(),
    stream: window.__blockcraft!.getStreamingStats!(),
    render: window.__blockcraft!.getRenderStats(),
  }));
  const seconds = (after.time - before.time) / 1000;
  const rates = Object.fromEntries(
    Object.entries(after.stream.completed).map(([stage, count]) => [
      stage,
      (count - before.stream.completed[stage as keyof typeof before.stream.completed]) / seconds,
    ]),
  );
  console.log('m05 throughput', JSON.stringify({ seconds, rates, before, after }));
  const batches = await page.evaluate(
    () =>
      (
        window as unknown as {
          WorldManager: {
            getInstance(): {
              lightBatchTimes: Array<{ columns: number; workerMs: number; mainMs: number }>;
            };
          };
        }
      ).WorldManager.getInstance().lightBatchTimes,
  );
  console.log('m05 light batches', JSON.stringify(batches));
  expect(after.stream.completed.generated).toBeGreaterThan(before.stream.completed.generated);
  await waitForStreamingIdle(page, 120_000);
});
