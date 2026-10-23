import { afterEach, describe, expect, it, vi } from 'vitest';
import { mat4 } from 'gl-matrix';
import '../../src/entity/mobs';
import {
  BABY_FEED_TICKS,
  BABY_SCALE,
  GROW_UP_TICKS,
  PRIORITY,
  creatureContext,
  type CreatureDefinition,
} from '../../src/entity/mobs/creature';
import {
  TUFTBUCK,
  TUFTBUCK_DEFINITION,
  TUFTBUCK_PALETTES,
  TUFTBUCK_SHEARED_MODEL,
  TuftbuckC,
  tuftbuckModelId,
  tuftbuckWool,
} from '../../src/entity/mobs/tuftbuck';
import { ROOTBOAR, ROOTBOAR_DEFINITION, ROOTBOAR_PALETTE } from '../../src/entity/mobs/rootboar';
import {
  DAPPLEFOWL,
  DAPPLEFOWL_DEFINITION,
  DAPPLEFOWL_PALETTE,
} from '../../src/entity/mobs/dapplefowl';
import { MOSSBACK, MOSSBACK_DEFINITION, MOSSBACK_PALETTE } from '../../src/entity/mobs/mossback';
import {
  GLIMMER_MOTH,
  GLIMMER_MOTH_DEFINITION,
  GLIMMER_MOTH_PALETTE,
} from '../../src/entity/mobs/glimmer-moth';
import {
  MAX_MODEL_PARTS,
  getEntityModel,
  getEntitySkin,
  validateModel,
} from '../../src/entity/ecs/model';
import { hasEntityType } from '../../src/entity/ecs/entity-types';
import { BodyC, HealthC, RenderableC } from '../../src/entity/ecs/components';
import { killEntity } from '../../src/entity/ecs/systems';
import { computePose } from '../../src/entity/ecs/pose';
import { AgeC, AiC, LoveC, MobC } from '../../src/entity/ai/components';
import { entityAI } from '../../src/entity/ai/runtime';
import { feedMob } from '../../src/entity/ai/goals/breed';
import { interactMob } from '../../src/entity/ai/interactions';
import { EntityRenderer, type EntityRenderView } from '../../src/render/entities';
import type { GLWrapper } from '../../src/render/gl';
import type { UnderwaterView } from '../../src/render/underwater';
import { resetWorldTime } from '../../src/world/time';
import { World } from '../../src/world/world';
import { GROUND, flatWorld, run, scene, type Scene } from './helpers/m13c-mobs';

afterEach(() => resetWorldTime());

const DEFINITIONS: Record<string, CreatureDefinition> = {
  [TUFTBUCK]: TUFTBUCK_DEFINITION,
  [ROOTBOAR]: ROOTBOAR_DEFINITION,
  [DAPPLEFOWL]: DAPPLEFOWL_DEFINITION,
  [MOSSBACK]: MOSSBACK_DEFINITION,
  [GLIMMER_MOTH]: GLIMMER_MOTH_DEFINITION,
};

/** Model id → every colour its skin may use. */
const PALETTES: Record<string, string[]> = {
  ...TUFTBUCK_PALETTES,
  [ROOTBOAR]: ROOTBOAR_PALETTE,
  [DAPPLEFOWL]: DAPPLEFOWL_PALETTE,
  [MOSSBACK]: MOSSBACK_PALETTE,
  [GLIMMER_MOTH]: GLIMMER_MOTH_PALETTE,
};

function goalList(s: Scene, id: number): Array<[number, string]> {
  run(s.ecs, 1);
  const selector = s.ecs.get(id, AiC)!.selector!;
  return selector.goals.map(({ priority, goal }) => [priority, goal.name]);
}

/** Item entity counts by item id. */
function dropped(s: Scene): Record<string, number> {
  const result: Record<string, number> = {};
  for (const entity of s.items.pool)
    if (entity.active) result[entity.item.id] = (result[entity.item.id] ?? 0) + entity.count;
  return result;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
}

