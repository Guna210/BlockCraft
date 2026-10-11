import { afterEach, expect, it, vi } from 'vitest';
import { LightWorkerPool } from '../../src/workers/light-worker-pool';

class HeldWorker {
  static instances: HeldWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: Array<{ id: number }> = [];
  constructor() {
    HeldWorker.instances.push(this);
  }
  postMessage(data: { id: number }) {
    this.posted.push(data);
  }
  terminate() {}
}
afterEach(() => {
  vi.unstubAllGlobals();
  HeldWorker.instances = [];
});

it('posts a bounded light backlog to one worker and correlates individual batch replies', async () => {
  vi.stubGlobal('Worker', HeldWorker);
  const pool = new LightWorkerPool(2);
  const bounds = { minCX: 0, maxCX: 0, minCZ: 0, maxCZ: 0 };
  const results = Array.from({ length: 5 }, () =>
    pool.enqueueBatch(bounds, bounds, { '0,0': [0] }),
  );
  const active = HeldWorker.instances.find((worker) => worker.posted.length > 0)!;
  expect(HeldWorker.instances.filter((worker) => worker.posted.length > 0)).toHaveLength(1);
  expect(active.posted).toHaveLength(4);
  expect(pool.queueLength).toBe(5);
  const reply = (i: number) =>
    active.onmessage!({
      data: {
        id: active.posted[i]!.id,
        sections: [],
        columns: [],
        duration: active.posted[i]!.id,
      },
    } as MessageEvent);
  reply(2);
  expect(active.posted).toHaveLength(5);
  for (const i of [0, 1, 3, 4]) reply(i);
  expect((await Promise.all(results)).map((result) => result.duration)).toEqual([1, 2, 3, 4, 5]);
  expect(HeldWorker.instances.filter((worker) => worker.posted.length > 0)).toHaveLength(1);
  expect(pool.queueLength).toBe(0);
  pool.terminate();
});
