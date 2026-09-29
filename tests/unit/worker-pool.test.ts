import { describe, test, expect, beforeAll } from 'vitest';
import { WorkerPool } from '../../src/mesh/worker-pool';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { buildMeshLookupTables, greedyMesh } from '../../src/mesh/greedy';

class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;

  postMessage(data: unknown, _transferables?: Transferable[]) {
    setTimeout(() => {
      const { id, paddedSection, tables } = data as {
        id: number;
        paddedSection: Uint16Array;
        tables: ReturnType<typeof buildMeshLookupTables>;
      };
      const start = performance.now();
      const meshData = greedyMesh(paddedSection, tables);
      const duration = performance.now() - start;
      if (this.onmessage) {
        this.onmessage({
          data: { id, meshData, duration },
        } as MessageEvent);
      }
    }, 0);
  }

  terminate() {}
}

describe('Worker Pool (M02c)', () => {
  beforeAll(() => {
    if (typeof globalThis.Worker === 'undefined') {
      (globalThis as unknown as Record<string, unknown>).Worker = MockWorker;
    }
  });

  test('reports workerCount and enqueues mesh job', async () => {
    const registry = BlockRegistry.getInstance();
    const tables = buildMeshLookupTables(registry, () => 1);
    const pool = new WorkerPool(2);

    expect(pool.workerCount).toBe(2);

    const paddedSection = new Uint16Array(18 * 18 * 18);
    const stoneState = registry.getDefaultStateId('stone') ?? 1;
    for (let py = 1; py <= 16; py++) {
      for (let pz = 1; pz <= 16; pz++) {
        for (let px = 1; px <= 16; px++) {
          paddedSection[px + 18 * (py + 18 * pz)] = stoneState;
        }
      }
    }

    const promise = pool.enqueueMeshJob(0, 0, 0, paddedSection, tables);
    expect(pool.queueLength).toBeGreaterThanOrEqual(0);

    const result = await promise;
    expect(result.key).toBe('0,0,0');
    expect(result.meshData).toBeDefined();
    expect(pool.meshMsP95).toBeGreaterThanOrEqual(0);

    pool.terminate();
  });
});
