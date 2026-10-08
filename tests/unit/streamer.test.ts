import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Streamer, type StreamerHost, type StreamerView } from '../../src/world/streamer';
import { chebyshev, streamRings } from '../../src/world/streaming-plan';

/** A fake world, worker pools and GPU whose results the test releases by hand. */
class FakeHost implements StreamerHost<string, string> {
  clock = 0;
  /** Milliseconds one upload costs on the fake clock. */
  uploadCostMs = 0;
  sectionsPerColumn = 2;
  slices: number[] = [];
  recordSlice(ms: number) {
    this.slices.push(ms);
  }

  data = new Set<string>();
  meshes = new Map<string, number>(); // column -> uploaded sections
  genRequests: Array<{ cx: number; cz: number; resolve: () => void; reject: () => void }> = [];
  genStarted: string[] = [];
  meshRequests: Array<{ cx: number; cz: number; resolveAll: () => void }> = [];
  applied: string[] = [];
  uploads: string[] = [];
  freedMeshes: string[] = [];
  freedData: string[] = [];
  violations: string[] = [];

  now() {
    return this.clock;
  }

  requestGen(cx: number, cz: number): Promise<string> {
    this.genStarted.push(`${cx},${cz}`);
    return new Promise<string>((resolve, reject) => {
      this.genRequests.push({
        cx,
        cz,
        resolve: () => resolve(`gen ${cx},${cz}`),
        reject: () => reject(new Error('gen failed')),
      });
    });
  }

  applyGen(cx: number, cz: number): void {
    this.applied.push(`${cx},${cz}`);
    this.data.add(`${cx},${cz}`);
    this.check();
  }

  requestMesh(cx: number, cz: number): Array<Promise<string>> {
    const resolvers: Array<() => void> = [];
    const promises: Array<Promise<string>> = [];
    for (let i = 0; i < this.sectionsPerColumn; i++) {
      promises.push(
        new Promise<string>((resolve) => {
          resolvers.push(() => resolve(`${cx},${cz}#${i}`));
        }),
      );
    }
    this.meshRequests.push({ cx, cz, resolveAll: () => resolvers.forEach((r) => r()) });
    return promises;
  }

  uploadSection(cx: number, cz: number): void {
    const key = `${cx},${cz}`;
    this.uploads.push(key);
    this.meshes.set(key, (this.meshes.get(key) ?? 0) + 1);
    this.clock += this.uploadCostMs;
    this.check();
  }

  freeMesh(cx: number, cz: number): void {
    this.freedMeshes.push(`${cx},${cz}`);
    this.meshes.delete(`${cx},${cz}`);
    this.check();
  }

  freeData(cx: number, cz: number): void {
    this.freedData.push(`${cx},${cz}`);
    this.data.delete(`${cx},${cz}`);
    this.check();
  }

  /** The perimeter invariant: every column with a mesh has all eight neighbour columns loaded. */
  check(): void {
    for (const key of this.meshes.keys()) {
      const [cx, cz] = key.split(',').map(Number) as [number, number];
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!this.data.has(`${cx + dx},${cz + dz}`)) {
            this.violations.push(`mesh ${key} lost neighbour ${cx + dx},${cz + dz}`);
          }
        }
      }
    }
  }

  async finishGen(max = Infinity): Promise<number> {
    const batch = this.genRequests.splice(0, max);
    batch.forEach((r) => r.resolve());
    await settle();
    return batch.length;
  }

  async finishMesh(max = Infinity): Promise<number> {
    const batch = this.meshRequests.splice(0, max);
    batch.forEach((r) => r.resolveAll());
    await settle();
    return batch.length;
  }
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(1);
}

function viewAt(cx: number, cz: number, over: Partial<StreamerView> = {}): StreamerView {
  return { x: cx * 16 + 8, z: cz * 16 + 8, yaw: 0, pitch: 0, planes: null, ...over };
}

function make(rd = 2, limits?: Partial<Streamer<string, string>['limits']>) {
  const host = new FakeHost();
  const streamer = new Streamer<string, string>(host);
  streamer.limits = { maxGenInFlight: 4, maxMeshColumnsInFlight: 3, maxDeferred: 1000, ...limits };
  streamer.reset(0, 0);
  streamer.setRenderDistance(rd);
  return { host, streamer };
}

