import type { GoalFlag } from '../goal';
import { AnimatorC, HealthC } from '../../ecs/components';
import { playClip } from '../../ecs/systems';
import { DamageScaleC } from '../components';
import type { MobHandle } from '../runtime';
import { MobGoal } from './mob-goal';

export const WITHDRAW_TICKS = 100;
/** Damage taken while withdrawn is multiplied by this. */
export const SHELL_DAMAGE_SCALE = 0.2;

export interface WithdrawOptions {
  /** One-shot clip of WITHDRAW_TICKS: retracts in `retractTicks`, holds, comes back out at the end. */
  clip?: string;
  retractTicks?: number;
}

/**
 * When hurt, the mob withdraws into its shell for 100 ticks: it does not move and takes ×0.2
 * damage. Each new hit while withdrawn restarts the 100 ticks.
 */
export class WithdrawGoal extends MobGoal {
  readonly name = 'withdraw';
  override readonly flags: readonly GoalFlag[] = ['move', 'look', 'jump'];
  private lastHealth: number;
  private left = 0;

  constructor(
    mob: MobHandle,
    private readonly options: WithdrawOptions = {},
  ) {
    super(mob);
    this.lastHealth = this.health();
  }

  /** Ticks left inside the shell. */
  get ticksLeft(): number {
    return this.left;
  }

  canStart(): boolean {
    return this.hurtSinceLastLook();
  }

  override shouldContinue(): boolean {
    return this.left > 0;
  }

  override start(): void {
    this.left = WITHDRAW_TICKS;
    this.nav.stop();
    this.lookAt(null);
    const scale = this.ecs.get(this.id, DamageScaleC);
    if (scale) scale.scale = SHELL_DAMAGE_SCALE;
    else this.ecs.add(this.id, DamageScaleC, { scale: SHELL_DAMAGE_SCALE });
    if (this.options.clip) playClip(this.ecs, this.id, this.options.clip);
  }

  override tick(): void {
    if (this.hurtSinceLastLook()) {
      this.left = WITHDRAW_TICKS;
      this.holdClip();
    }
    const body = this.body;
    body.wish[0] = body.wish[1] = body.wish[2] = 0;
    body.vel[0] = body.vel[2] = 0;
    if (body.vel[1] > 0) body.vel[1] = 0;
    body.jump = false;
    this.left--;
  }

  override stop(): void {
    this.left = 0;
    this.ecs.remove(this.id, DamageScaleC);
  }

  private health(): number {
    return this.ecs.get(this.id, HealthC)?.current ?? 0;
  }

  private hurtSinceLastLook(): boolean {
    const health = this.health();
    const hurt = health < this.lastHealth;
    this.lastHealth = health;
    return hurt;
  }

  /** A new hit while withdrawn keeps the clip in its retracted hold for another 100 ticks. */
  private holdClip(): void {
    const clip = this.options.clip;
    const animator = this.ecs.get(this.id, AnimatorC);
    if (!clip || !animator) return;
    const playing = animator.clips.find((c) => c.name === clip);
    const retract = this.options.retractTicks ?? 0;
    if (playing) playing.start = this.ecs.time - retract;
    else playClip(this.ecs, this.id, clip);
  }
}
