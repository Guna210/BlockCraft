import { afterEach, expect, it, vi } from 'vitest';
import { LightWorkerPool } from '../../src/workers/light-worker-pool';
import { computeBatchLight, type LightColumns, type LightRect } from '../../src/world/batch-light';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { buildLightLookupTables, computeRegionLight } from '../../src/world/lighting';

interface PostedBatch {
  id: number;
  bounds: LightRect;
  interior: LightRect;
  columns: LightColumns;
}
class HeldWorker {
  static instances: HeldWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: PostedBatch[] = [];
  pending: PostedBatch[] = [];
  constructor() {
    HeldWorker.instances.push(this);
  }
  postMessage(data: PostedBatch) {
    this.posted.push(data);
    this.pending.push(data);
  }
  answer(job: PostedBatch, columns = [] as ReturnType<typeof computeBatchLight>) {
    this.pending.splice(this.pending.indexOf(job), 1);
    this.onmessage!({
      data: { id: job.id, sections: [], columns, duration: job.id },
    } as MessageEvent);
  }
  terminate() {}
}
afterEach(() => {
  vi.unstubAllGlobals();
  HeldWorker.instances = [];
});
const rect = (x: number): LightRect => ({ minCX: x, maxCX: x, minCZ: 0, maxCZ: 0 });
function expectDisjoint() {
  const jobs = HeldWorker.instances.flatMap((worker) => worker.pending);
  for (let i = 0; i < jobs.length; i++)
    for (let j = i + 1; j < jobs.length; j++) {
      const a = jobs[i]!.interior;
      const b = jobs[j]!.interior;
      expect(a.maxCX < b.minCX || b.maxCX < a.minCX || a.maxCZ < b.minCZ || b.maxCZ < a.minCZ).toBe(
        true,
      );
    }
}

it.each([1, 2, 3, 4])(
  'uses all %i real light workers for ready disjoint batches',
  async (count) => {
    vi.stubGlobal('Worker', HeldWorker);
    const pool = new LightWorkerPool(count);
    const results = Array.from({ length: count }, (_, x) =>
      pool.enqueueBatch(rect(x), rect(x), { [`${x},0`]: [0] }),
    );
    expect(HeldWorker.instances).toHaveLength(count);
    expect(HeldWorker.instances.every((worker) => worker.pending.length === 1)).toBe(true);
    expect(pool.queueLength).toBe(count);
    expectDisjoint();
    for (const worker of [...HeldWorker.instances].reverse()) worker.answer(worker.pending[0]!);
    expect((await Promise.all(results)).map((result) => result.duration)).toEqual(
      Array.from({ length: count }, (_, i) => i + 1),
    );
    expect(pool.queueLength).toBe(0);
    pool.terminate();
  },
);

it('queues overlapping interiors, dispatches other ready work and keeps every in-flight pair disjoint', async () => {
  vi.stubGlobal('Worker', HeldWorker);
  const pool = new LightWorkerPool(2);
  const interiors = [
    rect(0),
    rect(0),
    rect(1),
    { minCX: 0, maxCX: 1, minCZ: 0, maxCZ: 0 },
    rect(2),
  ];
  const results = interiors.map((interior) => pool.enqueueBatch(interior, interior, {}));
  expect(HeldWorker.instances.every((worker) => worker.pending.length > 0)).toBe(true);
  expect(
    HeldWorker.instances
      .flatMap((worker) => worker.pending)
      .map((job) => job.id)
      .sort(),
  ).toEqual([1, 3, 5]);
  expect(pool.queueLength).toBe(5);
  expectDisjoint();
  while (pool.queueLength > 0) {
    const worker = [...HeldWorker.instances].reverse().find((item) => item.pending.length > 0)!;
    worker.answer(worker.pending.at(-1)!);
    expectDisjoint();
  }
  expect((await Promise.all(results)).map((result) => result.duration)).toEqual([1, 2, 3, 4, 5]);
  expect(
    HeldWorker.instances
      .flatMap((worker) => worker.posted)
      .map((job) => job.id)
      .sort(),
  ).toEqual([1, 2, 3, 4, 5]);
  pool.terminate();
});

