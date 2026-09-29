import { describe, test, expect } from 'vitest';
import { WorkerPool } from '../../src/mesh/worker-pool';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { buildMeshLookupTables } from '../../src/mesh/greedy';

describe('Worker Pool (M02c)', () => {
  test('enqueues mesh job and reports meshMsP95 and queueLength', async () => {
    const registry = BlockRegistry.getInstance();
    const tables = buildMeshLookupTables(registry, () => 1);
    const pool = new WorkerPool(2);

    const paddedSection = new Uint16Array(18 * 18 * 18);
    // Fill core with stone state
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
