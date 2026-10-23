import type { mat4 } from 'gl-matrix';
import type { GLWrapper } from './gl';
import type { UnderwaterView } from './underwater';
import type { World } from '../world/world';
import type { EntityWorld } from '../entity/ecs/world';
import { GLSL_SKY_ATMOSPHERE } from './sky';
import { LIGHT_MIN_BRIGHTNESS, lightBrightness } from './light-curve';
import {
  MAX_MODEL_PARTS,
  cubeFaceRects,
  getEntityModel,
  getEntitySkin,
  type EntityModel,
  type FaceName,
} from '../entity/ecs/model';
import { BodyC, HealthC, RenderableC, TransformC } from '../entity/ecs/components';
import { computePose, hurtTint } from '../entity/ecs/pose';

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_pos;
layout(location=1) in vec2 a_uv;
layout(location=2) in vec3 a_normal;
layout(location=3) in float a_part;
uniform mat4 u_parts[${MAX_MODEL_PARTS}];
uniform mat4 u_viewProj;
out vec2 v_uv;
out float v_shade;
out vec3 v_worldPos;
void main() {
  mat4 part = u_parts[int(a_part + 0.5)];
  vec4 world = part * vec4(a_pos, 1.0);
  vec3 n = normalize(mat3(part) * a_normal);
  // The terrain's face shading (top 1, z sides 0.8, x sides 0.6, bottom 0.5), blended for turned parts.
  float side = mix(0.6, 0.8, abs(n.z) / max(abs(n.x) + abs(n.z), 1e-4));
  v_shade = n.y >= 0.0 ? mix(side, 1.0, n.y) : mix(side, 0.5, -n.y);
  v_uv = a_uv;
  v_worldPos = world.xyz;
  gl_Position = u_viewProj * world;
}`;
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in float v_shade;
in vec3 v_worldPos;
uniform sampler2D u_skin;
uniform vec3 u_light;
uniform float u_hurt;
uniform vec3 u_eye;
uniform vec3 u_sunDir;
uniform float u_dayFactor;
uniform float u_twilightFactor;
uniform float u_nightFactor;
uniform float u_fogStart;
uniform float u_fogEnd;
uniform bool u_underwater;
uniform vec3 u_waterFogColor;
out vec4 fragColor;
${GLSL_SKY_ATMOSPHERE}
void main() {
  vec4 tex = texture(u_skin, v_uv);
  if (tex.a < 0.5) discard;
  vec3 color = mix(tex.rgb, vec3(1.0, 0.0, 0.0), u_hurt) * u_light * v_shade;
  vec3 delta = v_worldPos - u_eye;
  float distance = u_underwater ? length(delta) : length(delta.xz);
  float fog = smoothstep(u_fogStart, u_fogEnd, distance);
  vec3 fogColor = u_underwater ? u_waterFogColor : skyAtmosphereColor(normalize(delta + vec3(0.0, 1e-5, 0.0)), u_sunDir, u_dayFactor, u_twilightFactor, u_nightFactor);
  fragColor = vec4(mix(color, fogColor, fog), 1.0);
}`;

/** Floats per baked vertex: position (3), uv (2), normal (3), part index (1). */
export const ENTITY_VERTEX_FLOATS = 9;

// Corners per face, seen from outside: 0 bottom-left, 1 top-left, 2 top-right, 3 bottom-right of its UV rect.
const FACE_CORNERS: Record<FaceName, { normal: [number, number, number]; corners: number[][] }> = {
  right: {
    normal: [-1, 0, 0],
    corners: [
      [0, 0, 0],
      [0, 1, 0],
      [0, 1, 1],
      [0, 0, 1],
    ],
  },
  front: {
    normal: [0, 0, 1],
    corners: [
      [0, 0, 1],
      [0, 1, 1],
      [1, 1, 1],
      [1, 0, 1],
    ],
  },
  left: {
    normal: [1, 0, 0],
    corners: [
      [1, 0, 1],
      [1, 1, 1],
      [1, 1, 0],
      [1, 0, 0],
    ],
  },
  back: {
    normal: [0, 0, -1],
    corners: [
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 0],
    ],
  },
  top: {
    normal: [0, 1, 0],
    corners: [
      [0, 1, 1],
      [0, 1, 0],
      [1, 1, 0],
      [1, 1, 1],
    ],
  },
  bottom: {
    normal: [0, -1, 0],
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [1, 0, 1],
      [1, 0, 0],
    ],
  },
};
const TRIANGLES = [0, 1, 2, 0, 2, 3];
const REVERSED = [0, 2, 1, 0, 3, 2];
/** Counter-clockwise triangle order seen from outside, so back-face culling keeps the outer faces. */
const ORDER = Object.fromEntries(
  (Object.keys(FACE_CORNERS) as FaceName[]).map((face) => {
    const { normal, corners } = FACE_CORNERS[face];
    const [a, b, c] = [corners[0]!, corners[1]!, corners[2]!];
    const e1 = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!],
      e2 = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
    const cross = [
      e1[1]! * e2[2]! - e1[2]! * e2[1]!,
      e1[2]! * e2[0]! - e1[0]! * e2[2]!,
      e1[0]! * e2[1]! - e1[1]! * e2[0]!,
    ];
    const facing = cross[0]! * normal[0] + cross[1]! * normal[1] + cross[2]! * normal[2];
    return [face, facing > 0 ? TRIANGLES : REVERSED];
  }),
) as Record<FaceName, number[]>;

