import type { EntityWorld } from '../entity/ecs/world';
import { BodyC, HealthC, TransformC } from '../entity/ecs/components';
import type { Vec3 } from '../entity/ecs/model';
import { entityState } from '../entity/ecs/systems';
import { hurtMob } from './combat';
import type { World } from '../world/world';
import { VoxelRaycaster, createRayHit } from '../world/raycast';
import { MobBodyC } from '../entity/ai/components';

/** What a blast can hurt; the player hook applies shield and armor. */
export interface BlastScene {
  ecs: EntityWorld;
  world?: World;
  player(): {
    readonly pos: Readonly<Vec3>;
    readonly height: number;
    impulse?(velocity: Vec3): void;
    hurt(amount: number, source: string, from: Readonly<Vec3>): boolean;
  } | null;
}

/** Damage radius in blocks for a blast of this power. */
export function blastRadius(power: number): number {
  return power * 2;
}

/** Damage at `distance` from the centre: (impact² + impact)·2·power, impact = 1 − d / radius. */
export function blastDamage(power: number, distance: number, exposure = 1): number {
  const impact = Math.max(0, 1 - distance / blastRadius(power)) * exposure;
  if (impact <= 0) return 0;
  return (impact * impact + impact) * 2 * power;
}

const exposureRays = new WeakMap<
  World,
  { ray: VoxelRaycaster; hit: ReturnType<typeof createRayHit> }
>();

/** Twenty-seven shape-aware sample rays to the interior of a body's bounding box. */
export function blastExposure(
  world: World,
  center: Readonly<Vec3>,
  pos: Readonly<Vec3>,
  width: number,
  height: number,
): number {
  let cached = exposureRays.get(world);
  if (!cached) {
    cached = { ray: new VoxelRaycaster(world), hit: createRayHit() };
    exposureRays.set(world, cached);
  }
  const { ray, hit } = cached;
  let clear = 0;
  for (let x = 0; x < 3; x++)
    for (let y = 0; y < 3; y++)
      for (let z = 0; z < 3; z++) {
        const dx = pos[0] + (x - 1) * width * 0.45 - center[0];
        const dy = pos[1] + height * (0.05 + y * 0.45) - center[1];
        const dz = pos[2] + (z - 1) * width * 0.45 - center[2];
        const distance = Math.hypot(dx, dy, dz);
        if (
          !ray.cast(center[0], center[1], center[2], dx, dy, dz, Math.max(0, distance - 1e-5), hit)
            .hit
        )
          clear++;
      }
  return clear / 27;
}
function impulse(
  center: Readonly<Vec3>,
  pos: Readonly<Vec3>,
  height: number,
  power: number,
  exposure: number,
): Vec3 {
  const dx = pos[0] - center[0],
    dy = pos[1] + height / 2 - center[1],
    dz = pos[2] - center[2];
  const distance = Math.hypot(dx, dy, dz),
    scale = (Math.max(0, 1 - distance / blastRadius(power)) * exposure) / Math.max(distance, 0.01);
  return [dx * scale, dy * scale, dz * scale];
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
    const distance = Math.hypot(
      pos[0] - center[0],
      pos[1] + body.height / 2 - center[1],
      pos[2] - center[2],
    );
    if (distance >= blastRadius(power)) continue;
    const exposure = scene.world
      ? blastExposure(scene.world, center, pos, body.width, body.height)
      : 1;
    const damage = blastDamage(power, distance, exposure);
    if (damage > 0 && hurtMob(ecs, id, damage, { ref: source ?? -1, pos: center })) {
      hurt++;
      const motion = ecs.get(id, MobBodyC);
      if (motion) {
        const v = impulse(center, pos, body.height, power, exposure);
        for (let a = 0; a < 3; a++) motion.vel[a] = v[a]!;
      }
    }
  }
  const player = scene.player();
  if (player) {
    const p = player.pos;
    const distance = Math.hypot(
      p[0] - center[0],
      p[1] + player.height / 2 - center[1],
      p[2] - center[2],
    );
    if (distance >= blastRadius(power)) return hurt;
    const exposure = scene.world ? blastExposure(scene.world, center, p, 0.6, player.height) : 1;
    const damage = blastDamage(power, distance, exposure);
    if (damage > 0 && player.hurt(damage, 'blast', center)) {
      hurt++;
      player.impulse?.(impulse(center, p, player.height, power, exposure));
    }
  }
  return hurt;
}
