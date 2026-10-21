import type { GoalFlag } from '../goal';
import { steer } from '../navigation';
import { boxGap, type MobHandle } from '../runtime';
import { MobGoal } from './mob-goal';

export interface MeleeAttackOptions {
  damage: number;
  /** Ticks between hits. */
  interval?: number;
  speed?: number;
  /** Largest gap between the two bounding boxes that still lands a hit. */
  reach?: number;
}

/** Paths to the target and hits it whenever the bounding boxes are within reach, every 20 ticks. */
export class MeleeAttackGoal extends MobGoal {
  readonly name = 'melee_attack';
  override readonly flags: readonly GoalFlag[] = ['move', 'look'];
  readonly damage: number;
  private readonly interval: number;
  private readonly speed: number;
  private readonly reach: number;
  private cooldown = 0;

  constructor(mob: MobHandle, options: MeleeAttackOptions) {
    super(mob);
    this.damage = options.damage;
    this.interval = options.interval ?? 20;
    this.speed = options.speed ?? 1;
    this.reach = options.reach ?? 1;
  }

  canStart(): boolean {
    return this.liveTarget !== null;
  }

  override start(): void {
    this.cooldown = 0;
  }

  override tick(): void {
    const target = this.liveTarget!;
    const pos = this.runtime.targetPos(target)!;
    const box = this.runtime.targetBounds(target)!;
    this.lookAt([pos[0], (box.minY + box.maxY) / 2, pos[2]]);
    if (this.cooldown > 0) this.cooldown--;
    const own = this.runtime.entityBounds(this.id)!;
    const gap = boxGap(own, box);
    if (gap <= this.reach) {
      this.nav.stop();
      // Close in until the boxes touch, without pushing into the target.
      if (gap > 0.1) steer(this.body, this.pos, pos[0], pos[2], this.body.speed * this.speed);
      if (this.cooldown <= 0) {
        this.runtime.hurtTarget(target, this.damage, this.id);
        this.cooldown = this.interval;
      }
    } else this.nav.moveTo(pos[0], pos[1], pos[2], { speed: this.speed, direct: true });
  }

  override stop(): void {
    this.nav.stop();
    this.lookAt(null);
  }
}
