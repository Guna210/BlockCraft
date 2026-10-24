import * as poseModule from '../../src/entity/ecs/pose';
import { PlayerController } from '../../src/engine/player-controller';
import { Camera } from '../../src/render/camera';
import type { InputEngine } from '../../src/engine/input';
import { describe, expect, it, vi } from 'vitest';
import { mat4, vec3 } from 'gl-matrix';
import '../../src/entity/mobs';
import {
  CINDERWRAITH,
  CINDER_MODEL,
  CINDER_DEFINITION,
  CINDER_PALETTE,
  CinderC,
  CinderSight,
  ANGER_SIGHT_TICKS,
  TELEPORT_COOLDOWN,
  teleportCinder,
  safeCinderSpot,
} from '../../src/entity/mobs/cinderwraith';
import { creatureContext } from '../../src/entity/mobs/creature';
import {
  getEntityModel,
  getEntitySkin,
  validateModel,
  type Vec3,
} from '../../src/entity/ecs/model';
import { hasEntityType } from '../../src/entity/ecs/entity-types';
import { BodyC, HealthC, TransformC } from '../../src/entity/ecs/components';
import { createEntityWorld, killEntity } from '../../src/entity/ecs/systems';
import { computePose } from '../../src/entity/ecs/pose';
import { MobBodyC, MobC, PLAYER_TARGET, TargetC } from '../../src/entity/ai/components';
import { MobRuntime, entityAI } from '../../src/entity/ai/runtime';
import { ItemEntityManager } from '../../src/entity/item-entity';
import { hurtMob } from '../../src/gameplay/combat';
import { BreakParticles } from '../../src/render/particles';
import { PRNG } from '../../src/engine/rng';
import { VoxelRaycaster } from '../../src/world/raycast';
import { GROUND, StubPlayer, flatWorld, run, scene } from './helpers/m13c-mobs';
import {
  inventoryItemGenerators,
  inventoryItemPalettes,
} from '../../src/render/textures/inventory-items';
import { crafting } from '../../src/gameplay/crafting';
import { items } from '../../src/gameplay/items';
import { buildIconSheet } from '../../src/ui/icons';
import { spawnRules } from '../../src/entity/spawning';
import { BlockRegistry } from '../../src/world/blocks/registry';

class GazePlayer extends StubPlayer {
  origin: Vec3 = [10.5, GROUND + 1.62, 0.5];
  direction: Vec3 = [-1, 0, 0];
  gaze() {
    return { origin: this.origin, direction: this.direction };
  }
  aim(point: Readonly<Vec3>) {
    this.origin = [this.pos[0], this.pos[1] + 1.62, this.pos[2]];
    const d = vec3.normalize(vec3.create(), vec3.subtract(vec3.create(), point, this.origin));
    this.direction = [d[0]!, d[1]!, d[2]!];
  }
}
function setup() {
  const world = flatWorld();
  const ecs = createEntityWorld();
  const items = new ItemEntityManager(world);
  const particles = new BreakParticles(world);
  const player = new GazePlayer(10.5, GROUND, 0.5);
  const runtime = new MobRuntime(world, ecs, {
    player: () => player,
    spawnContext: { ecs, items, particles },
    seed: 1,
  });
  const id = runtime.spawn(CINDERWRAITH, 0.5, GROUND, 0.5);
  const t = ecs.get(id, TransformC)!;
  t.yaw = t.previousYaw = 0;
  const sight = new CinderSight(runtime.handle(id));
  return { world, ecs, items, particles, player, runtime, id, sight, ctx: creatureContext(ecs)! };
}
function headPoint(s: ReturnType<typeof setup>): Vec3 {
  const pose = new Float32Array(24 * 16);
  computePose(s.ecs, s.id, 1, pose);
  const p = vec3.transformMat4(
    vec3.create(),
    [0, 25.5, 10],
    pose.subarray(16, 32) as unknown as mat4,
  );
  return [p[0]!, p[1]!, p[2]!];
}
function colours(data: Uint8Array): string[] {
  const used = new Set<string>();
  for (let n = 0; n < data.length; n += 4)
    if (data[n + 3])
      used.add(
        '#' + ((data[n]! << 16) | (data[n + 1]! << 8) | data[n + 2]!).toString(16).padStart(6, '0'),
      );
  return [...used];
}
function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) & 255) * 0.2126 + ((n >> 8) & 255) * 0.7152 + (n & 255) * 0.0722;
}