describe('M13e creature registration', () => {
  it('registers the five types with Appendix B health and categories', () => {
    const expected: Record<string, [number, string]> = {
      tuftbuck: [10, 'passive'],
      rootboar: [12, 'passive'],
      dapplefowl: [4, 'passive'],
      mossback: [30, 'passive'],
      glimmer_moth: [2, 'ambient'],
    };
    for (const [type, [health, category]] of Object.entries(expected)) {
      expect(hasEntityType(type)).toBe(true);
      const s = scene(flatWorld());
      const id = s.runtime.spawn(type, 0.5, GROUND, 0.5);
      expect(s.ecs.get(id, HealthC)!.current).toBe(health);
      expect(s.ecs.get(id, MobC)!.category).toBe(category);
      expect(s.ecs.get(id, AgeC)).toEqual({ baby: false, ageTicks: GROW_UP_TICKS });
    }
  });

  it('builds every model within 24 parts, with whole-texel UVs inside its skin', () => {
    for (const id of Object.keys(PALETTES)) {
      const model = getEntityModel(id);
      expect(() => validateModel(model)).not.toThrow();
      expect(model.parts.length).toBeLessThanOrEqual(MAX_MODEL_PARTS);
      for (const part of model.parts)
        for (const cube of part.cubes) {
          expect(cube.uv.every(Number.isInteger)).toBe(true);
          expect(cube.size.every(Number.isInteger)).toBe(true);
        }
    }
    // Only the Glimmer Moth glows.
    expect(Object.keys(PALETTES).filter((id) => getEntityModel(id).emissive)).toEqual([
      GLIMMER_MOTH,
    ]);
  });

  it('paints deterministic skins from their declared palettes with readable contrast', () => {
    for (const [id, palette] of Object.entries(PALETTES)) {
      const skin = getEntitySkin(id);
      const a = skin(7),
        b = skin(7);
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
      const [w, h] = getEntityModel(id).textureSize;
      expect(a.length).toBe(w * h * 4);
      const allowed = new Set(palette.map((hex) => hex.toLowerCase()));
      const used = new Set<string>();
      for (let o = 0; o < a.length; o += 4) {
        if (a[o + 3] === 0) continue;
        expect(a[o + 3]).toBe(255);
        used.add(
          '#' + ((a[o]! << 16) | (a[o + 1]! << 8) | a[o + 2]!).toString(16).padStart(6, '0'),
        );
      }
      for (const color of used) expect(allowed.has(color), `${id} uses ${color}`).toBe(true);
      const lum = [...used].map(luminance);
      expect(Math.max(...lum) - Math.min(...lum), id).toBeGreaterThanOrEqual(60);
    }
  });

  it('paints the top of every cube, and only the shorn fleece is transparent', () => {
    for (const id of Object.keys(PALETTES)) {
      const model = getEntityModel(id),
        skin = getEntitySkin(id)(1),
        [tw] = model.textureSize;
      for (const part of model.parts) {
        const shorn = id === TUFTBUCK_SHEARED_MODEL && part.name === 'fleece';
        for (const cube of part.cubes) {
          const [u, v] = cube.uv,
            [cw, , cd] = cube.size;
          // The top face of the unwrap (side faces of hanging hair have a ragged, cut-out fringe).
          for (let y = 0; y < cd; y++)
            for (let x = 0; x < cw; x++)
              expect(skin[((v + y) * tw + u + cd + x) * 4 + 3], `${id} ${part.name}`).toBe(
                shorn ? 0 : 255,
              );
        }
      }
    }
  });

  it('gives each creature its goal list with the shared priorities', () => {
    const expected: Record<string, Array<[number, string]>> = {
      tuftbuck: [
        [PRIORITY.flee, 'flee'],
        [PRIORITY.breed, 'breed'],
        [PRIORITY.followFood, 'follow_food'],
        [PRIORITY.forage, 'graze'],
        [PRIORITY.wander, 'wander'],
      ],
      rootboar: [
        [PRIORITY.flee, 'flee'],
        [PRIORITY.breed, 'breed'],
        [PRIORITY.followFood, 'follow_food'],
        [PRIORITY.forage, 'root'],
        [PRIORITY.wander, 'wander'],
      ],
      dapplefowl: [
        [PRIORITY.flee, 'flee'],
        [PRIORITY.breed, 'breed'],
        [PRIORITY.followFood, 'follow_food'],
        [PRIORITY.layEgg, 'lay_egg'],
        [PRIORITY.wander, 'wander'],
      ],
      mossback: [
        [PRIORITY.withdraw, 'withdraw'],
        [PRIORITY.wander, 'wander'],
      ],
      glimmer_moth: [[PRIORITY.flock, 'flock']],
    };
    for (const [type, goals] of Object.entries(expected)) {
      const s = scene(flatWorld());
      expect(goalList(s, s.runtime.spawn(type, 0.5, GROUND, 0.5)), type).toEqual(goals);
    }
    expect([...TUFTBUCK_DEFINITION.foods!]).toEqual(['wheat']);
    expect([...ROOTBOAR_DEFINITION.foods!]).toEqual(['tuber']);
    expect([...DAPPLEFOWL_DEFINITION.foods!]).toEqual(['seed']);
    expect(MOSSBACK_DEFINITION.foods).toBeUndefined();
    expect(GLIMMER_MOTH_DEFINITION.flying).toBe(true);
  });

  it('draws the Tuftbuck and Rootboar at 1.2×, and every creature fits through a 1-block gap', () => {
    const scales: Record<string, number> = {
      tuftbuck: 1.2,
      rootboar: 1.2,
      dapplefowl: 1,
      mossback: 1,
      glimmer_moth: 1,
    };
    for (const [type, definition] of Object.entries(DEFINITIONS)) {
      const s = scene(flatWorld());
      const id = s.runtime.spawn(type, 0.5, GROUND, 0.5);
      expect(s.ecs.get(id, RenderableC)!.scale, type).toBe(scales[type]);
      expect(s.ecs.get(id, BodyC)!.width, type).toBeLessThanOrEqual(0.95);
      expect(s.ecs.get(id, BodyC)).toEqual({ width: definition.width, height: definition.height });
    }
    expect(TUFTBUCK_DEFINITION.height).toBeCloseTo(1.35 * 1.2, 9);
    expect(ROOTBOAR_DEFINITION.height).toBeCloseTo(0.95 * 1.2, 9);
  });

  it('picks the Tuftbuck fleece by biome', () => {
    expect(tuftbuckWool('plains')).toBe('cream');
    expect(tuftbuckWool('meadow')).toBe('cream');
    expect(tuftbuckWool('pine_taiga')).toBe('umber');
    expect(tuftbuckWool('snowy_tundra')).toBe('snow');
    expect(tuftbuckWool('savanna')).toBe('tan');
    expect(tuftbuckWool('swampland')).toBe('ash');
    // A flat world is all plains.
    const world = flatWorld();
    world.worldType = 'flat';
    const s = scene(world);
    const id = s.runtime.spawn(TUFTBUCK, 0.5, GROUND, 0.5);
    expect(s.ecs.get(id, RenderableC)!.model).toBe(tuftbuckModelId('cream'));
    expect(s.ecs.get(id, TuftbuckC)!.woolModel).toBe(tuftbuckModelId('cream'));
  });
});

