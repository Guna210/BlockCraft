import { describe, it, expect } from 'vitest';
import { ECS_FIRST_ID, EntityWorld, defineComponent } from '../../src/entity/ecs/world';
import {
  AnimatorC,
  DEATH_TICKS,
  HURT_TICKS,
  HURT_TINT,
  HealthC,
  LookTargetC,
  TransformC,
} from '../../src/entity/ecs/components';
import {
  createEntityWorld,
  damageEntity,
  entityState,
  killEntity,
  playClip,
  queryEcsEntities,
  snapshotEcsEntities,
  spawnModelEntity,
} from '../../src/entity/ecs/systems';
import {
  clipTime,
  headLook,
  sampleChannel,
  smoothToward,
  walkPhaseStep,
  walkSwing,
  wrapAngle,
} from '../../src/entity/ecs/animation';
import {
  MAX_MODEL_PARTS,
  registerEntityModel,
  validateModel,
  type EntityModel,
  type KeyframeChannel,
} from '../../src/entity/ecs/model';
import { hurtTint, tipAngle } from '../../src/entity/ecs/pose';
import { registerEntityType, spawnEntity } from '../../src/entity/ecs/entity-types';
import { World } from '../../src/world/world';
import { ItemEntityManager } from '../../src/entity/item-entity';
import { EntityQuery } from '../../src/entity/query';

const DEG = Math.PI / 180;

/** A four-legged test model: body, a head parented to it, four legs, one keyframed clip. */
const TEST_MODEL: EntityModel = {
  id: 'm13a_test_ecs',
  textureSize: [64, 32],
  parts: [
    {
      name: 'body',
      pivot: [0, 10, 0],
      cubes: [{ from: [-4, 6, -6], size: [8, 6, 12], uv: [0, 0] }],
    },
    {
      name: 'head',
      parent: 'body',
      pivot: [0, 12, 6],
      cubes: [{ from: [-3, 10, 6], size: [6, 5, 5], uv: [40, 0] }],
    },
    {
      name: 'leg_fr',
      pivot: [-2, 6, 4],
      cubes: [{ from: [-3, 0, 3], size: [2, 6, 2], uv: [0, 18] }],
    },
    {
      name: 'leg_fl',
      pivot: [2, 6, 4],
      cubes: [{ from: [1, 0, 3], size: [2, 6, 2], uv: [8, 18] }],
    },
    {
      name: 'leg_br',
      pivot: [-2, 6, -4],
      cubes: [{ from: [-3, 0, -5], size: [2, 6, 2], uv: [16, 18] }],
    },
    {
      name: 'leg_bl',
      pivot: [2, 6, -4],
      cubes: [{ from: [1, 0, -5], size: [2, 6, 2], uv: [24, 18] }],
    },
  ],
  walk: {
    maxSwing: 40 * DEG,
    refSpeed: 4,
    stride: 1.5,
    limbs: { leg_fr: 0, leg_bl: 0, leg_fl: Math.PI, leg_br: Math.PI },
  },
  head: { part: 'head' },
  clips: {
    nod: {
      length: 10,
      loop: false,
      channels: [
        {
          part: 'head',
          property: 'rotation',
          interpolation: 'linear',
          keys: [
            { tick: 0, value: [0, 0, 0] },
            { tick: 5, value: [0.5, 0, 0] },
            { tick: 10, value: [0, 0, 0] },
          ],
        },
      ],
    },
  },
};
const skin = () => {
  const pixels = new Uint8Array(64 * 32 * 4);
  for (let n = 0; n < pixels.length; n += 4) pixels.set([96, 120, 70, 255], n);
  return pixels;
};
registerEntityModel(TEST_MODEL, skin);

function spawn(ecs: EntityWorld, pos: [number, number, number] = [0.5, 64, 0.5], yaw = 0) {
  return spawnModelEntity(ecs, {
    type: 'm13a_test',
    model: TEST_MODEL.id,
    pos,
    yaw,
    health: 10,
    width: 0.8,
    height: 1,
  });
}