describe('M13h registration, art and drops', () => {
  it('registers health 30, hostile cap category and a collision box fitting a one-block gap', () => {
    const s = setup();
    expect(hasEntityType(CINDERWRAITH)).toBe(true);
    expect(s.ecs.get(s.id, HealthC)!.current).toBe(30);
    expect(s.ecs.get(s.id, MobC)!.category).toBe('hostile');
    expect(s.ecs.get(s.id, BodyC)!.width).toBeLessThanOrEqual(0.95);
    expect(s.ecs.get(s.id, BodyC)!.height).toBe(1.95);
    expect(s.ecs.get(s.id, BodyC)!.height).toBeLessThanOrEqual(2);
    expect(() => validateModel(CINDER_MODEL)).not.toThrow();
    expect(spawnRules.rules.some((rule) => rule.type === CINDERWRAITH)).toBe(false);
  });
  it('paints a deterministic palette-only low-noise grey skin with contrast at least 60', () => {
    const skin = getEntitySkin(CINDERWRAITH);
    expect(skin(7)).toEqual(skin(7));
    expect(skin(7)).not.toEqual(skin(8));
    const used = colours(skin(7));
    expect(used.every((color) => CINDER_PALETTE.includes(color))).toBe(true);
    const lum = used.map(luminance);
    expect(Math.max(...lum) - Math.min(...lum)).toBeGreaterThanOrEqual(60);
    const model = getEntityModel(CINDERWRAITH);
    for (const part of model.parts)
      for (const cube of part.cubes) expect(cube.uv.every(Number.isInteger)).toBe(true);
    // Shoulders are twice as broad as the head, and arms end at ground level beside short legs.
    expect(model.parts[0]!.cubes[1]!.size[0]).toBe(16);
    expect(model.parts[3]!.cubes[1]!.from[1]).toBe(0);
  });
  it('rolls only 0–1 shards and produces item entities through the normal death path', () => {
    const s = setup();
    const rolls = new Set<number>();
    const rng = new PRNG(91);
    for (let n = 0; n < 100; n++) {
      const result = CINDER_DEFINITION.drops({ ...s.ctx, random: () => rng.next() }, s.id);
      expect(result[0]![0]).toBe('cinder_shard');
      rolls.add(result[0]![1]);
    }
    expect([...rolls].sort()).toEqual([0, 1]);
    // A seeded batch proves the shared death/drop hook runs once per creature.
    for (let n = 0; n < 30; n++) killEntity(s.ecs, s.runtime.spawn(CINDERWRAITH, 0.5, GROUND, 0.5));
    run(s.ecs, 1);
    const count = s.items.pool.filter((e) => e.active && e.item.id === 'cinder_shard').length;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(30);
    run(s.ecs, 1);
    expect(s.items.pool.filter((e) => e.active && e.item.id === 'cinder_shard')).toHaveLength(
      count,
    );
  });
  it('registers a palette-only shard texture and an inventory icon, without a recipe', () => {
    expect(items.get('cinder_shard')).toMatchObject({
      kind: 'material',
      maxStack: 64,
      texture: 'cinder_shard',
    });
    const data = inventoryItemGenerators.cinder_shard!(42);
    expect(data).toEqual(inventoryItemGenerators.cinder_shard!(42));
    for (const [a, b] of [
      [42, 1337],
      [12345, 99999],
    ])
      expect(inventoryItemGenerators.cinder_shard!(a)).not.toEqual(
        inventoryItemGenerators.cinder_shard!(b),
      );
    const allowed = inventoryItemPalettes
      .cinder_shard!.filter((p) => p[3])
      .map((p) => '#' + ((p[0] << 16) | (p[1] << 8) | p[2]).toString(16).padStart(6, '0'));
    expect(colours(data).every((color) => allowed.includes(color))).toBe(true);
    const lum = colours(data).map(luminance);
    expect(Math.max(...lum) - Math.min(...lum)).toBeGreaterThanOrEqual(60);
    const icons = buildIconSheet((id) => inventoryItemGenerators[id]?.(42) ?? data, data);
    expect(icons.rects.has('cinder_shard')).toBe(true);
    expect(
      [...crafting.recipes.values()].some((recipe) => recipe.result.id === 'cinder_shard'),
    ).toBe(false);
  });
});

