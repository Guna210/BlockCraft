import type { GoalFlag } from '../goal';
import type { MobHandle } from '../runtime';
import { MobGoal } from './mob-goal';

export interface ApproachOptions {
  speed?: number;
  /** Stops closing in this near to the target (blocks, feet to feet). */
  stopDistance?: number;
}

/** Walks up to the target, by A* with direct steering until a path exists, and does nothing else. */
export class ApproachGoal extends MobGoal {
  readonly name = 'approach';
  override readonly flags: readonly GoalFlag[] = ['move', 'look'];
  private readonly speed: number;
  private readonly stopDistance: number;

  constructor(mob: MobHandle, options: ApproachOptions = {}) {
    super(mob);
    this.speed = options.speed ?? 1;
    this.stopDistance = options.stopDistance ?? 1.5;
  }

  canStart(): boolean {
    return this.liveTarget !== null;
  }

  override tick(): void {
    const target = this.liveTarget!;
    const pos = this.runtime.targetPos(target)!;
    const box = this.runtime.targetBounds(target)!;
    this.lookAt([pos[0], (box.minY + box.maxY) / 2, pos[2]]);
    if (this.distanceTo(pos) <= this.stopDistance) this.nav.stop();
    else this.nav.moveTo(pos[0], pos[1], pos[2], { speed: this.speed, direct: true });
  }

  override stop(): void {
    this.nav.stop();
    this.lookAt(null);
  }
}
