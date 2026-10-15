import { WALL_TORCH_GLSL } from '../mesh/wall-torch';
import type { UnderwaterView } from './underwater';
import { canonicalQuadVertices, quadIndices } from './shared-quads';
import { VERTEX_LAYOUT } from '../mesh/vertex';
import {
  LIGHT_MIN_BRIGHTNESS,
  LIGHT_BRIGHTNESS_RANGE,
  AO_UNOCCLUDED,
  AO_STEP,
} from './light-curve';
import { mat4 } from 'gl-matrix';
import { GLWrapper } from './gl';
import { TextureAtlas, CELL_SIZE } from './atlas';
import { SectionMeshData, MeshBucketData } from '../mesh/greedy';
import { renderStats } from '../debug/api/core';
import { wireframeEnabled } from '../debug/api/wireframe';
import { ColumnTintCache } from './tint-cache';
import { mergeMeshBuckets } from '../mesh/models';
import { columnInFrustum, sectionInFrustum, extractFrustumPlanes } from './frustum';
import { bayerGlsl } from './dither';
import { ColumnFades, UniformValueCache } from './column-fade';
import { GLSL_SKY_ATMOSPHERE } from './sky';

const VS_CHUNK = `#version 300 es
precision highp float;
layout(location = 0) in uint a_word0;
layout(location = 1) in uint a_word1;
uniform mat4 u_viewProj;
uniform vec3 u_sectionOrigin;
uniform vec2 u_atlasSize;
uniform float u_cellSize;
uniform float u_skyBrightness;
uniform bool u_debugLight;
uniform float u_underwaterFloor;
uniform sampler2D u_grassTintMap;
uniform sampler2D u_foliageTintMap;
uniform vec3 u_cameraPos;
uniform float u_fogStart;
uniform float u_fogEnd;
uniform vec3 u_sunDir;
uniform float u_dayFactor;
uniform float u_twilightFactor;
uniform float u_nightFactor;
uniform float u_rainFactor;
uniform float u_lightningFlash;
out vec2 v_unwrappedUV;
flat out vec2 v_tileOrigin;
out vec3 v_light;
out vec3 v_tint;
flat out float v_grassSide;
out vec3 v_worldPos;
out vec3 v_fogColor;
out float v_puddle;
const vec3 NORMALS[6] = vec3[6](
  vec3(1.0, 0.0, 0.0), vec3(-1.0, 0.0, 0.0),
  vec3(0.0, 1.0, 0.0), vec3(0.0, -1.0, 0.0),
  vec3(0.0, 0.0, 1.0), vec3(0.0, 0.0, -1.0)
);
${GLSL_SKY_ATMOSPHERE}
#ifdef WALL_TORCH
${WALL_TORCH_GLSL}
#endif
void main() {
  vec3 localPos = vec3(float(a_word0 & 31u), float((a_word0 >> 5u) & 31u), float((a_word0 >> 10u) & 31u));
  localPos.y += float((a_word1 >> ${VERTEX_LAYOUT.halfYShift}u) & 1u) * 0.5;
  vec3 worldPos = u_sectionOrigin + localPos;
  #ifdef WALL_TORCH
  uint normalIdx=(a_word0 >> 15u) & 7u;
  bool wallTorch=normalIdx>=6u;
  if(wallTorch) worldPos += wallTorchOffset(float((a_word1 >> ${VERTEX_LAYOUT.uShift}u)&31u),float((a_word1 >> ${VERTEX_LAYOUT.vShift}u)&31u),normalIdx-6u,(a_word0>>28u)&15u);
  vec3 normal = wallTorch ? vec3(0.0,1.0,0.0) : NORMALS[normalIdx];
  #else
  vec3 normal = NORMALS[(a_word0 >> 15u) & 7u];
  #endif
  worldPos += normal * float((a_word1 >> ${VERTEX_LAYOUT.wallInsetShift}u) & 1u) / 32.0;
  float faceShade = normal.y > 0.5 ? 1.0 : (normal.y < -0.5 ? 0.5 : (abs(normal.z) > 0.5 ? 0.8 : 0.6));
  float ao = ${AO_UNOCCLUDED.toFixed(2)} - ${AO_STEP.toFixed(2)} * float((a_word0 >> 18u) & 3u);
  float sky = ${LIGHT_MIN_BRIGHTNESS.toFixed(2)} + ${LIGHT_BRIGHTNESS_RANGE.toFixed(2)} * float((a_word0 >> 20u) & 15u) / 15.0;
#ifdef SKY_ONLY
  vec3 light = vec3(max(sky * u_skyBrightness, ${LIGHT_MIN_BRIGHTNESS.toFixed(2)}));
#else
  vec3 rgb = vec3(float((a_word0 >> 24u) & 15u), float((a_word1 >> ${VERTEX_LAYOUT.greenShift}u) & 15u), float((a_word1 >> ${VERTEX_LAYOUT.blueShift}u) & 15u));
  vec3 brightness = ${LIGHT_MIN_BRIGHTNESS.toFixed(2)} + ${LIGHT_BRIGHTNESS_RANGE.toFixed(2)} * rgb / 15.0;
  vec3 light = max(vec3(sky * u_skyBrightness), brightness);
#endif
  v_light = (u_debugLight ? vec3(1.0) : max(light, vec3(u_underwaterFloor))) * ao * faceShade;
  #ifdef WALL_TORCH
  uint tintIdx = wallTorch ? 0u : (a_word0 >> 28u) & 15u;
  #else
  uint tintIdx = (a_word0 >> 28u) & 15u;
  #endif
  // Clamp to this column's edge texel: vertices at x/z=16 still belong to this column.
  ivec2 tintTexel = ivec2(clamp(floor(localPos.xz - 0.5 * normal.xz), vec2(0.0), vec2(15.0)));
  v_tint = vec3(1.0);
  if (tintIdx == 1u || tintIdx == 3u) v_tint = texelFetch(u_grassTintMap, tintTexel, 0).rgb;
  else if (tintIdx == 2u) v_tint = texelFetch(u_foliageTintMap, tintTexel, 0).rgb;
  v_grassSide = tintIdx == 3u ? 1.0 : 0.0;
  uint tileIdx = a_word1 & ${VERTEX_LAYOUT.tileMask}u;
  uint cellsPerRow = uint(u_atlasSize.x / u_cellSize);
  v_tileOrigin = (vec2(float(tileIdx % cellsPerRow), float(tileIdx / cellsPerRow)) * u_cellSize + 4.0) / u_atlasSize;
  v_unwrappedUV = vec2(float((a_word1 >> ${VERTEX_LAYOUT.uShift}u) & ${VERTEX_LAYOUT.uvMask}u), float((a_word1 >> ${VERTEX_LAYOUT.vShift}u) & ${VERTEX_LAYOUT.uvMask}u));
  // Puddle darkening on outdoor top faces while raining (Decision 3)
  float isTopFace = normal.y > 0.5 ? 1.0 : 0.0;
  float isOutdoor = ((a_word0 >> 20u) & 15u) >= 14u ? 1.0 : 0.0;
  v_puddle = isTopFace * isOutdoor * u_rainFactor;

  vec3 toVertex = worldPos - u_cameraPos;
  v_worldPos = worldPos;
  // Always supply the colour: a large quad can cross fogStart between vertices.
  vec3 viewDir = normalize(toVertex + vec3(0.0, 1e-5, 0.0));
  vec3 fogCol = skyAtmosphereColor(viewDir, u_sunDir, u_dayFactor, u_twilightFactor, u_nightFactor);
  if (u_rainFactor > 0.001) {
    float lum = dot(fogCol, vec3(0.2126, 0.7152, 0.0722));
    fogCol = mix(fogCol, vec3(lum), 0.55 * u_rainFactor) * mix(1.0, 0.45, u_rainFactor);
  }
  if (u_lightningFlash > 0.001) {
    fogCol += vec3(u_lightningFlash * 0.9);
  }
  v_fogColor = fogCol;
  gl_Position = u_viewProj * vec4(worldPos, 1.0);
}
`;