/** Bakes every cube of every part into one triangle list; vertices carry their part index. */
export function bakeEntityModel(model: EntityModel): Float32Array {
  let cubes = 0;
  for (const part of model.parts) cubes += part.cubes.length;
  const data = new Float32Array(cubes * 36 * ENTITY_VERTEX_FLOATS);
  const [tw, th] = model.textureSize;
  let n = 0;
  model.parts.forEach((part, partIndex) => {
    for (const cube of part.cubes) {
      const grow = cube.inflate ?? 0,
        rects = cubeFaceRects(cube);
      for (const face of Object.keys(FACE_CORNERS) as FaceName[]) {
        const { normal, corners } = FACE_CORNERS[face],
          [u, v, w, h] = rects[face];
        for (const corner of ORDER[face]) {
          const c = corners[corner]!;
          for (let axis = 0; axis < 3; axis++)
            data[n++] = cube.from[axis]! - grow + c[axis]! * (cube.size[axis]! + 2 * grow);
          data[n++] = (u + (corner >= 2 ? w : 0)) / tw;
          data[n++] = (v + (corner === 1 || corner === 2 ? 0 : h)) / th;
          data[n++] = normal[0];
          data[n++] = normal[1];
          data[n++] = normal[2];
          data[n++] = partIndex;
        }
      }
    }
  });
  return data;
}

/**
 * Light at the block containing a point, on the terrain's curve: max(sky curve · sky multiplier,
 * block curve per channel), never below `floor`.
 */
export function entityLight(
  world: World,
  x: number,
  y: number,
  z: number,
  skyBrightness: number,
  floor: number,
  out: [number, number, number],
): [number, number, number] {
  const bx = Math.floor(x),
    by = Math.floor(y),
    bz = Math.floor(z);
  const sky = world.lightEngine.getLight(bx, by, bz).sky;
  const block =
    by < 0 || by > 319 ? { r: 0, g: 0, b: 0 } : world.lightEngine.getBlockLightRGB(bx, by, bz);
  const skyLight = Math.max(lightBrightness(sky) * skyBrightness, LIGHT_MIN_BRIGHTNESS);
  out[0] = Math.max(skyLight, lightBrightness(block.r), floor);
  out[1] = Math.max(skyLight, lightBrightness(block.g), floor);
  out[2] = Math.max(skyLight, lightBrightness(block.b), floor);
  return out;
}

interface ModelResources {
  vao: WebGLVertexArrayObject;
  buffer: WebGLBuffer;
  texture: WebGLTexture;
  vertices: number;
  emissive: boolean;
}

export interface EntityRenderView {
  viewProj: mat4;
  /** Bound back on texture unit 0 afterwards; the terrain passes that follow expect it there. */
  atlasTexture: WebGLTexture | null;
  eye: ArrayLike<number>;
  alpha: number;
  skyBrightness: number;
  underwater: UnderwaterView;
  sunDir: readonly [number, number, number];
  day: number;
  twilight: number;
  night: number;
  fogStart: number;
  fogEnd: number;
}

const UNIFORMS = [
  'parts',
  'viewProj',
  'skin',
  'light',
  'hurt',
  'eye',
  'sunDir',
  'dayFactor',
  'twilightFactor',
  'nightFactor',
  'fogStart',
  'fogEnd',
  'underwater',
  'waterFogColor',
] as const;

/**
 * Box-model entities: each model is baked once into one vertex buffer with its own skin texture,
 * and each entity is one draw call whose part matrices come from a uniform array.
 */
export class EntityRenderer {
  private readonly program: WebGLProgram;
  private readonly loc: Record<(typeof UNIFORMS)[number], WebGLUniformLocation>;
  private readonly models = new Map<string, ModelResources>();
  private readonly pose = new Float32Array(MAX_MODEL_PARTS * 16);
  private readonly light: [number, number, number] = [0, 0, 0];
  private disposed = false;
  /** Draw calls and triangles of the latest render(). */
  draws = 0;
  triangles = 0;
  constructor(private readonly wrapper: GLWrapper) {
    const gl = wrapper.gl;
    this.program = wrapper.createProgram(VS, FS);
    this.loc = Object.fromEntries(
      UNIFORMS.map((name) => [
        name,
        gl.getUniformLocation(this.program, name === 'parts' ? 'u_parts[0]' : `u_${name}`)!,
      ]),
    ) as Record<(typeof UNIFORMS)[number], WebGLUniformLocation>;
  }