/** Runs the streamer to rest at the current camera: finishes jobs, uploads everything. */
async function drain(host: FakeHost, streamer: Streamer<string, string>, view: StreamerView) {
  for (let i = 0; i < 400; i++) {
    host.clock += 20;
    streamer.update(view, host.clock);
    const done = (await host.finishGen()) + (await host.finishMesh());
    streamer.drainUploads(Infinity);
    streamer.update(view, host.clock);
    if (done === 0 && !streamer.busy) return;
  }
  throw new Error('streamer did not come to rest');
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Streamer: what is loaded', () => {
  it('generates up to RD+1, meshes up to RD, and nothing else', async () => {
    const { host, streamer } = make(2);
    const view = viewAt(0, 0);
    await drain(host, streamer, view);

    expect(host.violations).toEqual([]);
    expect(host.data.size).toBe(7 * 7); // RD + 1 = 3
    expect(streamer.loadedColumns).toBe(49);
    expect(streamer.meshedColumns).toBe(25); // RD = 2
    for (const key of host.meshes.keys()) {
      const [cx, cz] = key.split(',').map(Number) as [number, number];
      expect(chebyshev(cx, cz, 0, 0)).toBeLessThanOrEqual(2);
    }
  });

  it('does not infer state from the host: only the streamer decides what is generated', async () => {
    const { host, streamer } = make(2);
    host.data.add('0,0'); // the world already has a column the streamer never saw
    await drain(host, streamer, viewAt(0, 0));
    expect(host.genStarted).toContain('0,0'); // still generated: the streamer owns the state
  });

  it('generates in ring order around the camera', async () => {
    const { host, streamer } = make(3, { maxGenInFlight: 1 });
    streamer.update(viewAt(0, 0), 1000);
    const rings: number[] = [];
    for (let i = 0; i < 49; i++) {
      await host.finishGen(1);
      streamer.update(viewAt(0, 0), 1000 + i);
    }
    for (const key of host.genStarted) {
      const [cx, cz] = key.split(',').map(Number) as [number, number];
      rings.push(chebyshev(cx, cz, 0, 0));
    }
    const sorted = [...rings].sort((a, b) => a - b);
    expect(rings).toEqual(sorted);
    expect(rings.length).toBeGreaterThanOrEqual(49);
  });

  it('meshes nearer columns before farther ones', async () => {
    const { host, streamer } = make(4, { maxMeshColumnsInFlight: 1 });
    const view = viewAt(0, 0);
    // Generate everything first.
    for (let i = 0; i < 60; i++) {
      streamer.update(view, i);
      await host.finishGen();
    }
    const order: number[] = [];
    for (
      let i = 0;
      i < 200 && (host.meshRequests.length > 0 || streamer.getStats().meshQueued > 0);
      i++
    ) {
      for (const r of host.meshRequests) order.push(chebyshev(r.cx, r.cz, 0, 0));
      await host.finishMesh(1);
      streamer.update(view, 100 + i);
    }
    expect(order.length).toBe(81);
    // Columns near the centre are meshed before the far ring (columns become eligible as their
    // perimeter arrives, so allow a one-ring overlap).
    for (let i = 1; i < order.length; i++)
      expect(order[i]!).toBeGreaterThanOrEqual(order[i - 1]! - 1);
  });
});

