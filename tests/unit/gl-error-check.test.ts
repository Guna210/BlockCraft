import { describe, it, expect, afterEach, vi } from 'vitest';
import { mat4 } from 'gl-matrix';
import { GLWrapper } from '../../src/render/gl';
import type { Camera } from '../../src/render/camera';
import type { TextureAtlas } from '../../src/render/atlas';
import type { ChunkRenderer } from '../../src/render/chunk-renderer';
import { api, renderStats, setGlErrorDrain } from '../../src/debug/api/core';

const INVALID_ENUM = 1280;
const INVALID_VALUE = 1281;
const INVALID_OPERATION = 1282;

/**
 * Mock context with a real error queue: raise() records an error and getError() pops one, like
 * the browser does. Draw calls raise the errors queued in `nextDrawErrors`.
 */
class ErrorQueueGL {
  NO_ERROR = 0;
  queue: number[] = [];
  getErrorCalls = 0;
  nextDrawErrors: number[] = [];

  raise(code: number) {
    this.queue.push(code);
  }

  getError() {
    this.getErrorCalls++;
    return this.queue.shift() ?? 0;
  }

  drawArrays() {
    for (const e of this.nextDrawErrors.splice(0)) this.raise(e);
  }

  drawElements() {
    for (const e of this.nextDrawErrors.splice(0)) this.raise(e);
  }
}

function make(debug: boolean) {
  const mock = new ErrorQueueGL();
  let errors = 0;
  const wrapper = new GLWrapper(mock as unknown as WebGL2RenderingContext, debug, () => {
    errors++;
  });
  return { mock, wrapper, errors: () => errors };
}

describe('GLWrapper.drainErrors', () => {
  it('reads every queued error and calls the callback once per error, with per-draw checks off', () => {
    const { mock, wrapper, errors } = make(false);
    mock.queue = [INVALID_OPERATION, INVALID_VALUE, INVALID_ENUM];

    wrapper.drainErrors();

    expect(errors()).toBe(3);
    expect(mock.queue).toEqual([]);
    expect(mock.getErrorCalls).toBe(4); // three errors, then NO_ERROR
  });

  it('calls getError once and no callback when the queue is empty', () => {
    const { mock, wrapper, errors } = make(false);

    wrapper.drainErrors();

    expect(errors()).toBe(0);
    expect(mock.getErrorCalls).toBe(1);
  });

  it('does not throw without a callback', () => {
    const mock = new ErrorQueueGL();
    mock.queue = [INVALID_ENUM];
    const wrapper = new GLWrapper(mock as unknown as WebGL2RenderingContext, false);

    expect(() => wrapper.drainErrors()).not.toThrow();
    expect(mock.queue).toEqual([]);
  });
});

describe('per-frame error checking (per-draw checks off)', () => {
  it('draws do not call getError', () => {
    const { mock, wrapper } = make(false);

    for (let i = 0; i < 50; i++) {
      wrapper.drawElements(4, 6, 5123, 0);
      wrapper.drawArrays(4, 0, 3);
    }

    expect(mock.getErrorCalls).toBe(0);
  });

  it('one drain at the end of the frame counts errors from several draws and from non-draw calls', () => {
    const { mock, wrapper, errors } = make(false);

    mock.raise(INVALID_ENUM); // a non-draw call, before any draw
    mock.nextDrawErrors = [INVALID_OPERATION];
    wrapper.drawElements(4, 6, 5123, 0);
    mock.nextDrawErrors = [INVALID_VALUE, INVALID_OPERATION];
    wrapper.drawArrays(4, 0, 3);
    wrapper.drawElements(4, 6, 5123, 0); // no error
    mock.raise(INVALID_VALUE); // a non-draw call, after the last draw
    expect(mock.getErrorCalls).toBe(0);

    wrapper.drainErrors();

    expect(errors()).toBe(5);
    expect(mock.queue).toEqual([]);
  });

  it('per-draw mode (debug flag on) still checks after every draw', () => {
    const { mock, wrapper, errors } = make(true);

    mock.nextDrawErrors = [INVALID_OPERATION];
    wrapper.drawElements(4, 6, 5123, 0);
    wrapper.drawArrays(4, 0, 3);

    expect(errors()).toBe(1);
    expect(mock.getErrorCalls).toBe(3); // one error plus NO_ERROR, then NO_ERROR
  });
});

describe('getRenderStats drains pending errors', () => {
  afterEach(() => {
    setGlErrorDrain(null);
    renderStats.glErrors = 0;
  });

  it('counts errors that no frame has drained yet before returning the stats', () => {
    const mock = new ErrorQueueGL();
    const wrapper = new GLWrapper(mock as unknown as WebGL2RenderingContext, false, () => {
      renderStats.glErrors++;
    });
    setGlErrorDrain(() => wrapper.drainErrors());
    mock.queue = [INVALID_OPERATION, INVALID_ENUM];

    const stats = api.getRenderStats();

    expect(stats.glErrors).toBe(2);
    expect(mock.queue).toEqual([]);
    expect(api.getRenderStats().glErrors).toBe(2); // nothing new, nothing added
  });

  it('does not read the error queue when no drain is registered (not debug mode)', () => {
    const mock = new ErrorQueueGL();
    mock.queue = [INVALID_ENUM];

    expect(api.getRenderStats().glErrors).toBe(0);
    expect(mock.getErrorCalls).toBe(0);
  });
});

describe('WorldManager drains after the synchronous terrain frame', () => {
  it('calls the drain hook at the end of drawTerrainFrame, after the draw', async () => {
    vi.stubGlobal(
      'Worker',
      class {
        postMessage() {}
        terminate() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
    try {
      const { WorldManager } = await import('../../src/world/world-manager');
      const wm = WorldManager.getInstance();
      const calls: string[] = [];
      const gl = {
        COLOR_BUFFER_BIT: 1,
        DEPTH_BUFFER_BIT: 2,
        clear: () => calls.push('clear'),
      };
      wm.glWrapper = { gl } as unknown as GLWrapper;
      wm.camera = {
        projectionMatrix: mat4.create(),
        viewMatrix: mat4.create(),
      } as unknown as Camera;
      wm.atlasTexture = {} as WebGLTexture;
      wm.atlas = {} as TextureAtlas;
      wm.chunkRenderer = { render: () => calls.push('draw') } as unknown as ChunkRenderer;
      wm.drainGlErrors = () => calls.push('drain');

      (wm as unknown as { drawTerrainFrame(): void }).drawTerrainFrame();

      expect(calls).toEqual(['clear', 'draw', 'drain']);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
