import { type ComponentType, type EntityWorld } from '../entity/ecs/world';
import {
  EntityKindC,
  TransformC,
  BodyC,
  HealthC,
  RenderableC,
  AnimatorC,
  LookTargetC,
} from '../entity/ecs/components';
import { MobBodyC, TargetC, LoveC, CombatC, AgeC, DamageScaleC } from '../entity/ai/components';
import { spawnEntity, type EntitySpawnContext } from '../entity/ecs/entity-types';
import { TuftbuckC } from '../entity/mobs/tuftbuck';
import { CinderC } from '../entity/mobs/cinderwraith';
import { GlowwingC } from '../entity/mobs/glowwing';
import { MagmawC } from '../entity/mobs/magmaw';
import { SporeCloudC, spawnSporeCloud } from '../entity/mobs/spore-cloud';
import { CreatureC } from '../entity/mobs/creature';
import { fireProjectile, ProjectileC, ProjectileVelocityC } from '../entity/projectiles';
import { PrimedChargeC, type BlastCharges } from '../entity/blast-charge';

const components: readonly ComponentType<unknown>[] = [
  TransformC,
  BodyC,
  HealthC,
  RenderableC,
  AnimatorC,
  LookTargetC,
  MobBodyC,
  TargetC,
  LoveC,
  CombatC,
  AgeC,
  DamageScaleC,
  TuftbuckC,
  CinderC,
  GlowwingC,
  MagmawC,
  SporeCloudC,
  ProjectileC,
  ProjectileVelocityC,
  PrimedChargeC,
];
interface SavedEntity {
  id: number;
  kind: string;
  components: Record<string, unknown>;
  dropped?: boolean;
}
/** AI closures and path caches rebuild from the registered type; persistent component data round-trips. */
export function serializeEcsEntities(ecs: EntityWorld): Uint8Array {
  const entities: SavedEntity[] = [];
  for (const id of ecs.query(EntityKindC, TransformC)) {
    const entry: SavedEntity = { id, kind: ecs.get(id, EntityKindC)!.type, components: {} };
    for (const component of components) {
      const value = ecs.get(id, component);
      if (value !== undefined) entry.components[component.name] = value;
    }
    const creature = ecs.get(id, CreatureC);
    if (creature) entry.dropped = creature.dropped;
    entities.push(entry);
  }
  return new TextEncoder().encode(
    JSON.stringify({ version: 1, time: ecs.time, entities }, (_key, value) =>
      typeof value === 'number' && !Number.isFinite(value) ? { number: String(value) } : value,
    ),
  );
}
export function restoreEcsEntities(
  context: EntitySpawnContext,
  charges: BlastCharges,
  bytes: Uint8Array,
): void {
  const saved = JSON.parse(new TextDecoder().decode(bytes), (_key, value) => {
    if (
      value &&
      typeof value === 'object' &&
      Object.keys(value).length === 1 &&
      (value.number === 'Infinity' || value.number === '-Infinity')
    )
      return Number(value.number);
    return value;
  }) as { version: number; time: number; entities: SavedEntity[] };
  if (saved.version !== 1 || !Array.isArray(saved.entities) || !Number.isSafeInteger(saved.time))
    throw new Error('Invalid ECS entity format');
  const ids = new Map<number, number>();
  const ecs = context.ecs;
  ecs.time = saved.time;
  for (const entry of saved.entities) {
    const transform = entry.components[TransformC.name] as { pos: [number, number, number] };
    if (
      !transform ||
      !Array.isArray(transform.pos) ||
      transform.pos.length !== 3 ||
      !transform.pos.every(Number.isFinite)
    )
      throw new Error('Invalid persisted entity transform');
    let id: number;
    if (entry.kind === 'primed_blast_charge') id = charges.restore(...transform.pos, 80);
    else if (entry.kind === 'spore_cloud') id = spawnSporeCloud(ecs, transform.pos);
    else if (entry.components[ProjectileC.name])
      id = fireProjectile(ecs, {
        kind: entry.kind,
        from: transform.pos,
        speed: 1,
        dir: [1, 0, 0],
        owner: 0,
      });
    else
      id = spawnEntity(context, entry.kind, ...transform.pos, {
        baby: (entry.components[AgeC.name] as { baby?: boolean } | undefined)?.baby,
      });
    ids.set(entry.id, id);
    for (const component of components) {
      const value = entry.components[component.name];
      if (value !== undefined) ecs.add(id, component, value);
    }
    const creature = ecs.get(id, CreatureC);
    if (creature) creature.dropped = entry.dropped ?? false;
  }
  for (const id of ids.values()) {
    const target = ecs.get(id, TargetC);
    if (target) {
      if (target.target !== null && target.target !== 0)
        target.target = ids.get(target.target) ?? null;
      if (target.attacker !== null && target.attacker !== 0)
        target.attacker = ids.get(target.attacker) ?? null;
    }
    const projectile = ecs.get(id, ProjectileC);
    if (projectile && projectile.owner !== 0) projectile.owner = ids.get(projectile.owner) ?? 0;
  }
}
