import { describe, it, expect, vi } from 'vitest';
import { mat4, vec3 } from 'gl-matrix';
import {
  EntityRenderer,
  ENTITY_VERTEX_FLOATS,
  bakeEntityModel,
  entityLight,
  type EntityRenderView,
} from '../../src/render/entities';
import { registerEntityModel, type EntityModel } from '../../src/entity/ecs/model';
import {
  createEntityWorld,
  damageEntity,
  killEntity,
  playClip,
  spawnModelEntity,
} from '../../src/entity/ecs/systems';
import { LookTargetC, TransformC } from '../../src/entity/ecs/components';
import { computePose } from '../../src/entity/ecs/pose';
import { walkSwing } from '../../src/entity/ecs/animation';
import { lightBrightness } from '../../src/render/light-curve';
import { World } from '../../src/world/world';
import type { EntityWorld } from '../../src/entity/ecs/world';
import type { GLWrapper } from '../../src/render/gl';
import type { UnderwaterView } from '../../src/render/underwater';

const DEG = Math.PI / 180;

/** Test-only models; real creature models come from M13e and M13f. */
const BIPED: EntityModel = {
  id: 'm13a_test_biped',
  textureSize: [64, 32],
  parts: [
    {
      name: 'body',
      pivot: [0, 12, 0],
      cubes: [{ from: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16] }],
    },
    {
      name: 'head',
      parent: 'body',
      pivot: [0, 24, 0],
      cubes: [{ from: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0], inflate: 0.5 }],
    },
    {
      name: 'nose',
      parent: 'head',
      pivot: [0, 26, 4],
      cubes: [{ from: [-1, 26, 4], size: [2, 2, 2], uv: [32, 0] }],
    },
    {
      name: 'leg_r',
      pivot: [-2, 12, 0],
      cubes: [{ from: [-4, 0, -2], size: [4, 12, 4], uv: [0, 16] }],
    },
    {
      name: 'leg_l',
      pivot: [2, 12, 0],
      cubes: [{ from: [0, 0, -2], size: [4, 12, 4], uv: [0, 16] }],
    },
  ],
  walk: { maxSwing: 45 * DEG, refSpeed: 4, stride: 2, limbs: { leg_r: 0, leg_l: Math.PI } },
  head: { part: 'head' },
  clips: {
    turn: {
      length: 4,
      loop: true,
      channels: [
        {
          part: 'body',
          property: 'rotation',
          interpolation: 'step',
          keys: [{ tick: 0, value: [0, Math.PI / 2, 0] }],
        },
      ],
    },
  },
};
const CUBE: EntityModel = {
  id: 'm13a_test_cube',
  textureSize: [32, 16],
  parts: [
    { name: 'box', pivot: [0, 0, 0], cubes: [{ from: [-4, 0, -4], size: [8, 8, 8], uv: [0, 0] }] },
  ],
};
function skin(width: number, height: number) {
  return () => {
    const pixels = new Uint8Array(width * height * 4);
    for (let n = 0; n < pixels.length; n += 4) pixels.set([150, 110, 80, 255], n);
    return pixels;
  };
}
registerEntityModel(BIPED, skin(64, 32));
registerEntityModel(CUBE, skin(32, 16));

function spawn(ecs: EntityWorld, model: EntityModel, pos: [number, number, number], yaw = 0) {
  return spawnModelEntity(ecs, {
    type: model.id,
    model: model.id,
    pos,
    yaw,
    health: 10,
    width: 0.6,
    height: 2,
  });
}

const pose = new Float32Array(24 * 16);
function partMatrix(index: number): mat4 {
  return mat4.clone(pose.subarray(index * 16, index * 16 + 16) as unknown as mat4);
}
function apply(index: number, point: [number, number, number]): vec3 {
  return vec3.transformMat4(vec3.create(), point, partMatrix(index));
}
function direction(index: number, dir: [number, number, number]): vec3 {
  const m = partMatrix(index);
  m[12] = m[13] = m[14] = 0;
  return vec3.normalize(vec3.create(), vec3.transformMat4(vec3.create(), dir, m));
}

