import type { GoalFlag } from '../goal';
import type { EntityWorld } from '../../ecs/world';
import { EntityKindC, TransformC } from '../../ecs/components';
import { entityState } from '../../ecs/systems';
import { LoveC, MobC } from '../components';
import type { MobHandle } from '../runtime';
import { MobGoal } from './mob-goal';

export const LOVE_TICKS = 600;
export const BREED_COOLDOWN = 6000;
/** Partners closer than this produce the baby. */
export const BREED_DISTANCE = 1.5;

/**
 * Feeds a mob one of its foods: an adult that is not in love or on cooldown falls in love for 600
 * ticks. Returns true when the food was taken.
 */
export function feedMob(ecs: EntityWorld, id: number, itemId: string): boolean {
  const mob = ecs.get(id, MobC),
    love = ecs.get(id, LoveC);
  if (!mob || !love || !mob.foods.has(itemId) || entityState(ecs, id) === 'dying') return false;
  if (love.baby || love.cooldown > 0 || love.loveTicks > 0) return false;
  love.loveTicks = LOVE_TICKS;
  return true;
}

function ready(ecs: EntityWorld, id: number): boolean {
  const love = ecs.get(id, LoveC);
  return (
    !!love &&
    love.loveTicks > 0 &&
    !love.baby &&
    love.cooldown === 0 &&
    entityState(ecs, id) === 'alive'
  );
}

export interface BreedOptions {
  range?: number;
  speed?: number;
}

/**
 * Two mobs of one type in love within 8 blocks walk together; within 1.5 blocks they spawn one baby
 * through the type's factory with `{ baby: true }`, and both start a 6000-tick cooldown.
 */
export class BreedGoal extends MobGoal {
  readonly name = 'breed';
  override readonly flags: readonly GoalFlag[] = ['move', 'look'];
  private readonly range: number;
  private readonly speed: number;
  private partner: number | null = null;

  constructor(mob: MobHandle, options: BreedOptions = {}) {
    super(mob);
    this.range = options.range ?? 8;
    this.speed = options.speed ?? 1;
  }

  canStart(): boolean {
    if (!ready(this.ecs, this.id)) return false;
    this.partner = this.findPartner();
    return this.partner !== null;
  }

  override shouldContinue(): boolean {
    const partner = this.partner;
    if (partner === null || !ready(this.ecs, this.id) || !ready(this.ecs, partner)) return false;
    const pos = this.ecs.get(partner, TransformC)?.pos;
    return !!pos && this.distanceTo(pos) <= this.range * 2;
  }

  override tick(): void {
    const partner = this.partner!;
    const other = this.ecs.get(partner, TransformC)!.pos;
    this.lookAt([other[0], other[1] + this.height * 0.8, other[2]]);
    if (this.distanceTo(other) <= BREED_DISTANCE) {
      this.breed(partner);
      return;
    }
    this.nav.moveTo(other[0], other[1], other[2], { speed: this.speed, direct: true });
  }

  override stop(): void {
    this.nav.stop();
    this.lookAt(null);
    this.partner = null;
  }

  private findPartner(): number | null {
    const type = this.ecs.get(this.id, EntityKindC)?.type;
    let best: number | null = null,
      bestDistance = this.range;
    for (const other of this.ecs.query(LoveC, EntityKindC, TransformC)) {
      if (other === this.id || this.ecs.get(other, EntityKindC)!.type !== type) continue;
      if (!ready(this.ecs, other)) continue;
      const distance = this.distanceTo(this.ecs.get(other, TransformC)!.pos);
      if (distance <= bestDistance) {
        best = other;
        bestDistance = distance;
      }
    }
    return best;
  }

  private breed(partner: number): void {
    const ecs = this.ecs;
    const a = this.pos,
      b = ecs.get(partner, TransformC)!.pos;
    const type = ecs.get(this.id, EntityKindC)!.type;
    for (const id of [this.id, partner]) {
      const love = ecs.get(id, LoveC)!;
      love.loveTicks = 0;
      love.cooldown = BREED_COOLDOWN;
    }
    this.runtime.spawn(type, (a[0] + b[0]) / 2, Math.max(a[1], b[1]), (a[2] + b[2]) / 2, {
      baby: true,
    });
  }
}