const FS_CHUNK = `#version 300 es
precision highp float;
in vec2 v_unwrappedUV;
flat in vec2 v_tileOrigin;
in vec3 v_light;
in vec3 v_tint;
flat in float v_grassSide;
in vec3 v_worldPos;
in vec3 v_fogColor;
in float v_puddle;
uniform vec3 u_cameraPos;
uniform float u_fogStart;
uniform float u_fogEnd;
uniform sampler2D u_atlasSampler;
uniform vec2 u_atlasSize;
uniform bool u_underwater;
uniform vec3 u_waterFogColor;
uniform int u_isCutout;
uniform int u_isWireframe;
uniform float u_fade;
const float BAYER_4X4[16] = ${bayerGlsl()};
out vec4 fragColor;
void main() {
  if (u_fade < 1.0) {
    ivec2 pixel = ivec2(gl_FragCoord.xy);
    if (BAYER_4X4[(pixel.y & 3) * 4 + (pixel.x & 3)] >= u_fade) discard;
  }
  if (u_isWireframe == 1) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec2 tileSize = vec2(16.0) / u_atlasSize;
  vec2 halfTexel = vec2(0.5) / u_atlasSize;
  vec2 tileUV = clamp(v_tileOrigin + fract(v_unwrappedUV) * tileSize, v_tileOrigin + halfTexel, v_tileOrigin + tileSize - halfTexel);
  vec4 texColor = textureGrad(u_atlasSampler, tileUV, dFdx(v_unwrappedUV) * tileSize, dFdy(v_unwrappedUV) * tileSize);
  if (u_isCutout == 1 && texColor.a < 0.5) discard;
  // Grass side alpha selects the tinted fringe; its dirt base stays untinted and opaque.
  vec3 tint = mix(v_tint, mix(vec3(1.0), v_tint, texColor.a), v_grassSide);
  vec3 litColor = texColor.rgb * tint * v_light;
  if (v_puddle > 0.001) {
    litColor *= (1.0 - 0.22 * v_puddle);
  }
  float horizDist = u_underwater ? length(v_worldPos - u_cameraPos) : length((v_worldPos - u_cameraPos).xz);
  float fogFactor = u_fogEnd > u_fogStart ? smoothstep(u_fogStart, u_fogEnd, horizDist) : 0.0;
  vec3 finalColor = mix(litColor, u_underwater ? u_waterFogColor : v_fogColor, fogFactor);
  fragColor = vec4(finalColor, mix(texColor.a, 1.0, v_grassSide));
}
`;