it('bounds posted batches per worker and correlates out-of-order replies without losing queued work', async () => {
  vi.stubGlobal('Worker', HeldWorker);
  const pool = new LightWorkerPool(2);
  const results = Array.from({ length: 11 }, (_, x) =>
    pool.enqueueBatch(rect(x), rect(x), { [`${x},0`]: [0] }),
  );
  expect(HeldWorker.instances.map((worker) => worker.pending.length)).toEqual([4, 4]);
  expect(pool.queueLength).toBe(11);
  while (pool.queueLength > 0) {
    const worker = [...HeldWorker.instances].reverse().find((item) => item.pending.length > 0)!;
    worker.answer(worker.pending.at(-1)!);
    expect(HeldWorker.instances.every((item) => item.pending.length <= 4)).toBe(true);
    expectDisjoint();
  }
  expect((await Promise.all(results)).map((result) => result.duration)).toEqual(
    Array.from({ length: 11 }, (_, i) => i + 1),
  );
  expect(
    HeldWorker.instances
      .flatMap((worker) => worker.posted)
      .map((job) => job.id)
      .sort((a, b) => a - b),
  ).toEqual(Array.from({ length: 11 }, (_, i) => i + 1));
  pool.terminate();
});

it('parallel batches match the exact region reference in either completion order, including RGB and skirts', async () => {
  vi.stubGlobal('Worker', HeldWorker);
  const registry = BlockRegistry.getInstance();
  const tables = buildLightLookupTables(registry);
  const stone = registry.getStateId('stone')!;
  const columns: LightColumns = {};
  for (let z = -2; z <= 2; z++)
    for (let x = -2; x <= 2; x++) columns[`${x},${z}`] = [stone, 0, stone];
  const emitting = new Uint16Array(4096);
  emitting[15] = registry.getStateId('torch')!;
  emitting[(1 << 8) | (8 << 4) | 15] = registry.getStateId('lumite_ore')!;
  columns['-1,0']![1] = emitting;
  const bounds = { minCX: -2, maxCX: 2, minCZ: -2, maxCZ: 2 };
  const interior = { minCX: 0, maxCX: 1, minCZ: 0, maxCZ: 0 };
  const reference = computeRegionLight(2, columns, tables);
  const exact = computeBatchLight(bounds, interior, columns, tables);
  const completed = [];
  for (const order of [
    [0, 1],
    [1, 0],
  ]) {
    HeldWorker.instances = [];
    const pool = new LightWorkerPool(2);
    const promises = [0, 1].map((x) => {
      const batchBounds = { minCX: x - 1, maxCX: x + 1, minCZ: -1, maxCZ: 1 };
      const neighbours = Object.fromEntries(
        Object.entries(columns).filter(([key]) => {
          const [cx, cz] = key.split(',').map(Number);
          return cx! >= batchBounds.minCX && cx! <= batchBounds.maxCX && Math.abs(cz!) <= 1;
        }),
      );
      return pool.enqueueBatch(batchBounds, rect(x), neighbours);
    });
    expect(HeldWorker.instances.every((worker) => worker.pending.length === 1)).toBe(true);
    expectDisjoint();
    for (const index of order) {
      const worker = HeldWorker.instances[index]!;
      const job = worker.pending[0]!;
      worker.answer(job, computeBatchLight(job.bounds, job.interior, job.columns, tables));
      expectDisjoint();
    }
    const result = (await Promise.all(promises)).flatMap((batch) => batch.columns!);
    expect(result).toEqual(exact);
    for (const column of result)
      for (const section of column.sections) {
        const raw =
          typeof section.lightData === 'number'
            ? new Uint8Array(4096).fill(section.lightData)
            : section.lightData;
        expect(raw).toEqual(reference.get(section.key) ?? new Uint8Array(4096));
      }
    completed.push(result);
    expect(pool.queueLength).toBe(0);
    pool.terminate();
  }
  expect(completed[0]).toEqual(completed[1]);
});
