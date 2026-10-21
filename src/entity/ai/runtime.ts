import type { World } from '../../world/world';
import type { EntityWorld } from '../ecs/world';
import { BodyC, EntityKindC, HealthC, LookTargetC, TransformC } from '../ecs/components';
import type { Vec3 } from '../ecs/model';
import { entityState } from '../ecs/systems';
import { spawnEntity, type EntitySpawnContext, type EntitySpawnOptions } from '../ecs/entity-types';
import type { EntityBounds } from '../query';
import { BlockCollision } from '../physics';
import { PRNG, deriveSeed } from '../../engine/rng';
import {
  AgeC,
  AiC,
  CombatC,
  LoveC,
  MobBodyC,
  MobC,
  NavC,
  PLAYER_TARGET,
  TargetC,
  type MobCategory,
  type TargetRef,
} from './components';
import { GoalSelector, type Goal } from './goal';
import { Navigator, PathScheduler, type NavigationHost } from './navigation';
import { moveMob } from './movement';
import { Pathfinder, WorldAdapter, type NodeClassification, type WorldLike } from './pathfinding';
import { hurtMob } from '../../gameplay/combat';
import { MobSpawner, spawnRules, type SpawnRuleRegistry } from '../spawning';

/** System orders: between M13a's snapshot (−1000) and animation (1000). */
export const AI_ORDER = -500;
export const NAV_ORDER = -400;
export const MOVE_ORDER = -300;
export const SPAWN_ORDER = -200;

/** What mobs see of the player. */
export interface MobPlayer {
  readonly pos: Readonly<Vec3>;
  readonly height: number;
  /** Item id in the main hand, or null. */
  heldItemId(): string | null;
  /** Alive and in survival: hostiles only target such a player. */
  targetable(): boolean;
  /** Mob damage to the player (shield and armor apply); true when any health was lost. */
  hurt(amount: number, source: string, from: Readonly<Vec3>): boolean;
}

export interface MobHandle {
  readonly id: number;
  readonly runtime: MobRuntime;
}

export type GoalFactory = (mob: MobHandle) => Array<[priority: number, goal: Goal]>;

export interface MobOptions {
  category: MobCategory;
  /** Walking speed in blocks per tick. */
  speed: number;
  foods?: Iterable<string>;
  flying?: boolean;
  climbing?: boolean;
  /** Fall speed cap in blocks per tick. */
  maxFallSpeed?: number;
  baby?: boolean;
  goals: GoalFactory;
}

const goalFactories = new WeakMap<object, GoalFactory>();

/** Adds the AI, movement, target, love and combat components to an entity from spawnModelEntity. */
export function addMob(ecs: EntityWorld, id: number, options: MobOptions): void {
  ecs.add(id, MobC, { category: options.category, foods: new Set(options.foods ?? []) });
  ecs.add(id, MobBodyC, {
    speed: options.speed,
    flying: options.flying ?? false,
    climbing: options.climbing ?? false,
    vel: [0, 0, 0],
    onGround: false,
    inFluid: false,
    horizontalCollision: false,
    wish: [0, 0, 0],
    maxFallSpeed: options.maxFallSpeed ?? Infinity,
    jump: false,
    climb: false,
  });
  const ai = ecs.add(id, AiC, { selector: null });
  goalFactories.set(ai, options.goals);
  ecs.add(id, TargetC, { target: null, attacker: null, attackerPos: null, hurtAt: -Infinity });
  ecs.add(id, LoveC, { loveTicks: 0, cooldown: 0, baby: options.baby ?? false });
  ecs.add(id, CombatC, { invulnerableTicks: 0, lastDamage: 0 });
}

interface SharedPaths {
  adapter: WorldAdapter;
  pathfinder: Pathfinder;
}

/** One WorldAdapter and Pathfinder per world, shared by every mob runtime on it. */
const sharedPaths = new WeakMap<World, SharedPaths>();

export function worldPaths(world: World): SharedPaths {
  let shared = sharedPaths.get(world);
  if (!shared) {
    // The adapter redefines `onBlockEdited` on the object it is given as an accessor, which turns
    // that object into a slow dictionary-mode object. Give it a view so the World keeps its shape:
    // otherwise every World call on the main thread gets about 3× slower and streaming stalls.
    const view: WorldLike = {
      getBlockStateId: (x, y, z) => world.getBlockStateId(x, y, z),
      hasColumn: (cx, cz) => world.hasColumn(cx, cz),
    };
    const adapter = new WorldAdapter(view);
    shared = { adapter, pathfinder: new Pathfinder(adapter) };
    // Edits and column loads and unloads change what is solid, so cached paths go stale.
    world.listeners.add({
      loaded: () => adapter.invalidate(),
      unloaded: () => adapter.invalidate(),
      blockEdited: () => adapter.invalidate(),
    });
    sharedPaths.set(world, shared);
  }
  return shared;
}

const runtimes = new WeakMap<EntityWorld, MobRuntime>();

/** The runtime installed on an ECS world, if any. */
export function mobRuntime(ecs: EntityWorld): MobRuntime | undefined {
  return runtimes.get(ecs);
}