// Texture units 0, 1 and 2 hold the atlas and the grass and foliage tint maps while drawing.
const SCRATCH_TEXTURE_UNIT = 3;

export interface GPUBucketMesh {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  ebo: WebGLBuffer;
  lineEbo: WebGLBuffer | null;
  indexCount: number;
  lineIndexCount: number;
}

export interface GPUSectionMesh {
  hasBlockLight: boolean;
  hasWallTorch: boolean;
  key: string;
  sx: number;
  sy: number;
  sz: number;
  opaque: GPUBucketMesh | null;
  cutout: GPUBucketMesh | null;
  translucent: GPUBucketMesh | null;
}

export class ChunkRenderer {
  private sharedEbo: WebGLBuffer | null = null;
  private sharedQuadCapacity = 0;
  private glWrapper: GLWrapper;
  private program: WebGLProgram;
  private programs: WebGLProgram[];
  private programLocations: Array<Record<string, WebGLUniformLocation>>;

  private locViewProj: WebGLUniformLocation;
  private locSectionOrigin: WebGLUniformLocation;
  private locAtlasSampler: WebGLUniformLocation;
  private locAtlasSize: WebGLUniformLocation;
  private locCellSize: WebGLUniformLocation;
  private locIsCutout: WebGLUniformLocation;
  private locIsWireframe: WebGLUniformLocation;
  private locGrassTintMap: WebGLUniformLocation;
  private locFoliageTintMap: WebGLUniformLocation;
  private locFade: WebGLUniformLocation;
  private locSkyBrightness: WebGLUniformLocation;
  private locDebugLight: WebGLUniformLocation;
  private locCameraPos: WebGLUniformLocation;
  private locFogStart: WebGLUniformLocation;
  private locFogEnd: WebGLUniformLocation;
  private locSunDir: WebGLUniformLocation;
  private locDayFactor: WebGLUniformLocation;
  private locTwilightFactor: WebGLUniformLocation;
  private locUnderwaterFloor: WebGLUniformLocation;
  private locUnderwater: WebGLUniformLocation;
  private locWaterFogColor: WebGLUniformLocation;
  private underwater: UnderwaterView | null = null;
  private locNightFactor: WebGLUniformLocation;
  private locRainFactor: WebGLUniformLocation;
  private locLightningFlash: WebGLUniformLocation;
  private rainFactor = 0;
  private lightningFlash = 0;
  private skyBrightness = 1;
  private debugLight = false;
  private cameraPos: [number, number, number] = [0, 0, 0];
  private fogStart = 0;
  private fogEnd = 0;
  private sunDir: [number, number, number] = [
    0,
    Math.cos((15 * Math.PI) / 180),
    Math.sin((15 * Math.PI) / 180),
  ];
  private dayFactor = 1;
  private twilightFactor = 0;
  private nightFactor = 0;
  // The fade value last written to u_fade: a column whose fade is unchanged (finished) is not written again.
  private fadeUniform: UniformValueCache;

  private tintCache: ColumnTintCache;
  private sectionMeshes: Map<string, GPUSectionMesh> = new Map();
  // The same meshes grouped by column ("sx,sz"), so one frustum test covers a whole column and the
  // draws of a column are adjacent (one tint texture bind per column).
  private columnMeshes: Map<string, GPUSectionMesh[]> = new Map();
  // Fade-in of each column that has section meshes (decisions/M04b-fade-and-memory.md).
  private fades = new ColumnFades();
  private frustumPlanes = new Float64Array(24);

  // Per-frame scratch state of render(), kept as fields so the draw loop allocates nothing.
  private visColumns: GPUSectionMesh[][] = [];
  private visGrass: WebGLTexture[] = [];
  private visFoliage: WebGLTexture[] = [];
  private visFade: number[] = [];
  private boundGrass: WebGLTexture | null = null;
  private boundFoliage: WebGLTexture | null = null;
  private activeUnit = 0;
  private passDraws = 0;
  private passTriangles = 0;

