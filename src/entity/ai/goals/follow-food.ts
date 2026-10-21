import type { GoalFlag } from '../goal';
import { MobC } from '../components';
import type { MobHandle } from '../runtime';
import { MobGoal } from './mob-goal';

export interface FollowFoodOptions {
  range?: number;
  /** Stops this close to the player. */
  stopDistance?: number;
  speed?: number;
}

/** Follows a player within 8 blocks who holds one of the mob's foods, to 2 blocks away. */
export class FollowFoodGoal extends MobGoal {
  readonly name = 'follow_food';
  override readonly flags: readonly GoalFlag[] = ['move', 'look'];
  private readonly range: number;
  private readonly stopDistance: number;
  private readonly speed: number;

  constructor(mob: MobHandle, options: FollowFoodOptions = {}) {
    super(mob);
    this.range = options.range ?? 8;
    this.stopDistance = options.stopDistance ?? 2;
    this.speed = options.speed ?? 1;
  }

  canStart(): boolean {
    const player = this.runtime.player();
    const held = player?.heldItemId();
    if (!player || !held || !this.ecs.get(this.id, MobC)?.foods.has(held)) return false;
    return this.distanceTo(player.pos) <= this.range;
  }

  override tick(): void {
    const player = this.runtime.player()!;
    this.lookAt([player.pos[0], player.pos[1] + player.height * 0.9, player.pos[2]]);
    if (this.distanceTo(player.pos) > this.stopDistance)
      this.nav.moveTo(player.pos[0], player.pos[1], player.pos[2], {
        speed: this.speed,
        within: this.stopDistance,
      });
    else this.nav.stop();
  }

  override stop(): void {
    this.nav.stop();
    this.lookAt(null);
  }
}
