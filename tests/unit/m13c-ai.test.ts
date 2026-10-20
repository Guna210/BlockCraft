import { afterEach, describe, expect, it, vi } from 'vitest';
import { BaseGoal, GoalSelector, type Goal, type GoalFlag } from '../../src/entity/ai/goal';
import { PATH_NODE_BUDGET, MAX_ACTIVE_SEARCHES } from '../../src/entity/ai/navigation';
import { entityAI, type MobHandle } from '../../src/entity/ai/runtime';
import { AiC, LoveC, MobBodyC, PLAYER_TARGET, TargetC } from '../../src/entity/ai/components';
import type { EntityWorld } from '../../src/entity/ecs/world';
import type { PathSearch } from '../../src/entity/ai/pathfinding';
import { TargetPlayerGoal } from '../../src/entity/ai/goals/target-player';
import { WanderGoal } from '../../src/entity/ai/goals/wander';
import { FleeGoal } from '../../src/entity/ai/goals/flee';
import { FollowFoodGoal } from '../../src/entity/ai/goals/follow-food';
import { BREED_COOLDOWN, BreedGoal, LOVE_TICKS, feedMob } from '../../src/entity/ai/goals/breed';
import { MeleeAttackGoal } from '../../src/entity/ai/goals/melee-attack';
import { RangedAttackGoal } from '../../src/entity/ai/goals/ranged-attack';
import { AvoidSunlightGoal } from '../../src/entity/ai/goals/avoid-sunlight';
import { ClimbWallGoal } from '../../src/entity/ai/goals/climb-wall';
import { SwellGoal } from '../../src/entity/ai/goals/swell';
import { FlockGoal } from '../../src/entity/ai/goals/flock';
import { hurtMob } from '../../src/gameplay/combat';
import { registerEntityType, type EntitySpawnOptions } from '../../src/entity/ecs/entity-types';
import { resetWorldTime, setWorldTime } from '../../src/world/time';
import { HealthC } from '../../src/entity/ecs/components';
import { GROUND, TEST_TYPE, flat, flatWorld, makeMob, pos, run, scene } from './helpers/m13c-mobs';

afterEach(() => resetWorldTime());

function running(ecs: EntityWorld, id: number): string[] {
  return ecs.get(id, AiC)!.selector?.running.map((goal) => goal.name) ?? [];
}

class FakeGoal extends BaseGoal {
  can = false;
  keep: boolean | null = null;
  ticks = 0;
  constructor(
    readonly name: string,
    override readonly flags: readonly GoalFlag[],
    private readonly log: string[],
  ) {
    super();
  }
  canStart(): boolean {
    return this.can;
  }
  override shouldContinue(): boolean {
    return this.keep ?? this.can;
  }
  override start(): void {
    this.log.push(`start ${this.name}`);
  }
  override tick(): void {
    this.ticks++;
  }
  override stop(): void {
    this.log.push(`stop ${this.name}`);
  }
}

