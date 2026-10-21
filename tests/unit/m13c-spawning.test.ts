import { afterEach, describe, expect, it } from 'vitest';
import {
  MOB_CAPS,
  PASSIVE_INTERVAL,
  SPAWN_MAX_DISTANCE,
  SPAWN_MIN_DISTANCE,
  SpawnRuleRegistry,
  type MobSpawner,
} from '../../src/entity/spawning';
import { registerEntityType } from '../../src/entity/ecs/entity-types';
import { EntityKindC } from '../../src/entity/ecs/components';
import { MobC, type MobCategory } from '../../src/entity/ai/components';
import { resetWorldTime, setWorldTime } from '../../src/world/time';
import type { EntityWorld } from '../../src/entity/ecs/world';
import type { World } from '../../src/world/world';
import { FLOOR, GROUND, flat, flatWorld, makeMob, pos, run, scene } from './helpers/m13c-mobs';

afterEach(() => resetWorldTime());

const HOSTILE = 'm13c_test_hostile',
  PASSIVE = 'm13c_test_passive',
  AMBIENT = 'm13c_test_ambient';
for (const [type, category] of [
  [HOSTILE, 'hostile'],
  [PASSIVE, 'passive'],
  [AMBIENT, 'ambient'],
] as const)
  registerEntityType(type, (ctx, x, y, z) =>
    makeMob(ctx.ecs, [x, y, z], { type, category, flying: category === 'ambient' }),
  );

function registry(...categories: MobCategory[]): SpawnRuleRegistry {
  const rules = new SpawnRuleRegistry();
  const types = { hostile: HOSTILE, passive: PASSIVE, ambient: AMBIENT };
  for (const category of categories)
    rules.register({ type: types[category], category, biomes: [], groupSize: [1, 3], weight: 1 });
  return rules;
}

function mobs(ecs: EntityWorld, category: MobCategory): number[] {
  return ecs.query(MobC).filter((id) => ecs.get(id, MobC)!.category === category);
}

function spawnerOf(world: World, rules: SpawnRuleRegistry) {
  const s = scene(world, [0.5, GROUND, 0.5], { spawnRules: rules });
  return { ...s, spawner: s.runtime.spawner as MobSpawner };
}

