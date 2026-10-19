import { advance as advanceWorldTime } from '../world/time';

export const TICK_SECONDS = 1 / 20;
export const MAX_CATCH_UP_TICKS = 5;

/** A bounded accumulator; manual and real-time advancement share the same tick callback. */
export class TickLoop {
  public paused = false;
  /** Called when the loop goes from running to paused (the game saves then). */
  public onPause: (() => void) | null = null;
  private accumulator = 0;
  constructor(private readonly simulate: () => void) {}

  private step(): void {
    advanceWorldTime(1);
    this.simulate();
  }

  advance(seconds: number): number {
    if (this.paused) return 1;
    this.accumulator += Math.max(0, seconds);
    let count = 0;
    while (this.accumulator + 1e-10 >= TICK_SECONDS && count < MAX_CATCH_UP_TICKS) {
      this.step();
      this.accumulator -= TICK_SECONDS;
      count++;
    }
    if (this.accumulator + 1e-10 >= TICK_SECONDS) {
      this.accumulator -= Math.floor((this.accumulator + 1e-10) / TICK_SECONDS) * TICK_SECONDS;
    }
    this.accumulator = Math.max(0, this.accumulator);
    return this.accumulator / TICK_SECONDS;
  }

  pause(): void {
    const wasRunning = !this.paused;
    this.paused = true;
    this.accumulator = 0;
    if (wasRunning) this.onPause?.();
  }
  resume(): void {
    this.paused = false;
    this.accumulator = 0;
  }
  tick(n: number): void {
    if (!this.paused) throw new Error('tick requires a paused simulation');
    if (!Number.isSafeInteger(n) || n < 0)
      throw new Error('tick count must be a non-negative integer');
    for (let i = 0; i < n; i++) this.step();
  }
}
