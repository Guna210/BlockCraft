import type { GoalFlag } from '../goal';
import type { MobHandle } from '../runtime';
import { MobGoal } from './mob-goal';

export interface LeapOptions {
  /** Leaps at a target no farther than this (blocks, feet to feet). */
  range?: number;
  /** Nor nearer than this: a mob already touching its target just bites. */
  minRange?: number;
  /** Horizontal and upward launch speed in blocks per tick. */
  speed?: number;
  lift?: number;
  /** Ticks between leaps. */
  cooldown?: number;
}

/**
 * From the ground, leaps at a target within 4 blocks. Claims only `jump`, so it runs beside the
 * chase goal that steers the mob; the leap lasts until the mob lands.
 */
export class LeapGoal extends MobGoal {
  readonly name = 'leap';
  override readonly flags: readonly GoalFlag[] = ['jump'];
  private readonly range: number;
  private readonly minRange: number;
  private readonly speed: number;
  private readonly lift: number;
  private readonly cooldown: number;
  private wait = 0;
  private airborne = 0;

  constructor(mob: MobHandle, options: LeapOptions = {}) {
    super(mob);
    this.range = options.range ?? 4;
    this.minRange = options.minRange ?? 1.5;
    this.speed = options.speed ?? 0.5;
    this.lift = options.lift ?? 0.4;
    this.cooldown = options.cooldown ?? 40;
  }

  canStart(): boolean {
    if (this.wait > 0) {
      this.wait--;
      return false;
    }
    const target = this.liveTarget;
    const pos = target !== null ? this.runtime.targetPos(target) : null;
    if (!pos || !this.body.onGround || this.body.inFluid) return false;
    const distance = this.distanceTo(pos);
    return distance <= this.range && distance >= this.minRange;
  }

  /** Until it lands (after leaving the ground), at most 40 ticks. */
  override shouldContinue(): boolean {
    return this.airborne < 40 && (this.airborne < 2 || !this.body.onGround);
  }

  override start(): void {
    const target = this.runtime.targetPos(this.liveTarget!)!;
    const pos = this.pos,
      body = this.body;
    const dx = target[0] - pos[0],
      dz = target[2] - pos[2];
    const flat = Math.hypot(dx, dz) || 1;
    body.vel[0] = (dx / flat) * this.speed;
    body.vel[1] = this.lift;
    body.vel[2] = (dz / flat) * this.speed;
    body.onGround = false;
    this.airborne = 0;
    this.wait = this.cooldown;
  }

  override tick(): void {
    this.airborne++;
  }
}
