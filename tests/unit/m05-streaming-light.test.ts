import { expandBlockColumns, type BlockColumnsSnapshot } from '../../src/world/block-snapshot';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Streamer, type StreamerHost } from '../../src/world/streamer';
import { WorldManager } from '../../src/world/world-manager';
import { World } from '../../src/world/world';
import type { LightColumns } from '../../src/world/batch-light';

function setup(commitCost = 0) {
  const committed = new Set<string>();
  const meshes: string[] = [];
  const pending: Array<{ columns: Array<{ cx: number; cz: number }>; finish(): void }> = [];
  const host: StreamerHost<void, void> = {
    requestGen: async () => {
      throw new Error('All test block columns were adopted');
    },
    applyGen: () => [],
    requestLight: (columns) =>
      new Promise((resolve) =>
        pending.push({
          columns,
          finish: () =>
            resolve(
              columns.map(({ cx, cz }) => ({
                cx,
                cz,
                apply: () => {
                  committed.add(`${cx},${cz}`);
                  if (commitCost) vi.setSystemTime(Date.now() + commitCost);
                },
              })),
            ),
        }),
      ),
    requestMesh: (cx, cz) => {
      expect(committed.has(`${cx},${cz}`)).toBe(true);
      meshes.push(`${cx},${cz}`);
      return [];
    },
    uploadSection: () => {},
    beginMeshAttempt: () => {},
    endMeshAttempt: () => false,
    abandonMeshAttempt: () => {},
    freeMesh: () => {},
    freeData: () => {},
    now: () => Date.now(),
  };
  const streamer = new Streamer(host);
  streamer.active = false;
  streamer.reset();
  for (let z = -3; z <= 3; z++) for (let x = -3; x <= 3; x++) streamer.adoptColumn(x, z);
  return { streamer, committed, meshes, pending };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('an edit in an unlit border invalidates a neighbouring light snapshot', () => {
  const invalidated: string[] = [];
  const manager = Object.create(WorldManager.prototype) as {
    lightColumns: LightColumns;
    streamer: { invalidateLight(cx: number, cz: number): void; invalidate(): void };
    configureLighting(world: World): void;
  };
  manager.lightColumns = { '0,0': Array<number>(20).fill(0) };
  manager.streamer = {
    invalidateLight: (cx, cz) => invalidated.push(`${cx},${cz}`),
    invalidate: () => {},
  };
  const world = new World();
  world.getColumn(0, 0);
  manager.configureLighting(world);
  // Its torch reaches the adjoining column, even though incremental BFS must not enter this
  // unlit border. A neighbour already computing its light must reject the old block snapshot.
  world.setBlock(8, 20, 8, 'torch');
  expect(world.lightEngine.storage.touchedSections.size).toBe(0);
  expect(invalidated).toContain('1,0');
  expect(new Set(invalidated).size).toBe(invalidated.length);
});

it('a column lit before a region request is subsequently meshed', async () => {
  const { streamer, committed, meshes, pending } = setup();
  committed.add('0,0');
  streamer.markLit(0, 0);
  expect(streamer.phaseOf(0, 0)).toBe('lit');
  const ready = streamer.requestRegion({ cx: 0, cz: 0, genRadius: 1, meshRadius: 0 });
  await vi.advanceTimersByTimeAsync(10);
  await ready;
  expect(meshes).toEqual(['0,0']);
  expect(pending).toHaveLength(0);
});

it('light starts at the nearest column, counts as busy, and never remeshes neighbours', async () => {
  const { streamer, meshes, pending } = setup();
  const ready = streamer.requestRegion({ cx: 0, cz: 0, genRadius: 3, meshRadius: 2 });
  expect(pending[0]!.columns[0]).toEqual({ cx: 0, cz: 0 });
  expect(streamer.getStats().lightRunning).toBeGreaterThan(0);
  expect(streamer.busy).toBe(true);
  for (let i = 0; i < 30 && streamer.busy; i++) {
    pending.splice(0).forEach((batch) => batch.finish());
    await vi.advanceTimersByTimeAsync(10);
  }
  await ready;
  expect(meshes).toHaveLength(25);
  expect(new Set(meshes).size).toBe(25);
  expect(streamer.getStats().completed.lit).toBe(25);
  expect(streamer.getStats().completed.meshed).toBe(25);
  expect(streamer.getStats().completed.uploaded).toBe(25);
  expect(streamer.busy).toBe(false);
});

it('an edit rejects only its stale column within a light batch', async () => {
  const { streamer, committed, pending } = setup();
  void streamer.requestRegion({ cx: 0, cz: 0, genRadius: 3, meshRadius: 2 });
  const first = pending.shift()!;
  expect(first.columns.length).toBeGreaterThan(1);
  const stale = first.columns[0]!;
  streamer.invalidateLight(stale.cx, stale.cz);
  first.finish();
  await vi.advanceTimersByTimeAsync(10);
  expect(committed.has(`${stale.cx},${stale.cz}`)).toBe(false);
  for (const column of first.columns.slice(1))
    expect(committed.has(`${column.cx},${column.cz}`)).toBe(true);
  expect(streamer.getStats().cancels.light).toBe(1);
  streamer.reset();
});

it('batches a ready strip along Z when it is longer than the ready strip along X', () => {
  const { streamer, committed, pending } = setup();
  for (const x of [1, 2]) {
    committed.add(`${x},0`);
    streamer.markLit(x, 0);
  }
  void streamer.requestRegion({ cx: 0, cz: 0, genRadius: 3, meshRadius: 2 });
  expect(pending[0]!.columns).toEqual([
    { cx: 0, cz: 0 },
    { cx: 0, cz: 1 },
    { cx: 0, cz: 2 },
  ]);
  streamer.reset();
});

it('splits a finished light batch across pump slices and checks edits before each commit', async () => {
  const { streamer, committed, pending } = setup(4);
  void streamer.requestRegion({ cx: 0, cz: 0, genRadius: 3, meshRadius: 2 });
  const batch = pending.shift()!;
  expect(batch.columns.length).toBeGreaterThan(1);
  batch.finish();
  await Promise.resolve();
  const running = streamer.getStats().lightRunning;
  streamer.pump();
  expect(committed.size).toBe(1);
  expect(streamer.getStats().lightRunning).toBe(running);
  const stale = batch.columns[1]!;
  streamer.invalidateLight(stale.cx, stale.cz);
  streamer.pump();
  expect(committed.has(`${stale.cx},${stale.cz}`)).toBe(false);
  streamer.reset();
});

it('copies light block sections in separate tasks without transferring the editable source arrays', async () => {
  const manager = Object.create(WorldManager.prototype) as {
    lightColumns: LightColumns;
    world: World;
    copyLightColumns(bounds: {
      minCX: number;
      maxCX: number;
      minCZ: number;
      maxCZ: number;
    }): Promise<{ blocks: BlockColumnsSnapshot; workMs: number; maxSliceMs: number }>;
  };
  const source = new Uint16Array(4096).fill(17);
  source[0] = 18;
  manager.world = new World();
  const column = manager.world.getColumn(0, 0)!;
  for (const sy of [1, 2, 3]) column.getOrCreateSection(sy)!.loadBlockStatesFrom(source);
  manager.lightColumns = { '0,0': [0, source, source, source] };
  let now = 0;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now++);
  const copied = manager.copyLightColumns({ minCX: 0, maxCX: 0, minCZ: 0, maxCZ: 0 });
  let finished = false;
  void copied.then(() => {
    finished = true;
  });
  await Promise.resolve();
  expect(finished).toBe(false);
  await vi.advanceTimersByTimeAsync(30);
  const result = await copied;
  const decoded = expandBlockColumns(result.blocks);
  expect(decoded['0,0']![0]).toBe(0);
  expect(decoded['0,0']![1]).toEqual(source);
  expect(decoded['0,0']![1]).not.toBe(source);
  expect(source.byteLength).toBe(8192);
  expect(result.maxSliceMs).toBeLessThanOrEqual(2);
  clock.mockRestore();
});