describe('M13h gaze and anger', () => {
  it('triggers on the posed head from different orientations, checking voxels only after the slab hit', () => {
    const s = setup();
    for (const yaw of [0, 0.7, 2, 4]) {
      const t = s.ecs.get(s.id, TransformC)!;
      t.yaw = t.previousYaw = yaw;
      s.player.aim(headPoint(s));
      expect(s.sight.gazed(s.player), `yaw ${yaw}`).toBe(true);
    }
    const cast = vi.spyOn(VoxelRaycaster.prototype, 'cast');
    try {
      s.player.direction = [1, 0, 0];
      expect(s.sight.gazed(s.player)).toBe(false);
      expect(cast).not.toHaveBeenCalled();
      s.player.aim(headPoint(s));
      expect(s.sight.gazed(s.player)).toBe(true);
      expect(cast).toHaveBeenCalledTimes(1);
    } finally {
      cast.mockRestore();
    }
  });
  it('ignores body rays, looking away, blocked sight and distances beyond 64', () => {
    const s = setup();
    s.player.aim([0.5, GROUND + 0.6, 0.5]);
    expect(s.sight.gazed(s.player)).toBe(false);
    s.player.aim(headPoint(s));
    s.world.setBlock(5, GROUND + 1, 0, 'stone');
    expect(s.sight.gazed(s.player)).toBe(false);
    s.world.setBlock(5, GROUND + 1, 0, 'air');
    s.player.pos[0] = 65.5;
    s.player.aim(headPoint(s));
    const cast = vi.spyOn(VoxelRaycaster.prototype, 'cast');
    try {
      expect(s.sight.gazed(s.player)).toBe(false);
      expect(cast).not.toHaveBeenCalled();
    } finally {
      cast.mockRestore();
    }
  });
  it('stays neutral for 200 ticks, then pursues and hits after a gaze', () => {
    const s = setup();
    s.player.direction = [1, 0, 0];
    run(s.ecs, 200);
    expect(entityAI(s.ecs, s.id).target).toBeNull();
    expect(s.player.hits).toHaveLength(0);
    s.player.aim(headPoint(s));
    run(s.ecs, 2);
    expect(entityAI(s.ecs, s.id).target).toBe(PLAYER_TARGET);
    run(s.ecs, 198);
    expect(s.player.hits.length).toBeGreaterThan(0);
  });
  it('retaliates when the player hits a neutral creature and respects teleport cooldown', () => {
    const s = setup();
    s.player.direction = [1, 0, 0];
    const before = [...s.ecs.get(s.id, TransformC)!.pos];
    hurtMob(s.ecs, s.id, 1, { ref: PLAYER_TARGET, pos: s.player.pos });
    run(s.ecs, 1);
    expect(entityAI(s.ecs, s.id).target).toBe(PLAYER_TARGET);
    expect(vec3.distance(before, s.ecs.get(s.id, TransformC)!.pos)).toBeGreaterThanOrEqual(4);
    const until = s.ecs.get(s.id, CinderC)!.cooldownUntil;
    run(s.ecs, 11);
    hurtMob(s.ecs, s.id, 1, { ref: PLAYER_TARGET, pos: s.player.pos });
    run(s.ecs, 1);
    expect(s.ecs.get(s.id, CinderC)!.cooldownUntil).toBe(until);
    expect(teleportCinder(s.ctx, s.id)).toBe(false);
    expect(until).toBe(1 + TELEPORT_COOLDOWN);
  });
  it('calms on player death, distance over 64, or 600 ticks of blocked sight', () => {
    for (const reason of ['death', 'distance', 'sight']) {
      const s = setup();
      s.ecs.get(s.id, TargetC)!.target = PLAYER_TARGET;
      s.ecs.get(s.id, CinderC)!.cooldownUntil = Infinity;
      s.ecs.get(s.id, MobBodyC)!.speed = 0;
      if (reason === 'death') s.player.alive = false;
      else if (reason === 'distance') s.player.pos[0] = 65.5;
      else {
        for (let y = GROUND; y < GROUND + 4; y++) s.world.setBlock(5, y, 0, 'stone');
        run(s.ecs, ANGER_SIGHT_TICKS - 1);
        expect(entityAI(s.ecs, s.id).target).toBe(PLAYER_TARGET);
      }
      run(s.ecs, 1);
      expect(entityAI(s.ecs, s.id).target, reason).toBeNull();
    }
  });
});