describe('M13a ECS queries', () => {
  it('starts ids at 2^20 so they never meet item-entity ids', () => {
    const ecs = new EntityWorld();
    expect(ECS_FIRST_ID).toBe(1048576);
    expect(ecs.create()).toBe(1048576);
    expect(ecs.create()).toBe(1048577);
  });

  it('returns ids that have every queried component, in ascending order', () => {
    const ecs = new EntityWorld();
    const A = defineComponent<number>('a'),
      B = defineComponent<string>('b');
    const ids = Array.from({ length: 6 }, () => ecs.create());
    // Components are added out of id order; queries must still come back sorted.
    for (const id of [ids[5]!, ids[2]!, ids[0]!, ids[3]!]) ecs.add(id, A, id);
    for (const id of [ids[3]!, ids[1]!, ids[5]!]) ecs.add(id, B, `b${id}`);
    expect(ecs.query(A)).toEqual([ids[0], ids[2], ids[3], ids[5]]);
    expect(ecs.query(B)).toEqual([ids[1], ids[3], ids[5]]);
    expect(ecs.query(A, B)).toEqual([ids[3], ids[5]]);
    expect(ecs.query(B, A)).toEqual([ids[3], ids[5]]);
    expect(ecs.query()).toEqual(ids);
    expect(ecs.get(ids[3]!, B)).toBe(`b${ids[3]}`);
    ecs.remove(ids[3]!, B);
    expect(ecs.query(A, B)).toEqual([ids[5]]);
    ecs.destroy(ids[5]!);
    expect(ecs.query(A, B)).toEqual([]);
    expect(ecs.query(A)).toEqual([ids[0], ids[2], ids[3]]);
    expect(ecs.exists(ids[5]!)).toBe(false);
    expect(() => ecs.add(ids[5]!, A, 1)).toThrow(`No entity with id ${ids[5]} exists`);
    expect(ecs.query(defineComponent('unused'))).toEqual([]);
  });

  it('runs systems by order, then insertion order, and visits entities deterministically', () => {
    const ecs = new EntityWorld();
    const C = defineComponent<number>('c');
    const log: string[] = [];
    ecs.addSystem(() => log.push('late'), 5);
    ecs.addSystem((w) => log.push(`first:${w.query(C).join(',')}`), -5);
    ecs.addSystem(() => log.push('middle-a'));
    ecs.addSystem(() => log.push('middle-b'));
    const b = ecs.create(),
      a = ecs.create();
    ecs.add(a, C, 1);
    ecs.add(b, C, 2);
    ecs.tick();
    expect(log).toEqual([`first:${b},${a}`, 'middle-a', 'middle-b', 'late']);
    expect(ecs.time).toBe(1);
  });
});

describe('M13a model validation', () => {
  it(`rejects models with more than ${MAX_MODEL_PARTS} parts, children before parents and UVs off the texture`, () => {
    const part = (name: string, parent?: string) => ({
      name,
      parent,
      pivot: [0, 0, 0] as [number, number, number],
      cubes: [
        {
          from: [0, 0, 0] as [number, number, number],
          size: [1, 1, 1] as [number, number, number],
          uv: [0, 0] as [number, number],
        },
      ],
    });
    const base = { id: 'v', textureSize: [16, 16] as [number, number] };
    expect(() =>
      validateModel({ ...base, parts: Array.from({ length: 24 }, (_, n) => part(`p${n}`)) }),
    ).not.toThrow();
    expect(() =>
      validateModel({ ...base, parts: Array.from({ length: 25 }, (_, n) => part(`p${n}`)) }),
    ).toThrow('needs 1 to 24 parts');
    expect(() => validateModel({ ...base, parts: [part('child', 'root'), part('root')] })).toThrow(
      'must follow its parent',
    );
    expect(() =>
      validateModel({
        ...base,
        parts: [{ ...part('wide'), cubes: [{ from: [0, 0, 0], size: [6, 2, 3], uv: [0, 0] }] }],
      }),
    ).toThrow('UVs leave the texture');
    expect(() => registerEntityModel(TEST_MODEL, skin)).toThrow('Duplicate entity model');
    expect(() =>
      registerEntityModel(
        { ...base, id: 'm13a_bad_skin', parts: [part('a')] },
        () => new Uint8Array(4),
      ),
    ).toThrow('skin size');
  });
});