  private resources(id: string): ModelResources {
    const existing = this.models.get(id);
    if (existing) return existing;
    const gl = this.wrapper.gl,
      model = getEntityModel(id),
      data = bakeEntityModel(model);
    const vao = this.wrapper.createVertexArray(),
      buffer = this.wrapper.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const stride = ENTITY_VERTEX_FLOATS * 4;
    [3, 2, 3, 1].reduce((offset, size, attr) => {
      gl.enableVertexAttribArray(attr);
      gl.vertexAttribPointer(attr, size, gl.FLOAT, false, stride, offset * 4);
      return offset + size;
    }, 0);
    gl.bindVertexArray(null);
    const texture = this.wrapper.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      model.textureSize[0],
      model.textureSize[1],
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      getEntitySkin(id)(1),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    const resources = {
      vao,
      buffer,
      texture,
      vertices: data.length / ENTITY_VERTEX_FLOATS,
      emissive: model.emissive === true,
    };
    this.models.set(id, resources);
    return resources;
  }

  render(ecs: EntityWorld | null, world: World | null, view: EntityRenderView): number {
    this.draws = this.triangles = 0;
    if (this.disposed || !ecs || !world) return 0;
    const ids = ecs.query(RenderableC, TransformC);
    if (!ids.length) return 0;
    const gl = this.wrapper.gl,
      loc = this.loc,
      underwater = view.underwater,
      cull = view.fogEnd + 4;
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(loc.viewProj, false, view.viewProj);
    gl.uniform1i(loc.skin, 0);
    gl.uniform3f(loc.eye, view.eye[0]!, view.eye[1]!, view.eye[2]!);
    gl.uniform3fv(loc.sunDir, view.sunDir);
    gl.uniform1f(loc.dayFactor, view.day);
    gl.uniform1f(loc.twilightFactor, view.twilight);
    gl.uniform1f(loc.nightFactor, view.night);
    gl.uniform1f(loc.fogStart, view.fogStart);
    gl.uniform1f(loc.fogEnd, view.fogEnd);
    gl.uniform1i(loc.underwater, underwater.submerged ? 1 : 0);
    gl.uniform3fv(loc.waterFogColor, underwater.fogColor);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    let bound = '';
    for (const id of ids) {
      const t = ecs.get(id, TransformC)!,
        alpha = view.alpha;
      const x = t.previous[0] + (t.pos[0] - t.previous[0]) * alpha,
        y = t.previous[1] + (t.pos[1] - t.previous[1]) * alpha,
        z = t.previous[2] + (t.pos[2] - t.previous[2]) * alpha;
      if (Math.hypot(x - view.eye[0]!, z - view.eye[2]!) > cull) continue;
      const modelId = ecs.get(id, RenderableC)!.model,
        resources = this.resources(modelId);
      if (modelId !== bound) {
        gl.bindVertexArray(resources.vao);
        gl.bindTexture(gl.TEXTURE_2D, resources.texture);
        bound = modelId;
      }
      const parts = computePose(ecs, id, alpha, this.pose);
      gl.uniformMatrix4fv(loc.parts, false, this.pose, 0, parts * 16);
      if (resources.emissive) gl.uniform3f(loc.light, 1, 1, 1);
      else {
        const centre = y + (ecs.get(id, BodyC)?.height ?? 1) / 2;
        entityLight(
          world,
          x,
          centre,
          z,
          view.skyBrightness,
          underwater.brightnessFloor,
          this.light,
        );
        gl.uniform3f(loc.light, this.light[0], this.light[1], this.light[2]);
      }
      gl.uniform1f(loc.hurt, hurtTint(ecs.get(id, HealthC)));
      this.wrapper.drawArrays(gl.TRIANGLES, 0, resources.vertices);
      this.draws++;
      this.triangles += resources.vertices / 3;
    }
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, view.atlasTexture);
    // The passes after this one (particles, translucent terrain, weather) draw both faces.
    gl.disable(gl.CULL_FACE);
    return this.draws;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const resources of this.models.values()) {
      this.wrapper.deleteTexture(resources.texture);
      this.wrapper.deleteBuffer(resources.buffer);
      this.wrapper.deleteVertexArray(resources.vao);
    }
    this.models.clear();
    this.wrapper.deleteProgram(this.program);
  }
}