describe('M13h teleport safety and lazy particles', () => {
  it('lands safely in at least 100 seeded trials including fluid, ceilings, holes and unloaded boundaries', () => {
    const s = setup();
    for (let x = -15; x <= 15; x++)
      for (let z = -15; z <= 15; z++) {
        if ((x + z) % 5 === 0) s.world.setBlock(x, GROUND, z, x % 2 ? 'water' : 'lava');
        else if ((x - z) % 7 === 0) s.world.setBlock(x, GROUND + 1, z, 'stone');
        else if ((x + z) % 11 === 0) s.world.setBlock(x, GROUND - 1, z, 'air');
      }
    let landed = 0;
    for (let seed = 0; seed < 150; seed++) {
      const random = new PRNG(seed);
      const t = s.ecs.get(s.id, TransformC)!;
      t.pos = [seed % 2 ? 27.5 : 0.5, GROUND, 0.5];
      const from = [...t.pos];
      s.ecs.get(s.id, CinderC)!.cooldownUntil = 0;
      if (!teleportCinder({ ...s.ctx, random: () => random.next() }, s.id)) continue;
      landed++;
      expect(s.world.hasColumn(Math.floor(t.pos[0] / 16), Math.floor(t.pos[2] / 16))).toBe(true);
      const support = s.world.getBlock(Math.floor(t.pos[0]), t.pos[1] - 1, Math.floor(t.pos[2]));
      expect(BlockRegistry.getInstance().getBlockDefinition(support.id)!.fullOpaqueCube).toBe(true);
      expect(['water', 'lava', 'cactus']).not.toContain(support.id);
      expect(vec3.distance(from, t.pos)).toBeGreaterThanOrEqual(4);
      expect(vec3.distance(from, t.pos)).toBeLessThanOrEqual(16);
      expect(safeCinderSpot(s.world, Math.floor(t.pos[0]), t.pos[1], Math.floor(t.pos[2]))).toBe(
        true,
      );
      expect(s.world.getBlock(Math.floor(t.pos[0]), t.pos[1], Math.floor(t.pos[2])).id).toBe('air');
      expect(s.world.getBlock(Math.floor(t.pos[0]), t.pos[1] + 1, Math.floor(t.pos[2])).id).toBe(
        'air',
      );
    }
    expect(landed).toBeGreaterThanOrEqual(100);
  });
  it('allows a second teleport only after the cooldown expires', () => {
    const s = setup();
    const ctx = { ...s.ctx, random: () => 0.5 };
    expect(teleportCinder(ctx, s.id)).toBe(true);
    s.ecs.time = TELEPORT_COOLDOWN - 1;
    expect(teleportCinder(ctx, s.id)).toBe(false);
    s.ecs.time++;
    expect(teleportCinder(ctx, s.id)).toBe(true);
  });
  it('does not teleport when no safe spot exists and bounds failed searches', () => {
    const s = setup();
    const random = vi.fn(() => 0.5);
    const before = [...s.ecs.get(s.id, TransformC)!.pos];
    // Every candidate is at this blocked column, so all bounded attempts fail.
    for (let y = GROUND - 3; y <= GROUND + 4; y++) s.world.setBlock(-10, y, 0, 'stone');
    expect(teleportCinder({ ...s.ctx, random }, s.id)).toBe(false);
    expect(s.ecs.get(s.id, TransformC)!.pos).toEqual(before);
    expect(random.mock.calls.length).toBeLessThanOrEqual(96);
    expect(teleportCinder({ ...s.ctx, random }, s.id)).toBe(false);
    expect(random.mock.calls.length).toBeLessThanOrEqual(96);
  });
  it('caps rising, fading embers per creature and emits at both teleport endpoints', () => {
    const s = setup();
    const random = new PRNG(77);
    expect(teleportCinder({ ...s.ctx, random: () => random.next() }, s.id)).toBe(true);
    const sparks = s.particles.pool.filter((p) => p.active);
    expect(sparks).toHaveLength(16);
    const end = s.ecs.get(s.id, TransformC)!.pos;
    expect(sparks.filter((p) => Math.hypot(p.pos[0] - 0.5, p.pos[2] - 0.5) < 1)).toHaveLength(8);
    expect(sparks.filter((p) => Math.hypot(p.pos[0] - end[0], p.pos[2] - end[2]) < 1)).toHaveLength(
      8,
    );
    for (let n = 0; n < 40; n++) s.particles.ember(s.id, end, s.ctx.random, 8);
    expect(s.particles.pool.filter((p) => p.active)).toHaveLength(24);
    const y = sparks[0]!.pos[1];
    s.particles.tick();
    expect(sparks[0]!.pos[1]).toBeGreaterThan(y);
    expect(sparks[0]!.age).toBe(1);
    for (let n = 0; n < 24; n++) s.particles.tick();
    expect(s.particles.pool.filter((p) => p.active)).toHaveLength(0);
  });
  it('installs no systems or sight/ember work before a first Cinderwraith, including worlds with other creatures', () => {
    const s = scene(flatWorld());
    const worldKeys = Reflect.ownKeys(s.world);
    const playerKeys = Reflect.ownKeys(s.player);
    const addSystem = vi.spyOn(s.ecs, 'addSystem');
    const ray = vi.spyOn(VoxelRaycaster.prototype, 'cast');
    const ember = vi.spyOn(BreakParticles.prototype, 'ember');
    try {
      run(s.ecs, 5);
      expect(addSystem).not.toHaveBeenCalled();
      s.runtime.spawn('tuftbuck', 5.5, GROUND, 0.5);
      run(s.ecs, 5);
      expect(ray).not.toHaveBeenCalled();
      expect(ember).not.toHaveBeenCalled();
      addSystem.mockClear();
      const id = s.runtime.spawn(CINDERWRAITH, 0.5, GROUND, 0.5);
      expect(s.ecs.has(id, CinderC)).toBe(true);
      expect(Reflect.ownKeys(s.world)).toEqual(worldKeys);
      expect(Reflect.ownKeys(s.player)).toEqual(playerKeys);
      // Cinder-specific work uses goals and definition.tick; it adds no global system even here.
      expect(addSystem).not.toHaveBeenCalled();
      s.ecs.destroy(id);
      run(s.ecs, 5);
      expect(ray).not.toHaveBeenCalled();
      expect(ember).not.toHaveBeenCalled();
    } finally {
      addSystem.mockRestore();
      ray.mockRestore();
      ember.mockRestore();
    }
  });
});

