import type { GoalFlag } from '../goal';
import type { Vec3 } from '../../ecs/model';
import type { MobHandle } from '../runtime';
import { MobGoal } from './mob-goal';

/** Launches a projectile at a target point (M13d supplies the projectile). */
export type FireFunction = (target: Readonly<Vec3>, shooter: number) => void;

export interface RangedAttackOptions {
  fire: FireFunction;
  /** Ticks between shots. */
  interval: number;
  minRange?: number;
  maxRange?: number;
  speed?: number;
}

/**
 * Keeps 8–12 blocks from the target: approaches when farther, backs off when nearer and strafes
 * inside the band, firing every `interval` ticks while within range.
 */
export class RangedAttackGoal extends MobGoal {
  readonly name = 'ranged_attack';
  override readonly flags: readonly GoalFlag[] = ['move', 'look'];
  private readonly fire: FireFunction;
  private readonly interval: number;
  private readonly minRange: number;
  private readonly maxRange: number;
  private readonly speed: number;
  private countdown = 0;
  private strafeTicks = 0;
  private strafeSide = 1;

  constructor(mob: MobHandle, options: RangedAttackOptions) {
    super(mob);
    this.fire = options.fire;
    this.interval = options.interval;
    this.minRange = options.minRange ?? 8;
    this.maxRange = options.maxRange ?? 12;
    this.speed = options.speed ?? 1;
  }

  canStart(): boolean {
    return this.liveTarget !== null;
  }

  override start(): void {
    this.countdown = this.interval;
    this.strafeTicks = 0;
  }

  override tick(): void {
    const target = this.liveTarget!;
    const box = this.runtime.targetBounds(target)!;
    const aim: Vec3 = [
      (box.minX + box.maxX) / 2,
      (box.minY + box.maxY) / 2,
      (box.minZ + box.maxZ) / 2,
    ];
    this.lookAt(aim);
    const pos = this.pos;
    const dx = aim[0] - pos[0],
      dz = aim[2] - pos[2];
    const flat = Math.hypot(dx, dz);
    const distance = this.distanceTo(this.runtime.targetPos(target)!);
    const speed = this.body.speed * this.speed;
    if (distance > this.maxRange)
      this.nav.moveTo(aim[0], box.minY, aim[2], { speed: this.speed, direct: true });
    else {
      this.nav.stop();
      if (--this.strafeTicks <= 0 || this.body.horizontalCollision) {
        this.strafeSide = this.runtime.random() < 0.5 ? -1 : 1;
        this.strafeTicks = 20 + this.randomInt(0, 40);
      }
      if (flat > 1e-6) {
        const ux = dx / flat,
          uz = dz / flat;
        // Back off inside the minimum range, then sidestep around the target.
        const back = distance < this.minRange ? -1 : 0;
        const side = this.strafeSide * 0.5;
        this.body.wish[0] = (ux * back - uz * side) * speed;
        this.body.wish[2] = (uz * back + ux * side) * speed;
      }
    }
    if (--this.countdown <= 0 && distance <= this.maxRange) {
      this.fire(aim, this.id);
      this.countdown = this.interval;
    }
  }

  override stop(): void {
    this.nav.stop();
    this.lookAt(null);
  }
}