describe('M13e drops', () => {
  function killAndCollect(type: string, prepare?: (s: Scene, id: number) => void) {
    const s = scene(flatWorld());
    const id = s.runtime.spawn(type, 0.5, GROUND, 0.5);
    prepare?.(s, id);
    killEntity(s.ecs, id);
    run(s.ecs, 1);
    const first = dropped(s);
    run(s.ecs, 30);
    // Drops are rolled once, then the body is removed.
    expect(dropped(s)).toEqual(first);
    expect(s.ecs.exists(id)).toBe(false);
    return first;
  }

  it('drops each table through item entities', () => {
    expect(killAndCollect(TUFTBUCK)).toEqual({ wool: 1, raw_tuftbuck_shank: 1 });
    expect(
      killAndCollect(TUFTBUCK, (s, id) =>
        expect(interactMob(s.ecs, id, 'iron_shears')).toBe('wear'),
      ),
    ).toMatchObject({ raw_tuftbuck_shank: 1 });
    expect(killAndCollect(MOSSBACK)).toEqual({ shell_plate: 1 });
    expect(killAndCollect(GLIMMER_MOTH)).toEqual({});
    // Many deaths in one world draw successive rolls.
    const s = scene(flatWorld({ radius: 3 }));
    for (let n = 0; n < 40; n++) {
      killEntity(
        s.ecs,
        s.runtime.spawn(ROOTBOAR, (n % 8) * 4 - 15.5, GROUND, Math.floor(n / 8) * 4 - 15.5),
      );
      killEntity(
        s.ecs,
        s.runtime.spawn(DAPPLEFOWL, (n % 8) * 4 - 14, GROUND, Math.floor(n / 8) * 4 - 14),
      );
    }
    run(s.ecs, 1);
    const counts = (item: string) =>
      s.items.pool.filter((e) => e.active && e.item.id === item).map((e) => e.count);
    expect(counts('raw_boar_chop')).toHaveLength(40);
    expect([...new Set(counts('raw_boar_chop'))].sort()).toEqual([1, 2, 3]);
    expect(counts('raw_fowl')).toEqual(Array(40).fill(1));
    // 0 feathers spawns no item entity.
    const feathers = counts('feather');
    expect(feathers.length).toBeGreaterThan(0);
    expect(feathers.length).toBeLessThan(40);
    expect([...new Set(feathers)].sort()).toEqual([1, 2]);
  });

  it('drops nothing from a baby', () => {
    for (const type of [TUFTBUCK, ROOTBOAR, DAPPLEFOWL]) {
      const s = scene(flatWorld());
      const id = s.runtime.spawn(type, 0.5, GROUND, 0.5, { baby: true });
      killEntity(s.ecs, id);
      run(s.ecs, 2);
      expect(dropped(s), type).toEqual({});
    }
  });
});