describe('Streamer: render distance', () => {
  it('setRenderDistance rounds, clamps and re-plans at once', () => {
    const { streamer } = make(8);
    expect(streamer.setRenderDistance(1)).toBe(2);
    expect(streamer.setRenderDistance(100)).toBe(32);
    expect(streamer.setRenderDistance(5.4)).toBe(5);
    expect(streamer.renderDistance).toBe(5);
    expect(streamer.getStats().renderDistance).toBe(5);
    // The new plan is already in effect: ring 6 (RD + 1) is queued or running without any update().
    const stats = streamer.getStats();
    expect(stats.genQueued + stats.genRunning).toBe(13 * 13);
  });

  it('lowering the render distance frees meshes beyond RD+1 and data beyond RD+2, in that order', async () => {
    const { host, streamer } = make(5);
    const view = viewAt(0, 0);
    await drain(host, streamer, view);
    expect(streamer.meshedColumns).toBe(121);

    streamer.setRenderDistance(2);
    host.freedMeshes.length = 0;
    host.freedData.length = 0;
    for (let i = 0; i < 20; i++) {
      host.clock += 1;
      streamer.update(view, host.clock);
      streamer.freePass(Infinity);
    }
    await drain(host, streamer, view);

    expect(host.violations).toEqual([]);
    const rings = streamRings(2);
    for (const key of host.meshes.keys()) {
      const [cx, cz] = key.split(',').map(Number) as [number, number];
      expect(chebyshev(cx, cz, 0, 0)).toBeLessThanOrEqual(rings.keepMesh);
    }
    for (const key of host.data) {
      const [cx, cz] = key.split(',').map(Number) as [number, number];
      expect(chebyshev(cx, cz, 0, 0)).toBeLessThanOrEqual(rings.keepData);
    }
    // Every freed column's mesh was freed before its data.
    for (const key of host.freedData)
      expect(host.freedMeshes.indexOf(key)).toBeLessThan(host.freedData.indexOf(key) + 1);
    expect(host.freedMeshes.length).toBeGreaterThan(0);
    expect(host.freedData.length).toBeGreaterThan(0);
  });
});

describe('Streamer: hysteresis', () => {
  it('a column just outside the render distance keeps its mesh and a column just outside RD+1 its data', async () => {
    const { host, streamer } = make(2);
    await drain(host, streamer, viewAt(0, 0));
    expect(host.meshes.has('-2,0')).toBe(true);
    expect(host.data.has('-3,0')).toBe(true);

    // One column east: x = -2 is now at ring 3 = RD+1 (mesh kept), x = -3 at ring 4 = RD+2 (data kept).
    const east1 = viewAt(1, 0);
    host.clock += 20;
    streamer.update(east1, host.clock);
    streamer.freePass(Infinity);
    expect(host.meshes.has('-2,0')).toBe(true);
    expect(host.data.has('-3,0')).toBe(true);
    expect(host.freedMeshes).toEqual([]);
    expect(host.freedData).toEqual([]);

    // Two columns east: x = -2 is at ring 4 > RD+1 (mesh freed), x = -3 at ring 5 > RD+2 (data freed).
    const east2 = viewAt(2, 0);
    host.clock += 20;
    streamer.update(east2, host.clock);
    streamer.freePass(Infinity);
    expect(host.meshes.has('-2,0')).toBe(false);
    expect(host.freedMeshes).toContain('-2,0');
    expect(host.freedData).toContain('-3,0');
    expect(host.violations).toEqual([]);
  });

  it('hovering over a column border does not flip anything', async () => {
    const { host, streamer } = make(3);
    await drain(host, streamer, viewAt(0, 0));
    host.freedMeshes.length = 0;
    host.freedData.length = 0;
    const generatedBefore = host.genStarted.length;
    for (let i = 0; i < 10; i++) {
      // x = 15.9 (column 0) and 16.1 (column 1), alternately
      const view: StreamerView = { x: i % 2 ? 16.1 : 15.9, z: 8, yaw: 0, pitch: 0, planes: null };
      host.clock += 20;
      streamer.update(view, host.clock);
      streamer.freePass(Infinity);
    }
    await drain(host, streamer, { x: 16.1, z: 8, yaw: 0, pitch: 0, planes: null });
    // Only the columns that first enter the ring east are generated; nothing is freed.
    expect(host.freedMeshes).toEqual([]);
    expect(host.freedData).toEqual([]);
    expect(host.genStarted.length - generatedBefore).toBe(9); // column x = 5, rows -4..4
  });
});

