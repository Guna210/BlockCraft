import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Streamer, type StreamerHost } from '../../src/world/streamer';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it.each([true, false])(
  'M08a keeps physics ready through fluid-triggered light and mesh refresh (visible mesh: %s)',
  async (visibleMesh) => {
    let releaseMesh: (() => void) | undefined;
    let hold = false;
    const host: StreamerHost<number, number> = {
      requestGen: async () => 0,
      applyGen: () => [() => {}],
      requestLight: async (cols) => cols.map((c) => ({ ...c, apply() {} })),
      requestMesh: () =>
        visibleMesh
          ? [
              () =>
                hold
                  ? new Promise<number>((r) => {
                      releaseMesh = () => r(0);
                    })
                  : Promise.resolve(0),
            ]
          : [],
      uploadSection() {},
      beginMeshAttempt() {},
      abandonMeshAttempt() {},
      endMeshAttempt: () => visibleMesh,
      freeMesh() {},
      freeData() {},
      now: () => Date.now(),
    };
    const streamer = new Streamer(host);
    streamer.reset(0, 0);
    expect(streamer.canSimulate(0, 0)).toBe(false);
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) streamer.adoptColumn(x, z);
    // Blocks exist, but their first mesh has not completed.
    expect(streamer.canSimulate(0, 0)).toBe(false);
    const view = { x: 8, z: 8, yaw: 0, pitch: 0, planes: null };
    for (let i = 0; i < 20 && streamer.phaseOf(0, 0) !== 'meshed'; i++) {
      streamer.update(view, Date.now());
      await vi.advanceTimersByTimeAsync(10);
      streamer.drainUploads(Infinity);
    }
    expect(streamer.phaseOf(0, 0)).toBe('meshed');
    expect(streamer.canSimulate(0, 0)).toBe(true);
    hold = true;
    streamer.invalidateLight(0, 0);
    expect(streamer.phaseOf(0, 0)).not.toBe('meshed');
    expect(streamer.canSimulate(0, 0)).toBe(true);
    streamer.update(view, Date.now());
    await vi.advanceTimersByTimeAsync(10);
    expect(streamer.canSimulate(0, 0)).toBe(true);
    releaseMesh?.();
    await vi.advanceTimersByTimeAsync(1);
    streamer.drainUploads(Infinity);
    streamer.reset(100, 100);
    expect(streamer.canSimulate(0, 0)).toBe(false);
  },
);
