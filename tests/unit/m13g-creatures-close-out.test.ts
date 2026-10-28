import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../src/entity/mobs';
import {
  MOB_CAPS,
  SPAWN_ATTEMPTS_PER_TICK,
  MobSpawner,
  SpawnRuleRegistry,
  spawnRules,
} from '../../src/entity/spawning';
import { EntityKindC } from '../../src/entity/ecs/components';
import { BlockCollision } from '../../src/entity/physics';
import { LightEngine } from '../../src/world/lighting';
import { Camera } from '../../src/render/camera';
import { InputEngine } from '../../src/engine/input';
import { PlayerController } from '../../src/engine/player-controller';
import {
  hurtPlayer,
  playerInvulnerableTicks,
  PLAYER_INVULNERABLE_TICKS,
} from '../../src/gameplay/combat';
import { resetWorldTime, setWorldTime } from '../../src/world/time';
import { GROUND, flatWorld, makeMob, run, scene } from './helpers/m13c-mobs';
import { moveMob } from '../../src/entity/ai/movement';

afterEach(() => resetWorldTime());

const BY_TYPE = new Map(spawnRules.rules.map((rule) => [rule.type, rule]));
const HOSTILE_TYPES = ['hollow', 'thornling', 'skitterer', 'sporeburst', 'cinderwraith'];

function worldWithSurface(top = 'grass_block', light = false) {
  const world = flatWorld({ radius: 2, top });
  if (light) {
    world.lightEngine = new LightEngine();
    world.lightEngine.initializeColumnLight(world, 1, 0);
  }
  world.worldType = 'flat';
  return world;
}