export interface MobRuntimeOptions {
  player?: () => MobPlayer | null;
  /** Needed to spawn mobs (spawning, breeding). */
  spawnContext?: EntitySpawnContext;
  /** Natural spawning and despawning; off unless rules are given. */
  spawnRules?: SpawnRuleRegistry | 'default';
  seed?: number;
}

/** Ties the AI, navigation, movement and spawning systems of one ECS world to a block world. */
export class MobRuntime implements NavigationHost {
  readonly collision: BlockCollision;
  readonly adapter: WorldAdapter;
  readonly pathfinder: Pathfinder;
  readonly scheduler: PathScheduler;
  readonly spawner: MobSpawner | null;
  readonly spawnContext: EntitySpawnContext | null;
  private readonly rng: PRNG;
  private readonly removals = new Set<number>();
  private readonly getPlayer: () => MobPlayer | null;

  constructor(
    readonly world: World,
    readonly ecs: EntityWorld,
    options: MobRuntimeOptions = {},
  ) {
    if (runtimes.has(ecs)) throw new Error('A mob runtime is already installed on this ECS world');
    runtimes.set(ecs, this);
    this.collision = new BlockCollision(world);
    const shared = worldPaths(world);
    this.adapter = shared.adapter;
    this.pathfinder = shared.pathfinder;
    this.scheduler = new PathScheduler(this.pathfinder);
    this.rng = new PRNG(options.seed ?? deriveSeed(world.worldSeed, 'mobs'));
    this.getPlayer = options.player ?? (() => null);
    this.spawnContext = options.spawnContext ?? null;
    const rules = options.spawnRules === 'default' ? spawnRules : options.spawnRules;
    this.spawner = rules ? new MobSpawner(this, rules) : null;
    ecs.addSystem(() => this.aiSystem(), AI_ORDER);
    ecs.addSystem(() => this.navigationSystem(), NAV_ORDER);
    ecs.addSystem(() => this.movementSystem(), MOVE_ORDER);
    if (this.spawner) {
      const spawner = this.spawner;
      ecs.addSystem(() => spawner.tick(), SPAWN_ORDER);
    }
  }

  /** Detaches world listeners and drops every pending path search. */
  dispose(): void {
    this.scheduler.clear();
    if (runtimes.get(this.ecs) === this) runtimes.delete(this.ecs);
  }

  classify(x: number, y: number, z: number): NodeClassification {
    return this.adapter.classify(x, y, z);
  }

  /** Deterministic random number in [0, 1). */
  random(): number {
    return this.rng.next();
  }

  player(): MobPlayer | null {
    return this.getPlayer();
  }

  handle(id: number): MobHandle {
    return { id, runtime: this };
  }

  navigator(id: number): Navigator {
    let nav = this.ecs.get(id, NavC);
    if (!nav) nav = this.ecs.add(id, NavC, { navigator: new Navigator(this, id) });
    return nav.navigator;
  }

  /** Feet position of a target. */
  targetPos(ref: TargetRef): Readonly<Vec3> | null {
    if (ref === PLAYER_TARGET) return this.player()?.pos ?? null;
    return this.ecs.get(ref, TransformC)?.pos ?? null;
  }

  targetBounds(ref: TargetRef): EntityBounds | null {
    if (ref === PLAYER_TARGET) {
      const player = this.player();
      return player ? boundsAt(player.pos, 0.6, player.height) : null;
    }
    return this.entityBounds(ref);
  }

  entityBounds(id: number): EntityBounds | null {
    const pos = this.ecs.get(id, TransformC)?.pos,
      body = this.ecs.get(id, BodyC);
    return pos && body ? boundsAt(pos, body.width, body.height) : null;
  }

  /** The player is targetable, or the entity exists and is not dying. */
  targetAlive(ref: TargetRef): boolean {
    if (ref === PLAYER_TARGET) return this.player()?.targetable() ?? false;
    return this.ecs.exists(ref) && entityState(this.ecs, ref) === 'alive';
  }

  /** A melee hit from mob `attacker` on its target; true when it did damage. */
  hurtTarget(ref: TargetRef, amount: number, attacker: number): boolean {
    const from = this.ecs.get(attacker, TransformC)?.pos;
    if (!from) return false;
    const type = this.ecs.get(attacker, EntityKindC)?.type ?? 'unknown';
    if (ref === PLAYER_TARGET) return this.player()?.hurt(amount, `mob:${type}`, from) ?? false;
    return hurtMob(this.ecs, ref, amount, { ref: attacker, pos: from });
  }

