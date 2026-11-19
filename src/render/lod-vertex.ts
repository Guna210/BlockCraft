import { GLSL_SKY_ATMOSPHERE } from './sky';
import { LOD_WATER } from './lod-colors';
import { LOD_MASK_WIDTH } from './lod-plan';
import { FULL_DETAIL_RADIUS } from '../world/streaming-plan';
import { LIGHT_MIN_BRIGHTNESS } from '../world/light-curve';

const UV_AXES = ['-z', 'z', 'x', 'x', 'x', '-x'] as const;

/** Uses the face projection of the voxel mesher with one repeat per world block. */
export function lodFaceUv(face: number, x: number, y: number, z: number): [number, number] {
  const axis = UV_AXES[face];
  const u = axis === '-z' ? -z : axis === 'z' ? z : axis === '-x' ? -x : x;
  return [u, face === 2 || face === 3 ? -z : -y];
}

const uvGlsl = UV_AXES.map(
  (axis, face) =>
    `vec2(${axis.replace(/[xz]/, (letter) => `world.${letter}`)}, -world.${face === 2 || face === 3 ? 'z' : 'y'})`,
).join(', ');

export const LOD_DATA_WIDTH = 2048;

export const VS_LOD = `#version 300 es
precision highp float;
precision highp int;
uniform highp isampler2D u_quads;
uniform mat4 u_viewProj;
uniform ivec2 u_center;
uniform int u_distance;
uniform uint u_detail[${LOD_MASK_WIDTH}];
uniform ivec3 u_materials[${LOD_WATER + 1}];
uniform vec2 u_atlasSize;
uniform vec3 u_cameraPos;
uniform vec3 u_sunDir;
uniform vec3 u_factors;
uniform vec3 u_weatherLight;
uniform float u_brightness;
uniform float u_fluidTime;
flat out float v_leaf;
flat out float v_fluid;
flat out float v_flow;
out vec3 v_normal;
out vec2 v_unwrappedUV;
flat out vec2 v_tileOrigin;
out vec3 v_light;
out vec3 v_tint;
flat out float v_grassSide;
out vec3 v_worldPos;
out vec3 v_fogColor;
out float v_puddle;
const int CORNERS[6] = int[6](0, 1, 2, 0, 2, 3);
const vec3 NORMALS[6] = vec3[6](
  vec3(1,0,0), vec3(-1,0,0), vec3(0,1,0), vec3(0,-1,0), vec3(0,0,1), vec3(0,0,-1)
);
${GLSL_SKY_ATMOSPHERE}

bool drawsDetail(ivec2 p) {
  ivec2 cell = p + ${FULL_DETAIL_RADIUS};
  if (any(lessThan(cell, ivec2(0))) || any(greaterThanEqual(cell, ivec2(${LOD_MASK_WIDTH})))) return false;
  return (u_detail[cell.y] & (1u << uint(cell.x))) != 0u;
}
bool withinRange(ivec2 p) {
  return max(abs(p.x), abs(p.y)) <= u_distance;
}

void main() {
  int index = gl_VertexID / 6;
  ivec4 q = texelFetch(u_quads, ivec2(index % ${LOD_DATA_WIDTH}, index / ${LOD_DATA_WIDTH}), 0);
  ivec2 base = q.xy;
  int face = (q.w >> 10) & 7;
  int skirt = (q.w >> 19) & 3;
  vec3 normal = NORMALS[face];
  ivec2 owner = (base >> 4) - u_center;
  ivec2 adjacent = owner + ivec2(normal.xz);
  if (!withinRange(owner) || drawsDetail(owner) ||
      (skirt == 1 && withinRange(adjacent) && !drawsDetail(adjacent))) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  int c = CORNERS[gl_VertexID % 6];
  float a = c == 1 || c == 2 ? 1.0 : 0.0;
  float b = c >= 2 ? 1.0 : 0.0;
  vec2 extent = vec2(q.w & 31, (q.w >> 5) & 31);
  float bottom = float(q.z & 511);
  float top = float((q.z >> 9) & 511);
  vec2 local;
  float y;
  if (face == 2) {
    local = vec2(b, a);
    y = top;
  } else {
    local = face == 0 ? vec2(1, b) : face == 1 ? vec2(0, 1.0-b) :
            face == 4 ? vec2(1.0-b, 1) : vec2(b, 0);
    y = mix(bottom, top, a);
  }
  int surface = (q.w >> 13) & 63;
  bool water = surface == ${LOD_WATER};
  vec2 xz = vec2(base) + local * extent;
  // Translate the entire curtain inside its tile. Its face remains vertical.
  if (skirt != 0) xz -= normal.xz * 0.015625;
  if (water) {
    // Resolution changes beyond the one-block ring. Fade the tiny surface displacement
    // before the first mixed-resolution edge; the atlas animation continues at every distance.
    vec2 waterDelta = abs(xz - u_cameraPos.xz);
    float wave = 1.0 - smoothstep(220.0, 240.0, max(waterDelta.x, waterDelta.y));
    y += 0.875 + wave * 0.018 * sin(xz.x * 1.1 + u_fluidTime * 1.2) *
      cos(xz.y * 0.9 + u_fluidTime * 0.8);
  }
  vec3 world = vec3(xz.x, y, xz.y);
  v_normal = normal;
  v_worldPos = world;
  v_leaf = 0.0;
  v_fluid = water ? 1.0 : 0.0;
  v_flow = 0.0;
  v_unwrappedUV = vec2[6](${uvGlsl})[face];
  ivec3 material = u_materials[surface];
  int tile = face == 2 ? material.x : material.y & 4095;
  if (water) tile += int(mod(floor(u_fluidTime * 8.0), 32.0));
  int cells = int(u_atlasSize.x / 24.0);
  v_tileOrigin = (vec2(tile % cells, tile / cells) * 24.0 + 4.0) / u_atlasSize;
  v_tint = vec3(material.z & 255, (material.z >> 8) & 255, (material.z >> 16) & 255) / 255.0;
  v_grassSide = face != 2 && (material.y & 4096) != 0 ? 1.0 : 0.0;
  float shade = face == 2 ? 1.0 : face >= 4 ? 0.8 : 0.6;
  v_light = vec3(max(u_weatherLight.z, ${LIGHT_MIN_BRIGHTNESS.toFixed(2)}) * shade * u_brightness);
  v_puddle = face == 2 ? u_weatherLight.x : 0.0;
  vec3 fog = skyAtmosphereColor(normalize(world - u_cameraPos + vec3(0.0, 1e-5, 0.0)),
    u_sunDir, u_factors.x, u_factors.y, u_factors.z);
  float rain = u_weatherLight.x;
  if (rain > 0.001) {
    float lum = dot(fog, vec3(0.2126, 0.7152, 0.0722));
    fog = mix(fog, vec3(lum), min(0.8, 0.55 * rain)) * vec3(0.9, 0.97, 1.08) * max(0.12, 1.0 - 0.8 * rain);
  }
  v_fogColor = fog + u_weatherLight.y * 0.35;
  gl_Position = u_viewProj * vec4(world, 1.0);
}
`;
