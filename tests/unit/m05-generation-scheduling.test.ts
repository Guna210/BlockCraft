import { afterEach, expect, it, vi } from 'vitest';
import { GenWorkerPool } from '../../src/workers/gen-worker-pool';

class HeldWorker {
  static instances: HeldWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: Array<{ id: number; cx: number; cz: number }> = [];
  constructor() {
    HeldWorker.instances.push(this);
  }
  postMessage(data: { id: number; cx: number; cz: number }) {
    this.posted.push(data);
  }
  terminate() {}
}
afterEach(() => {
  vi.unstubAllGlobals();
  HeldWorker.instances = [];
});

it('keeps bounded generation work posted through delayed main-thread replies and matches job IDs', async () => {
  vi.stubGlobal('Worker', HeldWorker);
  const pool = new GenWorkerPool(2);
  const results = Array.from({ length: 17 }, (_, cx) => pool.enqueueGenJob(42, cx, 0, 'default'));
  const [first, second] = HeldWorker.instances;
  expect(first!.posted).toHaveLength(8);
  expect(second!.posted).toHaveLength(8);
  expect(pool.queueLength).toBe(17);
  const reply = (worker: HeldWorker, i: number) =>
    worker.onmessage!({
      data: {
        ...worker.posted[i],
        sections: [],
        biomes: new Uint8Array(256),
        grassTints: new Uint8Array(768),
        foliageTints: new Uint8Array(768),
        columnMs: 1,
        sectionCount: 0,
        perSectionMs: 0,
      },
    } as MessageEvent);
  reply(first!, 1);
  expect(first!.posted).toHaveLength(9);
  for (let i = 0; i < 9; i++) if (i !== 1) reply(first!, i);
  for (let i = 0; i < 8; i++) reply(second!, i);
  expect((await Promise.all(results)).map((result) => result.cx)).toEqual(
    Array.from({ length: 17 }, (_, i) => i),
  );
  expect(pool.queueLength).toBe(0);
  pool.terminate();
});