  private aiSystem(): void {
    const ecs = this.ecs;
    for (const id of ecs.query(CombatC)) {
      const combat = ecs.get(id, CombatC)!;
      if (combat.invulnerableTicks > 0) combat.invulnerableTicks--;
    }
    for (const id of ecs.query(LoveC)) {
      const love = ecs.get(id, LoveC)!;
      if (love.loveTicks > 0) love.loveTicks--;
      if (love.cooldown > 0) love.cooldown--;
    }
    for (const id of ecs.query(AiC, TransformC)) {
      const ai = ecs.get(id, AiC)!;
      if (ecs.get(id, HealthC) && entityState(ecs, id) === 'dying') {
        if (ai.selector) {
          ai.selector.stopAll();
          ai.selector = null;
          ecs.get(id, NavC)?.navigator.stop();
          const look = ecs.get(id, LookTargetC);
          if (look) look.target = null;
        }
        continue;
      }
      const pos = ecs.get(id, TransformC)!.pos;
      if (!this.world.hasColumn(Math.floor(pos[0] / 16), Math.floor(pos[2] / 16))) continue;
      if (!ai.selector) {
        const factory = goalFactories.get(ai);
        if (!factory) continue;
        ai.selector = new GoalSelector();
        for (const [priority, goal] of factory(this.handle(id))) ai.selector.add(priority, goal);
      }
      ai.selector.tick();
    }
    for (const id of this.removals) {
      ecs.get(id, NavC)?.navigator.stop();
      ecs.destroy(id);
    }
    this.removals.clear();
  }

  /** Spawns a registered entity type; needs the spawn context given at construction. */
  spawn(type: string, x: number, y: number, z: number, options?: EntitySpawnOptions): number {
    if (!this.spawnContext) throw new Error('This mob runtime has no spawn context');
    return spawnEntity(this.spawnContext, type, x, y, z, options);
  }

  /** Removes a mob at the end of this AI pass, with no death tip-over (a burst). */
  remove(id: number): void {
    this.removals.add(id);
  }

  /** Removes a mob at once (despawning), stopping its path search. */
  removeNow(id: number): void {
    this.ecs.get(id, NavC)?.navigator.stop();
    this.ecs.destroy(id);
  }

  private navigationSystem(): void {
    const ecs = this.ecs;
    this.scheduler.prune((id) => ecs.exists(id) && entityState(ecs, id) === 'alive');
    this.scheduler.tick();
    for (const id of ecs.query(NavC)) ecs.get(id, NavC)!.navigator.tick();
  }

  private movementSystem(): void {
    const ecs = this.ecs;
    for (const id of ecs.query(MobBodyC, TransformC, BodyC))
      moveMob(
        this.collision,
        ecs.get(id, TransformC)!,
        ecs.get(id, BodyC)!,
        ecs.get(id, MobBodyC)!,
      );
  }
}

export function boundsAt(pos: Readonly<Vec3>, width: number, height: number): EntityBounds {
  const half = width / 2;
  return {
    minX: pos[0] - half,
    minY: pos[1],
    minZ: pos[2] - half,
    maxX: pos[0] + half,
    maxY: pos[1] + height,
    maxZ: pos[2] + half,
  };
}

/** Largest per-axis gap between two boxes (0 when they touch or overlap). */
export function boxGap(a: EntityBounds, b: EntityBounds): number {
  return Math.max(
    0,
    a.minX - b.maxX,
    b.minX - a.maxX,
    a.minY - b.maxY,
    b.minY - a.maxY,
    a.minZ - b.maxZ,
    b.minZ - a.maxZ,
  );
}

export interface EntityAISnapshot {
  /** The highest-ranked running goal that moves the mob, else the highest-ranked running goal. */
  goal: string | null;
  /** 0 for the player, an entity id, or null. */
  target: TargetRef | null;
  /** Waypoints left on the current path. */
  pathLength: number;
  /** Ticks left in love (0 when not in love). */
  love: number;
  invulnerableTicks: number;
  /** A baby cannot breed and grows up over time. */
  baby: boolean;
  /** Age of a creature in ticks, or null for a mob without one. */
  ageTicks: number | null;
  /** Velocity in blocks per tick. */
  vel: Vec3;
  /** Body yaw; forward is (cos yaw, 0, sin yaw). */
  yaw: number;
}

/** AI state of one mob, for the debug API. */
export function entityAI(ecs: EntityWorld, id: number): EntityAISnapshot {
  if (!ecs.exists(id)) throw new Error(`No entity with id ${id} exists`);
  if (!ecs.has(id, AiC)) throw new Error(`Entity ${id} has no AI`);
  const running = ecs.get(id, AiC)!.selector?.running ?? [];
  return {
    goal: (running.find((goal) => goal.flags.includes('move')) ?? running[0])?.name ?? null,
    target: ecs.get(id, TargetC)?.target ?? null,
    pathLength: ecs.get(id, NavC)?.navigator.pathLength ?? 0,
    love: ecs.get(id, LoveC)?.loveTicks ?? 0,
    invulnerableTicks: ecs.get(id, CombatC)?.invulnerableTicks ?? 0,
    baby: ecs.get(id, LoveC)?.baby ?? false,
    ageTicks: ecs.get(id, AgeC)?.ageTicks ?? null,
    vel: [...(ecs.get(id, MobBodyC)?.vel ?? [0, 0, 0])],
    yaw: ecs.get(id, TransformC)?.yaw ?? 0,
  };
}
