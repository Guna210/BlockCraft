import { expect, it, vi } from 'vitest';
import { TerrainFrameGate } from '../../src/render/terrain-frame-gate';

it('holds the previous terrain draw until its fence completes, without blocking or leaking fences', () => {
  const sync = {} as WebGLSync;
  const gl = {
    UNSIGNALED: 0,
    SYNC_STATUS: 1,
    SIGNALED: 2,
    SYNC_GPU_COMMANDS_COMPLETE: 3,
    getSyncParameter: vi.fn().mockReturnValue(0),
    fenceSync: vi.fn().mockReturnValue(sync),
    flush: vi.fn(),
    deleteSync: vi.fn(),
  };
  const gate = new TerrainFrameGate(gl as unknown as WebGL2RenderingContext);
  expect(gate.ready()).toBe(true);
  gate.submitted();
  expect(gl.flush).toHaveBeenCalledOnce();
  expect(gate.ready()).toBe(false);
  expect(gl.getSyncParameter).toHaveBeenCalledWith(sync, 1);
  gl.getSyncParameter.mockReturnValue(2);
  expect(gate.ready()).toBe(true);
  expect(gl.deleteSync).toHaveBeenCalledWith(sync);
  gate.submitted();
  gate.reset();
  expect(gate.ready()).toBe(true);
  expect(gl.deleteSync).toHaveBeenCalledTimes(2);
});

it('makes progress when the browser cannot report a valid fence status', () => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
  const gl = {
    UNSIGNALED: 0,
    SYNC_STATUS: 1,
    SIGNALED: 2,
    SYNC_GPU_COMMANDS_COMPLETE: 3,
    getSyncParameter: vi.fn().mockReturnValue(null),
    fenceSync: vi.fn().mockReturnValue({}),
    flush: vi.fn(),
    deleteSync: vi.fn(),
    finish: vi.fn(),
  };
  const gate = new TerrainFrameGate(gl as unknown as WebGL2RenderingContext);
  gate.submitted();
  clock.mockReturnValue(249);
  expect(gate.ready()).toBe(false);
  expect(gl.finish).not.toHaveBeenCalled();
  clock.mockReturnValue(250);
  expect(gate.ready()).toBe(false);
  expect(gl.finish).toHaveBeenCalledOnce();
  clock.mockReturnValue(499);
  expect(gate.ready()).toBe(false);
  clock.mockReturnValue(500);
  expect(gate.ready()).toBe(true);
  clock.mockRestore();
});

it('bounds recovery after an invalid fence while allowing worker callbacks to run', () => {
  let now = 0;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const gl = {
    UNSIGNALED: 0,
    SYNC_STATUS: 1,
    SIGNALED: 2,
    SYNC_GPU_COMMANDS_COMPLETE: 3,
    getSyncParameter: vi.fn().mockReturnValue(null),
    fenceSync: vi.fn().mockReturnValue({}),
    flush: vi.fn(),
    deleteSync: vi.fn(),
    finish: vi.fn(() => {
      now = 1500;
    }),
  };
  const gate = new TerrainFrameGate(gl as unknown as WebGL2RenderingContext);
  gate.submitted();
  now = 250;
  expect(gate.ready()).toBe(false);
  now = 2499;
  expect(gate.ready()).toBe(false);
  now = 2500;
  expect(gate.ready()).toBe(true);
  gate.submitted();
  gl.getSyncParameter.mockReturnValue(2);
  expect(gate.ready()).toBe(true);
  clock.mockRestore();
});

it('waits for a normal unsignaled GPU fence without blocking or forcing another draw', () => {
  let now = 0;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const gl = {
    UNSIGNALED: 0,
    SYNC_STATUS: 1,
    SIGNALED: 2,
    SYNC_GPU_COMMANDS_COMPLETE: 3,
    getSyncParameter: vi.fn().mockReturnValue(0),
    fenceSync: vi.fn().mockReturnValue({}),
    flush: vi.fn(),
    deleteSync: vi.fn(),
    finish: vi.fn(),
  };
  const gate = new TerrainFrameGate(gl as unknown as WebGL2RenderingContext);
  gate.submitted();
  now = 5000;
  expect(gate.ready()).toBe(false);
  expect(gl.finish).not.toHaveBeenCalled();
  expect(gl.deleteSync).not.toHaveBeenCalled();
  gl.getSyncParameter.mockReturnValue(2);
  expect(gate.ready()).toBe(true);
  expect(gate.submittedFrames).toBe(1);
  clock.mockRestore();
});