  /** The section meshes drawn by the latest render() call: nonempty sections inside the frustum. */
  public lastVisible: GPUSectionMesh[] = [];

  constructor(glWrapper: GLWrapper) {
    this.glWrapper = glWrapper;
    this.program = this.glWrapper.createProgram(VS_CHUNK, FS_CHUNK);
    const skyOnly = (source: string) =>
      source.replace('#version 300 es', '#version 300 es\n#define SKY_ONLY');
    const wallTorch = (source: string) =>
      source.replace('#version 300 es', '#version 300 es\n#define WALL_TORCH');
    this.programs = [
      this.program,
      this.glWrapper.createProgram(skyOnly(VS_CHUNK), skyOnly(FS_CHUNK)),
      this.glWrapper.createProgram(wallTorch(VS_CHUNK), FS_CHUNK),
      this.glWrapper.createProgram(skyOnly(wallTorch(VS_CHUNK)), skyOnly(FS_CHUNK)),
    ];
    this.tintCache = new ColumnTintCache(glWrapper);

    const gl = this.glWrapper.gl;
    this.locViewProj = gl.getUniformLocation(this.program, 'u_viewProj')!;
    this.locSectionOrigin = gl.getUniformLocation(this.program, 'u_sectionOrigin')!;
    this.locAtlasSampler = gl.getUniformLocation(this.program, 'u_atlasSampler')!;
    this.locGrassTintMap = gl.getUniformLocation(this.program, 'u_grassTintMap')!;
    this.locFoliageTintMap = gl.getUniformLocation(this.program, 'u_foliageTintMap')!;
    this.locAtlasSize = gl.getUniformLocation(this.program, 'u_atlasSize')!;
    this.locCellSize = gl.getUniformLocation(this.program, 'u_cellSize')!;
    this.locIsCutout = gl.getUniformLocation(this.program, 'u_isCutout')!;
    this.locIsWireframe = gl.getUniformLocation(this.program, 'u_isWireframe')!;
    this.locSkyBrightness = gl.getUniformLocation(this.program, 'u_skyBrightness')!;
    this.locDebugLight = gl.getUniformLocation(this.program, 'u_debugLight')!;
    this.locFade = gl.getUniformLocation(this.program, 'u_fade')!;
    this.locCameraPos = gl.getUniformLocation(this.program, 'u_cameraPos')!;
    this.locFogStart = gl.getUniformLocation(this.program, 'u_fogStart')!;
    this.locFogEnd = gl.getUniformLocation(this.program, 'u_fogEnd')!;
    this.locSunDir = gl.getUniformLocation(this.program, 'u_sunDir')!;
    this.locDayFactor = gl.getUniformLocation(this.program, 'u_dayFactor')!;
    this.locTwilightFactor = gl.getUniformLocation(this.program, 'u_twilightFactor')!;
    this.locNightFactor = gl.getUniformLocation(this.program, 'u_nightFactor')!;
    this.locUnderwater = gl.getUniformLocation(this.program, 'u_underwater')!;
    this.locUnderwaterFloor = gl.getUniformLocation(this.program, 'u_underwaterFloor')!;
    this.locWaterFogColor = gl.getUniformLocation(this.program, 'u_waterFogColor')!;
    this.locRainFactor = gl.getUniformLocation(this.program, 'u_rainFactor')!;
    this.locLightningFlash = gl.getUniformLocation(this.program, 'u_lightningFlash')!;
    const fields = [
      'locViewProj',
      'locSectionOrigin',
      'locAtlasSampler',
      'locGrassTintMap',
      'locFoliageTintMap',
      'locAtlasSize',
      'locCellSize',
      'locIsCutout',
      'locIsWireframe',
      'locSkyBrightness',
      'locDebugLight',
      'locFade',
      'locCameraPos',
      'locFogStart',
      'locFogEnd',
      'locSunDir',
      'locDayFactor',
      'locTwilightFactor',
      'locNightFactor',
      'locUnderwater',
      'locUnderwaterFloor',
      'locWaterFogColor',
      'locRainFactor',
      'locLightningFlash',
    ];
    this.programLocations = this.programs.map((program) =>
      Object.fromEntries(
        fields.map((field) => [
          field,
          gl.getUniformLocation(program, `u_${field[3]!.toLowerCase()}${field.slice(4)}`)!,
        ]),
      ),
    );
    this.fadeUniform = new UniformValueCache((value) => gl.uniform1f(this.locFade, value));
  }

  public setSkyBrightness(brightness: number): void {
    this.skyBrightness = Math.max(0, Math.min(1, brightness));
  }

