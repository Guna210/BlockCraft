import { expect, it } from 'vitest';
import { api, renderStats, setGlErrorDrain } from '../../src/debug/api/core';
import {
  FencedErrorDrain,
  MAX_FRAMES_IN_FLIGHT,
  type FenceGL,
} from '../../src/render/fenced-error-drain';
import {
  MultiplayerErrorDrain,
  installSessionErrorDrain,
  MAX_MULTIPLAYER_FRAMES_IN_FLIGHT,
} from '../../src/game/net/error-drain';

class MockGL implements FenceGL {
  SYNC_GPU_COMMANDS_COMPLETE = 1;
  SYNC_STATUS = 2;
  SIGNALED = 3;
  signalled = new Set<WebGLSync>();
  live = new Set<WebGLSync>();
  errors: number[] = [];
  fenceSync() {
    const fence = {} as WebGLSync;
    this.live.add(fence);
    return fence;
  }
  getSyncParameter(fence: WebGLSync) {
    return this.signalled.has(fence) ? this.SIGNALED : 0;
  }
  deleteSync(fence: WebGLSync | null) {
    if (fence) this.live.delete(fence);
  }
  flush() {}
  getError() {
    return this.errors.shift() ?? 0;
  }
  finishAll() {
    for (const fence of this.live) this.signalled.add(fence);
  }
}

function context() {
  const gl = new MockGL();
  let errors = 0;
  const read = () => {
    while (gl.getError()) errors++;
  };
  const collector = new MultiplayerErrorDrain(gl, read);
  return { gl, collector, read, errors: () => errors };
}

it('counts an error issued while multiplayer fences are pending at the next drainNow', () => {
  const { gl, collector, errors } = context();
  for (let i = 0; i < MAX_FRAMES_IN_FLIGHT + 3; i++) {
    collector.beginFrame();
    collector.endFrame();
  }
  gl.errors.push(0x0502);
  collector.beginFrame();
  expect(errors()).toBe(0);
  expect(collector.pendingFrames).toBe(7);
  collector.drainNow();
  expect(errors()).toBe(1);
  expect(collector.pendingFrames).toBe(0);
  expect(gl.live.size).toBe(0);
});

it('reads every pending frame when the latest fence signals without a forced read of an unfinished newer frame', () => {
  const { gl, collector, errors } = context();
  for (let i = 0; i < 8; i++) {
    collector.beginFrame();
    gl.errors.push(0x0501);
    collector.endFrame();
  }
  const fences = [...gl.live];
  gl.signalled.add(fences[0]!);
  collector.beginFrame();
  expect(errors()).toBe(0);
  expect(collector.pendingFrames).toBe(8);
  gl.finishAll();
  collector.beginFrame();
  expect(errors()).toBe(8);
  expect(collector.pendingFrames).toBe(0);
  expect(gl.live.size).toBe(0);
});

it('forces the blocking error read at the multiplayer hard cap of sixteen frames', () => {
  const { gl, collector, errors } = context();
  expect(MAX_MULTIPLAYER_FRAMES_IN_FLIGHT).toBe(16);
  for (let i = 0; i < MAX_MULTIPLAYER_FRAMES_IN_FLIGHT; i++) {
    collector.beginFrame();
    gl.errors.push(0x0500);
    collector.endFrame();
    expect(errors()).toBe(0);
    expect(collector.pendingFrames).toBeLessThanOrEqual(16);
  }
  collector.beginFrame();
  expect(errors()).toBe(16);
  expect(collector.pendingFrames).toBe(0);
  expect(gl.live.size).toBe(0);
});

it('keeps getRenderStats blocking so it reports a real queued error', () => {
  const gl = new MockGL();
  const previous = renderStats.glErrors;
  const collector = new MultiplayerErrorDrain(gl, () => {
    while (gl.getError()) renderStats.glErrors++;
  });
  setGlErrorDrain(() => collector.drainNow());
  try {
    collector.endFrame();
    gl.errors.push(0x0502);
    collector.beginFrame();
    expect(renderStats.glErrors).toBe(previous);
    expect(api.getRenderStats().glErrors).toBe(previous + 1);
    expect(collector.pendingFrames).toBe(0);
  } finally {
    setGlErrorDrain(null);
    renderStats.glErrors = previous;
  }
});

it('drains before returning to an unchanged four-frame single-player collector', () => {
  const { gl, collector, read, errors } = context();
  const normal = new FencedErrorDrain(gl, read);
  collector.endFrame();
  gl.errors.push(0x0501);
  collector.drainNow();
  expect(errors()).toBe(1);
  expect(gl.live.size).toBe(0);
  for (let i = 0; i < MAX_FRAMES_IN_FLIGHT; i++) {
    normal.beginFrame();
    normal.endFrame();
  }
  expect(MAX_FRAMES_IN_FLIGHT).toBe(4);
  expect(normal.pendingFrames).toBe(4);
  gl.errors.push(0x0502);
  normal.beginFrame();
  expect(errors()).toBe(2);
  expect(normal.pendingFrames).toBe(0);
  expect(gl.live.size).toBe(0);
});

it('uses the supplied zero-timeout native poll without a synchronous fence query', () => {
  const gl = new MockGL();
  gl.getSyncParameter = () => {
    throw new Error('Unexpected synchronous query');
  };
  let finished = false,
    errors = 0;
  const collector = new MultiplayerErrorDrain(
    gl,
    () => {
      while (gl.getError()) errors++;
    },
    () => finished,
  );
  collector.endFrame();
  gl.errors.push(0x0501);
  collector.beginFrame();
  expect(errors).toBe(0);
  finished = true;
  collector.beginFrame();
  expect(errors).toBe(1);
  expect(collector.pendingFrames).toBe(0);
});

it('drains the restored normal collector again when quit follows disconnect', () => {
  const { gl, collector, read, errors } = context();
  const normal = new FencedErrorDrain(gl, read);
  let active: FencedErrorDrain | null = normal;
  const installed: Array<FencedErrorDrain | null> = [];
  normal.endFrame();
  gl.errors.push(0x0501);
  const restore = installSessionErrorDrain(normal, collector, (next) => {
    active = next;
    installed.push(next);
  });
  expect(errors()).toBe(1);
  expect(normal.pendingFrames).toBe(0);
  expect(active).toBe(collector);
  collector.endFrame();
  gl.errors.push(0x0502);
  restore(); // Disconnect: collect multiplayer errors and restore normal mode.
  expect(errors()).toBe(2);
  expect(active).toBe(normal);
  normal.endFrame();
  gl.errors.push(0x0500);
  restore(); // Quit after disconnect must still collect the intervening normal frame.
  expect(errors()).toBe(3);
  expect(normal.pendingFrames).toBe(0);
  expect(installed).toEqual([collector, normal]);
  expect(gl.live.size).toBe(0);
});
