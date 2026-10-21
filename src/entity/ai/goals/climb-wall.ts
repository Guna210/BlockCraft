import type { GoalFlag } from '../goal';
import { MobGoal } from './mob-goal';

/**
 * For climbing mobs: while a wall blocks horizontal movement and the target is higher, moves up
 * the wall face without A*. When the wall ends the mob walks over the top or falls off.
 */
export class ClimbWallGoal extends MobGoal {
  readonly name = 'climb_wall';
  override readonly flags: readonly GoalFlag[] = ['jump'];

  canStart(): boolean {
    return this.blockedBelowTarget(0.5);
  }

  /** Keeps climbing until the feet clear the wall top, even once level with the target. */
  override shouldContinue(): boolean {
    return this.blockedBelowTarget(-0.5);
  }

  override tick(): void {
    this.body.climb = true;
  }

  private blockedBelowTarget(margin: number): boolean {
    const body = this.body;
    if (!body.climbing || !body.horizontalCollision) return false;
    const target = this.liveTarget;
    const pos = target !== null ? this.runtime.targetPos(target) : null;
    return !!pos && pos[1] > this.pos[1] + margin;
  }
}