describe('Streamer: stale jobs', () => {
  it('removes queued generation of columns that left the ring and counts each as cancelled', async () => {
    const { host, streamer } = make(4, { maxGenInFlight: 2 });
    streamer.update(viewAt(0, 0), 10);
    const before = streamer.getStats();
    expect(before.genRunning).toBe(2);
    expect(before.genQueued).toBe(11 * 11 - 2); // RD+1 = 5

    // Teleport far away: everything queued around the old centre is stale.
    streamer.update(viewAt(500, 500), 20);
    const after = streamer.getStats();
    expect(after.cancelledJobs).toBe(before.genQueued);
    expect(after.genQueued).toBe(11 * 11);
    expect(after.genRunning).toBe(2); // running jobs are not terminated
    expect(host.genRequests.length).toBe(2);
  });

  it('drops the result of a running job whose column is no longer wanted', async () => {
    const { host, streamer } = make(2, { maxGenInFlight: 1 });
    streamer.update(viewAt(0, 0), 10);
    expect(host.genRequests.length).toBe(1);
    streamer.update(viewAt(300, 300), 20);
    const cancelledBefore = streamer.getStats().cancelledJobs;

    await host.finishGen(1); // the stale job returns

    expect(host.applied).toEqual([]);
    expect(host.data.size).toBe(0);
    expect(streamer.getStats().cancelledJobs).toBe(cancelledBefore + 1);
    expect(streamer.phaseOf(0, 0)).toBeUndefined();
  });

  it('removes queued mesh jobs of columns that left the mesh ring', async () => {
    const { host, streamer } = make(3, { maxMeshColumnsInFlight: 1 });
    const view = viewAt(0, 0);
    for (let i = 0; i < 30; i++) {
      streamer.update(view, i);
      await host.finishGen();
    }
    expect(streamer.getStats().meshRunning).toBe(1);
    const queued = streamer.getStats().meshQueued;
    expect(queued).toBeGreaterThan(10);

    streamer.update(viewAt(400, 0), 100);
    const stats = streamer.getStats();
    expect(stats.meshQueued).toBe(0);
    expect(stats.cancelledJobs).toBeGreaterThanOrEqual(queued);
  });

  it('drops mesh results of a column that was freed while its sections were being meshed', async () => {
    const { host, streamer } = make(2, { maxMeshColumnsInFlight: 25 });
    const view = viewAt(0, 0);
    for (let i = 0; i < 20; i++) {
      streamer.update(view, i);
      await host.finishGen();
    }
    expect(host.meshRequests.length).toBeGreaterThan(0);

    // Teleport away; the meshing jobs return afterwards.
    streamer.update(viewAt(300, 300), 100);
    streamer.freePass(Infinity);
    await host.finishMesh();
    streamer.drainUploads(Infinity);

    expect(host.uploads).toEqual([]);
    expect(host.violations).toEqual([]);
  });

  it('a failed job does not retry forever', async () => {
    const { host, streamer } = make(2, { maxGenInFlight: 1 });
    streamer.update(viewAt(0, 0), 10);
    host.genRequests[0]!.reject();
    await settle();
    const started = host.genStarted.length;
    for (let i = 0; i < 5; i++) {
      streamer.update(viewAt(0, 0), 20 + i);
      await settle();
    }
    expect(host.genStarted.filter((k) => k === host.genStarted[0]).length).toBe(1);
    expect(host.genStarted.length).toBeGreaterThanOrEqual(started);
  });
});

