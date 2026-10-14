import { it, expect, vi } from 'vitest';
import {
  FencedErrorDrain,
  MAX_FRAMES_IN_FLIGHT,
  type FenceGL,
} from '../../src/render/fenced-error-drain';
function native() {
  let next = 0,
    finished = 0;
  const gl: FenceGL = {
    SYNC_GPU_COMMANDS_COMPLETE: 1,
    SYNC_STATUS: 2,
    SIGNALED: 3,
    fenceSync: () => ({ id: ++next }) as unknown as WebGLSync,
    getSyncParameter: () => {
      throw new Error('The native path must not make a synchronous status query');
    },
    deleteSync: vi.fn(),
    flush: vi.fn(),
  };
  const poll = vi.fn((fence: WebGLSync) => (fence as unknown as { id: number }).id <= finished);
  const read = vi.fn();
  const drain = new FencedErrorDrain(gl, read, poll);
  return {
    gl,
    poll,
    read,
    drain,
    finish: (id: number) => {
      finished = id;
    },
  };
}
it('M07b native polling waits for the latest GPU frame, so reading errors cannot wait on newer submitted work', () => {
  const { gl, poll, read, drain, finish } = native();
  for (let n = 0; n < 3; n++) {
    drain.beginFrame();
    drain.endFrame();
  }
  finish(2);
  drain.beginFrame();
  expect(poll.mock.lastCall?.[0]).toEqual({ id: 3 });
  expect(read).not.toHaveBeenCalled();
  expect(drain.pendingFrames).toBe(3);
  finish(3);
  drain.beginFrame();
  expect(read).toHaveBeenCalledTimes(1);
  expect(gl.deleteSync).toHaveBeenCalledTimes(3);
  expect(drain.pendingFrames).toBe(0);
});
it('M07b native polling preserves the mandatory unread-frame bound and final synchronous error coverage', () => {
  const { gl, read, drain } = native();
  for (let n = 0; n < MAX_FRAMES_IN_FLIGHT; n++) {
    drain.beginFrame();
    drain.endFrame();
  }
  expect(read).not.toHaveBeenCalled();
  drain.beginFrame();
  expect(read).toHaveBeenCalledTimes(1);
  expect(drain.pendingFrames).toBe(0);
  expect(gl.deleteSync).toHaveBeenCalledTimes(MAX_FRAMES_IN_FLIGHT);
  drain.endFrame();
  drain.drainNow();
  expect(read).toHaveBeenCalledTimes(2);
  expect(drain.pendingFrames).toBe(0);
});
it('M07b native polling covers every submitted frame without changing draw submission or losing sync objects', () => {
  const { gl, read, drain, finish } = native();
  for (let n = 1; n <= 20; n++) {
    drain.beginFrame();
    drain.endFrame();
    if (n % 3 === 0) finish(n - 1);
  }
  finish(20);
  drain.beginFrame();
  expect(gl.fenceSync).toBeDefined();
  expect(gl.deleteSync).toHaveBeenCalledTimes(20);
  expect(read.mock.calls.length).toBeGreaterThan(0);
  expect(drain.pendingFrames).toBe(0);
});
