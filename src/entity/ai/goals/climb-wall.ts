import type { GoalFlag } from '../goal';
import { MobGoal } from './mob-goal';

/**
 * For climbing mobs: while a wall blocks horizontal movement, climbs toward the ceiling. Once
 * attached, it moves along the underside toward the target, then drops when close enough.
 */
export class ClimbWallGoal extends MobGoal {
  readonly name = 'climb_wall';
  override readonly flags: readonly GoalFlag[] = ['jump'];

  canStart(): boolean {
    return this.blockedTowardTarget();
  }

  /** Keeps climbing until the feet clear the wall top, even once level with the target. */
  override shouldContinue(): boolean {
    const target = this.liveTarget;
    const pos = target !== null ? this.runtime.targetPos(target) : null;
    if (!pos || !this.body.climbing) return false;
    const horizontal = Math.hypot(pos[0] - this.pos[0], pos[2] - this.pos[2]);
    if (this.body.ceilingCling) return horizontal > 1.5;
    return this.body.horizontalCollision && (horizontal > 1 || pos[1] > this.pos[1] + 0.5);
  }

  override tick(): void {
    this.body.climb = true;
  }

  private blockedTowardTarget(): boolean {
    const body = this.body;
    if (!body.climbing || !body.horizontalCollision) return false;
    const target = this.liveTarget;
    const pos = target !== null ? this.runtime.targetPos(target) : null;
    return (
      !!pos &&
      (Math.hypot(pos[0] - this.pos[0], pos[2] - this.pos[2]) > 1 || pos[1] > this.pos[1] + 0.5)
    );
  }
}
