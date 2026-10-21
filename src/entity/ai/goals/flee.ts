import type { GoalFlag } from '../goal';
import type { Vec3 } from '../../ecs/model';
import type { MobHandle } from '../runtime';
import { MobGoal, findStandable } from './mob-goal';

export interface FleeOptions {
  ticks?: number;
  speed?: number;
  distance?: number;
}

/** After being hurt, runs away from the attacker for 100 ticks at 1.25× speed. */
export class FleeGoal extends MobGoal {
  readonly name = 'flee';
  override readonly flags: readonly GoalFlag[] = ['move'];
  private readonly ticks: number;
  private readonly speed: number;
  private readonly distance: number;
  private until = 0;
  private seenHurt = -Infinity;

  constructor(mob: MobHandle, options: FleeOptions = {}) {
    super(mob);
    this.ticks = options.ticks ?? 100;
    this.speed = options.speed ?? 1.25;
    this.distance = options.distance ?? 8;
  }

  canStart(): boolean {
    const targeting = this.targeting;
    return targeting.attackerPos !== null && this.ecs.time - targeting.hurtAt <= 1;
  }

  override shouldContinue(): boolean {
    return this.ecs.time < this.until;
  }

  override start(): void {
    this.seenHurt = this.targeting.hurtAt;
    this.until = this.ecs.time + this.ticks;
    this.runAway();
  }

  override tick(): void {
    if (this.targeting.hurtAt !== this.seenHurt) this.start();
    else if (this.nav.idle) this.runAway();
  }

  override stop(): void {
    this.nav.stop();
  }

  private attackerPos(): Readonly<Vec3> {
    const targeting = this.targeting;
    const current = targeting.attacker !== null ? this.runtime.targetPos(targeting.attacker) : null;
    return current ?? targeting.attackerPos!;
  }

  private runAway(): void {
    const pos = this.pos,
      from = this.attackerPos();
    let away = Math.atan2(pos[2] - from[2], pos[0] - from[0]);
    if (Math.hypot(pos[0] - from[0], pos[2] - from[2]) < 1e-6)
      away = this.runtime.random() * Math.PI * 2;
    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = away + (this.runtime.random() - 0.5) * 1.2;
      const x = Math.floor(pos[0] + Math.cos(angle) * this.distance);
      const z = Math.floor(pos[2] + Math.sin(angle) * this.distance);
      const cell = findStandable(this.runtime, x, Math.floor(pos[1] + 0.01), z, this.height);
      if (cell) {
        this.nav.moveTo(cell[0] + 0.5, cell[1], cell[2] + 0.5, { speed: this.speed });
        return;
      }
    }
  }
}
