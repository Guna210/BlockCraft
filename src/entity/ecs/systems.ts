import { EntityWorld } from './world';
import {
  AnimatorC,
  BodyC,
  DEATH_TICKS,
  EntityKindC,
  HURT_TICKS,
  HealthC,
  LookTargetC,
  RenderableC,
  TransformC,
} from './components';
import { getEntityModel, type Vec3 } from './model';
import {
  DEFAULT_HEAD_MAX_PITCH,
  DEFAULT_HEAD_MAX_YAW,
  clipTime,
  headLook,
  smoothToward,
  walkPhaseStep,
} from './animation';
import type { QueriedEntity } from '../query';
import { MobC } from '../ai/components';

/** Systems added by later tasks (AI, physics) run between these two orders. */
export const SNAPSHOT_ORDER = -1000;
export const ANIMATION_ORDER = 1000;
export const HEALTH_ORDER = 1100;
export const TICKS_PER_SECOND = 20;

export type EntityState = 'alive' | 'dying';

export interface EcsEntitySnapshot {
  id: number;
  type: string;
  pos: Vec3;
  health: number;
  state: EntityState;
}

/** Copies this tick's starting state into the `previous` fields used for render interpolation. */
function snapshotSystem(ecs: EntityWorld): void {
  for (const id of ecs.query(TransformC)) {
    const t = ecs.get(id, TransformC)!;
    t.previous[0] = t.pos[0];
    t.previous[1] = t.pos[1];
    t.previous[2] = t.pos[2];
    t.previousYaw = t.yaw;
    if (t.pitch !== undefined) t.previousPitch = t.pitch;
  }
  for (const id of ecs.query(AnimatorC)) {
    const a = ecs.get(id, AnimatorC)!;
    a.previousWalkPhase = a.walkPhase;
    a.previousSpeed = a.speed;
    a.previousHeadYaw = a.headYaw;
    a.previousHeadPitch = a.headPitch;
  }
  for (const id of ecs.query(HealthC)) {
    const h = ecs.get(id, HealthC)!;
    h.previousDeathTicks = h.deathTicks;
  }
}

/** Walk phase from horizontal distance, head tracking, and expiry of one-shot clips. */
function animationSystem(ecs: EntityWorld): void {
  for (const id of ecs.query(AnimatorC, TransformC, RenderableC)) {
    const a = ecs.get(id, AnimatorC)!,
      t = ecs.get(id, TransformC)!,
      model = getEntityModel(ecs.get(id, RenderableC)!.model);
    const distance = Math.hypot(t.pos[0] - t.previous[0], t.pos[2] - t.previous[2]);
    a.speed = distance * TICKS_PER_SECOND;
    if (model.walk) a.walkPhase += walkPhaseStep(distance, model.walk.stride);
    if (model.head) {
      const target = ecs.get(id, LookTargetC)?.target ?? null;
      let yaw = 0,
        pitch = 0;
      if (target) {
        const head = model.parts.find((part) => part.name === model.head!.part)!;
        const eye: Vec3 = [t.pos[0], t.pos[1] + head.pivot[1] / 16, t.pos[2]];
        [yaw, pitch] = headLook(
          t.yaw,
          eye,
          target,
          model.head.maxYaw ?? DEFAULT_HEAD_MAX_YAW,
          model.head.maxPitch ?? DEFAULT_HEAD_MAX_PITCH,
        );
      }
      a.headYaw = smoothToward(a.headYaw, yaw);
      a.headPitch = smoothToward(a.headPitch, pitch);
    }
    if (a.clips.length)
      a.clips = a.clips.filter(
        (clip) => clipTime(model.clips![clip.name]!, ecs.time - clip.start) !== null,
      );
  }
}

/** Counts down the hurt tint, advances the death tip-over and removes entities that finished it. */
function healthSystem(ecs: EntityWorld): void {
  for (const id of ecs.query(HealthC)) {
    const h = ecs.get(id, HealthC)!;
    if (h.hurtTicks > 0) h.hurtTicks--;
    if (h.current > 0) continue;
    h.deathTicks++;
    if (h.deathTicks > DEATH_TICKS) ecs.destroy(id);
  }
}

/** An EntityWorld with the snapshot, animation and health systems installed. */
export function createEntityWorld(): EntityWorld {
  const ecs = new EntityWorld();
  ecs.addSystem(snapshotSystem, SNAPSHOT_ORDER);
  ecs.addSystem(animationSystem, ANIMATION_ORDER);
  ecs.addSystem(healthSystem, HEALTH_ORDER);
  return ecs;
}

export interface ModelEntityOptions {
  type: string;
  model: string;
  pos: Vec3;
  yaw?: number;
  health: number;
  width: number;
  height: number;
  /** Model scale; 1 by default. */
  scale?: number;
}