describe('M13e babies', () => {
  it('spawns a baby at half size that cannot breed and reports baby and ageTicks', () => {
    const s = scene(flatWorld());
    const id = s.runtime.spawn(TUFTBUCK, 0.5, GROUND, 0.5, { baby: true });
    // Half of the Tuftbuck's adult 1.2× model scale and of its 0.95 × 1.62 body.
    expect(s.ecs.get(id, RenderableC)!.scale).toBe(BABY_SCALE * 1.2);
    expect(s.ecs.get(id, BodyC)).toEqual({ width: 0.475, height: 0.81 });
    expect(s.ecs.get(id, LoveC)!.baby).toBe(true);
    expect(feedMob(s.ecs, id, 'wheat')).toBe(false);
    const ai = entityAI(s.ecs, id);
    expect(ai.baby).toBe(true);
    expect(ai.ageTicks).toBe(0);
    // The pose is half the size of an adult's.
    const adult = s.runtime.spawn(TUFTBUCK, 4.5, GROUND, 0.5);
    const babyPose = new Float32Array(MAX_MODEL_PARTS * 16),
      adultPose = new Float32Array(MAX_MODEL_PARTS * 16);
    computePose(s.ecs, id, 1, babyPose);
    computePose(s.ecs, adult, 1, adultPose);
    const scaleOf = (pose: Float32Array) => Math.hypot(pose[0]!, pose[1]!, pose[2]!);
    expect(scaleOf(babyPose) / scaleOf(adultPose)).toBeCloseTo(BABY_SCALE);
  });

  it('grows up after 24000 ticks', () => {
    const s = scene(flatWorld());
    // Penned in, so it cannot wander off the loaded columns (where it would freeze).
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        if (dx || dz) s.world.fill(dx, GROUND, dz, dx, GROUND + 1, dz, 'stone');
    const id = s.runtime.spawn(ROOTBOAR, 0.5, GROUND, 0.5, { baby: true });
    run(s.ecs, GROW_UP_TICKS - 1);
    expect(entityAI(s.ecs, id).baby).toBe(true);
    run(s.ecs, 1);
    expect(entityAI(s.ecs, id)).toMatchObject({ baby: false, ageTicks: GROW_UP_TICKS });
    expect(s.ecs.get(id, RenderableC)!.scale).toBe(1.2);
    expect(s.ecs.get(id, BodyC)).toEqual({ width: 0.95, height: 1.14 });
    expect(feedMob(s.ecs, id, 'tuber')).toBe(true);
  });

  it('grows 10 % of the total faster for each feeding with its food', () => {
    const s = scene(flatWorld());
    const id = s.runtime.spawn(TUFTBUCK, 0.5, GROUND, 0.5, { baby: true });
    expect(interactMob(s.ecs, id, 'seed')).toBeNull();
    expect(interactMob(s.ecs, id, 'wheat')).toBe('consume');
    expect(entityAI(s.ecs, id).ageTicks).toBe(BABY_FEED_TICKS);
    // Shears do nothing to a baby.
    expect(interactMob(s.ecs, id, 'iron_shears')).toBeNull();
    for (let n = 0; n < 8; n++) interactMob(s.ecs, id, 'wheat');
    expect(entityAI(s.ecs, id).ageTicks).toBe(9 * BABY_FEED_TICKS);
    run(s.ecs, BABY_FEED_TICKS - 1);
    expect(entityAI(s.ecs, id).baby).toBe(true);
    run(s.ecs, 1);
    expect(entityAI(s.ecs, id).baby).toBe(false);
    // An adult's food is a breeding item again, not a growth one.
    expect(interactMob(s.ecs, id, 'wheat')).toBeNull();
  });

  it('breeds two Tuftbucks fed wheat 5 blocks apart into a baby within 100 ticks', () => {
    const s = scene(flatWorld(), [0.5, GROUND, 10.5]);
    const a = s.runtime.spawn(TUFTBUCK, 0.5, GROUND, 0.5),
      b = s.runtime.spawn(TUFTBUCK, 5.5, GROUND, 0.5);
    expect(feedMob(s.ecs, a, 'wheat')).toBe(true);
    expect(feedMob(s.ecs, b, 'wheat')).toBe(true);
    let baby: number | null = null,
      ticks = 0;
    while (baby === null && ticks < 100) {
      run(s.ecs, 1);
      ticks++;
      baby =
        s.ecs.query(TuftbuckC).find((id) => id !== a && id !== b && entityAI(s.ecs, id).baby) ??
        null;
    }
    expect(baby).not.toBeNull();
    expect(ticks).toBeLessThan(100);
    expect(s.ecs.get(baby!, RenderableC)!.scale).toBe(BABY_SCALE * 1.2);
  });
});