describe('M13g natural spawn rules', () => {
  it('registers every Overworld creature with the Appendix B caps and declared groups', () => {
    expect([...BY_TYPE.keys()].sort()).toEqual(
      ['tuftbuck', 'rootboar', 'dapplefowl', 'mossback', 'glimmer_moth', ...HOSTILE_TYPES].sort(),
    );
    expect(MOB_CAPS).toEqual({ passive: 12, hostile: 40, ambient: 10 });
    expect(SPAWN_ATTEMPTS_PER_TICK).toBe(8);
    expect(BY_TYPE.get('tuftbuck')!.groupSize).toEqual([2, 4]);
    expect(BY_TYPE.get('rootboar')!.groupSize).toEqual([2, 4]);
    expect(BY_TYPE.get('dapplefowl')!.groupSize).toEqual([2, 4]);
    expect(BY_TYPE.get('mossback')!.groupSize).toEqual([2, 4]);
    expect(BY_TYPE.get('glimmer_moth')!.groupSize).toEqual([2, 4]);
    expect(BY_TYPE.get('hollow')!.groupSize).toEqual([2, 4]);
    expect(BY_TYPE.get('thornling')!.groupSize).toEqual([1, 3]);
    expect(BY_TYPE.get('skitterer')!.groupSize).toEqual([1, 2]);
    expect(BY_TYPE.get('sporeburst')!.groupSize).toBe(1);
    expect(BY_TYPE.get('cinderwraith')!.groupSize).toBe(1);
    expect(BY_TYPE.get('cinderwraith')!.weight).toBe(10);
  });

  it('filters passive rules by biome and requires grass for grazers', () => {
    const world = worldWithSurface();
    const spawner = scene(world, [0.5, GROUND, 0.5], { spawnRules }).runtime.spawner!;
    const tuftbuck = BY_TYPE.get('tuftbuck')!;
    expect(spawner.canSpawnAt(tuftbuck, 30, GROUND, 0)).toBe(true);
    world.setBlock(30, GROUND - 1, 0, 'sand');
    expect(spawner.canSpawnAt(tuftbuck, 30, GROUND, 0)).toBe(false);
    expect(spawner.pickRule('passive', 'meadow')?.type).toBe('tuftbuck');
    expect(spawner.pickRule('passive', 'desert')).toBeNull();
    expect(BY_TYPE.get('rootboar')!.biomes).toEqual([
      'oakwood_forest',
      'birch_grove',
      'pine_taiga',
    ]);
  });

  it('allows Mossbacks on sand or grass only near water', () => {
    const world = worldWithSurface('sand');
    world.getBiome = () => 'beach';
    const spawner = scene(world, [0.5, GROUND, 0.5], { spawnRules }).runtime.spawner!;
    const mossback = BY_TYPE.get('mossback')!;
    expect(spawner.canSpawnAt(mossback, 30, GROUND, 0)).toBe(false);
    world.setBlock(34, GROUND, 0, 'water');
    expect(spawner.canSpawnAt(mossback, 30, GROUND, 0)).toBe(true);
    world.setBlock(30, GROUND - 1, 0, 'stone');
    expect(spawner.canSpawnAt(mossback, 30, GROUND, 0)).toBe(false);
  });

  it('requires Glimmer Moths at night in air with block light at least 8', () => {
    const world = worldWithSurface('grass_block', true);
    const spawner = scene(world, [0.5, GROUND, 0.5], { spawnRules }).runtime.spawner!;
    const moth = BY_TYPE.get('glimmer_moth')!;
    setWorldTime(18000);
    expect(spawner.canSpawnAt(moth, 30, GROUND, 0)).toBe(false);
    world.setBlock(31, GROUND, 0, 'torch');
    expect(world.getLight(30, GROUND, 0).block).toBeGreaterThanOrEqual(8);
    expect(spawner.canSpawnAt(moth, 30, GROUND, 0)).toBe(true);
    world.setBlock(30, GROUND, 0, 'stone');
    expect(spawner.canSpawnAt(moth, 30, GROUND, 0)).toBe(false);
    world.setBlock(30, GROUND, 0, 'air');
    setWorldTime(6000);
    expect(spawner.canSpawnAt(moth, 30, GROUND, 0)).toBe(false);
  });

  it("checks a Glimmer Moth rule's where condition for every group member", () => {
    setWorldTime(18000);
    const world = worldWithSurface('grass_block', true);
    world.setBlock(24, GROUND - 1, 0, 'torch');
    expect(world.getLight(24, GROUND, 0).block).toBeGreaterThanOrEqual(8);

    const moth = BY_TYPE.get('glimmer_moth')!;
    const where = vi.fn((...args: Parameters<NonNullable<typeof moth.where>>) => {
      const [candidateWorld, x, y, z] = args;
      return moth.where!(candidateWorld, x, y, z) && x === 24 && y === GROUND && z === 0;
    });
    const rules = new SpawnRuleRegistry();
    rules.register({ ...moth, where });
    const s = scene(world, [0.5, GROUND, 0.5], { spawnRules: rules });
    vi.spyOn(s.runtime, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(0.99);

    const spawnGroup = Reflect.get(s.runtime.spawner!, 'spawnGroup') as (
      category: 'ambient',
      x: number,
      y: number,
      z: number,
    ) => void;
    spawnGroup.call(s.runtime.spawner!, 'ambient', 24, GROUND, 0);

    const mothIds = s.ecs
      .query(EntityKindC)
      .filter((id) => s.ecs.get(id, EntityKindC)!.type === 'glimmer_moth');
    expect(mothIds).toHaveLength(1);
    expect(where.mock.calls.some(([, x, y, z]) => x !== 24 || y !== GROUND || z !== 0)).toBe(true);
    s.runtime.dispose();
  });

  it('requires every hostile to have block light zero, rejects open noon, and weights cave Sporebursts up', () => {
    const world = worldWithSurface('grass_block', true);
    const spawner = scene(world, [0.5, GROUND, 0.5], { spawnRules }).runtime.spawner!;
    setWorldTime(18000);
    for (const type of HOSTILE_TYPES)
      expect(spawner.canSpawnAt(BY_TYPE.get(type)!, 30, GROUND, 0), type).toBe(true);
    setWorldTime(6000);
    expect(spawner.canSpawnAt(BY_TYPE.get('hollow')!, 30, GROUND, 0)).toBe(false);
    setWorldTime(18000);
    world.setBlock(31, GROUND, 0, 'torch');
    expect(spawner.canSpawnAt(BY_TYPE.get('cinderwraith')!, 30, GROUND, 0)).toBe(false);
    world.setBlock(31, GROUND, 0, 'air');

    const spores = BY_TYPE.get('sporeburst')!;
    expect(spores.weightAt!(world, 30, GROUND, 0)).toBe(60);
    world.fill(24, GROUND + 6, -6, 36, GROUND + 6, 6, 'stone');
    world.setBlock(28, GROUND, -2, 'brown_mushroom');
    world.setBlock(30, GROUND, 2, 'red_mushroom');
    world.setBlock(32, GROUND + 1, 0, 'brown_mushroom');
    expect(spores.weightAt!(world, 30, GROUND, 0)).toBe(180);
  });

  it('keeps despawning active and removes spawn tick work when disabled', () => {
    const world = worldWithSurface('grass_block', true);
    world.notifyColumnLoaded(0, 0, true);
    const s = scene(world, [0.5, GROUND, 0.5], { spawnRules, spawning: false });
    expect(world.unpopulatedColumns.size).toBe(0);
    expect(s.runtime.spawner).toBeInstanceOf(MobSpawner);
    const spawnerTick = vi.spyOn(s.runtime.spawner!, 'tick');
    world.notifyColumnLoaded(0, 0, true, false);
    expect(world.unpopulatedColumns.size).toBe(0);

    for (let n = 0; n < MOB_CAPS.hostile; n++)
      makeMob(s.ecs, [2.5 + (n % 8), GROUND, 2.5 + Math.floor(n / 8)], {
        type: 'hollow',
        category: 'hostile',
      });
    expect(s.runtime.spawner!.count('hostile')).toBe(MOB_CAPS.hostile);
    const distant = makeMob(s.ecs, [129.5, GROUND, 0.5], {
      type: 'hollow',
      category: 'hostile',
    });
    run(s.ecs, 1);
    expect(spawnerTick).not.toHaveBeenCalled();
    s.runtime.setSpawning(true);
    run(s.ecs, 1);
    expect(spawnerTick).toHaveBeenCalledTimes(1);
    expect(s.ecs.exists(distant)).toBe(false);
    expect(s.runtime.spawner!.count('hostile')).toBeLessThanOrEqual(MOB_CAPS.hostile);
    s.runtime.setSpawning(false);
    expect(world.unpopulatedColumns.size).toBe(0);
    s.runtime.dispose();
  });

  it('drains first-generation passive work for every generated column beyond 128', () => {
    const world = flatWorld({ radius: 9, top: 'grass_block' });
    world.worldType = 'flat';
    const rules = new SpawnRuleRegistry();
    rules.register({
      type: 'tuftbuck',
      category: 'passive',
      biomes: ['no_such_biome'],
      groupSize: 1,
      weight: 1,
    });
    const s = scene(world, [0.5, GROUND, 0.5], { spawnRules: rules });
    const columns = world.loadedColumns();
    for (const [cx, cz] of columns) world.notifyColumnLoaded(cx, cz, true);

    expect(columns.length).toBeGreaterThan(128);
    expect(world.unpopulatedColumns.size).toBe(columns.length);
    run(s.ecs, Math.ceil(columns.length / SPAWN_ATTEMPTS_PER_TICK));
    expect(world.unpopulatedColumns.size).toBe(0);
    expect(s.runtime.spawner!.count('passive')).toBe(0);
    s.runtime.dispose();
  });

  it('fills the hostile cap, then stops adding hostiles', () => {
    setWorldTime(18000);
    const world = worldWithSurface('grass_block', true);
    const rules = new SpawnRuleRegistry();
    rules.register({
      type: 'hollow',
      category: 'hostile',
      biomes: [],
      groupSize: [1, 3],
      weight: 1,
    });
    const s = scene(world, [0.5, GROUND, 0.5], { spawnRules: rules });
    for (let n = 0; n < MOB_CAPS.hostile - 1; n++)
      makeMob(s.ecs, [1.5 + (n % 6), GROUND, 1.5 + Math.floor(n / 6)], {
        type: 'hollow',
        category: 'hostile',
      });
    const spawn = vi.spyOn(s.runtime, 'spawn');
    vi.spyOn(s.runtime, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(0.99);

    s.runtime.spawner!.tick();
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(s.runtime.spawner!.count('hostile')).toBe(MOB_CAPS.hostile);

    s.runtime.spawner!.tick();
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(s.runtime.spawner!.count('hostile')).toBe(MOB_CAPS.hostile);
    s.runtime.dispose();
  });

});

describe('M13g creature and player close-out', () => {
  it('clings to and moves along a ceiling while pursuing', () => {
    const world = flatWorld();
    world.fill(0, 69, -2, 8, 69, 2, 'stone');
    const collision = new BlockCollision(world);
    const transform = {
      pos: [1.5, 68.3, 0.5] as [number, number, number],
      previous: [1.5, 68.3, 0.5] as [number, number, number],
      yaw: 0,
      previousYaw: 0,
    };
    const size = { width: 0.8, height: 0.7 };
    const body = {
      speed: 0.12,
      flying: false,
      climbing: true,
      vel: [0, 0, 0] as [number, number, number],
      onGround: false,
      inFluid: false,
      horizontalCollision: false,
      wish: [0.12, 0, 0] as [number, number, number],
      jump: false,
      climb: true,
      ceilingCling: true,
    };
    const startX = transform.pos[0];
    for (let n = 0; n < 10; n++) {
      body.climb = true;
      body.wish[0] = 0.12;
      moveMob(collision, transform, size, body);
      expect(body.ceilingCling).toBe(true);
    }
    expect(transform.pos[0]).toBeGreaterThan(startX + 0.4);
    expect(transform.pos[1]).toBeCloseTo(68.3, 3);
  });

  it('clears entity-damage immunity on death and respawn', () => {
    const world = flatWorld();
    const controller = new PlayerController(
      new Camera(1),
      new InputEngine(document.createElement('canvas')),
      () => true,
    );
    controller.spawn(world, 0.5, GROUND, 0.5, 'survival', false, false);
    controller.loop.pause();
    const player = controller.player!;
    expect(hurtPlayer(player, 1, 'mob:hollow', [2.5, GROUND, 0.5])).toBe(true);
    expect(playerInvulnerableTicks(player)).toBe(PLAYER_INVULNERABLE_TICKS);
    player.survival.damage(player.health, 'fall');
    expect(player.dead).toBe(true);
    expect(playerInvulnerableTicks(player)).toBe(0);
    controller.respawn();
    expect(player.dead).toBe(false);
    expect(playerInvulnerableTicks(player)).toBe(0);
    controller.reset();
  });
});