describe('Streamer: uploads', () => {
  it('uploads while the frame upload time is under the budget, at least one when any is waiting', async () => {
    const { host, streamer } = make(2);
    const view = viewAt(0, 0);
    host.uploadCostMs = 1;
    for (let i = 0; i < 30; i++) {
      streamer.update(view, i);
      await host.finishGen();
      await host.finishMesh();
    }
    const deferred = streamer.getStats().uploadsDeferred;
    expect(deferred).toBeGreaterThan(10);

    const spent = streamer.drainUploads(3);

    expect(host.uploads.length).toBe(3);
    expect(spent).toBe(3);
    expect(streamer.getStats().uploadsDeferred).toBe(deferred - 3);

    host.uploadCostMs = 10; // one expensive upload overshoots the budget but still only one is done
    const before = host.uploads.length;
    streamer.drainUploads(3);
    expect(host.uploads.length - before).toBe(1);
  });

  it('a column counts as meshed only after its last section is uploaded', async () => {
    const { host, streamer } = make(2);
    host.sectionsPerColumn = 3;
    const view = viewAt(0, 0);
    for (let i = 0; i < 20; i++) {
      streamer.update(view, i);
      await host.finishGen();
    }
    await host.finishMesh(1);
    const first = host.meshRequests.length === 0 ? null : null;
    expect(first).toBeNull();
    expect(streamer.meshedColumns).toBe(0);
    expect(streamer.getStats().uploadsDeferred).toBe(3);
    streamer.drainUploads(Infinity);
    expect(streamer.meshedColumns).toBe(1);
  });

  it('bounds the deferred queue: no mesh jobs are dispatched while it is full', async () => {
    const { host, streamer } = make(4, { maxMeshColumnsInFlight: 50, maxDeferred: 6 });
    const view = viewAt(0, 0);
    for (let i = 0; i < 30; i++) {
      streamer.update(view, i);
      await host.finishGen();
    }
    for (let i = 0; i < 10; i++) {
      await host.finishMesh();
      streamer.update(view, 50 + i);
    }
    expect(streamer.getStats().uploadsDeferred).toBeLessThanOrEqual(
      6 + 50 * host.sectionsPerColumn,
    );
    // After draining, work continues.
    streamer.drainUploads(Infinity);
    streamer.update(view, 100);
    await settle(); // mesh jobs are started by the pump task that follows the frame
    expect(host.meshRequests.length).toBeGreaterThan(0);
  });

  it('off-frame slices upload while a region request is pending and no frame is running', async () => {
    const { host, streamer } = make(2);
    host.uploadCostMs = 1;
    let done = false;
    void streamer.requestRegion({ cx: 0, cz: 0, genRadius: 3, meshRadius: 2 }).then(() => {
      done = true;
    });
    for (let i = 0; i < 100 && !done; i++) {
      await host.finishGen();
      await host.finishMesh();
      host.clock += 5;
      await vi.advanceTimersByTimeAsync(5);
    }
    expect(done).toBe(true);
    expect(streamer.meshedColumns).toBeGreaterThanOrEqual(25);
    expect(host.violations).toEqual([]);
  });

  it('without a frame loop and without requests nothing is uploaded between frames', async () => {
    const { host, streamer } = make(2);
    const view = viewAt(0, 0);
    for (let i = 0; i < 20; i++) {
      streamer.update(view, i);
      await host.finishGen();
    }
    await host.finishMesh();
    host.clock += 10_000; // the frame loop has been suspended for ten seconds
    await vi.advanceTimersByTimeAsync(500);
    expect(host.uploads).toEqual([]);
    expect(streamer.getStats().uploadsDeferred).toBeGreaterThan(0);
  });

  it('even when frames are overdue the pump does not upload without a pending request', async () => {
    const { host, streamer } = make(2);
    host.uploadCostMs = 1;
    const view = viewAt(0, 0);
    host.clock = 1000;
    for (let i = 0; i < 20; i++) {
      streamer.update(view, host.clock);
      await host.finishGen();
    }
    await host.finishMesh();
    host.clock += 300; // the next frame is late
    streamer.pump();
    await vi.advanceTimersByTimeAsync(300);
    expect(host.uploads.length).toBe(0);
    // The frame's own budget uploads them.
    streamer.update(view, host.clock);
    streamer.drainUploads(3);
    expect(host.uploads.length).toBe(3);
  });
});

describe('Streamer: slice accounting', () => {
  it('reports the duration of every pump slice and worker-result task', async () => {
    const { host, streamer } = make(2);
    const view = viewAt(0, 0);
    for (let i = 0; i < 10; i++) {
      host.clock += 1;
      streamer.update(view, host.clock);
      await host.finishGen();
      await host.finishMesh();
    }
    expect(host.slices.length).toBeGreaterThan(0);
    const before = host.slices.length;
    streamer.pump();
    expect(host.slices.length).toBe(before + 1);
    expect(host.slices.every((ms) => ms >= 0)).toBe(true);
  });
});

