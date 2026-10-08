/**
 * Reads WebGL errors once per frame without making the main thread wait for the GPU process.
 *
 * `gl.getError()` is a synchronous round trip: it returns only when the GPU process has executed every
 * command issued before it. Under a slow rasteriser that is the whole frame, hundreds of milliseconds,
 * and the main thread cannot handle worker results meanwhile. So the frame callback ends by inserting a
 * fence (and flushing), and a later frame callback reads the errors only once a fence has signalled. By
 * then all commands before that fence have run, so `getError()` returns at once. Every frame that
 * issued GL work gets its fence, and a drain after any fence covers all earlier frames, so no error is
 * left uncounted. At most MAX_FRAMES_IN_FLIGHT frames may wait for their drain; beyond that the next
 * frame callback drains with a blocking getError, so a burst of frames cannot queue unbounded GPU work
 * and an error is never read more than a few frames late. See decisions/M04a-streaming.md.
 */

/**
 * Chrome itself keeps about three frames in flight, so in steady state this bound never triggers; it
 * only caps bursts, such as the first frames after the page has been idle.
 */
export const MAX_FRAMES_IN_FLIGHT = 4;

/** The WebGL calls the drain needs, so it can be unit-tested with a mock. */
export interface FenceGL {
  readonly SYNC_GPU_COMMANDS_COMPLETE: number;
  readonly SYNC_STATUS: number;
  readonly SIGNALED: number;
  fenceSync(condition: number, flags: number): WebGLSync | null;
  getSyncParameter(sync: WebGLSync, pname: number): unknown;
  deleteSync(sync: WebGLSync | null): void;
  flush(): void;
}

export class FencedErrorDrain {
  /** Fences of frames whose errors have not been read yet, oldest first. */
  private readonly pending: WebGLSync[] = [];
  /** Drains performed (blocking or not), for tests and stats. */
  public drains = 0;

  constructor(
    private readonly gl: FenceGL,
    /** Reads gl.getError() until NO_ERROR and counts the errors. */
    private readonly drain: () => void,
  ) {}

  /** Fences of frames still waiting for their drain. */
  get pendingFrames(): number {
    return this.pending.length;
  }

  /** Call at the start of a frame callback, before any GL call: drains if an earlier frame's fence signalled. */
  beginFrame(): void {
    let signalled = 0;
    while (signalled < this.pending.length && this.isSignalled(this.pending[signalled]!))
      signalled++;
    if (signalled === 0) {
      if (this.pending.length >= MAX_FRAMES_IN_FLIGHT) this.drainNow();
      return;
    }
    // Everything up to the newest signalled fence has executed, so this getError does not wait.
    this.drains++;
    this.drain();
    for (const fence of this.pending.splice(0, signalled)) this.gl.deleteSync(fence);
  }

  /** Call at the end of a frame callback that issued GL work. */
  endFrame(): void {
    const fence = this.gl.fenceSync(this.gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (fence) this.pending.push(fence);
    this.gl.flush();
  }

  /** Blocking drain for code outside the frame loop (stats read, synchronous terrain frame). */
  drainNow(): void {
    this.drains++;
    this.drain();
    // The drain returned, so every command issued so far has executed and every fence is signalled.
    for (const fence of this.pending.splice(0)) this.gl.deleteSync(fence);
  }

  private isSignalled(fence: WebGLSync): boolean {
    return this.gl.getSyncParameter(fence, this.gl.SYNC_STATUS) === this.gl.SIGNALED;
  }
}
