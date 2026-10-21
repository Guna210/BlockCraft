import type { GoalFlag } from '../goal';
import { getWorldTime, sunElevationSin } from '../../../world/time';
import type { BlockPos } from '../pathfinding';
import type { MobHandle } from '../runtime';
import { MobGoal, standable } from './mob-goal';

export interface AvoidSunlightOptions {
  range?: number;
  speed?: number;
}

const SEARCH_INTERVAL = 20;
const VERTICAL_RANGE = 4;

/**
 * In daytime with full sky light (15) at head height, walks to the nearest standable cell within
 * 16 blocks whose head space has sky light below 15.
 */
export class AvoidSunlightGoal extends MobGoal {
  readonly name = 'avoid_sunlight';
  override readonly flags: readonly GoalFlag[] = ['move'];
  private readonly range: number;
  private readonly speed: number;
  private shade: BlockPos | null = null;
  private searchCooldown = 0;

  constructor(mob: MobHandle, options: AvoidSunlightOptions = {}) {
    super(mob);
    this.range = options.range ?? 16;
    this.speed = options.speed ?? 1;
  }

  /** Whether the head is in direct daylight. */
  inSunlight(): boolean {
    if (sunElevationSin(getWorldTime()) <= 0 || !this.runtime.world.lightEngine) return false;
    const pos = this.pos;
    const head = Math.floor(pos[1] + this.height - 0.1);
    return this.runtime.world.getLight(Math.floor(pos[0]), head, Math.floor(pos[2])).sky >= 15;
  }

  canStart(): boolean {
    if (!this.inSunlight()) return false;
    if (this.searchCooldown > 0) {
      this.searchCooldown--;
      return false;
    }
    this.shade = this.findShade();
    if (!this.shade) this.searchCooldown = SEARCH_INTERVAL;
    return this.shade !== null;
  }

  override shouldContinue(): boolean {
    return this.shade !== null && this.inSunlight();
  }

  override start(): void {
    this.go();
  }

  override tick(): void {
    if (!this.nav.idle) return;
    this.shade = this.findShade();
    if (this.shade) this.go();
  }

  override stop(): void {
    this.nav.stop();
    this.shade = null;
  }

  private go(): void {
    const shade = this.shade!;
    this.nav.moveTo(shade[0] + 0.5, shade[1], shade[2] + 0.5, { speed: this.speed });
  }

  /** Nearest shaded standable cell, searching square rings outwards. */
  findShade(): BlockPos | null {
    const pos = this.pos;
    const x0 = Math.floor(pos[0]),
      y0 = Math.floor(pos[1] + 0.01),
      z0 = Math.floor(pos[2]);
    const cells = Math.max(1, Math.ceil(this.height - 1e-6));
    const world = this.runtime.world;
    for (let r = 1; r <= this.range; r++) {
      let best: BlockPos | null = null,
        bestDistance = Infinity;
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const flat = dx * dx + dz * dz;
          if (flat > this.range * this.range) continue;
          for (let dy = -VERTICAL_RANGE; dy <= VERTICAL_RANGE; dy++) {
            const distance = flat + dy * dy;
            if (distance >= bestDistance) continue;
            const x = x0 + dx,
              y = y0 + dy,
              z = z0 + dz;
            if (!standable(this.runtime, x, y, z, cells)) continue;
            if (world.getLight(x, y + cells - 1, z).sky >= 15) continue;
            best = [x, y, z];
            bestDistance = distance;
          }
        }
      if (best) return best;
    }
    return null;
  }
}
