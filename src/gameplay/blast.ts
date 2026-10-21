import type { EntityWorld } from '../entity/ecs/world';
import { BodyC, HealthC, TransformC } from '../entity/ecs/components';
import type { Vec3 } from '../entity/ecs/model';
import { entityState } from '../entity/ecs/systems';
import { hurtMob } from './combat';

/** What a blast can hurt; the player hook applies shield and armor. */
export interface BlastScene {
  ecs: EntityWorld;
  player(): {
    readonly pos: Readonly<Vec3>;
    readonly height: number;
    hurt(amount: number, source: string, from: Readonly<Vec3>): boolean;
  } | null;
}

/** Damage radius in blocks for a blast of this power. */
export function blastRadius(power: number): number {
  return power * 2;
}

/** Damage at `distance` from the centre: (impact² + impact)·2·power, impact = 1 − d / radius. */
export function blastDamage(power: number, distance: number): number {
  const impact = 1 - distance / blastRadius(power);
  if (impact <= 0) return 0;
  return (impact * impact + impact) * 2 * power;
}

/**
 * Damages entities and the player around `center` with distance falloff, measured to the middle of
 * each body. `source` (the bursting mob) is spared. Returns the number of things hurt.
 */
export function blast(
  scene: BlastScene,
  center: Readonly<Vec3>,
  power: number,
  source?: number,
): number {
  let hurt = 0;
  const ecs = scene.ecs;
  for (const id of ecs.query(TransformC, BodyC, HealthC)) {
    if (id === source || entityState(ecs, id) === 'dying') continue;
    const pos = ecs.get(id, TransformC)!.pos,
      body = ecs.get(id, BodyC)!;
    const damage = blastDamage(
      power,
      Math.hypot(pos[0] - center[0], pos[1] + body.height / 2 - center[1], pos[2] - center[2]),
    );
    if (damage > 0 && hurtMob(ecs, id, damage, { ref: source ?? -1, pos: center })) hurt++;
  }
  const player = scene.player();
  if (player) {
    const p = player.pos;
    const damage = blastDamage(
      power,
      Math.hypot(p[0] - center[0], p[1] + player.height / 2 - center[1], p[2] - center[2]),
    );
    if (damage > 0 && player.hurt(damage, 'blast', center)) hurt++;
  }
  return hurt;
}
