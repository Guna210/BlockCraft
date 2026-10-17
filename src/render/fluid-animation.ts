/** A render clock independent of simulation ticks. Pausing freezes both waves and UV animation. */
export class FluidAnimationClock {
  private elapsed = 0;
  private previous: number | null = null;
  private paused = false;
  /** `hold` stops the clock for this sample only, like a pause that the caller owns. */
  sample(now: number, hold = false): number {
    if (this.previous !== null && !this.paused && !hold)
      this.elapsed += Math.max(0, now - this.previous) / 1000;
    this.previous = now;
    return this.elapsed;
  }
  setPaused(paused: boolean, now: number): void {
    this.sample(now);
    this.paused = paused;
  }
  snapshot() {
    return { paused: this.paused, seconds: this.elapsed, frame: Math.floor(this.elapsed * 8) % 32 };
  }
}
export const fluidAnimation = new FluidAnimationClock();
/**
 * The wind clock for waving leaves and plants. It runs with the render clock but also stands still
 * while the fluid animation is paused or the simulation is paused, as a paused game freezes wind.
 */
export const windAnimation = new FluidAnimationClock();
