import { api } from './core';
import { WorldManager } from '../../world/world-manager';
import { killPlayer } from './death';
import { spawnEntity } from '../../entity/ecs/entity-types';
import { killEntity, snapshotEcsEntities } from '../../entity/ecs/systems';
import { entityAI } from '../../entity/ai/runtime';
import { ProjectileC, ProjectileVelocityC } from '../../entity/projectiles';
import { TransformC } from '../../entity/ecs/components';
function controller() {
  const c = WorldManager.getInstance().playerController;
  if (!c?.player || !c.itemEntities || !c.ecs)
    throw new Error('Create a world before querying entities');
  return c;
}
api.spawn = (type, x, y, z) => {
  const c = controller();
  return spawnEntity({ ecs: c.ecs!, items: c.itemEntities! }, type, x, y, z);
};
function getEntities(filter?: { type?: string; radius?: number }) {
  if (filter?.radius !== undefined && (!Number.isFinite(filter.radius) || filter.radius < 0))
    throw new Error('Entity radius must be finite and nonnegative');
  const c = controller();
  return [
    ...c.itemEntities!.snapshot(c.player!, filter),
    ...snapshotEcsEntities(c.ecs!, c.player!.pos, filter),
  ].sort((a, b) => a.id - b.id);
}
// With type 'item' only item snapshots match, which the first overload states.
api.getEntities = getEntities as NonNullable<typeof api.getEntities>;
api.kill = (id) => {
  if (!Number.isSafeInteger(id) || id < 0)
    throw new Error('Entity id must be a non-negative integer');
  if (id === 0) return killPlayer();
  const c = WorldManager.getInstance().playerController;
  const item = c?.itemEntities?.pool.find((e) => e.active && e.id === id);
  if (item) item.active = false;
  else if (c?.ecs?.exists(id)) killEntity(c.ecs, id);
  else throw new Error(`No entity with id ${id} exists`);
};
api.getEntityAI = (id) => {
  if (!Number.isSafeInteger(id) || id < 0)
    throw new Error('Entity id must be a non-negative integer');
  return entityAI(controller().ecs!, id);
};
api.getProjectile = (id) => {
  if (!Number.isSafeInteger(id) || id < 0)
    throw new Error('Projectile id must be a non-negative integer');
  const c = controller(),
    projectile = c.ecs!.get(id, ProjectileC),
    transform = c.ecs!.get(id, TransformC),
    motion = c.ecs!.get(id, ProjectileVelocityC);
  if (!projectile || !transform || !motion) throw new Error(`No projectile with id ${id} exists`);
  return {
    pos: [...transform.pos] as [number, number, number],
    vel: [...motion.vel] as [number, number, number],
    stuck: projectile.stuck,
    owner: projectile.owner,
    kind: projectile.kind,
  };
};
api.getDropStats = () => {
  const c = controller(),
    renderer = WorldManager.getInstance().dropRenderer;
  return {
    items: c.itemEntities!.pool.filter((e) => e.active).length,
    particles: c.particles!.pool.filter((p) => p.active).length,
    itemDraws: renderer?.itemDraws ?? 0,
    particleDraws: renderer?.particleDraws ?? 0,
    triangles: renderer?.triangles ?? 0,
  };
};