/** Creates an entity with every component the renderer and the built-in systems use. */
export function spawnModelEntity(ecs: EntityWorld, options: ModelEntityOptions): number {
  getEntityModel(options.model);
  const id = ecs.create(),
    yaw = options.yaw ?? 0;
  ecs.add(id, EntityKindC, { type: options.type });
  ecs.add(id, TransformC, {
    pos: [...options.pos],
    previous: [...options.pos],
    yaw,
    previousYaw: yaw,
  });
  ecs.add(id, BodyC, { width: options.width, height: options.height });
  ecs.add(id, HealthC, {
    current: options.health,
    max: options.health,
    hurtTicks: 0,
    deathTicks: 0,
    previousDeathTicks: 0,
  });
  ecs.add(id, RenderableC, { model: options.model, scale: options.scale ?? 1 });
  ecs.add(id, AnimatorC, {
    walkPhase: 0,
    previousWalkPhase: 0,
    speed: 0,
    previousSpeed: 0,
    headYaw: 0,
    previousHeadYaw: 0,
    headPitch: 0,
    previousHeadPitch: 0,
    clips: [],
  });
  ecs.add(id, LookTargetC, { target: null });
  return id;
}

export function entityState(ecs: EntityWorld, id: number): EntityState {
  const health = ecs.get(id, HealthC);
  return health && health.current <= 0 ? 'dying' : 'alive';
}

/** Lowers health and starts the hurt tint. Dying entities take no further damage. */
export function damageEntity(ecs: EntityWorld, id: number, amount: number): void {
  const health = ecs.get(id, HealthC);
  if (!health) throw new Error(`Entity ${id} has no health`);
  if (health.current <= 0 || !(amount > 0)) return;
  health.current = Math.max(0, health.current - amount);
  health.hurtTicks = HURT_TICKS;
}

/** Sets health to 0 so the entity plays its tip-over; entities without health are removed at once. */
export function killEntity(ecs: EntityWorld, id: number): void {
  if (!ecs.exists(id)) throw new Error(`No entity with id ${id} exists`);
  const health = ecs.get(id, HealthC);
  if (!health) ecs.destroy(id);
  else if (health.current > 0) health.current = 0;
}

/** Starts a keyframed clip of the entity's model; playing it again restarts it. */
export function playClip(ecs: EntityWorld, id: number, name: string): void {
  const renderable = ecs.get(id, RenderableC),
    animator = ecs.get(id, AnimatorC);
  if (!renderable || !animator) throw new Error(`Entity ${id} is not animated`);
  if (!getEntityModel(renderable.model).clips?.[name])
    throw new Error(`Model ${renderable.model} has no clip ${name}`);
  animator.clips = animator.clips.filter((clip) => clip.name !== name);
  animator.clips.push({ name, start: ecs.time });
}

export function snapshotEcsEntities(
  ecs: EntityWorld,
  origin: Readonly<Vec3>,
  filter?: { type?: string; radius?: number },
): EcsEntitySnapshot[] {
  const result: EcsEntitySnapshot[] = [];
  for (const id of ecs.query(EntityKindC, TransformC)) {
    const type = ecs.get(id, EntityKindC)!.type,
      pos = ecs.get(id, TransformC)!.pos;
    if (filter?.type !== undefined && filter.type !== type) continue;
    if (
      filter?.radius !== undefined &&
      Math.hypot(pos[0] - origin[0], pos[1] - origin[1], pos[2] - origin[2]) > filter.radius
    )
      continue;
    result.push({
      id,
      type,
      pos: [...pos],
      health: ecs.get(id, HealthC)?.current ?? 0,
      state: entityState(ecs, id),
    });
  }
  return result;
}

/** Bounds of living entities for EntityQuery (pressure plates, tripwire); dying ones press nothing. */
export function queryEcsEntities(ecs: EntityWorld): QueriedEntity[] {
  const result: QueriedEntity[] = [];
  for (const id of ecs.query(EntityKindC, TransformC, BodyC)) {
    if (entityState(ecs, id) === 'dying') continue;
    const pos = ecs.get(id, TransformC)!.pos,
      body = ecs.get(id, BodyC)!,
      half = body.width / 2,
      category = ecs.get(id, MobC)?.category;
    result.push({
      id,
      type: ecs.get(id, EntityKindC)!.type,
      ...(category ? { category } : {}),
      minX: pos[0] - half,
      minY: pos[1],
      minZ: pos[2] - half,
      maxX: pos[0] + half,
      maxY: pos[1] + body.height,
      maxZ: pos[2] + half,
    });
  }
  return result;
}