  public setAtmosphere(params: {
    cameraPos: ArrayLike<number>;
    fogStart: number;
    fogEnd: number;
    sunDir: readonly [number, number, number];
    dayFactor: number;
    twilightFactor: number;
    nightFactor: number;
    underwater?: UnderwaterView;
    rainFactor?: number;
    lightningFlash?: number;
  }): void {
    this.cameraPos[0] = params.cameraPos[0] ?? 0;
    this.cameraPos[1] = params.cameraPos[1] ?? 0;
    this.cameraPos[2] = params.cameraPos[2] ?? 0;
    this.fogStart = params.fogStart;
    this.fogEnd = params.fogEnd;
    this.sunDir[0] = params.sunDir[0];
    this.sunDir[1] = params.sunDir[1];
    this.sunDir[2] = params.sunDir[2];
    this.dayFactor = params.dayFactor;
    this.twilightFactor = params.twilightFactor;
    this.nightFactor = params.nightFactor;
    this.underwater = params.underwater ?? null;
    this.rainFactor = params.rainFactor ?? 0;
    this.lightningFlash = params.lightningFlash ?? 0;
  }
  public setDebugLight(on: boolean): void {
    this.debugLight = on;
  }

  /**
   * Uploads one section mesh. `fadeFromMs` is the time the column's fade-in starts when this upload
   * makes the column visible (its first section mesh), or null to show it at once. A column that
   * already has section meshes is not faded again by a re-mesh.
   */
  public uploadSectionMesh(
    sx: number,
    sy: number,
    sz: number,
    meshData: SectionMeshData,
    fadeFromMs: number | null = null,
  ): GPUSectionMesh {
    const key = `${sx},${sy},${sz}`;
    const colKey = `${sx},${sz}`;
    const hadSections = (this.columnMeshes.get(colKey)?.length ?? 0) > 0;
    this.removeSectionMesh(key);

    const opaque = this.createGPUBucketMesh(meshData.opaque);
    // Plants (cross models) are drawn in the cutout pass, in the same draw call as the leaves
    const cutout = this.createGPUBucketMesh(mergeMeshBuckets(meshData.cutout, meshData.models));
    const translucent = this.createGPUBucketMesh(meshData.translucent);

    let hasWallTorch = false;
    for (let i = 0; i < meshData.models.vertices.length; i += 2) {
      if (((meshData.models.vertices[i]! >>> 15) & 7) >= 6) {
        hasWallTorch = true;
        break;
      }
    }
    const gpuMesh: GPUSectionMesh = {
      hasWallTorch,
      hasBlockLight: meshData.hasBlockLight ?? true,
      key,
      sx,
      sy,
      sz,
      opaque,
      cutout,
      translucent,
    };

    // Light storage and skirts never create geometry. Empty worker results replace old meshes,
    // but do not enter draw/visibility lists or own tint textures.
    if (!opaque && !cutout && !translucent) return gpuMesh;
    this.tintCache.onSectionAdded(sx, sy, sz);
    this.sectionMeshes.set(key, gpuMesh);
    const list = this.columnMeshes.get(colKey);
    if (list) list.push(gpuMesh);
    else this.columnMeshes.set(colKey, [gpuMesh]);
    this.fades.onUpload(sx, sz, hadSections, fadeFromMs);
    return gpuMesh;
  }

  public removeSectionMesh(key: string): void {
    const existing = this.sectionMeshes.get(key);
    if (!existing) return;

    this.tintCache.onSectionRemoved(existing.sx, existing.sy, existing.sz);

    this.freeGPUBucketMesh(existing.opaque);
    this.freeGPUBucketMesh(existing.cutout);
    this.freeGPUBucketMesh(existing.translucent);

    this.sectionMeshes.delete(key);
    const colKey = `${existing.sx},${existing.sz}`;
    const list = this.columnMeshes.get(colKey);
    if (list) {
      const i = list.indexOf(existing);
      if (i >= 0) list.splice(i, 1);
      if (list.length === 0) this.columnMeshes.delete(colKey);
    }
  }

  /** One GPU section per streaming free step; retain the column until the final step. */
  public removeColumnMeshStep(cx: number, cz: number): boolean {
    const key = `${cx},${cz}`;
    const first = this.columnMeshes.get(key)?.[0];
    if (first) this.removeSectionMesh(first.key);
    const done = !this.columnMeshes.has(key);
    if (done) this.fades.onEmptied(cx, cz);
    return done;
  }

  /** Deletes every GPU resource of the section meshes of one column. */
  public removeColumnMeshes(cx: number, cz: number): void {
    const list = this.columnMeshes.get(`${cx},${cz}`);
    if (!list) return;
    for (const mesh of Array.from(list)) this.removeSectionMesh(mesh.key);
    this.fades.onEmptied(cx, cz);
  }

