import type { GoalFlag } from '../goal';
import type { BlockPos } from '../pathfinding';
import type { MobHandle } from '../runtime';
import { MobGoal, findStandable } from './mob-goal';

export interface WanderOptions {
  radius?: number;
  idleMin?: number;
  idleMax?: number;
  speed?: number;
}

/** Idles for 60–200 ticks, then walks to a random standable point within 10 blocks. */
export class WanderGoal extends MobGoal {
  readonly name = 'wander';
  override readonly flags: readonly GoalFlag[] = ['move'];
  private readonly radius: number;
  private readonly idleMin: number;
  private readonly idleMax: number;
  private readonly speed: number;
  private idle: number;
  private point: BlockPos | null = null;

  constructor(mob: MobHandle, options: WanderOptions = {}) {
    super(mob);
    this.radius = options.radius ?? 10;
    this.idleMin = options.idleMin ?? 60;
    this.idleMax = options.idleMax ?? 200;
    this.speed = options.speed ?? 1;
    this.idle = this.randomInt(this.idleMin, this.idleMax);
  }

  /** Ticks left before the next walk. */
  get idleTicks(): number {
    return this.idle;
  }

  canStart(): boolean {
    if (this.idle > 0) {
      this.idle--;
      return false;
    }
    this.point = this.pickPoint();
    if (!this.point) this.idle = this.randomInt(this.idleMin, this.idleMax);
    return this.point !== null;
  }

  override shouldContinue(): boolean {
    return !this.nav.idle;
  }

  override start(): void {
    const point = this.point!;
    this.nav.moveTo(point[0] + 0.5, point[1], point[2] + 0.5, { speed: this.speed });
  }

  override stop(): void {
    this.nav.stop();
    this.point = null;
    this.idle = this.randomInt(this.idleMin, this.idleMax);
  }

  private pickPoint(): BlockPos | null {
    const pos = this.pos;
    for (let attempt = 0; attempt < 10; attempt++) {
      const angle = this.runtime.random() * Math.PI * 2;
      const distance = 2 + this.runtime.random() * (this.radius - 2);
      const x = Math.floor(pos[0] + Math.cos(angle) * distance);
      const z = Math.floor(pos[2] + Math.sin(angle) * distance);
      const cell = findStandable(this.runtime, x, Math.floor(pos[1] + 0.01), z, this.height);
      if (cell) return cell;
    }
    return null;
  }
}