describe('M13a walk animation math', () => {
  it('swing = maxSwing · sin(phase) · min(speed / refSpeed, 1)', () => {
    const max = 40 * DEG;
    expect(walkSwing(max, Math.PI / 2, 4, 4)).toBeCloseTo(max);
    expect(walkSwing(max, Math.PI / 2, 2, 4)).toBeCloseTo(max / 2);
    expect(walkSwing(max, Math.PI / 2, 12, 4)).toBeCloseTo(max);
    expect(walkSwing(max, -Math.PI / 2, 1, 4)).toBeCloseTo(-max / 4);
    expect(walkSwing(max, Math.PI / 6, 4, 4)).toBeCloseTo(max * 0.5);
    expect(walkSwing(max, 1, 0, 4)).toBe(0);
    expect(walkPhaseStep(1.5, 1.5)).toBeCloseTo(Math.PI * 2);
  });

  it('advances the phase with horizontal distance travelled, not with time', () => {
    const run = (perTick: number, ticks: number, vertical = 0) => {
      const ecs = createEntityWorld();
      const id = spawn(ecs);
      ecs.addSystem((w) => {
        const t = w.get(id, TransformC)!;
        t.pos[0] += perTick;
        t.pos[1] += vertical;
      });
      for (let n = 0; n < ticks; n++) ecs.tick();
      return ecs.get(id, AnimatorC)!;
    };
    const still = run(0, 40);
    expect(still.walkPhase).toBe(0);
    expect(still.speed).toBe(0);
    // Three blocks slowly or quickly: the same phase, different speeds.
    const slow = run(0.05, 60),
      fast = run(0.25, 12);
    expect(slow.walkPhase).toBeCloseTo(walkPhaseStep(3, 1.5));
    expect(fast.walkPhase).toBeCloseTo(slow.walkPhase);
    expect(slow.speed).toBeCloseTo(1);
    expect(fast.speed).toBeCloseTo(5);
    // Falling straight down is not walking.
    expect(run(0, 10, -0.5).walkPhase).toBe(0);
  });
});

describe('M13a head tracking math', () => {
  it('clamps yaw to ±60° and pitch to ±40° relative to the body', () => {
    const eye: [number, number, number] = [0, 1, 0],
      yaw60 = 60 * DEG,
      pitch40 = 40 * DEG;
    // Body faces +X (yaw 0); a target 30° to the +Z side.
    const [yaw, pitch] = headLook(
      0,
      eye,
      [Math.cos(30 * DEG), 1, Math.sin(30 * DEG)],
      yaw60,
      pitch40,
    );
    expect(yaw).toBeCloseTo(30 * DEG);
    expect(pitch).toBeCloseTo(0);
    expect(headLook(0, eye, [-5, 1, 0.1], yaw60, pitch40)[0]).toBeCloseTo(yaw60);
    expect(headLook(0, eye, [-5, 1, -0.1], yaw60, pitch40)[0]).toBeCloseTo(-yaw60);
    expect(headLook(0, eye, [1, 11, 0], yaw60, pitch40)[1]).toBeCloseTo(pitch40);
    expect(headLook(0, eye, [1, -9, 0], yaw60, pitch40)[1]).toBeCloseTo(-pitch40);
    expect(headLook(0, eye, [2, 2, 0], yaw60, pitch40)[1]).toBeCloseTo(Math.atan2(1, 2));
    // Relative to a turned body, across the ±π seam.
    expect(
      headLook(170 * DEG, eye, [Math.cos(-170 * DEG), 1, Math.sin(-170 * DEG)], yaw60, pitch40)[0],
    ).toBeCloseTo(20 * DEG);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-190 * DEG)).toBeCloseTo(170 * DEG);
  });

  it('smooths the head toward the target and back to rest when the target clears', () => {
    expect(smoothToward(0, 1, 0.35)).toBeCloseTo(0.35);
    const ecs = createEntityWorld();
    const id = spawn(ecs, [0, 64, 0], 0);
    ecs.get(id, LookTargetC)!.target = [-10, 64.75, 0.01];
    const yaws: number[] = [];
    for (let n = 0; n < 30; n++) {
      ecs.tick();
      yaws.push(ecs.get(id, AnimatorC)!.headYaw);
    }
    expect(yaws[0]).toBeGreaterThan(0);
    expect(yaws[0]).toBeLessThan(60 * DEG * 0.5);
    for (let n = 1; n < yaws.length; n++) expect(yaws[n]).toBeGreaterThan(yaws[n - 1]!);
    expect(yaws.at(-1)).toBeCloseTo(60 * DEG, 3);
    ecs.get(id, LookTargetC)!.target = null;
    for (let n = 0; n < 40; n++) ecs.tick();
    expect(ecs.get(id, AnimatorC)!.headYaw).toBeCloseTo(0, 4);
  });
});

