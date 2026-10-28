import type { GoalFlag } from '../goal';
import { explode } from '../../../gameplay/explosions';
import type { MobHandle } from '../runtime';
import { MobGoal } from './mob-goal';

export interface SwellOptions {
  power: number;
  /** Swelling starts this close to the target. */
  startDistance?: number;
  /** Swelling is cancelled beyond this distance. */
  cancelDistance?: number;
  fuse?: number;
}

/**
 * Within 3 blocks of the target, stands still and swells for 30 ticks, then bursts with a blast
 * and is removed. A target more than 7 blocks away cancels the swell.
 */
export class SwellGoal extends MobGoal {
  readonly name = 'swell';
  override readonly flags: readonly GoalFlag[] = ['move'];
  readonly power: number;
  private readonly startDistance: number;
  private readonly cancelDistance: number;
  readonly fuse: number;
  private ticks = 0;
  private burst = false;

  constructor(mob: MobHandle, options: SwellOptions) {
    super(mob);
    this.power = options.power;
    this.startDistance = options.startDistance ?? 3;
    this.cancelDistance = options.cancelDistance ?? 7;
    this.fuse = options.fuse ?? 30;
  }

  /** Swell ticks so far (0 when not swelling). */
  get swellTicks(): number {
    return this.ticks;
  }

  canStart(): boolean {
    return !this.burst && this.targetWithin(this.startDistance);
  }

  override shouldContinue(): boolean {
    return !this.burst && this.targetWithin(this.cancelDistance);
  }

  override start(): void {
    this.ticks = 0;
    this.nav.stop();
  }

  override tick(): void {
    if (++this.ticks < this.fuse) return;
    this.burst = true;
    const pos = this.pos;
    explode(this.runtime, [pos[0], pos[1] + this.height / 2, pos[2]], this.power, this.id);
    this.runtime.remove(this.id);
  }

  override stop(): void {
    this.ticks = 0;
  }

  private targetWithin(distance: number): boolean {
    const target = this.liveTarget;
    const pos = target !== null ? this.runtime.targetPos(target) : null;
    return !!pos && this.distanceTo(pos) <= distance;
  }
}