  /**
   * Deletes the section meshes of one column whose keys ("sx,sy,sz") are not in `keep`. Returns whether
   * the column still has section meshes.
   */
  public removeColumnMeshesExcept(cx: number, cz: number, keep: ReadonlySet<string>): boolean {
    const list = this.columnMeshes.get(`${cx},${cz}`);
    if (!list) return false;
    for (const mesh of Array.from(list)) {
      if (!keep.has(mesh.key)) this.removeSectionMesh(mesh.key);
    }
    const remains = this.columnMeshes.has(`${cx},${cz}`);
    if (!remains) this.fades.onEmptied(cx, cz);
    return remains;
  }

  /** Columns whose fade-in has not finished at `nowMs` (see column-fade.ts). */
  public fadingColumns(nowMs: number): number {
    return this.fades.fadingColumns(nowMs);
  }

  /**
   * Creates the column's tint textures now, as part of its upload, instead of in the first frame that
   * draws it. The textures are created on the scratch unit (see render()).
   */
  public prepareColumnTints(
    cx: number,
    cz: number,
    world: import('../world/world').World | null,
  ): void {
    const gl = this.glWrapper.gl;
    gl.activeTexture(gl.TEXTURE0 + SCRATCH_TEXTURE_UNIT);
    this.tintCache.getColumnTints(cx, cz, world);
  }

  /** Number of section meshes on the GPU. */
  public get sectionMeshCount(): number {
    return this.sectionMeshes.size;
  }

  public clearAllMeshes(): void {
    for (const key of Array.from(this.sectionMeshes.keys())) {
      this.removeSectionMesh(key);
    }
    this.columnMeshes.clear();
    this.fades.clear();
    this.lastVisible.length = 0;
    this.tintCache.clearAll();
    if (this.sharedEbo) this.glWrapper.deleteBuffer(this.sharedEbo);
    this.sharedEbo = null;
    this.sharedQuadCapacity = 0;
  }

  private createGPUBucketMesh(bucket: MeshBucketData): GPUBucketMesh | null {
    if (bucket.quadCount === 0 || bucket.vertices.length === 0) {
      return null;
    }

    const gl = this.glWrapper.gl;
    const vao = this.glWrapper.createVertexArray();
    const vbo = this.glWrapper.createBuffer();
    if (!this.sharedEbo) this.sharedEbo = this.glWrapper.createBuffer();
    const ebo = this.sharedEbo;

    gl.bindVertexArray(vao);

    // VBO (packed 2xuint32 per vertex)
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, canonicalQuadVertices(bucket), gl.STATIC_DRAW);

    // Stride = 8 bytes (2 uint32s)
    const stride = 8;

    // Attribute 0: word0 (1 unsigned int)
    gl.enableVertexAttribArray(0);
    gl.vertexAttribIPointer(0, 1, gl.UNSIGNED_INT, stride, 0);

