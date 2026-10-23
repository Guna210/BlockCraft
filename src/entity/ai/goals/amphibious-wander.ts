import type { GoalFlag } from '../goal';
import type { BlockPos } from '../pathfinding';
import type { MobHandle } from '../runtime';
import { MobGoal, findStandable, standable } from './mob-goal';

export interface AmphibiousWanderOptions {
  radius?: number;
  idleMin?: number;
  idleMax?: number;
  speed?: number;
}

/**
 * Wandering that moves between water and land: from land the mob heads for the surface of water
 * within 12 blocks, from water it heads for dry land, idling 60–200 ticks between trips. With
 * nothing of the other kind in reach it wanders like WanderGoal.
 */
export class AmphibiousWanderGoal extends MobGoal {
  readonly name = 'wander';
  override readonly flags: readonly GoalFlag[] = ['move'];
  private readonly radius: number;
  private readonly idleMin: number;
  private readonly idleMax: number;
  private readonly speed: number;
  private idle: number;
  private point: BlockPos | null = null;
  /** Whether the current trip heads for water. */
  toWater = false;

  constructor(mob: MobHandle, options: AmphibiousWanderOptions = {}) {
    super(mob);
    this.radius = options.radius ?? 12;
    this.idleMin = options.idleMin ?? 60;
    this.idleMax = options.idleMax ?? 200;
    this.speed = options.speed ?? 1;
    this.idle = this.randomInt(this.idleMin, this.idleMax);
  }

  get idleTicks(): number {
    return this.idle;
  }

  set idleTicks(ticks: number) {
    this.idle = ticks;
  }

  /** The target of the current trip. */
  get target(): BlockPos | null {
    return this.point;
  }

  canStart(): boolean {
    if (this.idle > 0) {
      this.idle--;
      return false;
    }
    this.toWater = !this.inWater();
    this.point = this.pick(this.toWater) ?? this.pickAny();
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

  private inWater(): boolean {
    const pos = this.pos;
    return (
      this.body.inFluid ||
      this.runtime.classify(Math.floor(pos[0]), Math.floor(pos[1] + 0.1), Math.floor(pos[2])) ===
        'water'
    );
  }

  /** A water surface cell (water with air above) or a dry standable cell within the radius. */
  private pick(water: boolean): BlockPos | null {
    const pos = this.pos,
      r = this.runtime;
    const y0 = Math.floor(pos[1] + 0.01);
    for (let attempt = 0; attempt < 16; attempt++) {
      const angle = r.random() * Math.PI * 2;
      const distance = 2 + r.random() * (this.radius - 2);
      const x = Math.floor(pos[0] + Math.cos(angle) * distance);
      const z = Math.floor(pos[2] + Math.sin(angle) * distance);
      for (let i = 0; i <= 12; i++) {
        const y = y0 + (i % 2 === 1 ? (i + 1) / 2 : -i / 2);
        if (water) {
          if (r.classify(x, y, z) === 'water' && r.classify(x, y + 1, z) === 'passable')
            return [x, y, z];
        } else if (r.classify(x, y, z) === 'passable' && standable(r, x, y, z, this.cells()))
          return [x, y, z];
      }
    }
    return null;
  }

  private pickAny(): BlockPos | null {
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

  private cells(): number {
    return Math.max(1, Math.ceil(this.height - 1e-6));
  }
}
