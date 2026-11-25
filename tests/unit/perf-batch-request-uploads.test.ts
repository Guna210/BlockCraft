import { afterEach, expect, it, vi } from 'vitest';
import { ChunkRenderer } from '../../src/render/chunk-renderer';
import { DrawDataTextureRing } from '../../src/render/draw-data-texture-ring';
import { GLWrapper } from '../../src/render/gl';
import { TerrainArena } from '../../src/render/terrain-arena';
import { Streamer, type StreamerHost } from '../../src/world/streamer';

afterEach(() => vi.useRealTimers());

it('finishes a pinned mesh upload in bounded upload phases when no animation frames run', async () => {
  vi.useFakeTimers();
  const events: string[] = [];
  let uploadAttempts = 0;
  const host: StreamerHost<void, void> = {
    requestGen: async () => {},
    applyGen: () => [],
    requestMesh: () => [async () => {}],
    drainRequestUploads: (budgetMs) => {
      expect(budgetMs).toBeGreaterThan(0);
      events.push('open');
      streamer.drainUploads(budgetMs);
      events.push('flush');
    },
    uploadSection: () => {
      events.push('write');
      return ++uploadAttempts === 2;
    },
    beginMeshAttempt: () => {},
    endMeshAttempt: () => {
      events.push('publish');
      return true;
    },
    abandonMeshAttempt: () => {},
    freeMesh: () => {},
    freeData: () => {},
    now: Date.now,
  };
  const streamer = new Streamer(host);
  streamer.backgroundEnabled = false;
  const complete = streamer.requestRegion({ cx: 0, cz: 0, genRadius: 1, meshRadius: 0 });
  void complete.then(() => events.push('ready'));
  await vi.advanceTimersByTimeAsync(50);
  expect(events).toEqual(['open', 'write', 'flush', 'open', 'write', 'publish', 'flush', 'ready']);
});

it('counts a late write even when an upload phase and its animation frame both call begin', () => {
  const wrapper = new GLWrapper({} as WebGL2RenderingContext, false, undefined, true);
  wrapper.beginDebugFrame();
  wrapper.recordTerrainGpuWrite();
  wrapper.recordRenderPassStart();
  wrapper.recordTerrainGpuWrite();
  wrapper.beginDebugFrame();
  wrapper.recordTerrainGpuWrite();
  expect(wrapper.endDebugFrame()).toBe(2);

  wrapper.recordTerrainGpuWrite();
  wrapper.beginDebugFrame();
  wrapper.recordTerrainGpuWrite();
  wrapper.beginDebugFrame();
  expect(wrapper.endDebugFrame()).toBe(1);
});

it('upload slices between animation frames preserve arena quarantine and the draw-data ring', () => {
  const gl = new Proxy(
    {},
    {
      get: (_, key) => (String(key).toUpperCase() === key ? 0 : () => ({})),
    },
  ) as WebGL2RenderingContext;
  const renderer = new ChunkRenderer(new GLWrapper(gl, false));
  using arenaFrame = vi.spyOn(TerrainArena.prototype, 'beginUploadFrame');
  using ringFrame = vi.spyOn(DrawDataTextureRing.prototype, 'beginFrame');
  for (let slice = 0; slice < 5; slice++) {
    renderer.beginUploadSlice();
    renderer.endUploadBatch();
  }
  expect(arenaFrame).not.toHaveBeenCalled();
  expect(ringFrame).not.toHaveBeenCalled();
  renderer.beginUploadBatch();
  renderer.endUploadBatch();
  expect(arenaFrame).toHaveBeenCalledTimes(3);
  expect(ringFrame).toHaveBeenCalledTimes(1);
});