    // Attribute 1: word1 (1 unsigned int)
    gl.enableVertexAttribArray(1);
    gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_INT, stride, 4);

    // EBO (Triangles: 6 Uint32 indices per quad)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
    if (bucket.quadCount > this.sharedQuadCapacity) {
      this.sharedQuadCapacity = 2 ** Math.ceil(Math.log2(bucket.quadCount));
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, quadIndices(this.sharedQuadCapacity), gl.STATIC_DRAW);
    }

    gl.bindVertexArray(null);

    return {
      vao,
      vbo,
      ebo,
      lineEbo: null,
      indexCount: bucket.indices.length,
      lineIndexCount: bucket.quadCount * 8,
    };
  }

  /** Debug outlines are uploaded only when requested, rather than for every streamed mesh. */
  private wireframeBuffer(bucket: GPUBucketMesh): WebGLBuffer {
    if (bucket.lineEbo) return bucket.lineEbo;
    const gl = this.glWrapper.gl;
    const lineIndices = new Uint32Array(bucket.lineIndexCount);
    for (let q = 0; q < bucket.lineIndexCount / 8; q++) {
      const base = q * 4;
      const o = q * 8;
      lineIndices[o] = base;
      lineIndices[o + 1] = base + 1;
      lineIndices[o + 2] = base + 1;
      lineIndices[o + 3] = base + 2;
      lineIndices[o + 4] = base + 2;
      lineIndices[o + 5] = base + 3;
      lineIndices[o + 6] = base + 3;
      lineIndices[o + 7] = base;
    }

    const lineEbo = this.glWrapper.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lineEbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, lineIndices, gl.STATIC_DRAW);
    bucket.lineEbo = lineEbo;
    return lineEbo;
  }

  private freeGPUBucketMesh(bucketMesh: GPUBucketMesh | null): void {
    if (!bucketMesh) return;
    this.glWrapper.deleteVertexArray(bucketMesh.vao);
    this.glWrapper.deleteBuffer(bucketMesh.vbo);
    // Triangle EBO belongs to the renderer and is shared by all section VAOs.
    if (bucketMesh.lineEbo) this.glWrapper.deleteBuffer(bucketMesh.lineEbo);
  }

  /** Draws one pass (0 opaque, 1 cutout, 2 translucent) over the visible columns gathered by render(). */
  private drawPass(pass: number, skyOnly: boolean, wallTorch = false): void {
    const gl = this.glWrapper.gl;
    const columns = this.visColumns;
    for (let c = 0; c < columns.length; c++) {
      const list = columns[c]!;
      let tintsBound = false;
      for (let i = 0; i < list.length; i++) {
        const mesh = list[i]!;
        if (mesh.hasBlockLight === skyOnly || Boolean(mesh.hasWallTorch) !== wallTorch) continue;
        const bucket = pass === 0 ? mesh.opaque : pass === 1 ? mesh.cutout : mesh.translucent;
        if (!bucket) continue;
        if (!tintsBound) {
          tintsBound = true;
          // One fade value per column, set before the column's first draw of this pass.
          this.fadeUniform.set(this.visFade[c]!);
          // Only a texture that differs from the one already bound is bound again.
          const grass = this.visGrass[c]!;
          if (grass !== this.boundGrass) {
            if (this.activeUnit !== 1) gl.activeTexture(gl.TEXTURE1);
            this.activeUnit = 1;
            gl.bindTexture(gl.TEXTURE_2D, grass);
            this.boundGrass = grass;
          }
          const foliage = this.visFoliage[c]!;
          if (foliage !== this.boundFoliage) {
            if (this.activeUnit !== 2) gl.activeTexture(gl.TEXTURE2);
            this.activeUnit = 2;
            gl.bindTexture(gl.TEXTURE_2D, foliage);
            this.boundFoliage = foliage;
          }
        }
        gl.uniform3f(this.locSectionOrigin, mesh.sx * 16, mesh.sy * 16, mesh.sz * 16);
        gl.bindVertexArray(bucket.vao);
        this.glWrapper.drawElements(gl.TRIANGLES, bucket.indexCount, gl.UNSIGNED_INT, 0);
        this.passDraws++;
        this.passTriangles += bucket.indexCount / 3;
      }
    }
  }

  private selectLightingProgram(
    skyOnly: boolean,
    viewProjMatrix: mat4,
    atlas: TextureAtlas,
    wallTorch = false,
  ): void {
    const gl = this.glWrapper.gl;
    const index = (skyOnly ? 1 : 0) + (wallTorch ? 2 : 0);
    this.program = this.programs[index]!;
    Object.assign(this, this.programLocations[index]);
    gl.useProgram(this.program);
    gl.uniform1f(this.locSkyBrightness, this.skyBrightness);
    gl.uniform1i(this.locDebugLight, this.debugLight ? 1 : 0);
    gl.uniform1i(this.locAtlasSampler, 0);
    gl.uniform1i(this.locGrassTintMap, 1);
    gl.uniform1i(this.locFoliageTintMap, 2);
    gl.uniform2f(this.locAtlasSize, atlas.width, atlas.height);
    gl.uniform1f(this.locCellSize, CELL_SIZE);
    gl.uniformMatrix4fv(this.locViewProj, false, viewProjMatrix);
    gl.uniform3f(this.locCameraPos, this.cameraPos[0], this.cameraPos[1], this.cameraPos[2]);
    gl.uniform1f(this.locFogStart, this.fogStart);
    gl.uniform1f(this.locFogEnd, this.fogEnd);
    gl.uniform3f(this.locSunDir, this.sunDir[0], this.sunDir[1], this.sunDir[2]);
    gl.uniform1f(this.locDayFactor, this.dayFactor);
    gl.uniform1f(this.locTwilightFactor, this.twilightFactor);
    gl.uniform1f(this.locNightFactor, this.nightFactor);
    gl.uniform1i(this.locUnderwater, this.underwater?.submerged ? 1 : 0);
    gl.uniform1f(this.locUnderwaterFloor, this.underwater?.brightnessFloor ?? 0);
    const color = this.underwater?.fogColor;
    gl.uniform3f(this.locWaterFogColor, color?.[0] ?? 0, color?.[1] ?? 0, color?.[2] ?? 0);
    gl.uniform1f(this.locRainFactor, this.rainFactor);
    gl.uniform1f(this.locLightningFlash, this.lightningFlash);
    this.fadeUniform.forget();
  }

  private drawLightingPass(pass: number, viewProjMatrix: mat4, atlas: TextureAtlas): void {
    for (let variant = 0; variant < 4; variant++) {
      const skyOnly = (variant & 1) === 0,
        wallTorch = variant >= 2;
      this.selectLightingProgram(skyOnly, viewProjMatrix, atlas, wallTorch);
      this.glWrapper.gl.uniform1i(this.locIsCutout, pass === 1 ? 1 : 0);
      this.glWrapper.gl.uniform1i(this.locIsWireframe, 0);
      this.drawPass(pass, skyOnly, wallTorch);
    }
  }

  public render(
    viewProjMatrix: mat4,
    atlasTexture: WebGLTexture,
    atlas: TextureAtlas,
    world?: import('../world/world').World | null,
    drawPlayer?: () => number,
  ): void {
    const gl = this.glWrapper.gl;

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlasTexture);

    // Column-level frustum culling: every pass draws only the sections of columns whose box touches
    // the frustum (decisions/M04a-streaming.md). Each visible column's tint textures are fetched once
    // per frame, on a texture unit this renderer does not sample from: the cache creates (or
    // re-uploads) textures on the active unit, and the first column seen in a frame must not replace
    // the atlas on unit 0 (stale first frame, see decisions/M02c-fix-load-path.md).
    const planes = extractFrustumPlanes(viewProjMatrix, this.frustumPlanes);
    const meshes = this.lastVisible;
    meshes.length = 0;
    const columns = this.visColumns;
    const nowMs = performance.now();
    this.fadeUniform.forget();
    let columnCount = 0;
    gl.activeTexture(gl.TEXTURE0 + SCRATCH_TEXTURE_UNIT);
    for (const list of this.columnMeshes.values()) {
      const first = list[0]!;
      if (!columnInFrustum(planes, first.sx, first.sz)) continue;
      const visible = columns[columnCount] ?? [];
      visible.length = 0;
      for (const mesh of list) {
        if (!sectionInFrustum(planes, mesh.sx, mesh.sy, mesh.sz)) continue;
        visible.push(mesh);
        meshes.push(mesh);
      }
      if (visible.length === 0) continue;
      columns[columnCount] = visible;
      const pair = this.tintCache.getColumnTints(first.sx, first.sz, world);
      this.visGrass[columnCount] = pair.grassTexture;
      this.visFoliage[columnCount] = pair.foliageTexture;
      this.visFade[columnCount] = this.fades.amount(first.sx, first.sz, nowMs);
      columnCount++;
    }
    columns.length = columnCount;
    this.visGrass.length = columnCount;
    this.visFoliage.length = columnCount;
    this.visFade.length = columnCount;
    this.boundGrass = null;
    this.boundFoliage = null;
    this.activeUnit = SCRATCH_TEXTURE_UNIT;
    this.passDraws = 0;
    this.passTriangles = 0;

    // 1. Opaque Pass
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    this.drawLightingPass(0, viewProjMatrix, atlas);

    // 2. Cutout Pass
    this.drawLightingPass(1, viewProjMatrix, atlas);

    const playerDraws = drawPlayer?.() ?? 0;
    if (playerDraws > 0) this.activeUnit = 0;

    // 3. Translucent Pass
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    this.drawLightingPass(2, viewProjMatrix, atlas);

    let drawCalls = this.passDraws + playerDraws;
    const triangles = this.passTriangles + playerDraws * 12;

    // Restore depth write
    gl.depthMask(true);

    // 4. Wireframe Overlay Pass (if enabled)
    if (wireframeEnabled) {
      this.selectLightingProgram(false, viewProjMatrix, atlas);
      gl.uniform1i(this.locIsWireframe, 1);
      gl.uniform1i(this.locIsCutout, 0);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-1.0, -1.0);

      // The overlay follows the column fades like the solid passes.
      for (let c = 0; c < columns.length; c++) {
        this.fadeUniform.set(this.visFade[c]!);
        for (const mesh of columns[c]!) {
          const buckets = [mesh.opaque, mesh.cutout, mesh.translucent];
          for (const bucket of buckets) {
            if (bucket) {
              this.selectLightingProgram(false, viewProjMatrix, atlas, mesh.hasWallTorch);
              gl.uniform1i(this.locIsWireframe, 1);
              gl.uniform1i(this.locIsCutout, 0);
              this.fadeUniform.set(this.visFade[c]!);
              gl.uniform3f(this.locSectionOrigin, mesh.sx * 16, mesh.sy * 16, mesh.sz * 16);
              gl.bindVertexArray(bucket.vao);
              gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.wireframeBuffer(bucket));
              this.glWrapper.drawElements(gl.LINES, bucket.lineIndexCount, gl.UNSIGNED_INT, 0);
              // The VAO records its element buffer: put the triangle indices back for the next frame.
              gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bucket.ebo);
              drawCalls++;
            }
          }
        }
      }

      gl.disable(gl.POLYGON_OFFSET_FILL);
    }

    gl.bindVertexArray(null);

    renderStats.drawCalls = drawCalls;
    renderStats.triangles = triangles;
    // chunksLoaded and chunksMeshed come from the streamer (WorldManager); only the draw knows
    // how many section meshes were visible.
    renderStats.chunksVisible = meshes.length;
  }
}
