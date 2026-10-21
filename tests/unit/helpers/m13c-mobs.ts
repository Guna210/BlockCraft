import { World } from '../../../src/world/world';
import { BlockRegistry } from '../../../src/world/blocks/registry';
import { createEntityWorld } from '../../../src/entity/ecs/systems';
import type { EntityWorld } from '../../../src/entity/ecs/world';
import {
  BodyC,
  EntityKindC,
  HealthC,
  LookTargetC,
  TransformC,
} from '../../../src/entity/ecs/components';
import type { Vec3 } from '../../../src/entity/ecs/model';
import { ItemEntityManager } from '../../../src/entity/item-entity';
import {
  MobRuntime,
  addMob,
  type MobOptions,
  type MobPlayer,
  type MobRuntimeOptions,
} from '../../../src/entity/ai/runtime';

// Shared by the M13c unit tests: a flat stone world, hand-built mobs and a stand-in player.

/** Top of the stone floor; mobs stand at y = FLOOR + 1. */
export const FLOOR = 63;
export const GROUND = FLOOR + 1;

export interface FlatWorldOptions {
  /** Columns from -radius to radius - 1 on both axes. */
  radius?: number;
  /** Light every column (needed for sunlight and hostile spawning). */
  light?: boolean;
  /** Top layer block. */
  top?: string;
}

/** A world of stone from y 0 to 63 with an optional top layer, written straight into sections. */
export function flatWorld(options: FlatWorldOptions = {}): World {
  const radius = options.radius ?? 2;
  const world = new World(options.light ?? false);
  const registry = BlockRegistry.getInstance();
  const stone = registry.getDefaultStateId('stone')!;
  const top = options.top ? registry.getDefaultStateId(options.top)! : stone;
  for (let cx = -radius; cx < radius; cx++)
    for (let cz = -radius; cz < radius; cz++) {
      const column = world.getColumn(cx, cz, true)!;
      for (let sy = 0; sy < 4; sy++) column.getOrCreateSection(sy, stone)!.fill(stone);
      if (top !== stone)
        for (let x = 0; x < 16; x++)
          for (let z = 0; z < 16; z++) column.setBlockStateId(x, FLOOR, z, top);
    }
  if (options.light)
    for (let cx = -radius; cx < radius; cx++)
      for (let cz = -radius; cz < radius; cz++)
        world.lightEngine.initializeColumnLight(world, cx, cz);
  return world;
}

/** Stands in for the player: records every hurt call. */
export class StubPlayer implements MobPlayer {
  readonly pos: Vec3;
  height = 1.8;
  held: string | null = null;
  alive = true;
  readonly hits: Array<{ amount: number; source: string; from: Vec3; time: number }> = [];
  clock: () => number = () => 0;

  constructor(x: number, y: number, z: number) {
    this.pos = [x, y, z];
  }

  heldItemId(): string | null {
    return this.held;
  }

  targetable(): boolean {
    return this.alive;
  }

  hurt(amount: number, source: string, from: Readonly<Vec3>): boolean {
    this.hits.push({ amount, source, from: [...from], time: this.clock() });
    return true;
  }
}

export interface Scene {
  world: World;
  ecs: EntityWorld;
  runtime: MobRuntime;
  player: StubPlayer;
  items: ItemEntityManager;
}

export function scene(
  world: World,
  playerPos: Vec3 = [0.5, GROUND, 0.5],
  options: Omit<MobRuntimeOptions, 'player' | 'spawnContext'> = {},
): Scene {
  const ecs = createEntityWorld();
  const items = new ItemEntityManager(world);
  const player = new StubPlayer(...playerPos);
  player.clock = () => ecs.time;
  const runtime = new MobRuntime(world, ecs, {
    seed: 1,
    ...options,
    player: () => player,
    spawnContext: { ecs, items },
  });
  return { world, ecs, runtime, player, items };
}

export const TEST_TYPE = 'm13c_test_beast';

export interface TestMobOptions extends Partial<MobOptions> {
  type?: string;
  width?: number;
  height?: number;
  health?: number;
}

/** A mob with every component the runtime and renderer-free systems use. */
export function makeMob(ecs: EntityWorld, pos: Vec3, options: TestMobOptions = {}): number {
  const id = ecs.create();
  ecs.add(id, EntityKindC, { type: options.type ?? TEST_TYPE });
  ecs.add(id, TransformC, { pos: [...pos], previous: [...pos], yaw: 0, previousYaw: 0 });
  ecs.add(id, BodyC, { width: options.width ?? 0.6, height: options.height ?? 1.8 });
  const health = options.health ?? 20;
  ecs.add(id, HealthC, {
    current: health,
    max: health,
    hurtTicks: 0,
    deathTicks: 0,
    previousDeathTicks: 0,
  });
  ecs.add(id, LookTargetC, { target: null });
  addMob(ecs, id, {
    category: options.category ?? 'passive',
    speed: options.speed ?? 0.1,
    foods: options.foods ?? [],
    flying: options.flying ?? false,
    climbing: options.climbing ?? false,
    baby: options.baby ?? false,
    goals: options.goals ?? (() => []),
  });
  return id;
}

export function run(ecs: EntityWorld, ticks: number, each?: (tick: number) => void): void {
  for (let n = 0; n < ticks; n++) {
    ecs.tick();
    each?.(n);
  }
}

export function pos(ecs: EntityWorld, id: number): Vec3 {
  return ecs.get(id, TransformC)!.pos;
}

export function flat(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}
