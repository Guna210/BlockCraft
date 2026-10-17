/** A render clock independent of simulation ticks. Pausing freezes both waves and UV animation. */
export class FluidAnimationClock {
  private elapsed = 0;
  private previous: number | null = null;
  private paused = false;
  sample(now: number): number {
    if (this.previous !== null && !this.paused)
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
