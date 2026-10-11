import { afterEach, expect, it, vi } from 'vitest';
import { WorkerPool } from '../../src/mesh/worker-pool';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { buildMeshLookupTables, greedyMesh } from '../../src/mesh/greedy';

class HeldWorker {
  static instances: HeldWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: Array<{ id: number }> = [];
  constructor() {
    HeldWorker.instances.push(this);
  }
  postMessage(data: { id: number } | { jobs: Array<{ id: number }> }) {
    this.posted.push(...('jobs' in data ? data.jobs : [data]));
  }
  terminate() {}
}

afterEach(() => {
  vi.unstubAllGlobals();
  HeldWorker.instances = [];
});

it('posts a bounded backlog while reserving a worker for foreground work and matches replies', async () => {
  vi.stubGlobal('Worker', HeldWorker);
  const pool = new WorkerPool(2);
  const tables = buildMeshLookupTables(BlockRegistry.getInstance(), () => 1);
  const empty = new Uint16Array(18 ** 3);
  const results = Array.from({ length: 33 }, (_, i) =>
    pool.enqueueMeshJob(i, 0, 0, empty.slice(), tables, true),
  );
  await Promise.resolve();
  const [background, foreground] = HeldWorker.instances;
  expect(background!.posted).toHaveLength(32);
  expect(foreground!.posted).toHaveLength(0);
  results.push(pool.enqueueMeshJob(33, 0, 0, empty.slice(), tables));
  await Promise.resolve();
  expect(foreground!.posted).toHaveLength(1);
  expect(pool.queueLength).toBe(34);
  const reply = (worker: HeldWorker, i: number) =>
    worker.onmessage!({
      data: {
        id: worker.posted[i]!.id,
        meshData: greedyMesh(empty, tables),
        duration: 1,
      },
    } as MessageEvent);
  reply(background!, 0);
  await Promise.resolve();
  expect(background!.posted).toHaveLength(33);
  for (let i = 1; i < 33; i++) reply(background!, i);
  reply(foreground!, 0);
  expect((await Promise.all(results)).map((result) => result.sx)).toEqual(
    Array.from({ length: 34 }, (_, i) => i),
  );
  expect(pool.queueLength).toBe(0);
  pool.terminate();
});