describe('M13c goal selector', () => {
  it('lets a higher-priority goal preempt a running lower one that shares a flag', () => {
    const log: string[] = [];
    const low = new FakeGoal('low', ['move'], log),
      high = new FakeGoal('high', ['move', 'look'], log),
      look = new FakeGoal('look', ['look'], log);
    const selector = new GoalSelector().add(5, low).add(1, high).add(3, look);
    low.can = true;
    look.can = true;
    selector.tick();
    expect(selector.running.map((g) => g.name)).toEqual(['look', 'low']);
    expect(selector.current?.name).toBe('look');
    high.can = true;
    log.length = 0;
    selector.tick();
    // Both holders of high's flags are stopped before it starts.
    expect(log).toEqual(['stop low', 'stop look', 'start high']);
    expect(selector.running.map((g) => g.name)).toEqual(['high']);
    // Lower goals cannot take the flags back while the higher goal runs.
    log.length = 0;
    selector.tick();
    expect(log).toEqual([]);
    expect(high.ticks).toBe(2);
    // When it ends, the lower goals start again in the same tick.
    high.can = false;
    selector.tick();
    expect(log).toEqual(['stop high', 'start look', 'start low']);
  });

  it('gives ties to the earlier registration and runs goals with disjoint flags together', () => {
    const log: string[] = [];
    const first = new FakeGoal('first', ['move'], log),
      second = new FakeGoal('second', ['move'], log),
      jump = new FakeGoal('jump', ['jump'], log),
      free = new FakeGoal('free', [], log);
    const selector = new GoalSelector().add(2, second).add(2, jump).add(1, free);
    selector.add(2, first);
    // 'second' was registered first among the priority-2 move goals.
    second.can = first.can = jump.can = free.can = true;
    selector.tick();
    expect(selector.running.map((g) => g.name)).toEqual(['free', 'second', 'jump']);
    selector.tick();
    expect(log.filter((l) => l.includes('first'))).toEqual([]);
    second.can = false;
    selector.tick();
    expect(selector.running.map((g) => g.name)).toEqual(['free', 'jump', 'first']);
  });

  it('stops a goal whose shouldContinue fails even when canStart would hold, and stops all', () => {
    const log: string[] = [];
    const goal = new FakeGoal('g', ['move'], log);
    const selector = new GoalSelector().add(1, goal);
    goal.can = true;
    goal.keep = false;
    selector.tick();
    expect(log).toEqual(['start g']);
    selector.tick();
    // Stopped in the continue pass, then started afresh in the start pass.
    expect(log).toEqual(['start g', 'stop g', 'start g']);
    goal.keep = true;
    selector.stopAll();
    expect(selector.running).toEqual([]);
    expect(selector.current).toBeNull();
    expect(log.at(-1)).toBe('stop g');
  });
});