describe('M13a keyframes', () => {
  const channel = (interpolation: 'linear' | 'step'): KeyframeChannel => ({
    part: 'head',
    property: 'rotation',
    interpolation,
    keys: [
      { tick: 0, value: [0, 0, 0] },
      { tick: 4, value: [1, 2, -4] },
      { tick: 8, value: [3, 2, 0] },
    ],
  });

  it('interpolates linear channels and holds step channels, clamping outside the keys', () => {
    expect(sampleChannel(channel('linear'), 2)).toEqual([0.5, 1, -2]);
    expect(sampleChannel(channel('linear'), 6)).toEqual([2, 2, -2]);
    expect(sampleChannel(channel('linear'), 4)).toEqual([1, 2, -4]);
    expect(sampleChannel(channel('linear'), -1)).toEqual([0, 0, 0]);
    expect(sampleChannel(channel('linear'), 99)).toEqual([3, 2, 0]);
    expect(sampleChannel(channel('step'), 3.9)).toEqual([0, 0, 0]);
    expect(sampleChannel(channel('step'), 4)).toEqual([1, 2, -4]);
    expect(sampleChannel(channel('step'), 7.5)).toEqual([1, 2, -4]);
  });

  it('loops looping clips and ends one-shot clips after their length', () => {
    const loop = { length: 8, loop: true, channels: [] },
      once = { length: 8, loop: false, channels: [] };
    expect(clipTime(loop, 3.5)).toBe(3.5);
    expect(clipTime(loop, 11.5)).toBe(3.5);
    expect(clipTime(once, 8)).toBe(8);
    expect(clipTime(once, 8.5)).toBeNull();
    const ecs = createEntityWorld();
    const id = spawn(ecs);
    playClip(ecs, id, 'nod');
    expect(() => playClip(ecs, id, 'missing')).toThrow('has no clip missing');
    for (let n = 0; n < 10; n++) ecs.tick();
    expect(ecs.get(id, AnimatorC)!.clips.map((c) => c.name)).toEqual(['nod']);
    ecs.tick();
    expect(ecs.get(id, AnimatorC)!.clips).toEqual([]);
  });
});

