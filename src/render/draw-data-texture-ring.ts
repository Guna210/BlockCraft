/**
 * Tracks draw-data textures that may still be sampled by recent terrain draw frames.
 * A changed payload is assigned only to a texture that was not used in either of the
 * previous two frames or earlier in the current frame.
 */
export const DRAW_DATA_TEXTURE_RING_SIZE = 3;

export class DrawDataTextureRing {
  private activeIndex = -1;
  private previousFrameIndex = -1;
  private lastFrameIndex = -1;
  private currentFrameIndex = -1;

  public beginFrame(): void {
    this.currentFrameIndex = -1;
  }

  /** Reuses the active texture for identical data, otherwise chooses a safe ring slot. */
  public acquire(changed: boolean): number {
    if (!changed && this.activeIndex >= 0) {
      this.currentFrameIndex = this.activeIndex;
      return this.activeIndex;
    }

    for (let index = 0; index < DRAW_DATA_TEXTURE_RING_SIZE; index++) {
      if (
        index !== this.previousFrameIndex &&
        index !== this.lastFrameIndex &&
        index !== this.currentFrameIndex
      ) {
        this.activeIndex = index;
        this.currentFrameIndex = index;
        return index;
      }
    }

    throw new Error('No draw-data texture is outside the two-frame read window');
  }

  public endFrame(): void {
    this.previousFrameIndex = this.lastFrameIndex;
    this.lastFrameIndex = this.currentFrameIndex;
    this.currentFrameIndex = -1;
  }

  public reset(): void {
    this.activeIndex = -1;
    this.previousFrameIndex = -1;
    this.lastFrameIndex = -1;
    this.currentFrameIndex = -1;
  }
}
