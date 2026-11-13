import { expect, it, vi } from 'vitest';
import { RemoteRenderLoop } from '../../src/game/net/render-loop';
import { FencedErrorDrain, MAX_FRAMES_IN_FLIGHT } from '../../src/render/fenced-error-drain';

function device() {
  let next = 0;
  return {
    SYNC_GPU_COMMANDS_COMPLETE: 1,
    SYNC_STATUS: 2,
    SIGNALED: 3,
    ALREADY_SIGNALED: 4,
    TIMEOUT_EXPIRED: 5,
    WAIT_FAILED: 6,
    status: 5,
    live: new Set<WebGLSync>(),
    fenceSync() {
      const f = { id: ++next } as unknown as WebGLSync;
      this.live.add(f);
      return f;
    },
    clientWaitSync() {
      return this.status;
    },
    getSyncParameter() {
      return this.status === this.ALREADY_SIGNALED ? this.SIGNALED : 0;
    },
    deleteSync(f: WebGLSync | null) {
      if (f) this.live.delete(f);
    },
    flush: vi.fn(),
  };
}

it('retains the full frame budget, then updates input/UI until the original error drain is safe', () => {
  const gl = device(),
    errors = vi.fn();
  const drain = new FencedErrorDrain(gl, errors, () => gl.status === gl.ALREADY_SIGNALED);
  const draw = vi.fn(() => {
    drain.beginFrame();
    drain.endFrame();
  });
  const update = vi.fn(),
    schedule = vi.fn();
  const loop = new RemoteRenderLoop(
    gl,
    draw,
    update,
    schedule,
    () => drain.pendingFrames < MAX_FRAMES_IN_FLIGHT,
  );
  for (let i = 0; i < MAX_FRAMES_IN_FLIGHT; i++) loop.render(i);
  expect(draw).toHaveBeenCalledTimes(MAX_FRAMES_IN_FLIGHT);
  expect(drain.pendingFrames).toBe(MAX_FRAMES_IN_FLIGHT);
  for (let i = 0; i < 10; i++) loop.render(10 + i);
  expect(draw).toHaveBeenCalledTimes(MAX_FRAMES_IN_FLIGHT);
  expect(update).toHaveBeenCalledTimes(10);
  expect(schedule).toHaveBeenCalledTimes(10);
  expect(errors).not.toHaveBeenCalled();
  gl.status = gl.ALREADY_SIGNALED;
  loop.render(30);
  expect(draw).toHaveBeenCalledTimes(MAX_FRAMES_IN_FLIGHT + 1);
  expect(errors).toHaveBeenCalledTimes(1);
  expect(drain.pendingFrames).toBe(1);
  loop.dispose();
  drain.drainNow();
  expect(gl.live.size).toBe(0);
});

it('covers a full menu backlog and preserves failed-poll reporting and exit restoration', () => {
  const gl = device(),
    draw = vi.fn(),
    update = vi.fn(),
    schedule = vi.fn();
  const loop = new RemoteRenderLoop(gl, draw, update, schedule, () => false);
  loop.render(1);
  expect(draw).not.toHaveBeenCalled();
  expect(update).toHaveBeenCalledTimes(1);
  gl.status = gl.WAIT_FAILED;
  loop.render(2);
  expect(draw).toHaveBeenCalledWith(2);
  loop.dispose();
  expect(gl.live.size).toBe(0);
  const submissions = gl.flush.mock.calls.length;
  loop.render(3);
  expect(draw).toHaveBeenCalledWith(3);
  expect(gl.flush).toHaveBeenCalledTimes(submissions);
});