describe('M13e performance', () => {
  it('installs nothing on an ECS world until the first creature spawns', () => {
    const s = scene(flatWorld());
    expect(creatureContext(s.ecs)).toBeUndefined();
    s.runtime.spawn(DAPPLEFOWL, 0.5, GROUND, 0.5);
    expect(creatureContext(s.ecs)).toBeDefined();
  });

  it('renders 30 creatures with one draw call each, the moths full-bright', () => {
    const calls: Record<string, ReturnType<typeof vi.fn>> = {};
    const gl = new Proxy(calls, {
      get: (obj, key) => {
        const name = String(key);
        if (/^[A-Z_0-9]+$/.test(name)) return 1;
        return (obj[name] ??= vi.fn(() => ({})));
      },
    });
    const draw = vi.fn();
    const wrapper = {
      gl,
      createProgram: vi.fn(() => ({})),
      createBuffer: vi.fn(() => ({})),
      createVertexArray: vi.fn(() => ({})),
      createTexture: vi.fn(() => ({})),
      drawArrays: draw,
    } as unknown as GLWrapper;
    const view: EntityRenderView = {
      viewProj: mat4.create(),
      atlasTexture: null,
      eye: [0, 70, 0],
      alpha: 1,
      skyBrightness: 1,
      underwater: {
        submerged: false,
        fogColor: [0, 0, 0],
        brightnessFloor: 0,
      } as unknown as UnderwaterView,
      sunDir: [0, 1, 0],
      day: 1,
      twilight: 0,
      night: 0,
      fogStart: 80,
      fogEnd: 112,
    };
    // A world with no light at all: everything is dark except what glows.
    const s = scene(new World());
    const types = Object.keys(DEFINITIONS);
    for (let n = 0; n < 30; n++)
      s.runtime.spawn(
        types[n % types.length]!,
        (n % 6) * 2 + 0.5,
        GROUND,
        Math.floor(n / 6) * 2 + 0.5,
        {
          baby: n % 7 === 0,
        },
      );
    const renderer = new EntityRenderer(wrapper);
    for (let frame = 0; frame < 3; frame++) {
      draw.mockClear();
      expect(renderer.render(s.ecs, s.world, view)).toBe(30);
      expect(draw).toHaveBeenCalledTimes(30);
    }
    // Back-face culling is on for the entities only: the passes after them draw both faces.
    const toggles = [
      ...calls.enable!.mock.invocationCallOrder.map((order) => [order, 'on'] as const),
      ...calls.disable!.mock.invocationCallOrder.map((order) => [order, 'off'] as const),
    ].sort((a, b) => a[0] - b[0]);
    expect(toggles.at(-1)![1]).toBe('off');
    expect(calls.disable!.mock.calls.at(-1)).toEqual([1]);
    const lightLocation = (() => {
      const index = calls.getUniformLocation!.mock.calls.findIndex((call) => call[1] === 'u_light');
      return calls.getUniformLocation!.mock.results[index]!.value;
    })();
    const lights = calls
      .uniform3f!.mock.calls.filter((call) => call[0] === lightLocation)
      .slice(-30)
      .map((call) => call[1] as number);
    const ids = s.ecs.query(RenderableC);
    ids.forEach((id, n) => {
      const glows = s.ecs.get(id, RenderableC)!.model === GLIMMER_MOTH;
      expect(lights[n]).toBeCloseTo(glows ? 1 : 0.04, 5);
    });
  });
});