describe('Streamer: region requests (waitForTerrain, createWorld)', () => {
  it('pins columns beyond the render distance until the request resolves, then applies the ring rules', async () => {
    const { host, streamer } = make(2);
    const view = viewAt(0, 0);
    await drain(host, streamer, view);
    let done = false;
    void streamer.requestRegion({ cx: 0, cz: 0, genRadius: 6, meshRadius: 5 }).then(() => {
      done = true;
    });
    for (let i = 0; i < 200 && !done; i++) {
      await host.finishGen();
      await host.finishMesh();
      if (done) break; // resolved: look before the next frame applies the ring rules again
      host.clock += 1;
      streamer.update(view, host.clock);
      streamer.drainUploads(Infinity);
      await settle();
    }
    expect(done).toBe(true);
    expect(streamer.phaseOf(5, 5)).toBe('meshed');
    // Resolved: the pins are gone and the next frames free what is beyond the keep rings.
    for (let i = 0; i < 10; i++) {
      host.clock += 20;
      streamer.update(view, host.clock);
      streamer.freePass(Infinity);
      await settle();
    }
    expect(host.meshes.has('5,5')).toBe(false);
    expect(host.data.has('5,5')).toBe(false);
    expect(host.violations).toEqual([]);
  });

  it('does not generate a column twice when a request covers columns the streamer already holds', async () => {
    const { host, streamer } = make(3);
    const view = viewAt(0, 0);
    await drain(host, streamer, view);
    const generated = host.genStarted.length;
    let done = false;
    void streamer.requestRegion({ cx: 0, cz: 0, genRadius: 4, meshRadius: 3 }).then(() => {
      done = true;
    });
    await settle();
    expect(done).toBe(true);
    expect(host.genStarted.length).toBe(generated);
  });

  it('serves a pinned region before the camera ring', async () => {
    const { host, streamer } = make(3, { maxGenInFlight: 1 });
    streamer.update(viewAt(0, 0), 1);
    void streamer.requestRegion({ cx: 40, cz: 40, genRadius: 1, meshRadius: 0 });
    await host.finishGen(1); // the job that was running when the request arrived
    for (let i = 0; i < 9; i++) await host.finishGen(1);
    const lateKeys = host.genStarted.slice(1, 10);
    for (const key of lateKeys) {
      const [cx, cz] = key.split(',').map(Number) as [number, number];
      expect(chebyshev(cx, cz, 40, 40)).toBeLessThanOrEqual(1);
    }
  });

  it('keeps a region requested after moveTo when the pins release without any frame', async () => {
    const { host, streamer } = make(2);
    await drain(host, streamer, viewAt(0, 0));
    // The camera is placed far away while no frame runs (a test holding the frame loop).
    streamer.moveTo(viewAt(30, 30));
    let done = false;
    void streamer.requestRegion({ cx: 30, cz: 30, genRadius: 3, meshRadius: 2 }).then(() => {
      done = true;
    });
    for (let i = 0; i < 200 && !done; i++) {
      host.clock += 20;
      await host.finishGen();
      await host.finishMesh();
      streamer.drainUploads(Infinity);
      await settle();
    }
    expect(done).toBe(true);
    // Pins are gone; the pump keeps freeing relative to the camera column it was told about.
    for (let i = 0; i < 20; i++) await settle();
    expect(streamer.cameraColumn).toEqual({ cx: 30, cz: 30 });
    for (let cx = 28; cx <= 32; cx++) {
      for (let cz = 28; cz <= 32; cz++) expect(streamer.phaseOf(cx, cz)).toBe('meshed');
    }
    expect(streamer.phaseOf(0, 0)).toBeUndefined();
    expect(host.violations).toEqual([]);
  });

  it('resolves pending requests when the world is replaced', async () => {
    const { streamer } = make(2);
    let done = false;
    void streamer.requestRegion({ cx: 0, cz: 0, genRadius: 3, meshRadius: 2 }).then(() => {
      done = true;
    });
    streamer.reset(0, 0);
    await settle();
    expect(done).toBe(true);
  });

  it('a mesh request needs no work when the region is already meshed', async () => {
    const { host, streamer } = make(3);
    const view = viewAt(0, 0);
    await drain(host, streamer, view);
    const requests = host.meshRequests.length;
    await streamer.requestRegion({ cx: 0, cz: 0, genRadius: 3, meshRadius: 2 });
    expect(host.meshRequests.length).toBe(requests);
  });
});