describe('M13c navigation and the path budget', () => {
  it('30 mobs re-pathing never expand more than 2000 nodes in one tick and dispose every search', () => {
    const world = flatWorld({ radius: 3 });
    // Every goal is sealed in, so each search floods the field until its node cap.
    const { ecs, runtime } = scene(world);
    const searches: Array<{ search: PathSearch; disposed: boolean }> = [];
    let expanded = 0;
    let contexts = 0;
    const pathfinder = runtime.pathfinder;
    const create = pathfinder.createSearch.bind(pathfinder);
    pathfinder.createSearch = (start, goal, options) => {
      const search = create(start, goal, options);
      const record = { search, disposed: false };
      searches.push(record);
      if (search.status === 'pending') contexts++;
      const step = search.step.bind(search);
      const dispose = search.dispose?.bind(search);
      return {
        get status() {
          return search.status;
        },
        get path() {
          return search.path;
        },
        get cost() {
          return search.cost;
        },
        get nodesExpanded() {
          return search.nodesExpanded;
        },
        step(maxNodes?: number) {
          const before = search.nodesExpanded;
          const status = step(maxNodes);
          expanded += search.nodesExpanded - before;
          return status;
        },
        dispose() {
          record.disposed = true;
          dispose?.();
        },
      };
    };
    // Twelve sealed 1×1 pens, 6 blocks apart, along z = 30.
    const pen = (i: number) => -40 + i * 6;
    for (let i = 0; i < 12; i++) {
      const x = pen(i);
      world.fill(x - 1, GROUND, 29, x + 1, GROUND + 2, 31, 'stone');
      world.setBlock(x, GROUND, 30, 'air');
      world.setBlock(x, GROUND + 1, 30, 'air');
      world.setBlock(x, GROUND + 2, 30, 'air');
    }
    const mobs: number[] = [];
    for (let i = 0; i < 30; i++)
      mobs.push(
        makeMob(ecs, [-40 + (i % 10) * 8 + 0.5, GROUND, -40 + Math.floor(i / 10) * 8 + 0.5]),
      );
    const perTick: number[] = [];
    for (let t = 0; t < 120; t++) {
      for (const [i, id] of mobs.entries()) {
        // Goals jump 6+ blocks every tick, so every mob re-paths as often as allowed.
        runtime.navigator(id).moveTo(pen((i + t) % 12) + 0.5, GROUND, 30.5);
      }
      expanded = 0;
      ecs.tick();
      perTick.push(expanded);
      expect(runtime.scheduler.lastExpanded).toBe(expanded);
    }
    expect(Math.max(...perTick)).toBeLessThanOrEqual(PATH_NODE_BUDGET);
    // The budget is actually used, not just respected.
    expect(Math.max(...perTick)).toBeGreaterThan(PATH_NODE_BUDGET * 0.9);
    expect(perTick.reduce((a, b) => a + b, 0)).toBeGreaterThan(PATH_NODE_BUDGET * 60);
    expect(searches.length).toBeGreaterThan(30);
    // Removing every mob cancels its search; nothing is left pending without a dispose.
    for (const id of mobs) ecs.destroy(id);
    ecs.tick();
    expect(runtime.scheduler.outstanding).toBe(0);
    const leaked = searches.filter((r) => r.search.status === 'pending' && !r.disposed);
    expect(leaked).toEqual([]);
    expect(contexts).toBeGreaterThan(MAX_ACTIVE_SEARCHES);
  });

  it('walks a path onto a one-block step and arrives', () => {
    const world = flatWorld();
    world.fill(4, GROUND, -2, 7, GROUND, 2, 'stone');
    const { ecs, runtime } = scene(world);
    const id = makeMob(ecs, [0.5, GROUND, 0.5]);
    const nav = runtime.navigator(id);
    nav.moveTo(5.5, GROUND + 1, 0.5);
    let jumped = false;
    run(ecs, 200, () => {
      if (ecs.get(id, MobBodyC)!.vel[1] > 0.3) jumped = true;
    });
    expect(jumped).toBe(true);
    expect(nav.idle).toBe(true);
    expect(nav.arrived).toBe(true);
    expect(pos(ecs, id)[1]).toBeCloseTo(GROUND + 1, 3);
    expect(flat(pos(ecs, id), [5.5, 0, 0.5])).toBeLessThan(0.6);
  });

  it('re-paths only when the goal moved more than 2 blocks, at most every 20 ticks', () => {
    const world = flatWorld();
    const { ecs, runtime } = scene(world);
    const id = makeMob(ecs, [0.5, GROUND, 0.5]);
    const nav = runtime.navigator(id);
    const request = vi.spyOn(runtime.scheduler, 'request');
    nav.moveTo(20.5, GROUND, 0.5);
    expect(request).toHaveBeenCalledTimes(1);
    run(ecs, 5);
    nav.moveTo(22.5, GROUND, 0.5); // moved 2: no re-path
    nav.moveTo(25.5, GROUND, 0.5); // moved 5 but only 5 ticks later
    expect(request).toHaveBeenCalledTimes(1);
    run(ecs, 15);
    nav.moveTo(22.0, GROUND, 0.5); // 20 ticks after the request, but within 2 of the path goal
    expect(request).toHaveBeenCalledTimes(1);
    nav.moveTo(25.5, GROUND, 0.5);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('disposes searches of removed and despawned mobs', () => {
    const world = flatWorld({ radius: 3 });
    world.fill(29, GROUND, 9, 31, GROUND + 2, 11, 'stone');
    for (let y = GROUND; y <= GROUND + 2; y++) world.setBlock(30, y, 10, 'air');
    const { ecs, runtime } = scene(world);
    const a = makeMob(ecs, [0.5, GROUND, 0.5]),
      b = makeMob(ecs, [2.5, GROUND, 0.5]);
    const disposed: number[] = [];
    const create = runtime.pathfinder.createSearch.bind(runtime.pathfinder);
    runtime.pathfinder.createSearch = (start, goal, options) => {
      const search = create(start, goal, options);
      const dispose = search.dispose?.bind(search);
      search.dispose = () => {
        disposed.push(start[0]);
        dispose?.();
      };
      return search;
    };
    // Goal sealed inside stone: the searches flood the field for several ticks.
    runtime.navigator(a).moveTo(30.5, GROUND, 10.5);
    runtime.navigator(b).moveTo(30.5, GROUND, 10.5);
    ecs.tick();
    expect(runtime.scheduler.outstanding).toBe(2);
    ecs.destroy(a);
    ecs.tick();
    expect(disposed).toEqual([0]);
    runtime.removeNow(b);
    expect(disposed).toEqual([0, 2]);
    expect(runtime.scheduler.outstanding).toBe(0);
  });

  it('invalidates the shared adapter when columns load or unload', () => {
    const world = flatWorld();
    const { runtime } = scene(world);
    const invalidate = vi.spyOn(runtime.adapter, 'invalidate');
    world.notifyColumnLoaded(5, 5, true);
    expect(invalidate).toHaveBeenCalledTimes(1);
    world.removeColumn(0, 0);
    expect(invalidate).toHaveBeenCalledTimes(2);
    world.removeColumn(40, 40); // never loaded
    expect(invalidate).toHaveBeenCalledTimes(2);
  });
});

describe('M13c goals on a real world', () => {
  it('wander idles 60–200 ticks, then walks to a point within 10 blocks', () => {
    const world = flatWorld();
    const { ecs } = scene(world, [100, GROUND, 100]);
    let wander: WanderGoal | null = null;
    const id = makeMob(ecs, [0.5, GROUND, 0.5], {
      goals: (mob) => [[5, (wander = new WanderGoal(mob))]],
    });
    ecs.tick();
    const idle = wander!.idleTicks;
    expect(idle).toBeGreaterThanOrEqual(59);
    expect(idle).toBeLessThanOrEqual(200);
    run(ecs, idle - 1);
    expect(entityAI(ecs, id).goal).toBeNull();
    let started = -1,
      ended = -1,
      maxDistance = 0;
    run(ecs, 300, (n) => {
      const goal = entityAI(ecs, id).goal;
      if (started < 0 && goal === 'wander') started = n;
      if (started >= 0 && ended < 0 && goal === null) ended = n;
      if (ended < 0) maxDistance = Math.max(maxDistance, flat(pos(ecs, id), [0.5, 0, 0.5]));
    });
    expect(started).toBeGreaterThanOrEqual(0);
    expect(started).toBeLessThanOrEqual(2);
    expect(ended).toBeGreaterThan(started);
    expect(maxDistance).toBeGreaterThan(1.5);
    expect(maxDistance).toBeLessThanOrEqual(10.6);
    // Walk over: a fresh idle spell starts.
    expect(wander!.idleTicks).toBeGreaterThanOrEqual(60 - (300 - ended));
    expect(wander!.idleTicks).toBeLessThanOrEqual(200);
  });

  it('flee runs from the attacker for 100 ticks at 1.25× speed', () => {
    const world = flatWorld();
    const { ecs } = scene(world, [0.5, GROUND, 0.5]);
    const id = makeMob(ecs, [2.5, GROUND, 0.5], {
      speed: 0.1,
      goals: (mob) => [[1, new FleeGoal(mob)]],
    });
    run(ecs, 5);
    expect(entityAI(ecs, id).goal).toBeNull();
    hurtMob(ecs, id, 1, { ref: PLAYER_TARGET, pos: [0.5, GROUND, 0.5] });
    ecs.tick();
    expect(entityAI(ecs, id).goal).toBe('flee');
    let fastest = 0,
      ticks = 1;
    run(ecs, 120, (n) => {
      if (entityAI(ecs, id).goal === 'flee') ticks++;
      const t = ecs.get(id, MobBodyC)!;
      if (n > 30 && t.onGround) fastest = Math.max(fastest, Math.hypot(t.vel[0], t.vel[2]));
    });
    expect(ticks).toBeGreaterThanOrEqual(99);
    expect(ticks).toBeLessThanOrEqual(101);
    expect(entityAI(ecs, id).goal).toBeNull();
    expect(flat(pos(ecs, id), [0.5, 0, 0.5])).toBeGreaterThan(6);
    expect(fastest).toBeGreaterThan(0.11);
    expect(fastest).toBeLessThanOrEqual(0.1251);
  });

  it('follows a player holding its food to 2 blocks, and ignores other items or far players', () => {
    const world = flatWorld();
    const { ecs, player } = scene(world, [7.5, GROUND, 0.5]);
    const id = makeMob(ecs, [0.5, GROUND, 0.5], {
      foods: ['wheat'],
      goals: (mob) => [[3, new FollowFoodGoal(mob)]],
    });
    player.held = 'stone';
    run(ecs, 20);
    expect(entityAI(ecs, id).goal).toBeNull();
    player.held = 'wheat';
    run(ecs, 200);
    const d = flat(pos(ecs, id), player.pos);
    expect(d).toBeLessThanOrEqual(2.6);
    expect(d).toBeGreaterThan(1);
    expect(entityAI(ecs, id).goal).toBe('follow_food');
    player.pos[0] = 30;
    ecs.tick();
    expect(entityAI(ecs, id).goal).toBeNull();
  });

  it('breeds two fed mobs of one type into one baby and starts the 6000-tick cooldown', () => {
    const world = flatWorld();
    const { ecs, runtime } = scene(world, [100, GROUND, 100]);
    const spawned: Array<EntitySpawnOptions | undefined> = [];
    const goals = (mob: MobHandle): Array<[number, Goal]> => [[2, new BreedGoal(mob)]];
    registerEntityType(TEST_TYPE, (ctx, x, y, z, options) => {
      spawned.push(options);
      return makeMob(ctx.ecs, [x, y, z], { baby: options?.baby, foods: ['wheat'], goals });
    });
    const a = makeMob(ecs, [0.5, GROUND, 0.5], { foods: ['wheat'], goals }),
      b = makeMob(ecs, [5.5, GROUND, 0.5], { foods: ['wheat'], goals }),
      other = makeMob(ecs, [2.5, GROUND, 3.5], { type: 'm13c_other', foods: ['wheat'], goals });
    expect(feedMob(ecs, a, 'stone')).toBe(false);
    expect(feedMob(ecs, a, 'wheat')).toBe(true);
    expect(feedMob(ecs, a, 'wheat')).toBe(false); // already in love
    expect(entityAI(ecs, a).love).toBe(LOVE_TICKS);
    run(ecs, 40);
    // One mob in love has no partner.
    expect(entityAI(ecs, a).goal).toBeNull();
    expect(feedMob(ecs, other, 'wheat')).toBe(true);
    run(ecs, 20);
    expect(entityAI(ecs, a).goal).toBeNull(); // another type is no partner
    expect(feedMob(ecs, b, 'wheat')).toBe(true);
    ecs.tick();
    expect(entityAI(ecs, a).goal).toBe('breed');
    let bredAt = -1;
    run(ecs, 200, (n) => {
      if (bredAt < 0 && spawned.length > 0) bredAt = n;
    });
    expect(spawned).toEqual([{ baby: true }]);
    for (const id of [a, b]) {
      const love = ecs.get(id, LoveC)!;
      expect(love.loveTicks).toBe(0);
      expect(love.cooldown).toBe(BREED_COOLDOWN - (199 - bredAt));
      expect(feedMob(ecs, id, 'wheat')).toBe(false);
    }
    const baby = ecs.query(LoveC).find((id) => ecs.get(id, LoveC)!.baby)!;
    expect(feedMob(ecs, baby, 'wheat')).toBe(false);
    expect(flat(pos(ecs, baby), [3, 0, 0.5])).toBeLessThan(2.5);
    // Love left alone wears off after 600 ticks.
    run(ecs, LOVE_TICKS);
    expect(entityAI(ecs, other).love).toBe(0);
    expect(runtime.spawnContext).not.toBeNull();
  });

  it('melee attack paths to the target and hits every 20 ticks within 1 block', () => {
    const world = flatWorld();
    const { ecs, player } = scene(world, [8.5, GROUND, 0.5]);
    const id = makeMob(ecs, [0.5, GROUND, 0.5], {
      category: 'hostile',
      goals: (mob) => [
        [0, new TargetPlayerGoal(mob)],
        [2, new MeleeAttackGoal(mob, { damage: 3 })],
      ],
    });
    run(ecs, 160);
    expect(entityAI(ecs, id).target).toBe(PLAYER_TARGET);
    expect(entityAI(ecs, id).goal).toBe('melee_attack');
    expect(running(ecs, id)).toEqual(['target_player', 'melee_attack']);
    expect(player.hits.length).toBeGreaterThanOrEqual(3);
    for (const hit of player.hits) {
      expect(hit.amount).toBe(3);
      expect(hit.source).toBe(`mob:${TEST_TYPE}`);
    }
    const gaps = player.hits.slice(1).map((hit, i) => hit.time - player.hits[i]!.time);
    expect(new Set(gaps)).toEqual(new Set([20]));
    expect(flat(pos(ecs, id), player.pos)).toBeLessThan(0.6 + 1);
    // A target that is no longer targetable ends the attack.
    player.alive = false;
    const before = player.hits.length;
    run(ecs, 40);
    expect(player.hits.length).toBe(before);
    expect(entityAI(ecs, id).target).toBeNull();
    expect(entityAI(ecs, id).goal).toBeNull();
  });

  it('ranged attack keeps 8–12 blocks away and fires every interval through the injected function', () => {
    const world = flatWorld({ radius: 3 });
    const { ecs, player } = scene(world, [0.5, GROUND, 0.5]);
    const fire = vi.fn();
    const id = makeMob(ecs, [20.5, GROUND, 0.5], {
      category: 'hostile',
      goals: (mob) => [
        [0, new TargetPlayerGoal(mob, { range: 32 })],
        [2, new RangedAttackGoal(mob, { fire, interval: 30 })],
      ],
    });
    run(ecs, 200);
    const d = flat(pos(ecs, id), player.pos);
    expect(d).toBeLessThanOrEqual(12.5);
    expect(d).toBeGreaterThanOrEqual(7);
    expect(fire).toHaveBeenCalled();
    const [aim, shooter] = fire.mock.calls.at(-1)!;
    expect(shooter).toBe(id);
    expect(aim).toEqual([0.5, GROUND + 0.9, 0.5]);
    // Inside the minimum range it backs off.
    const p = pos(ecs, id);
    player.pos[0] = p[0] - 4;
    player.pos[2] = p[2];
    const close = flat(p, player.pos);
    const calls = fire.mock.calls.length;
    run(ecs, 60);
    expect(flat(pos(ecs, id), player.pos)).toBeGreaterThan(close + 1);
    expect(fire.mock.calls.length).toBe(calls + 2);
  });

  it('avoid sunlight walks into shade at noon, and does nothing at night or with no shade', () => {
    const world = flatWorld({ light: true });
    world.fill(6, GROUND + 2, -2, 9, GROUND + 2, 2, 'stone');
    setWorldTime(6000);
    const { ecs } = scene(world, [-20, GROUND, -20]);
    let goal: AvoidSunlightGoal | null = null;
    const id = makeMob(ecs, [0.5, GROUND, 0.5], {
      category: 'hostile',
      goals: (mob) => [[1, (goal = new AvoidSunlightGoal(mob))]],
    });
    ecs.tick();
    expect(goal!.inSunlight()).toBe(true);
    expect(entityAI(ecs, id).goal).toBe('avoid_sunlight');
    run(ecs, 200);
    expect(goal!.inSunlight()).toBe(false);
    expect(entityAI(ecs, id).goal).toBeNull();
    const p = pos(ecs, id);
    expect(world.getLight(Math.floor(p[0]), GROUND + 1, Math.floor(p[2])).sky).toBeLessThan(15);
    expect(p[0]).toBeGreaterThan(5.6);

    // Night: no sunlight to avoid.
    const night = makeMob(ecs, [-10.5, GROUND, 0.5], {
      goals: (mob) => [[1, new AvoidSunlightGoal(mob)]],
    });
    setWorldTime(18000);
    run(ecs, 5);
    expect(entityAI(ecs, night).goal).toBeNull();
    // Noon with no shade within 16 blocks: the search fails and the goal never starts.
    setWorldTime(6000);
    const open = makeMob(ecs, [-28.5, GROUND, -28.5], {
      goals: (mob) => [[1, new AvoidSunlightGoal(mob)]],
    });
    run(ecs, 5);
    expect(entityAI(ecs, open).goal).toBeNull();
    expect(flat(pos(ecs, open), [-28.5, 0, -28.5])).toBeLessThan(0.01);
  });

  it('climb wall carries a climbing mob up a 6-block wall toward a higher target', () => {
    const world = flatWorld();
    world.fill(4, GROUND, -4, 7, GROUND + 5, 4, 'stone');
    const { ecs, player } = scene(world, [5.5, GROUND + 6, 0.5]);
    const goals = (mob: MobHandle): Array<[number, Goal]> => [
      [0, new TargetPlayerGoal(mob)],
      [1, new ClimbWallGoal(mob)],
      [2, new MeleeAttackGoal(mob, { damage: 2 })],
    ];
    const climber = makeMob(ecs, [1.5, GROUND, 0.5], {
      category: 'hostile',
      climbing: true,
      goals,
    });
    const walker = makeMob(ecs, [1.5, GROUND, -2.5], { category: 'hostile', goals });
    let climbing = 0,
      top = 0;
    run(ecs, 200, () => {
      if (running(ecs, climber).includes('climb_wall')) climbing++;
      top = Math.max(top, pos(ecs, climber)[1]);
    });
    expect(climbing).toBeGreaterThan(10);
    expect(top).toBeGreaterThanOrEqual(GROUND + 6);
    expect(pos(ecs, walker)[1]).toBeLessThan(GROUND + 1.5);
    expect(player.hits.length).toBeGreaterThan(0);
    // On top the wall no longer blocks it, so the climb has ended.
    expect(running(ecs, climber)).not.toContain('climb_wall');
    expect(running(ecs, walker)).not.toContain('climb_wall');
  });

  it('climb wall ends where the wall ends, and the mob falls back down', () => {
    const world = flatWorld();
    // A 3-block wall with the target floating far above: the mob climbs past the top and drops.
    world.fill(4, GROUND, -4, 4, GROUND + 2, 4, 'stone');
    const { ecs } = scene(world, [4.5, GROUND + 12, 0.5]);
    const id = makeMob(ecs, [3.0, GROUND, 0.5], {
      category: 'hostile',
      climbing: true,
      goals: (mob) => [
        [0, new TargetPlayerGoal(mob, { range: 20 })],
        [1, new ClimbWallGoal(mob)],
      ],
    });
    // Push into the wall every tick as a chasing goal would.
    let wasClimbing = false,
      top = 0;
    run(ecs, 60, () => {
      ecs.get(id, MobBodyC)!.wish[0] = 0.1;
      if (running(ecs, id).includes('climb_wall')) wasClimbing = true;
      top = Math.max(top, pos(ecs, id)[1]);
    });
    expect(wasClimbing).toBe(true);
    expect(top).toBeGreaterThanOrEqual(GROUND + 2.9);
    expect(top).toBeLessThan(GROUND + 4.5);
    // Past the one-block-thick wall it drops back to the ground on the far side.
    expect(pos(ecs, id)[0]).toBeGreaterThan(5);
    expect(pos(ecs, id)[1]).toBeCloseTo(GROUND, 3);
    expect(running(ecs, id)).not.toContain('climb_wall');
  });

  it('swell bursts after 30 ticks within 3 blocks, hurting by distance, and cancels beyond 7', () => {
    const world = flatWorld();
    const { ecs, player } = scene(world, [2.5, GROUND, 0.5]);
    const goals = (mob: MobHandle): Array<[number, Goal]> => [
      [0, new TargetPlayerGoal(mob)],
      [1, new SwellGoal(mob, { power: 3 })],
    ];
    let swell: SwellGoal | null = null;
    const bomber = makeMob(ecs, [0.5, GROUND, 0.5], {
      category: 'hostile',
      goals: (mob) => {
        const list = goals(mob);
        swell = list[1]![1] as SwellGoal;
        return list;
      },
    });
    const near = makeMob(ecs, [0.5, GROUND, 2.5]),
      far = makeMob(ecs, [0.5, GROUND, 9.5]);
    run(ecs, 29);
    expect(entityAI(ecs, bomber).goal).toBe('swell');
    expect(swell!.swellTicks).toBe(29);
    expect(player.hits).toEqual([]);
    ecs.tick();
    expect(ecs.exists(bomber)).toBe(false);
    expect(player.hits).toHaveLength(1);
    expect(player.hits[0]!.source).toBe('blast');
    expect(ecs.get(near, HealthC)!.current).toBeLessThan(20);
    expect(ecs.get(far, HealthC)!.current).toBe(20);
    // Cancelling: the target walks off to 10 blocks mid-swell.
    const second = makeMob(ecs, [0.5, GROUND, -3.5], {
      category: 'hostile',
      goals: (mob) => {
        const list = goals(mob);
        swell = list[1]![1] as SwellGoal;
        return list;
      },
    });
    player.pos[2] = -3.5;
    run(ecs, 10);
    expect(swell!.swellTicks).toBe(10);
    player.pos[2] = 6.5;
    ecs.tick();
    expect(swell!.swellTicks).toBe(0);
    run(ecs, 60);
    expect(ecs.exists(second)).toBe(true);
    expect(player.hits).toHaveLength(1);
  });

  it('flock flies boids-style and gathers around a torch within 8 blocks', () => {
    const world = flatWorld();
    world.setBlock(8, GROUND, 0, 'torch');
    const { ecs } = scene(world, [-30, GROUND, -30]);
    let goal: FlockGoal | null = null;
    const flock: number[] = [];
    for (let i = 0; i < 4; i++)
      flock.push(
        makeMob(ecs, [2.5 + (i % 2), GROUND + 3, 0.5 + Math.floor(i / 2)], {
          category: 'ambient',
          flying: true,
          width: 0.5,
          height: 0.9,
          speed: 0.1,
          goals: (mob) => [[1, i === 0 ? (goal = new FlockGoal(mob)) : new FlockGoal(mob)]],
        }),
      );
    const walker = makeMob(ecs, [-5.5, GROUND, 0.5], {
      goals: (mob) => [[1, new FlockGoal(mob)]],
    });
    let near = 0,
      lowest = Infinity;
    run(ecs, 300, (n) => {
      for (const id of flock) {
        lowest = Math.min(lowest, pos(ecs, id)[1]);
        if (n >= 100 && Math.hypot(pos(ecs, id)[0] - 8.5, pos(ecs, id)[2] - 0.5) < 5) near++;
      }
    });
    expect(goal!.lightTarget).toEqual([8.5, GROUND + 0.5, 0.5]);
    expect(entityAI(ecs, flock[0]!).goal).toBe('flock');
    expect(lowest).toBeGreaterThan(GROUND - 0.01);
    expect(near / (200 * flock.length)).toBeGreaterThan(0.8);
    // The flock does not collapse into one point.
    const [a, b] = [pos(ecs, flock[0]!), pos(ecs, flock[1]!)];
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(0.2);
    expect(entityAI(ecs, walker).goal).toBeNull();
  });

  it('reports AI state through getEntityAI', () => {
    const world = flatWorld();
    const { ecs, player } = scene(world, [6.5, GROUND, 0.5]);
    const id = makeMob(ecs, [0.5, GROUND, 0.5], {
      category: 'hostile',
      goals: (mob) => [
        [0, new TargetPlayerGoal(mob)],
        [2, new MeleeAttackGoal(mob, { damage: 1 })],
      ],
    });
    expect(entityAI(ecs, id)).toEqual({
      goal: null,
      target: null,
      pathLength: 0,
      love: 0,
      invulnerableTicks: 0,
    });
    run(ecs, 4);
    const ai = entityAI(ecs, id);
    expect(ai.goal).toBe('melee_attack');
    expect(ai.target).toBe(PLAYER_TARGET);
    expect(ecs.get(id, TargetC)!.target).toBe(PLAYER_TARGET);
    hurtMob(ecs, id, 2, { ref: PLAYER_TARGET, pos: player.pos });
    expect(entityAI(ecs, id).invulnerableTicks).toBe(10);
    expect(() => entityAI(ecs, 999_999_999)).toThrow('No entity with id 999999999 exists');
    const plain = ecs.create();
    expect(() => entityAI(ecs, plain)).toThrow(`Entity ${plain} has no AI`);
  });

  it('shows a path length while following a path', () => {
    const world = flatWorld();
    world.fill(3, GROUND, -3, 3, GROUND + 2, 3, 'stone');
    const { ecs, runtime } = scene(world);
    const id = makeMob(ecs, [0.5, GROUND, 0.5]);
    runtime.navigator(id).moveTo(6.5, GROUND, 0.5);
    let longest = 0;
    run(ecs, 10, () => (longest = Math.max(longest, entityAI(ecs, id).pathLength)));
    expect(longest).toBeGreaterThan(6);
  });
});