describe('M13a hurt tint and death', () => {
  it(`tints ${HURT_TINT} red for ${HURT_TICKS} ticks after damage`, () => {
    const ecs = createEntityWorld();
    const id = spawn(ecs);
    expect(hurtTint(ecs.get(id, HealthC))).toBe(0);
    damageEntity(ecs, id, 3);
    expect(ecs.get(id, HealthC)!.current).toBe(7);
    for (let n = 0; n < HURT_TICKS; n++) {
      expect(hurtTint(ecs.get(id, HealthC))).toBe(0.4);
      ecs.tick();
    }
    expect(hurtTint(ecs.get(id, HealthC))).toBe(0);
    expect(entityState(ecs, id)).toBe('alive');
  });

  it(`tips over 90° in ${DEATH_TICKS} ticks with the red tint, then is removed`, () => {
    const ecs = createEntityWorld();
    const id = spawn(ecs),
      other = spawn(ecs, [3, 64, 0]);
    killEntity(ecs, id);
    expect(entityState(ecs, id)).toBe('dying');
    expect(entityState(ecs, other)).toBe('alive');
    expect(ecs.get(id, HealthC)!.current).toBe(0);
    expect(hurtTint(ecs.get(id, HealthC))).toBe(0.4);
    for (let n = 1; n <= DEATH_TICKS; n++) {
      ecs.tick();
      const health = ecs.get(id, HealthC)!;
      expect(tipAngle(health, 1)).toBeCloseTo((n / DEATH_TICKS) * (Math.PI / 2));
      expect(tipAngle(health, 0.5)).toBeCloseTo(((n - 0.5) / DEATH_TICKS) * (Math.PI / 2));
      expect(hurtTint(health)).toBe(0.4);
    }
    expect(ecs.exists(id)).toBe(true);
    ecs.tick();
    expect(ecs.exists(id)).toBe(false);
    expect(ecs.exists(other)).toBe(true);
    // Damage that empties health starts the same death.
    damageEntity(ecs, other, 50);
    expect(entityState(ecs, other)).toBe('dying');
    for (let n = 0; n <= DEATH_TICKS; n++) ecs.tick();
    expect(ecs.count).toBe(0);
    expect(() => killEntity(ecs, other)).toThrow(`No entity with id ${other} exists`);
  });
});

describe('M13a entity types, snapshots and EntityQuery', () => {
  it("spawns 'item:<itemId>' as one dropped item and rejects unknown types", () => {
    const world = new World(),
      items = new ItemEntityManager(world),
      ecs = createEntityWorld();
    const ctx = { ecs, items };
    const id = spawnEntity(ctx, 'item:stone', 1.5, 70, 2.5);
    const dropped = items.pool.find((e) => e.active)!;
    expect(dropped.id).toBe(id);
    expect(dropped.item.id).toBe('stone');
    expect(dropped.count).toBe(1);
    expect(ecs.count).toBe(0);
    expect(() => spawnEntity(ctx, 'item:not_an_item', 0, 70, 0)).toThrow(
      'Unknown entity type: item:not_an_item',
    );
    expect(() => spawnEntity(ctx, 'm13a_unregistered', 0, 70, 0)).toThrow(
      'Unknown entity type: m13a_unregistered',
    );
    registerEntityType('m13a_test', (c, x, y, z) => spawn(c.ecs, [x, y, z]));
    const creature = spawnEntity(ctx, 'm13a_test', 4, 70, 4);
    expect(creature).toBeGreaterThanOrEqual(ECS_FIRST_ID);
    expect(ecs.get(creature, TransformC)!.pos).toEqual([4, 70, 4]);
  });

  it('snapshots alive and dying entities and lets pressure-plate queries see only living ones', () => {
    const ecs = createEntityWorld();
    const a = spawn(ecs, [0.5, 64, 0.5]),
      b = spawn(ecs, [10.5, 64, 0.5]);
    killEntity(ecs, b);
    expect(snapshotEcsEntities(ecs, [0, 64, 0])).toEqual([
      { id: a, type: 'm13a_test', pos: [0.5, 64, 0.5], health: 10, state: 'alive' },
      { id: b, type: 'm13a_test', pos: [10.5, 64, 0.5], health: 0, state: 'dying' },
    ]);
    expect(snapshotEcsEntities(ecs, [0, 64, 0], { radius: 5 }).map((e) => e.id)).toEqual([a]);
    expect(snapshotEcsEntities(ecs, [0, 64, 0], { type: 'item' })).toEqual([]);
    const query = new EntityQuery();
    query.addProvider('ecs', () => queryEcsEntities(ecs));
    const plate = (x: number) => ({ minX: x, minY: 64, minZ: 0, maxX: x + 1, maxY: 64.2, maxZ: 1 });
    expect(query.query(plate(0)).map((e) => e.id)).toEqual([a]);
    expect(query.query(plate(10))).toEqual([]);
    const bounds = query.query(plate(0))[0]!;
    expect(bounds.minX).toBeCloseTo(0.1);
    expect(bounds.maxX).toBeCloseTo(0.9);
    expect([bounds.minY, bounds.maxY]).toEqual([64, 65]);
  });
});
