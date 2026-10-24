import { describe, expect, it, vi } from 'vitest';
import { mat4 } from 'gl-matrix';
import '../../src/entity/mobs';
import '../../src/entity/projectiles';
import { getEntityModel } from '../../src/entity/ecs/model';
import { createEntityWorld, spawnModelEntity } from '../../src/entity/ecs/systems';
import {
  EntityRenderer,
  bakeEntityModel,
  ENTITY_VERTEX_FLOATS,
  type EntityRenderView,
} from '../../src/render/entities';
import type { GLWrapper } from '../../src/render/gl';
import { UnderwaterView } from '../../src/render/underwater';
import { World } from '../../src/world/world';
import { CINDER_MODEL } from '../../src/entity/mobs/cinderwraith';

const EXISTING = [
  'tuftbuck_cream',
  'tuftbuck_umber',
  'tuftbuck_snow',
  'tuftbuck_tan',
  'tuftbuck_ash',
  'tuftbuck_sheared',
  'rootboar',
  'dapplefowl',
  'mossback',
  'glimmer_moth',
  'hollow',
  'thornling',
  'skitterer',
  'sporeburst',
  'sporeburst_flash',
  'spore_cloud',
  'projectile_arrow',
  'projectile_thorn',
];

describe('M13h selective emission regression', () => {
  it('gives only the eye vertices emission, and every existing model a zero emission attribute', () => {
    for (const name of [...EXISTING, 'cinderwraith']) {
      const model = getEntityModel(name);
      const data = bakeEntityModel(model);
      let offset = 0;
      for (const part of model.parts) {
        const expected = name === 'cinderwraith' && part.name === 'eyes' ? 1 : 0;
        for (let vertex = 0; vertex < part.cubes.length * 36; vertex++) {
          expect(data[offset + 8]).toBe(model.parts.indexOf(part));
          expect(data[offset + 9], `${name}:${part.name}`).toBe(expected);
          offset += ENTITY_VERTEX_FLOATS;
        }
      }
    }
    expect(CINDER_MODEL.emissive).toBeUndefined();
  });
  it('submits exactly one draw per entity, retaining existing lighting including the full-bright moth', () => {
    const calls: Record<string, ReturnType<typeof vi.fn>> = {};
    const gl = new Proxy(calls, {
      get: (obj, key) => {
        const name = String(key);
        if (/^[A-Z_0-9]+$/.test(name)) return 1;
        return (obj[name] ??= vi.fn(() => ({})));
      },
    });
    const draw = vi.fn();
    const program = vi.fn((_vertex: string, _fragment: string) => ({}));
    const wrapper = {
      gl,
      createProgram: program,
      createBuffer: vi.fn(() => ({})),
      createVertexArray: vi.fn(() => ({})),
      createTexture: vi.fn(() => ({})),
      drawArrays: draw,
    } as unknown as GLWrapper;
    const renderer = new EntityRenderer(wrapper);
    const ecs = createEntityWorld();
    const types = [...EXISTING, 'cinderwraith'];
    for (const name of types)
      spawnModelEntity(ecs, {
        type: name,
        model: name,
        pos: [0.5, 64, 0.5],
        health: 30,
        width: 0.95,
        height: 1.75,
      });
    const view: EntityRenderView = {
      viewProj: mat4.create(),
      atlasTexture: null,
      eye: [0, 65, 5],
      alpha: 1,
      skyBrightness: 0.1,
      underwater: new UnderwaterView(),
      sunDir: [0, 1, 0],
      day: 0,
      twilight: 0,
      night: 1,
      fogStart: 80,
      fogEnd: 112,
    };
    expect(renderer.render(ecs, new World(), view)).toBe(types.length);
    expect(draw).toHaveBeenCalledTimes(types.length);
    const lightIndex = calls.getUniformLocation!.mock.calls.findIndex(
      (call) => call[1] === 'u_light',
    );
    const lightLocation = calls.getUniformLocation!.mock.results[lightIndex]!.value;
    const lights = calls.uniform3f!.mock.calls.filter((call) => call[0] === lightLocation);
    types.forEach((name, index) => {
      expect(lights[index]!.slice(1), name).toEqual(
        name === 'glimmer_moth' ? [1, 1, 1] : [0.04, 0.04, 0.04],
      );
    });
    const fragment = String(program.mock.calls[0]![1]);
    // Zero part emission preserves the legacy world-light × face-shade result; eyes select 1.
    expect(fragment).toContain('mix(u_light * v_shade, vec3(1.0), v_emissive)');
  });
});
