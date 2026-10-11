/** Keep one terrain draw in flight, while simulation, streaming and frame-budgeted uploads continue. */
export class TerrainFrameGate {
  private fence: WebGLSync | null = null;
  private submittedAt = 0;
  public submittedFrames = 0;
  private resumeAt = 0;
  constructor(private readonly gl: WebGL2RenderingContext) {}

  ready(): boolean {
    if (!this.fence) return performance.now() >= this.resumeAt;
    const status = this.gl.getSyncParameter(this.fence, this.gl.SYNC_STATUS);
    if (status !== this.gl.SIGNALED) {
      // Some browsers expose fence status late. Bound visual latency without queuing another draw:
      // finish only this outstanding frame; updates and uploads ran throughout the preceding wait.
      if (performance.now() - this.submittedAt < 250) return false;
      this.gl.finish();
      this.reset();
      // Let queued worker replies and pump slices run after the blocking fallback, before
      // submitting another expensive terrain draw on this CPU/GPU-contended browser.
      this.resumeAt = performance.now() + 250;
      return false;
    }
    this.reset();
    return true;
  }

  submitted(): void {
    this.submittedFrames++;
    this.reset();
    this.fence = this.gl.fenceSync(this.gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    this.submittedAt = performance.now();
    this.gl.flush();
  }

  reset(): void {
    this.resumeAt = 0;
    if (this.fence) this.gl.deleteSync(this.fence);
    this.fence = null;
  }
}
