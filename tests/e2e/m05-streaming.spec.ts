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
  const cpuSnapshot = () =>
    page.evaluate(() => {
      const wm = (
        window as unknown as {
          WorldManager: {
            getInstance(): {
              workerPool: {
                workerCount: number;
                completedWorkMs: number;
                completedJobs: number;
                deliveryMs: number[];
                meshMsP95: number;
              };
              genWorkerPool: {
                workerCount: number;
                completedWorkMs: number;
                completedJobs: number;
              };
              lightWorkerPool: { workerCount: number };
              terrainFrameGate: { submittedFrames: number } | null;
              lightBatchTimes: Array<{ workerMs: number }>;
              streamer: { cols: Map<number, { phase: string }> };
            };
          };
        }
      ).WorldManager.getInstance();
      const phases: Record<string, number> = {};
      for (const col of wm.streamer.cols.values()) phases[col.phase] = (phases[col.phase] ?? 0) + 1;
      return {
        hardwareConcurrency: navigator.hardwareConcurrency,
        terrainFrames: wm.terrainFrameGate?.submittedFrames ?? 0,
        meshWorkers: wm.workerPool.workerCount,
        generationWorkers: wm.genWorkerPool.workerCount,
        lightWorkers: wm.lightWorkerPool.workerCount,
        meshWorkMs: wm.workerPool.completedWorkMs,
        meshJobs: wm.workerPool.completedJobs,
        generationWorkMs: wm.genWorkerPool.completedWorkMs,
        generationJobs: wm.genWorkerPool.completedJobs,
        meshMsP95: wm.workerPool.meshMsP95,
        deliveryMs: wm.workerPool.deliveryMs,
        lightWorkerMs: wm.lightBatchTimes.map((b) => b.workerMs),
        phases,
      };
    });
  const cpuBefore = await cpuSnapshot();
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
  const cpuAfter = await cpuSnapshot();
  expect(cpuAfter.terrainFrames).toBeGreaterThan(cpuBefore.terrainFrames);
  console.log('m05 cpu profile', JSON.stringify({ before: cpuBefore, after: cpuAfter }));
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