describe('M13a baked box models', () => {
  it('bakes every cube into one outward-facing triangle list with UVs on the skin', () => {
    const data = bakeEntityModel(BIPED);
    expect(data.length).toBe(5 * 36 * ENTITY_VERTEX_FLOATS);
    for (let v = 0; v < data.length; v += ENTITY_VERTEX_FLOATS * 3) {
      const at = (k: number, axis: number) => data[v + k * ENTITY_VERTEX_FLOATS + axis]!;
      const e1 = [0, 1, 2].map((a) => at(1, a) - at(0, a)),
        e2 = [0, 1, 2].map((a) => at(2, a) - at(0, a));
      const cross = [
        e1[1]! * e2[2]! - e1[2]! * e2[1]!,
        e1[2]! * e2[0]! - e1[0]! * e2[2]!,
        e1[0]! * e2[1]! - e1[1]! * e2[0]!,
      ];
      // Counter-clockwise from outside: the winding normal agrees with the stored face normal.
      expect(cross[0]! * at(0, 5) + cross[1]! * at(0, 6) + cross[2]! * at(0, 7)).toBeGreaterThan(0);
      for (let k = 0; k < 3; k++) {
        expect(at(k, 3)).toBeGreaterThanOrEqual(0);
        expect(at(k, 3)).toBeLessThanOrEqual(1);
        expect(at(k, 4)).toBeGreaterThanOrEqual(0);
        expect(at(k, 4)).toBeLessThanOrEqual(1);
      }
    }
    // The inflated head grows 0.5 px on each side; its vertices carry part index 1.
    const head = data.subarray(36 * ENTITY_VERTEX_FLOATS, 72 * ENTITY_VERTEX_FLOATS);
    const xs = [],
      parts = new Set<number>();
    for (let v = 0; v < head.length; v += ENTITY_VERTEX_FLOATS) {
      xs.push(head[v]!);
      parts.add(head[v + 8]!);
    }
    expect(Math.min(...xs)).toBe(-4.5);
    expect(Math.max(...xs)).toBe(4.5);
    expect([...parts]).toEqual([1]);
  });
});

