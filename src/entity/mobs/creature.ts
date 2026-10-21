import { PRNG, deriveSeed } from '../../engine/rng';
import { defineComponent, type EntityWorld } from '../ecs/world';
import { BodyC, HealthC, RenderableC, TransformC } from '../ecs/components';
import { registerEntityModel, type EntityModel, type SkinGenerator } from '../ecs/model';
import {
  registerEntityType,
  type EntitySpawnContext,
  type EntitySpawnOptions,
} from '../ecs/entity-types';
import { spawnModelEntity } from '../ecs/systems';
import { AgeC, LoveC, MobC, type MobCategory } from '../ai/components';
import { registerMobInteraction, type MobUse } from '../ai/interactions';
import { AI_ORDER, addMob, type GoalFactory } from '../ai/runtime';
import type { ItemEntityManager } from '../item-entity';

/** Ticks for a baby to grow up: 20 minutes at 20 ticks per second. */
export const GROW_UP_TICKS = 24000;
/** Feeding a baby its food brings growing up closer by a tenth of the total. */
export const BABY_FEED_TICKS = GROW_UP_TICKS / 10;
export const BABY_SCALE = 0.5;
/** Goal priorities shared by the creatures; a lower number ranks higher. */
export const PRIORITY = {
  withdraw: 0,
  flee: 1,
  breed: 2,
  followFood: 3,
  forage: 4,
  layEgg: 4,
  wander: 5,
  flock: 5,
} as const;

/** After the AI pass, before navigation. */
export const CREATURE_ORDER = AI_ORDER + 50;

/** Items and counts dropped on death. */
export type Drops = Array<[itemId: string, count: number]>;

/** What a creature's hooks can reach. */
export interface CreatureContext {
  ecs: EntityWorld;
  items: ItemEntityManager;
  /** Deterministic random number in [0, 1), seeded from the world seed. */
  random(): number;
}

export interface CreatureDefinition {
  type: string;
  category: MobCategory;
  health: number;
  /** Adult collision size in blocks; a baby's is half. */
  width: number;
  height: number;
  /** Walking speed in blocks per tick. */
  speed: number;
  foods?: readonly string[];
  flying?: boolean;
  maxFallSpeed?: number;
  /** Model id for an entity spawned at (x, z). */
  model(ctx: EntitySpawnContext, x: number, z: number): string;
  goals: GoalFactory;
  /** Rolled once when the creature dies. */
  drops(ctx: CreatureContext, id: number): Drops;
  /** Adds creature-specific components after the shared ones. */
  setup?(ctx: CreatureContext, id: number, baby: boolean): void;
  /** Runs every tick for each living creature of this type whose column is loaded. */
  tick?(ctx: CreatureContext, id: number): void;
  /** 'use' with an item; feeding a baby is handled after it. */
  interact?(ctx: CreatureContext, id: number, itemId: string): MobUse | null;
}

interface Creature {
  definition: CreatureDefinition;
  dropped: boolean;
}

export const CreatureC = defineComponent<Creature>('creature');

const contexts = new WeakMap<EntityWorld, CreatureContext>();

/**
 * The creature context of an ECS world. The first creature spawned installs the creature system,
 * so a world without creatures runs nothing new.
 */
function contextFor(spawn: EntitySpawnContext): CreatureContext {
  let ctx = contexts.get(spawn.ecs);
  if (!ctx) {
    const rng = new PRNG(deriveSeed(spawn.items.world.worldSeed, 'creatures'));
    const created: CreatureContext = {
      ecs: spawn.ecs,
      items: spawn.items,
      random: () => rng.next(),
    };
    ctx = created;
    contexts.set(spawn.ecs, created);
    spawn.ecs.addSystem(() => creatureSystem(created), CREATURE_ORDER);
  }
  return ctx;
}

/** The creature context of an ECS world that has spawned a creature, else undefined. */
export function creatureContext(ecs: EntityWorld): CreatureContext | undefined {
  return contexts.get(ecs);
}

/** Growing up, death drops and per-type ticks. */
function creatureSystem(ctx: CreatureContext): void {
  const ecs = ctx.ecs,
    world = ctx.items.world;
  for (const id of ecs.query(CreatureC)) {
    const creature = ecs.get(id, CreatureC)!;
    const health = ecs.get(id, HealthC);
    if (health && health.current <= 0) {
      if (!creature.dropped) {
        creature.dropped = true;
        dropLoot(ctx, id, creature.definition);
      }
      continue;
    }
    const pos = ecs.get(id, TransformC)!.pos;
    if (!world.hasColumn(Math.floor(pos[0] / 16), Math.floor(pos[2] / 16))) continue;
    const age = ecs.get(id, AgeC);
    if (age) {
      age.ageTicks++;
      if (age.baby && age.ageTicks >= GROW_UP_TICKS) growUp(ecs, id, creature.definition);
    }
    creature.definition.tick?.(ctx, id);
  }
}