describe('M13c spawn rules', () => {
  it('validates weights and group sizes', () => {
    const rules = new SpawnRuleRegistry();
    const rule = { type: HOSTILE, category: 'hostile' as const, biomes: [], weight: 1 };
    expect(() => rules.register({ ...rule, groupSize: 2, weight: 0 })).toThrow('positive weight');
    expect(() => rules.register({ ...rule, groupSize: 0 })).toThrow('invalid group size');
    expect(() => rules.register({ ...rule, groupSize: [3, 1] })).toThrow('invalid group size');
    expect(() => rules.register({ ...rule, groupSize: 1.5 })).toThrow('invalid group size');
    rules.register({ ...rule, groupSize: [2, 4] });
    rules.register({ ...rule, type: PASSIVE, category: 'passive', groupSize: 4 });
    expect(rules.forCategory('hostile').map((r) => r.type)).toEqual([HOSTILE]);
    expect(rules.rules).toHaveLength(2);
  });

  it('picks rules by weight and biome, skipping types that are not registered', () => {
    const rules = new SpawnRuleRegistry();
    rules.register({ type: HOSTILE, category: 'hostile', biomes: [], groupSize: 1, weight: 3 });
    rules.register({
      type: AMBIENT,
      category: 'hostile',
      biomes: ['meadow'],
      groupSize: 1,
      weight: 1,
    });
    rules.register({
      type: 'm13c_unregistered',
      category: 'hostile',
      biomes: [],
      groupSize: 1,
      weight: 50,
    });
    const { spawner } = spawnerOf(flatWorld(), rules);
    const counts = new Map<string, number>();
    for (let n = 0; n < 4000; n++) {
      const type = spawner.pickRule('hostile', 'meadow')!.type;
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual([AMBIENT, HOSTILE].sort());
    expect(counts.get(HOSTILE)! / 4000).toBeGreaterThan(0.72);
    expect(counts.get(HOSTILE)! / 4000).toBeLessThan(0.78);
    expect(spawner.pickRule('hostile', 'desert')!.type).toBe(HOSTILE);
    expect(spawner.pickRule('passive', 'meadow')).toBeNull();
  });
});

describe('M13c hostile spawning', () => {
  it('needs solid ground, two free cells, no block light, dark sky and 24–128 blocks', () => {
    const world = flatWorld({ radius: 2, light: true });
    const { spawner } = spawnerOf(world, registry('hostile'));
    setWorldTime(18000);
    expect(spawner.hostileSpot(30, GROUND, 0)).toBe(true);
    expect(spawner.hostileSpot(-30, GROUND, -20)).toBe(true);
    expect(spawner.hostileSpot(10, GROUND, 0)).toBe(false); // too close
    expect(spawner.hostileSpot(23, GROUND, 0)).toBe(false);
    expect(spawner.hostileSpot(30, GROUND + 3, 0)).toBe(false); // nothing solid below
    expect(spawner.hostileSpot(30, FLOOR, 0)).toBe(false); // inside the floor
    world.setBlock(30, GROUND + 1, 4, 'stone');
    expect(spawner.hostileSpot(30, GROUND, 4)).toBe(false); // one free cell only
    world.setBlock(33, GROUND, -6, 'torch');
    expect(world.getLight(31, GROUND, -6).block).toBeGreaterThan(0);
    expect(spawner.hostileSpot(31, GROUND, -6)).toBe(false); // block light
    // Noon: the open sky is too bright, deep cover is dark enough.
    setWorldTime(6000);
    expect(spawner.hostileSpot(30, GROUND, 0)).toBe(false);
    world.fill(14, GROUND + 2, 14, 31, GROUND + 2, 31, 'stone');
    expect(world.getLight(26, GROUND, 26).sky).toBeLessThan(8);
    expect(spawner.hostileSpot(26, GROUND, 26)).toBe(true);
    // Near the open edge of the roof the sky light is still too high.
    expect(world.getLight(15, GROUND, 20).sky).toBeGreaterThanOrEqual(8);
    expect(spawner.hostileSpot(15, GROUND, 20)).toBe(false);
  });

  it('never judges an unlit column as dark while the streamer lights columns', () => {
    const world = flatWorld({ radius: 2, light: true });
    world.lightEngine.onlyLitColumns = true;
    const { spawner } = spawnerOf(world, registry('hostile'));
    setWorldTime(18000);
    world.lightEngine.removeColumn(1, 0);
    expect(spawner.hostileSpot(30, GROUND, 0)).toBe(false);
    expect(spawner.hostileSpot(-30, GROUND, 0)).toBe(true);
  });

  it('fills to the hostile cap of 40 at night, in valid spots, and spawns none at noon', () => {
    const world = flatWorld({ radius: 2, light: true });
    setWorldTime(6000);
    const { ecs, spawner, player } = spawnerOf(world, registry('hostile'));
    run(ecs, 200);
    expect(mobs(ecs, 'hostile')).toEqual([]);
    setWorldTime(18000);
    let most = 0;
    run(ecs, 600, () => (most = Math.max(most, spawner.count('hostile'))));
    expect(most).toBe(MOB_CAPS.hostile);
    expect(mobs(ecs, 'hostile').length).toBeLessThanOrEqual(MOB_CAPS.hostile);
    for (const id of mobs(ecs, 'hostile')) {
      const p = pos(ecs, id);
      expect(ecs.get(id, EntityKindC)!.type).toBe(HOSTILE);
      expect(flat(p, player.pos)).toBeGreaterThanOrEqual(SPAWN_MIN_DISTANCE - 1);
      expect(flat(p, player.pos)).toBeLessThanOrEqual(SPAWN_MAX_DISTANCE);
      expect(p[1]).toBeCloseTo(GROUND, 3);
    }
  });

  it('counts caps over loaded columns only', () => {
    const world = flatWorld({ radius: 2 });
    const { ecs, spawner } = spawnerOf(world, registry());
    makeMob(ecs, [5.5, GROUND, 5.5], { category: 'hostile' });
    makeMob(ecs, [-20.5, GROUND, 5.5], { category: 'hostile' });
    makeMob(ecs, [500.5, GROUND, 5.5], { category: 'hostile' });
    makeMob(ecs, [5.5, GROUND, 5.5], { category: 'passive' });
    expect(spawner.count('hostile')).toBe(2);
    expect(spawner.count('passive')).toBe(1);
    expect(spawner.count('ambient')).toBe(0);
  });
});

describe('M13c passive and ambient spawning', () => {
  it('spawns passives on grass when a column is first generated, up to the cap of 12', () => {
    const world = flatWorld({ radius: 3, top: 'grass_block' });
    const { ecs, spawner } = spawnerOf(world, registry('passive'));
    // Restored columns are not repopulated.
    for (const [cx, cz] of world.loadedColumns()) world.notifyColumnLoaded(cx, cz, false);
    run(ecs, 20);
    expect(spawner.count('passive')).toBe(0);
    for (const [cx, cz] of world.loadedColumns()) world.notifyColumnLoaded(cx, cz, true);
    run(ecs, 1);
    const first = spawner.count('passive');
    expect(first).toBeGreaterThan(0);
    run(ecs, 10);
    expect(spawner.count('passive')).toBe(MOB_CAPS.passive);
    expect(world.unpopulatedColumns.size).toBe(0);
    for (const id of mobs(ecs, 'passive')) {
      const p = pos(ecs, id);
      expect(world.getBlock(Math.floor(p[0]), FLOOR, Math.floor(p[2])).id).toBe('grass_block');
    }
    // A column is populated once: loading it again generated adds nothing new below the cap.
    for (const id of mobs(ecs, 'passive').slice(0, 6)) ecs.destroy(id);
    world.notifyColumnLoaded(0, 0, true);
    run(ecs, 5);
    expect(spawner.count('passive')).toBe(6);
  });

  it('spawns passives only on grass and in the rule biomes', () => {
    const stone = flatWorld({ radius: 2 });
    const a = spawnerOf(stone, registry('passive'));
    for (const [cx, cz] of stone.loadedColumns()) stone.notifyColumnLoaded(cx, cz, true);
    run(a.ecs, 10);
    expect(a.spawner.count('passive')).toBe(0);
    const grass = flatWorld({ radius: 2, top: 'grass_block' });
    const rules = new SpawnRuleRegistry();
    rules.register({
      type: PASSIVE,
      category: 'passive',
      biomes: ['m13c_nowhere'],
      groupSize: 2,
      weight: 1,
    });
    const b = spawnerOf(grass, rules);
    for (const [cx, cz] of grass.loadedColumns()) grass.notifyColumnLoaded(cx, cz, true);
    run(b.ecs, 10);
    expect(b.spawner.count('passive')).toBe(0);
    expect(b.spawner.passiveSpot(3, GROUND, 3)).toBe(true);
  });

  it('gives each loaded column a 1/10 passive attempt every 400 ticks', () => {
    const world = flatWorld({ radius: 4, top: 'grass_block' });
    const { ecs, spawner } = spawnerOf(world, registry('passive'));
    run(ecs, PASSIVE_INTERVAL - 1);
    expect(spawner.count('passive')).toBe(0);
    ecs.tick();
    const once = spawner.count('passive');
    expect(once).toBeGreaterThan(0);
    // About 64 / 10 columns try, with groups of 1–3.
    expect(once).toBeLessThanOrEqual(MOB_CAPS.passive);
    run(ecs, PASSIVE_INTERVAL - 1);
    expect(spawner.count('passive')).toBe(once);
  });

  it('spawns ambient mobs in free air by day or night, up to the cap of 10', () => {
    const world = flatWorld({ radius: 3 });
    setWorldTime(6000);
    const { ecs, spawner } = spawnerOf(world, registry('ambient'));
    let most = 0;
    run(ecs, 600, () => (most = Math.max(most, spawner.count('ambient'))));
    expect(most).toBe(MOB_CAPS.ambient);
    expect(spawner.ambientSpot(30, GROUND, 0)).toBe(true);
    expect(spawner.ambientSpot(30, FLOOR, 0)).toBe(false);
    expect(spawner.ambientSpot(5, GROUND, 0)).toBe(false);
  });
});

describe('M13c despawning', () => {
  it('removes hostiles beyond 128 at once and those beyond 32 by chance, never near ones or passives', () => {
    const world = flatWorld({ radius: 2 });
    const { ecs } = spawnerOf(world, registry());
    const far = makeMob(ecs, [129.5, GROUND, 0.5], { category: 'hostile' });
    const mid = Array.from({ length: 10 }, (_, i) =>
      makeMob(ecs, [40.5, GROUND, i - 4.5], { category: 'hostile' }),
    );
    const near = makeMob(ecs, [20.5, GROUND, 20.5], { category: 'hostile' });
    const sheep = makeMob(ecs, [300.5, GROUND, 0.5], { category: 'passive' });
    const bat = makeMob(ecs, [300.5, GROUND, 40.5], { category: 'ambient', flying: true });
    ecs.tick();
    expect(ecs.exists(far)).toBe(false);
    expect(mid.every((id) => ecs.exists(id))).toBe(true);
    run(ecs, 800);
    const left = mid.filter((id) => ecs.exists(id)).length;
    expect(left).toBeLessThan(10);
    run(ecs, 7200);
    expect(mid.filter((id) => ecs.exists(id))).toEqual([]);
    expect(ecs.exists(near)).toBe(true);
    expect(ecs.exists(sheep)).toBe(true);
    expect(ecs.exists(bat)).toBe(true);
  });
});