describe('M13a pose: hierarchy, procedural animation, death and interpolation', () => {
  it('keeps entities without pitch on the existing yaw and translation transform', () => {
    const ecs = createEntityWorld();
    const yaw = 0.4;
    const id = spawn(ecs, CUBE, [2, 5, 7], yaw);
    const rotateX = vi.spyOn(mat4, 'rotateX');
    let rotateXCalls: number;
    let actual: mat4;
    try {
      computePose(ecs, id, 1, pose);
      rotateXCalls = rotateX.mock.calls.length;
      actual = mat4.clone(pose.subarray(0, 16) as unknown as mat4);
    } finally {
      rotateX.mockRestore();
    }

    // The one remaining X rotation is the cube part's rest transform. No root pitch rotation is
    // applied to entities whose TransformC has never had a pitch field.
    expect(rotateXCalls).toBe(1);
    const expected = mat4.create();
    mat4.fromTranslation(expected, [2, 5, 7]);
    mat4.rotateY(expected, expected, Math.PI / 2 - yaw);
    mat4.scale(expected, expected, [1 / 16, 1 / 16, 1 / 16]);
    expect(Array.from(actual!)).toEqual(Array.from(expected));
  });

  it('places model pixels in the world facing the entity yaw', () => {
    const ecs = createEntityWorld();
    // Yaw 0 faces world +X, the camera's convention.
    const id = spawn(ecs, BIPED, [10.5, 64, 3.5], 0);
    expect(computePose(ecs, id, 1, pose)).toBe(5);
    const front = apply(0, [0, 16, 16]);
    expect([...front].map((n) => +n.toFixed(5))).toEqual([11.5, 65, 3.5]);
    // Model -X is the entity's right-hand side: world +Z when facing +X.
    const right = apply(0, [-16, 0, 0]);
    expect([...right].map((n) => +n.toFixed(5))).toEqual([10.5, 64, 4.5]);
  });

  it('moves children with their parents', () => {
    const ecs = createEntityWorld();
    const id = spawn(ecs, BIPED, [0, 64, 0], Math.PI / 2);
    computePose(ecs, id, 1, pose);
    const restNose = apply(2, [0, 27, 6]);
    playClip(ecs, id, 'turn');
    ecs.tick();
    computePose(ecs, id, 1, pose);
    // The body turns 90° about its pivot; head and nose follow without their own rotation.
    const nose = apply(2, [0, 27, 6]);
    expect([...nose]).toEqual([...apply(0, [0, 27, 6])]);
    expect(vec3.distance(nose, restNose)).toBeGreaterThan(0.3);
    expect(nose[0]).toBeCloseTo(6 / 16);
    expect(nose[2]).toBeCloseTo(0);
    expect(nose[1]).toBeCloseTo(64 + 27 / 16);
  });

  it('swings opposite legs by the walk formula as the entity moves', () => {
    const ecs = createEntityWorld();
    // Yaw π/2 faces world +Z, so model and world axes line up.
    const id = spawn(ecs, BIPED, [0, 64, 0], Math.PI / 2);
    ecs.addSystem((w) => (w.get(id, TransformC)!.pos[2] += 0.1));
    for (let n = 0; n < 5; n++) ecs.tick();
    computePose(ecs, id, 1, pose);
    // 0.5 blocks of a 2-block stride is a quarter cycle; 2 blocks/s is half of refSpeed.
    const swing = walkSwing(45 * DEG, Math.PI / 2, 2, 4);
    expect(swing).toBeCloseTo(22.5 * DEG);
    const right = apply(3, [-2, 0, 0]),
      left = apply(4, [2, 0, 0]);
    expect((right[2] - 0.5) * 16).toBeCloseTo(-12 * Math.sin(swing));
    expect((left[2] - 0.5) * 16).toBeCloseTo(12 * Math.sin(swing));
    expect((right[1] - 64) * 16).toBeCloseTo(12 - 12 * Math.cos(swing));
  });

  it('turns the head toward the look target within ±60°', () => {
    const ecs = createEntityWorld();
    const id = spawn(ecs, BIPED, [0, 64, 0], 0);
    // Target straight to the entity's right (world +Z): 90° asked, 60° allowed.
    ecs.get(id, LookTargetC)!.target = [0, 64 + 24 / 16, 10];
    for (let n = 0; n < 40; n++) ecs.tick();
    computePose(ecs, id, 1, pose);
    const look = direction(1, [0, 0, 1]);
    expect(look[0]).toBeCloseTo(Math.cos(60 * DEG), 3);
    expect(look[2]).toBeCloseTo(Math.sin(60 * DEG), 3);
    expect(look[1]).toBeCloseTo(0, 3);
    // The body still faces +X.
    const body = direction(0, [0, 0, 1]);
    expect(body[0]).toBeCloseTo(1);
    // Looking up at a high target pitches the head up by at most 40°.
    ecs.get(id, LookTargetC)!.target = [3, 80, 0];
    for (let n = 0; n < 40; n++) ecs.tick();
    computePose(ecs, id, 1, pose);
    const up = direction(1, [0, 0, 1]);
    expect(Math.asin(up[1])).toBeCloseTo(40 * DEG, 3);
  });

  it('tips the body over 90° around its forward axis while dying', () => {
    const ecs = createEntityWorld();
    const id = spawn(ecs, BIPED, [0, 64, 0], 0);
    killEntity(ecs, id);
    for (let n = 0; n < 10; n++) ecs.tick();
    computePose(ecs, id, 1, pose);
    expect(Math.acos(direction(0, [0, 1, 0])[1])).toBeCloseTo(45 * DEG);
    for (let n = 0; n < 10; n++) ecs.tick();
    computePose(ecs, id, 1, pose);
    const up = direction(0, [0, 1, 0]);
    expect(up[1]).toBeCloseTo(0);
    // The forward axis (world +X) is the rotation axis, so the body falls sideways.
    expect(up[0]).toBeCloseTo(0);
    expect(Math.abs(up[2])).toBeCloseTo(1);
    expect(direction(0, [0, 0, 1])[0]).toBeCloseTo(1);
  });

  it('interpolates position and yaw with the partial tick', () => {
    const ecs = createEntityWorld();
    const id = spawn(ecs, CUBE, [0, 64, 0], 0);
    ecs.addSystem((w) => {
      const t = w.get(id, TransformC)!;
      t.pos[0] += 1;
      t.yaw += Math.PI / 2;
    });
    ecs.tick();
    computePose(ecs, id, 0.25, pose);
    expect(apply(0, [0, 0, 0])[0]).toBeCloseTo(0.25);
    const forward = direction(0, [0, 0, 1]);
    expect(Math.atan2(forward[2], forward[0])).toBeCloseTo(Math.PI / 8);
  });
});

