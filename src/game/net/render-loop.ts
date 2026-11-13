interface FenceGL {
  readonly SYNC_GPU_COMMANDS_COMPLETE: number;
  readonly TIMEOUT_EXPIRED: number;
  fenceSync(condition: number, flags: number): WebGLSync | null;
  clientWaitSync(fence: WebGLSync, flags: number, timeout: number): number;
  deleteSync(fence: WebGLSync | null): void;
  flush(): void;
}

/** Yield at the existing GPU frame bound instead of entering a blocking error drain. */
export class RemoteRenderLoop {
  private fence: WebGLSync | null;
  private disposed = false;
  constructor(
    private readonly gl: FenceGL,
    private readonly draw: (time: number) => void,
    private readonly update: () => void,
    private readonly schedule: () => void,
    private readonly belowFrameBound: () => boolean,
  ) {
    this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
  }

  readonly render = (time: number): void => {
    if (this.disposed) {
      this.draw(time);
      return;
    }
    if (
      !this.belowFrameBound() &&
      this.fence &&
      this.gl.clientWaitSync(this.fence, 0, 0) === this.gl.TIMEOUT_EXPIRED
    ) {
      this.update();
      this.schedule();
      return;
    }
    // Failed polls enter the original error-reporting path. No errors are hidden.
    if (this.fence) this.gl.deleteSync(this.fence);
    this.draw(time);
    this.fence = this.gl.fenceSync(this.gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    this.gl.flush();
  };

  dispose(): void {
    if (this.fence) this.gl.deleteSync(this.fence);
    this.fence = null;
    this.disposed = true;
  }
}
