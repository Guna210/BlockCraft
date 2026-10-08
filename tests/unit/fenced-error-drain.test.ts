import { describe, it, expect } from 'vitest';
import {
  FencedErrorDrain,
  MAX_FRAMES_IN_FLIGHT,
  type FenceGL,
} from '../../src/render/fenced-error-drain';

/** Mock context: fences signal only when the test says so, like a GPU that is still busy. */
class MockGL implements FenceGL {
  SYNC_GPU_COMMANDS_COMPLETE = 0x9117;
  SYNC_STATUS = 0x9114;
  SIGNALED = 0x9119;
  UNSIGNALED = 0x9118;
  private nextId = 1;
  signalled = new Set<number>();
  deleted = new Set<number>();
  flushes = 0;
  fenceSync() {
    return { id: this.nextId++ } as unknown as WebGLSync;
  }
  getSyncParameter(sync: WebGLSync) {
    return this.signalled.has((sync as unknown as { id: number }).id)
      ? this.SIGNALED
      : this.UNSIGNALED;
  }
  deleteSync(sync: WebGLSync | null) {
    this.deleted.add((sync as unknown as { id: number }).id);
  }
  flush() {
    this.flushes++;
  }
  /** The GPU finishes all frames up to and including fence `id`. */
  finishThrough(id: number) {
    for (let i = 1; i <= id; i++) this.signalled.add(i);
  }
}

function make() {
  const gl = new MockGL();
  let drains = 0;
  const drain = new FencedErrorDrain(gl, () => {
    drains++;
  });
  return { gl, drain, drains: () => drains };
}

describe('FencedErrorDrain', () => {
  it('does not drain while the previous frame is still on the GPU', () => {
    const { drain, drains } = make();
    drain.beginFrame();
    drain.endFrame();
    drain.beginFrame();
    drain.endFrame();
    drain.beginFrame();
    expect(drains()).toBe(0);
    expect(drain.pendingFrames).toBe(2);
  });

  it('blocks to drain when a burst of frames leaves too many unread, and only then', () => {
    const { gl, drain, drains } = make();
    for (let i = 0; i < MAX_FRAMES_IN_FLIGHT; i++) {
      drain.beginFrame();
      expect(drains()).toBe(0); // fewer than the limit are pending
      drain.endFrame();
    }
    expect(drain.pendingFrames).toBe(MAX_FRAMES_IN_FLIGHT);

    drain.beginFrame(); // the GPU has finished nothing, but the limit is reached

    expect(drains()).toBe(1);
    expect(drain.pendingFrames).toBe(0);
    expect(gl.deleted.size).toBe(MAX_FRAMES_IN_FLIGHT);
  });

  it('drains once a frame has finished, and deletes the fences it covered', () => {
    const { gl, drain, drains } = make();
    drain.beginFrame();
    drain.endFrame(); // fence 1
    gl.finishThrough(1);

    drain.beginFrame();

    expect(drains()).toBe(1);
    expect(gl.deleted).toEqual(new Set([1]));
    expect(drain.pendingFrames).toBe(0);
  });

  it('one drain covers several finished frames and never more than one drain per frame', () => {
    const { gl, drain, drains } = make();
    for (let i = 0; i < 3; i++) {
      drain.beginFrame();
      drain.endFrame(); // fences 1..3
    }
    gl.finishThrough(2);

    drain.beginFrame();

    expect(drains()).toBe(1);
    expect(gl.deleted).toEqual(new Set([1, 2]));
    expect(drain.pendingFrames).toBe(1); // fence 3 is still on the GPU

    drain.endFrame(); // fence 4
    gl.finishThrough(4);
    drain.beginFrame();
    expect(drains()).toBe(2);
    expect(drain.pendingFrames).toBe(0);
  });

  it('every frame that issued GL work is covered by a drain: pending fences always end in a drain', () => {
    const { gl, drain, drains } = make();
    const frames = 20;
    let fence = 0;
    for (let i = 0; i < frames; i++) {
      drain.beginFrame();
      drain.endFrame();
      fence++;
      if (i % 3 === 2) gl.finishThrough(fence - 1); // the GPU lags one frame behind every third frame
    }
    gl.finishThrough(fence);
    drain.beginFrame();
    expect(drain.pendingFrames).toBe(0);
    expect(drains()).toBeGreaterThan(0);
    expect(drains()).toBeLessThanOrEqual(frames);
    expect(gl.deleted.size).toBe(frames);
  });

  it('flushes after placing the fence, so the GPU starts the frame', () => {
    const { gl, drain } = make();
    drain.endFrame();
    expect(gl.flushes).toBe(1);
  });

  it('drainNow drains at once and forgets all pending fences', () => {
    const { gl, drain, drains } = make();
    drain.endFrame();
    drain.endFrame();

    drain.drainNow();

    expect(drains()).toBe(1);
    expect(gl.deleted).toEqual(new Set([1, 2]));
    expect(drain.pendingFrames).toBe(0);
  });

  it('keeps going when the context cannot create a fence', () => {
    const gl = new MockGL();
    gl.fenceSync = () => null as unknown as WebGLSync;
    let drains = 0;
    const drain = new FencedErrorDrain(gl, () => {
      drains++;
    });
    drain.endFrame();
    drain.beginFrame();
    expect(drains).toBe(0);
    expect(drain.pendingFrames).toBe(0);
  });
});