/** Spawns item entities for a creature's drops at the middle of its body. */
export function dropLoot(ctx: CreatureContext, id: number, definition: CreatureDefinition): void {
  const pos = ctx.ecs.get(id, TransformC)?.pos;
  if (!pos) return;
  const height = ctx.ecs.get(id, BodyC)?.height ?? definition.height;
  for (const [item, count] of definition.drops(ctx, id))
    if (count > 0) ctx.items.spawn(item, count, pos[0], pos[1] + height / 2, pos[2]);
}

/** A baby becomes an adult: full size, able to breed. */
export function growUp(ecs: EntityWorld, id: number, definition: CreatureDefinition): void {
  const age = ecs.get(id, AgeC),
    love = ecs.get(id, LoveC),
    body = ecs.get(id, BodyC),
    renderable = ecs.get(id, RenderableC);
  if (age) {
    age.baby = false;
    age.ageTicks = Math.max(age.ageTicks, GROW_UP_TICKS);
  }
  if (love) love.baby = false;
  if (body) {
    body.width = definition.width;
    body.height = definition.height;
  }
  if (renderable) renderable.scale = 1;
}

/** True for a living baby creature. */
export function isBaby(ecs: EntityWorld, id: number): boolean {
  return ecs.get(id, AgeC)?.baby ?? false;
}

/** A roll of min..max inclusive. */
export function rollCount(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** Spawns a creature of a definition; breeding passes `{ baby: true }`. */
export function spawnCreature(
  spawn: EntitySpawnContext,
  definition: CreatureDefinition,
  x: number,
  y: number,
  z: number,
  options?: EntitySpawnOptions,
): number {
  const ctx = contextFor(spawn);
  const baby = options?.baby === true;
  const scale = baby ? BABY_SCALE : 1;
  const id = spawnModelEntity(spawn.ecs, {
    type: definition.type,
    model: definition.model(spawn, x, z),
    pos: [x, y, z],
    yaw: ctx.random() * Math.PI * 2,
    health: definition.health,
    width: definition.width * scale,
    height: definition.height * scale,
    scale,
  });
  addMob(spawn.ecs, id, {
    category: definition.category,
    speed: definition.speed,
    foods: definition.foods ?? [],
    flying: definition.flying ?? false,
    ...(definition.maxFallSpeed !== undefined ? { maxFallSpeed: definition.maxFallSpeed } : {}),
    baby,
    goals: definition.goals,
  });
  spawn.ecs.add(id, AgeC, { baby, ageTicks: baby ? 0 : GROW_UP_TICKS });
  spawn.ecs.add(id, CreatureC, { definition, dropped: false });
  definition.setup?.(ctx, id, baby);
  return id;
}

/**
 * Feeds a baby one of its foods: growing up comes 10 % of the total closer. Returns 'consume' when
 * the food was taken.
 */
export function feedBaby(ecs: EntityWorld, id: number, itemId: string): MobUse | null {
  const age = ecs.get(id, AgeC);
  if (!age?.baby || !ecs.get(id, MobC)?.foods.has(itemId)) return null;
  age.ageTicks = Math.min(GROW_UP_TICKS, age.ageTicks + BABY_FEED_TICKS);
  return 'consume';
}

export interface CreatureRegistration {
  definition: CreatureDefinition;
  /** Every model of the creature (variants share geometry and differ in skin). */
  models: Array<[EntityModel, SkinGenerator]>;
}

/** Registers a creature's models, entity type and 'use' handler. */
export function registerCreature(registration: CreatureRegistration): void {
  const definition = registration.definition;
  for (const [model, skin] of registration.models) registerEntityModel(model, skin);
  registerEntityType(definition.type, (spawn, x, y, z, options) =>
    spawnCreature(spawn, definition, x, y, z, options),
  );
  registerMobInteraction(definition.type, (ecs, id, itemId) => {
    const ctx = contexts.get(ecs);
    const used = ctx && definition.interact ? definition.interact(ctx, id, itemId) : null;
    return used ?? feedBaby(ecs, id, itemId);
  });
}
