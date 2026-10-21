import type { GoalFlag } from '../goal';
import { PLAYER_TARGET } from '../components';
import type { MobHandle } from '../runtime';
import { MobGoal } from './mob-goal';

export interface TargetPlayerOptions {
  /** Distance at which the player is noticed. */
  range?: number;
}

/** Targets a targetable player within range; lets go beyond 1.5× the range. */
export class TargetPlayerGoal extends MobGoal {
  readonly name = 'target_player';
  override readonly flags: readonly GoalFlag[] = ['target'];
  private readonly range: number;

  constructor(mob: MobHandle, options: TargetPlayerOptions = {}) {
    super(mob);
    this.range = options.range ?? 16;
  }

  canStart(): boolean {
    return this.playerWithin(this.range);
  }

  override shouldContinue(): boolean {
    return this.playerWithin(this.range * 1.5);
  }

  override start(): void {
    this.targeting.target = PLAYER_TARGET;
  }

  override stop(): void {
    if (this.targeting.target === PLAYER_TARGET) this.targeting.target = null;
  }

  private playerWithin(range: number): boolean {
    const player = this.runtime.player();
    return !!player && player.targetable() && this.distanceTo(player.pos) <= range;
  }
}