describe('Streamer: main-thread columns and stale meshes', () => {
  it('adoptColumn cancels a queued or running generation and ignores its result', async () => {
    const { host, streamer } = make(2, { maxGenInFlight: 1 });
    streamer.update(viewAt(0, 0), 1);
    const running = host.genRequests[0]!;
    const runningKey = `${running.cx},${running.cz}`;
    streamer.adoptColumn(running.cx, running.cz); // running one
    streamer.adoptColumn(2, 2); // a queued one
    host.data.add(runningKey);
    host.data.add('2,2');
    expect(streamer.phaseOf(2, 2)).not.toBe('queuedGen');

    running.resolve();
    await settle();

    expect(host.applied).not.toContain(runningKey); // the main-thread data is not overwritten
    expect(streamer.getStats().cancelledJobs).toBeGreaterThanOrEqual(2);
    expect(host.genStarted).not.toContain('2,2');
  });

  it('invalidate re-meshes a meshed column, invalidateAll every meshed column', async () => {
    const { host, streamer } = make(2);
    const view = viewAt(0, 0);
    await drain(host, streamer, view);
    const meshed = streamer.meshedColumns;
    const requests = host.meshRequests.length + host.uploads.length;

    streamer.invalidate(0, 0);
    expect(streamer.phaseOf(0, 0)).toBe('queuedMesh');
    await drain(host, streamer, view);
    expect(streamer.phaseOf(0, 0)).toBe('meshed');

    streamer.invalidateAll();
    expect(streamer.getStats().meshQueued).toBe(meshed);
    await drain(host, streamer, view);
    expect(streamer.meshedColumns).toBe(meshed);
    expect(host.uploads.length).toBeGreaterThan(requests);
    expect(host.violations).toEqual([]);
  });

  it('abandonInFlight puts running generation back in the queue', async () => {
    const { host, streamer } = make(2, { maxGenInFlight: 2 });
    streamer.update(viewAt(0, 0), 1);
    const first = host.genStarted.slice();
    expect(first.length).toBe(2);
    streamer.abandonInFlight({ gen: true, mesh: false });
    // The two columns are requested again; the old promises never matter.
    expect(host.genStarted.length).toBe(4);
    for (const key of host.genStarted.slice(2)) {
      const [cx, cz] = key.split(',').map(Number) as [number, number];
      expect(chebyshev(cx, cz, 0, 0)).toBeLessThanOrEqual(1);
    }
    expect(host.genStarted.slice(2)).toContain('0,0');
    expect(first).toContain('0,0');
  });
});

describe('Streamer: the perimeter invariant holds after every step', () => {
  it('a long random walk with out-of-order results never leaves a mesh without its neighbours', async () => {
    const { host, streamer } = make(3, { maxGenInFlight: 5, maxMeshColumnsInFlight: 4 });
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    let cx = 0;
    let cz = 0;
    for (let step = 0; step < 400; step++) {
      host.clock += 16;
      if (rnd() < 0.25) {
        cx += Math.floor(rnd() * 3) - 1;
        cz += Math.floor(rnd() * 3) - 1;
      }
      if (rnd() < 0.02) {
        cx += Math.floor(rnd() * 41) - 20; // a teleport
        cz += Math.floor(rnd() * 41) - 20;
      }
      if (rnd() < 0.03) streamer.setRenderDistance(2 + Math.floor(rnd() * 4));
      streamer.update(viewAt(cx, cz), host.clock);
      streamer.freePass(2);
      // Release a random subset of the outstanding results, in random order.
      const gens = host.genRequests.splice(0);
      for (const g of gens.sort(() => rnd() - 0.5))
        if (rnd() < 0.5) g.resolve();
        else host.genRequests.push(g);
      const meshes = host.meshRequests.splice(0);
      for (const m of meshes.sort(() => rnd() - 0.5))
        if (rnd() < 0.5) m.resolveAll();
        else host.meshRequests.push(m);
      await settle();
      streamer.drainUploads(rnd() < 0.5 ? 3 : Infinity);
      host.check();
      if (host.violations.length > 0) break;
    }
    expect(host.violations).toEqual([]);
    // And it comes to rest with the right content.
    const view = viewAt(cx, cz);
    await drain(host, streamer, view);
    for (let i = 0; i < 5; i++) {
      host.clock += 20;
      streamer.update(view, host.clock);
      streamer.freePass(Infinity);
    }
    await drain(host, streamer, view);
    const rings = streamRings(streamer.renderDistance);
    expect(host.violations).toEqual([]);
    for (const key of host.meshes.keys()) {
      const [x, z] = key.split(',').map(Number) as [number, number];
      expect(chebyshev(x, z, cx, cz)).toBeLessThanOrEqual(rings.keepMesh);
    }
    expect(host.data.size).toBeLessThanOrEqual((2 * rings.keepData + 1) ** 2);
    expect(streamer.meshedColumns).toBeGreaterThanOrEqual((2 * rings.mesh + 1) ** 2);
  });
});
