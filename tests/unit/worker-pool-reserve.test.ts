import { describe, test, expect, beforeEach, vi } from 'vitest';
import { WorkerPool } from '../../src/mesh/worker-pool';
import type { MeshLookupTables } from '../../src/mesh/greedy';

/** A worker that keeps every job until the test answers it. */
class HoldWorker {
  static all: HoldWorker[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  jobs: number[] = [];

  constructor() {
    HoldWorker.all.push(this);
  }

  postMessage(data: { id: number }, transfer: Transferable[] = []) {
    structuredClone(data, { transfer }); // detaches the transferred buffers, like a real worker
    this.jobs.push(data.id);
  }

  answer() {
    const id = this.jobs.pop()!;
    this.onmessage?.({
      data: { id, meshData: { opaque: {}, cutout: {}, translucent: {} }, duration: 1 },
    } as MessageEvent);
  }

  terminate() {}
}

const tables = {} as MeshLookupTables;
const padded = () => new Uint16Array(18 * 18 * 18);

describe('WorkerPool: one worker stays free for foreground jobs', () => {
  beforeEach(() => {
    HoldWorker.all = [];
    vi.stubGlobal('Worker', HoldWorker);
  });

  test('streaming jobs leave the last idle worker alone, a foreground job takes it at once', () => {
    const pool = new WorkerPool(3);
    for (let i = 0; i < 6; i++) void pool.enqueueMeshJob(i, 0, 0, padded(), tables, true);
    const busy = () => HoldWorker.all.filter((w) => w.jobs.length > 0).length;
    expect(busy()).toBe(2);
    expect(pool.queueLength).toBe(6); // 2 running, 4 waiting

    const buffer = padded();
    void pool.enqueueMeshJob(9, 0, 0, buffer, tables);
    expect(buffer.buffer.byteLength).toBe(0); // transferred: it started at once
    expect(busy()).toBe(3);
    pool.terminate();
  });

  test('a finished worker picks the next streaming job while one stays free', () => {
    const pool = new WorkerPool(3);
    for (let i = 0; i < 4; i++) void pool.enqueueMeshJob(i, 0, 0, padded(), tables, true);
    const running = HoldWorker.all.filter((w) => w.jobs.length > 0);
    running[0]!.answer();
    expect(HoldWorker.all.filter((w) => w.jobs.length > 0).length).toBe(2);
    expect(pool.queueLength).toBe(3);
    pool.terminate();
  });

  test('a pool of one worker runs every streaming job, one after the other', async () => {
    const pool = new WorkerPool(1);
    const done: Promise<unknown>[] = [];
    for (let i = 0; i < 4; i++) done.push(pool.enqueueMeshJob(i, 0, 0, padded(), tables, true));
    const worker = HoldWorker.all[0]!;
    for (let i = 0; i < 4; i++) {
      expect(worker.jobs.length).toBe(1); // the next job started when the last one finished
      worker.answer();
    }
    await expect(Promise.all(done)).resolves.toHaveLength(4);
    expect(pool.queueLength).toBe(0);
    pool.terminate();
  });

  test('a pool of one worker has no reserve', () => {
    const pool = new WorkerPool(1);
    void pool.enqueueMeshJob(0, 0, 0, padded(), tables, true);
    expect(HoldWorker.all[0]!.jobs.length).toBe(1);
    pool.terminate();
  });
});