it('M13h reuses controller gaze and sight scratch, rejecting away rays before posing', () => {
  const s = setup();
  const controller = new PlayerController(
    new Camera(16 / 9),
    { actionStates: new Map() } as InputEngine,
    () => true,
  );
  controller.spawn(s.world, 10.5, GROUND, 0.5, 'survival');
  const player = controller.mobs!.player()!;
  const gaze = player.gaze!();
  const origin = gaze.origin;
  const direction = gaze.direction;
  const pose = vi.spyOn(poseModule, 'computePose');
  const add = vi.spyOn(vec3, 'add');
  const set = vi.spyOn(vec3, 'set');
  try {
    controller.player!.yaw = Math.PI;
    for (let n = 0; n < 5; n++) {
      expect(player.gaze!()).toBe(gaze);
      expect(gaze.origin).toBe(origin);
      expect(gaze.direction).toBe(direction);
      s.sight.gazed(player);
      s.sight.sees(player);
    }
    expect(pose).toHaveBeenCalledTimes(5);
    const poseScratch = pose.mock.calls[0]![3];
    for (const call of pose.mock.calls) expect(call[3]).toBe(poseScratch);
    const endpoint = add.mock.calls[0]![0];
    const sightOrigin = set.mock.calls[0]![0];
    for (let n = 0; n < set.mock.calls.length; n += 2) {
      expect(set.mock.calls[n]![0]).toBe(sightOrigin);
      expect(set.mock.calls[n + 1]![0]).toBe(endpoint);
    }
    controller.player!.yaw = 0;
    pose.mockClear();
    for (let n = 0; n < 5; n++) expect(s.sight.gazed(player)).toBe(false);
    expect(pose).not.toHaveBeenCalled();
    controller.player!.pos[0] = 65.5;
    controller.player!.yaw = Math.PI;
    expect(s.sight.gazed(player)).toBe(false);
    expect(pose).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
    controller.mobs!.dispose();
  }
});