describe('M13a world-sampled entity light', () => {
  /** The terrain shader's light before AO and face shade, from the same curve. */
  const terrainLight = (sky: number, block: number, skyBrightness: number) =>
    Math.max(lightBrightness(sky) * skyBrightness, lightBrightness(block));

  function worldWith(sky: number, block: number) {
    const world = new World();
    for (const engine of [world.lightEngine, ...world.lightEngine.rgbChannels]) {
      engine.storage.setSkyLight(0, 4, 0, 1, 0, 1, sky);
      engine.storage.setBlockLight(0, 4, 0, 1, 0, 1, block);
    }
    return world;
  }

  it('matches the terrain curve at the block containing the entity centre', () => {
    const out: [number, number, number] = [0, 0, 0];
    // A dark cave: no sky, no block light, at noon. As dark as the cave walls.
    entityLight(worldWith(0, 0), 1.5, 64.5, 1.5, 1, 0, out);
    expect(out).toEqual([terrainLight(0, 0, 1), terrainLight(0, 0, 1), terrainLight(0, 0, 1)]);
    expect(out[0]).toBeCloseTo(0.04);
    // Open sky at dusk: the sky multiplier applies.
    entityLight(worldWith(15, 0), 1.5, 64.5, 1.5, 0.4, 0, out);
    expect(out[0]).toBeCloseTo(terrainLight(15, 0, 0.4));
    // A torch-lit cave at night.
    entityLight(worldWith(0, 12), 1.5, 64.5, 1.5, 0.1, 0, out);
    expect(out[1]).toBeCloseTo(terrainLight(0, 12, 0.1));
    // The block next door is unlit.
    entityLight(worldWith(15, 15), 2.5, 64.5, 1.5, 1, 0, out);
    expect(out[0]).toBeCloseTo(0.04);
  });
});

describe('M13a entity renderer', () => {
  function mockGl() {
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
    return { calls, draw, wrapper };
  }
  const view = (eye: [number, number, number] = [0, 70, 0]): EntityRenderView => ({
    viewProj: mat4.create(),
    atlasTexture: null,
    eye,
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
  });

  it('draws 100 entities with one draw call each and bakes each model once', () => {
    const { calls, draw, wrapper } = mockGl();
    const renderer = new EntityRenderer(wrapper),
      ecs = createEntityWorld(),
      world = new World();
    for (let n = 0; n < 100; n++)
      spawn(ecs, n % 3 ? BIPED : CUBE, [(n % 10) * 2, 64, Math.floor(n / 10) * 2], n * 0.1);
    for (let frame = 0; frame < 3; frame++) {
      draw.mockClear();
      expect(renderer.render(ecs, world, view())).toBe(100);
      expect(draw).toHaveBeenCalledTimes(100);
      expect(renderer.draws).toBe(100);
    }
    const bipeds = 66,
      cubes = 34;
    expect(renderer.triangles).toBe(bipeds * 5 * 12 + cubes * 12);
    expect(new Set(draw.mock.calls.map((call) => call[2]))).toEqual(new Set([5 * 36, 36]));
    // Two models: two static buffers and two skins, created on first use only.
    expect(calls.bufferData).toHaveBeenCalledTimes(2);
    expect(calls.texImage2D).toHaveBeenCalledTimes(2);
    // Each draw uploads its own part matrices: 16 floats per part.
    const partUploads = calls.uniformMatrix4fv!.mock.calls.filter((call) => call.length === 5);
    expect(partUploads.slice(-100).map((call) => call[4])).toEqual(
      Array.from({ length: 100 }, (_, n) => (n % 3 ? 5 : 1) * 16),
    );
    // Entities beyond the fog are skipped.
    expect(renderer.render(ecs, world, view([5000, 70, 0]))).toBe(0);
  });

  it('passes world light and the hurt tint per entity', () => {
    const { calls, wrapper } = mockGl();
    const renderer = new EntityRenderer(wrapper),
      ecs = createEntityWorld(),
      world = new World();
    for (const engine of [world.lightEngine, ...world.lightEngine.rgbChannels])
      engine.storage.setSkyLight(0, 4, 0, 1, 1, 1, 15);
    // Centre at y 65 (feet 64, height 2): the lit block (1, 65, 1).
    const lit = spawn(ecs, CUBE, [1.5, 64, 1.5]),
      dark = spawn(ecs, CUBE, [4.5, 64, 1.5]);
    damageEntity(ecs, dark, 1);
    renderer.render(ecs, world, view());
    const location = (name: string) => {
      const index = calls.getUniformLocation!.mock.calls.findIndex((call) => call[1] === name);
      return calls.getUniformLocation!.mock.results[index]!.value;
    };
    const lights = calls.uniform3f!.mock.calls.filter((call) => call[0] === location('u_light'));
    expect(lights.map((call) => call[1])).toEqual([expect.closeTo(1, 5), expect.closeTo(0.04, 5)]);
    const tints = calls.uniform1f!.mock.calls.filter((call) => call[0] === location('u_hurt'));
    expect(tints.map((call) => call[1])).toEqual([0, 0.4]);
    expect(lit).toBeLessThan(dark);
  });
});
