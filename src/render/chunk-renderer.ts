import type { LodRenderer, LodAtmosphere } from './lod-renderer';
import { chebyshev, FULL_DETAIL_RADIUS } from '../world/streaming-plan';
import { fluidAnimation, windAnimation } from './fluid-animation';
import { FluidDepth } from './fluid-depth';
import {
  quadCenters,
  TranslucentSorter,
  distanceSquared,
  TRANSLUCENT_NEAR_DISTANCE,
  TRANSLUCENT_SORT_STEP,
} from './translucent-sort';
import { WALL_TORCH_GLSL } from '../mesh/wall-torch';
import type { UnderwaterView } from './underwater';
import { canonicalQuadVertices } from './shared-quads';
import { SHAPE_VERTEX, VERTEX_LAYOUT, isShapeVertex } from '../mesh/vertex';
import {
  LIGHT_MIN_BRIGHTNESS,
  LIGHT_BRIGHTNESS_RANGE,
  AO_UNOCCLUDED,
  AO_STEP,
} from '../world/light-curve';
import { mat4 } from 'gl-matrix';
import { GLWrapper } from './gl';
import { settings } from '../engine/settings';
import { BlockRegistry } from '../world/blocks/registry';
import { TextureAtlas, CELL_SIZE } from './atlas';
import { atlasTileIndex, buildSwayMasks, type SwayMasks } from './foliage';
import { SectionMeshData, MeshBucketData } from '../mesh/greedy';
import { renderStats } from '../debug/api/core';
import { wireframeEnabled } from '../debug/api/wireframe';
import { ColumnTintCache, TINT_DEFAULT_SLOT } from './tint-cache';
import { columnInFrustum, sectionInFrustum, extractFrustumPlanes } from '../world/frustum';
import { FS_CHUNK } from './terrain-fragment';
import { ColumnFades } from './column-fade';
import { GLSL_SKY_ATMOSPHERE } from './sky';
import { SectionVisibility } from './section-visibility';
import { cullingSettings } from './culling-settings';
import { TerrainArena, type TerrainAllocation } from './terrain-arena';
import { TerrainDrawBatcher, DRAW_DATA_TEX_WIDTH, FLOATS_PER_DRAW } from './terrain-batcher';
import { DrawDataTextureRing, DRAW_DATA_TEXTURE_RING_SIZE } from './draw-data-texture-ring';
import { renderPhaseStats } from '../engine/render-phase-stats';
import { buildEmissiveTileTable, EMISSIVE_TABLE_SIZE } from './post/emissive-tiles';

const VS_CHUNK = `#version 300 es
precision highp float;
layout(location = 0) in uint a_word0;
layout(location = 1) in uint a_word1;
uniform mat4 u_viewProj;
uniform vec2 u_atlasSize;
uniform float u_cellSize;
uniform float u_skyBrightness;
uniform float u_smoothLighting;
uniform float u_brightness;
uniform bool u_debugLight;
uniform float u_underwaterFloor;
uniform highp sampler2D u_tintAtlas;
uniform highp sampler2D u_drawDataTex;
uniform int u_drawBase;
uniform int u_useMultiDrawId;
flat out float v_drawFade;
#ifdef BLOOM_EMISSIVE
uniform sampler2D u_emissiveMap;
flat out float v_emissive;
#endif
uniform vec3 u_cameraPos;
uniform float u_fogStart;
uniform float u_fogEnd;
uniform vec3 u_sunDir;
uniform float u_dayFactor;
uniform float u_twilightFactor;
uniform float u_nightFactor;
uniform float u_fluidTime;
uniform int u_waterTile;
uniform int u_lavaTile;
uniform float u_swayOn;
uniform float u_windTime;
uniform uvec4 u_swayLeaf[32];
uniform uvec4 u_swayPlant[32];
flat out float v_leaf;
flat out float v_fluid;
flat out float v_flow;
out vec3 v_normal;
uniform float u_rainFactor;
uniform float u_lightningFlash;
// A dimension's own fog colour (rgb), in use when a is 1: it replaces the sky's.
uniform vec4 u_dimensionFog;
uniform highp int u_isCutout;
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
  int drawIdx = u_drawBase + __DRAW_ID_EXPR__;
  int texel0 = drawIdx << 1;
  int texel1 = texel0 + 1;
  vec4 draw0 = texelFetch(u_drawDataTex, ivec2(texel0 & 1023, texel0 >> 10), 0);
  vec4 draw1 = texelFetch(u_drawDataTex, ivec2(texel1 & 1023, texel1 >> 10), 0);
  vec3 sectionOrigin = draw0.xyz;
  v_drawFade = draw0.w;
  int tintSlot = int(draw1.x + 0.5);

  vec3 localPos = vec3(float(a_word0 & 31u), float((a_word0 >> 5u) & 31u), float((a_word0 >> 10u) & 31u));
  // Shape vertices (stairs, fences, doors, trapdoors) live in the cutout bucket only, which is
  // how they are told apart from fluid vertices whose two top word1 bits are also set.
  #ifdef WALL_TORCH
  bool shape = u_isCutout == 1 && (a_word1 >> ${SHAPE_VERTEX.flagShift}u) == ${SHAPE_VERTEX.flags}u && (a_word0 >> 28u) >= 8u;
  #else
  const bool shape = false;
  #endif
  uint material = shape ? 0u : a_word0 >> 28u;
  bool fluid = material == 4u || material == 5u;
  v_fluid = fluid ? float(material - 3u) : 0.0;
  v_flow = fluid ? float((a_word1 >> 18u) & 15u) : 0.0;
  localPos.y += fluid ? -float((a_word1 >> 12u) & 63u) / 64.0 : (shape ? 0.0 : float((a_word1 >> ${VERTEX_LAYOUT.halfYShift}u) & 1u) * 0.5);
  vec3 shapeSub = vec3(0.0);
  if (shape) {
    uint packedSub = ((a_word0 >> 28u) & 7u) | (((a_word1 >> ${SHAPE_VERTEX.offsetShift}u) & 4095u) << 3u);
    shapeSub = vec3(float(packedSub & 31u), float((packedSub >> 5u) & 31u), float((packedSub >> 10u) & 31u)) / 16.0;
    localPos += shapeSub;
  }
  vec3 worldPos = sectionOrigin + localPos;
  #ifdef WALL_TORCH
  uint normalIdx=(a_word0 >> 15u) & 7u;
  bool wallTorch=normalIdx>=6u;
  if(wallTorch) worldPos += wallTorchOffset(float((a_word1 >> ${VERTEX_LAYOUT.uShift}u)&31u),float((a_word1 >> ${VERTEX_LAYOUT.vShift}u)&31u),normalIdx-6u,(a_word0>>28u)&15u);
  vec3 normal = wallTorch ? vec3(0.0,1.0,0.0) : NORMALS[normalIdx];
  #else
  vec3 normal = NORMALS[(a_word0 >> 15u) & 7u];
  #endif
  v_normal = normal;
  if (material == 4u && ((a_word1 >> 12u) & 63u) != 0u) {
    worldPos.y += 0.018 * sin(worldPos.x * 1.1 + u_fluidTime * 1.2) * cos(worldPos.z * 0.9 + u_fluidTime * 0.8);
  }
  worldPos += normal * (fluid ? 0.0 : (shape ? 0.0 : float((a_word1 >> ${VERTEX_LAYOUT.wallInsetShift}u) & 1u)) / 32.0);
  uint swayTile = a_word1 & (shape ? ${SHAPE_VERTEX.tileMask}u : ${VERTEX_LAYOUT.tileMask}u);
  bool leaf = !fluid && ((u_swayLeaf[swayTile >> 7u][(swayTile >> 5u) & 3u] >> (swayTile & 31u)) & 1u) == 1u;
  bool plant = !fluid && ((u_swayPlant[swayTile >> 7u][(swayTile >> 5u) & 3u] >> (swayTile & 31u)) & 1u) == 1u;
  v_leaf = leaf ? 1.0 : 0.0;
  if (u_swayOn > 0.0 && (leaf || plant)) {
    // Wind: a function of world position and the shared animation clock, so blocks sharing a corner
    // move together. Leaves move 0.03 blocks at most; plants sway 0.04 at the tip and stay fixed at the base.
    float weight = plant ? 1.0 - float((a_word1 >> ${VERTEX_LAYOUT.vShift}u) & ${VERTEX_LAYOUT.uvMask}u) : 1.0;
    float amplitude = plant ? 0.04 : 0.03;
    vec3 base = sectionOrigin + localPos;
    float phase = u_windTime * 1.6 + base.x * 0.7 + base.z * 0.5;
    worldPos.x += amplitude * weight * sin(phase + base.y * 0.3);
    worldPos.z += amplitude * weight * cos(phase * 0.8 + base.x * 0.2);
    worldPos.y += leaf ? 0.01 * sin(phase * 1.3 + base.z * 0.4) : 0.0;
  }
  float faceShade = normal.y > 0.5 ? 1.0 : (normal.y < -0.5 ? 0.5 : (abs(normal.z) > 0.5 ? 0.8 : 0.6));
  float ao = mix(1.0, ${AO_UNOCCLUDED.toFixed(2)} - ${AO_STEP.toFixed(2)} * float((a_word0 >> 18u) & 3u), u_smoothLighting);
  float sky = ${LIGHT_MIN_BRIGHTNESS.toFixed(2)} + ${LIGHT_BRIGHTNESS_RANGE.toFixed(2)} * float((a_word0 >> 20u) & 15u) / 15.0;
#ifdef SKY_ONLY
  vec3 light = vec3(max(sky * u_skyBrightness, ${LIGHT_MIN_BRIGHTNESS.toFixed(2)}));
#else
  vec3 rgb = vec3(float((a_word0 >> 24u) & 15u), float((a_word1 >> ${VERTEX_LAYOUT.greenShift}u) & 15u), float((a_word1 >> ${VERTEX_LAYOUT.blueShift}u) & 15u));
  vec3 brightness = ${LIGHT_MIN_BRIGHTNESS.toFixed(2)} + ${LIGHT_BRIGHTNESS_RANGE.toFixed(2)} * rgb / 15.0;
  vec3 light = max(vec3(sky * u_skyBrightness), brightness);
#endif
  v_light = (u_debugLight ? vec3(1.0) : max(light, vec3(u_underwaterFloor))) * ao * faceShade * u_brightness;
  #ifdef WALL_TORCH
  uint tintIdx = wallTorch || shape ? 0u : (a_word0 >> 28u) & 15u;
  #else
  uint tintIdx = (a_word0 >> 28u) & 15u;
  #endif
  // Clamp to this column's edge texel: vertices at x/z=16 still belong to this column.
  ivec2 tintTexel = ivec2(clamp(floor(localPos.xz - 0.5 * normal.xz), vec2(0.0), vec2(15.0)));
  v_tint = vec3(1.0);
  if (tintIdx >= 1u && tintIdx <= 3u) {
    int tintCell = (tintSlot << 1) + (tintIdx == 2u ? 1 : 0);
    ivec2 cellOrigin = ivec2((tintCell & 63) << 4, (tintCell >> 6) << 4);
    v_tint = texelFetch(u_tintAtlas, cellOrigin + tintTexel, 0).rgb;
  }
  v_grassSide = tintIdx == 3u ? 1.0 : 0.0;
  uint tileIdx = a_word1 & (shape ? ${SHAPE_VERTEX.tileMask}u : ${VERTEX_LAYOUT.tileMask}u);
  if (fluid) tileIdx = uint(material == 4u ? u_waterTile : u_lavaTile) + uint(mod(floor(u_fluidTime * 8.0), 32.0));
  #ifdef BLOOM_EMISSIVE
  v_emissive = texelFetch(u_emissiveMap, ivec2(int(tileIdx & 63u), int(tileIdx >> 6u)), 0).r;
  #endif
  uint cellsPerRow = uint(u_atlasSize.x / u_cellSize);
  v_tileOrigin = (vec2(float(tileIdx % cellsPerRow), float(tileIdx / cellsPerRow)) * u_cellSize + 4.0) / u_atlasSize;
  v_unwrappedUV = vec2(float((a_word1 >> ${VERTEX_LAYOUT.uShift}u) & ${VERTEX_LAYOUT.uvMask}u), float((a_word1 >> ${VERTEX_LAYOUT.vShift}u) & ${VERTEX_LAYOUT.uvMask}u));
  if (shape) {
    // Box faces show the part of the tile they cover (see SHAPE_VERTEX in mesh/vertex.ts).
    uint face = (a_word0 >> 15u) & 7u;
    v_unwrappedUV = face == 0u ? vec2(1.0 - shapeSub.z, 1.0 - shapeSub.y)
      : face == 1u ? vec2(shapeSub.z, 1.0 - shapeSub.y)
      : face == 2u ? vec2(shapeSub.x, 1.0 - shapeSub.z)
      : face == 3u ? vec2(shapeSub.x, shapeSub.z)
      : face == 4u ? vec2(shapeSub.x, 1.0 - shapeSub.y)
      : vec2(1.0 - shapeSub.x, 1.0 - shapeSub.y);
  }
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
    fogCol = mix(fogCol, vec3(lum), min(0.8, 0.55 * u_rainFactor)) * vec3(0.9, 0.97, 1.08) * max(0.12, 1.0 - 0.8 * u_rainFactor);
  }
  if (u_lightningFlash > 0.001) {
    fogCol += vec3(u_lightningFlash * 0.35);
  }
  if (u_dimensionFog.a > 0.5) fogCol = u_dimensionFog.rgb;
  v_fogColor = fogCol;
  gl_Position = u_viewProj * vec4(worldPos, 1.0);
}
`;

// Texture units while drawing:
// 0: block/item atlas
// 1: shared 2D tint atlas (TEXTURE_2D, grass + foliage cells)
// 2: per-frame draw-data TEXTURE_2D (RGBA32F)
// 3: scratch unit for upload-time tint updates
// 4: fluid scene depth texture
// 5: emissive tile table (when bloom is active)
const TINT_ATLAS_UNIT = 1;
const DRAW_DATA_UNIT = 2;
const SCRATCH_TEXTURE_UNIT = 3;
const EMISSIVE_TEXTURE_UNIT = 5;

const UNIFORM_CACHE_SLOT = {
  fluidTime: 0,
  swayOn: 1,
  windTime: 2,
  fastLeaves: 3,
  waterTile: 4,
  lavaTile: 5,
  sceneDepth: 6,
  viewport: 7,
  skyBrightness: 9,
  smoothLighting: 10,
  brightness: 11,
  debugLight: 12,
  atlasSampler: 13,
  tintAtlas: 14,
  drawDataTex: 15,
  atlasSize: 16,
  cellSize: 18,
  viewProj: 20,
  inverseViewProj: 36,
  cameraPos: 52,
  fogStart: 55,
  fogEnd: 56,
  sunDir: 57,
  dayFactor: 60,
  twilightFactor: 61,
  nightFactor: 62,
  underwater: 63,
  underwaterFloor: 64,
  waterFogColor: 65,
  rainFactor: 68,
  lightningFlash: 69,
  dimensionFog: 70,
  swayLeaf: 74,
  swayPlant: 78,
  isCutout: 82,
  isWireframe: 83,
  emissiveMap: 84,
  drawBase: 85,
  useMultiDrawId: 86,
} as const;

interface MultiDrawExtension {
  multiDrawElementsWEBGL(
    mode: number,
    counts: Int32Array,
    countsOffset: number,
    type: number,
    offsets: Int32Array,
    offsetsOffset: number,
    drawCount: number,
  ): void;
}

export interface GPUBucketMesh {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  ebo: WebGLBuffer;
  lineEbo: WebGLBuffer | null;
  indexCount: number;
  lineIndexCount: number;
  sortCamera?: [number, number, number];
  sorter?: TranslucentSorter;
  allocation: TerrainAllocation;
  arena: TerrainArena;
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
  visibleColumn: number;
  translucentVisibleGeneration: number;
  sortRank: number;
}

interface PendingSectionUpload {
  meshData: SectionMeshData;
  gpuMesh: GPUSectionMesh;
  fadeFromMs: number | null | undefined;
  hadSections: boolean;
  nextBucket: number;
}

export interface TerrainBatchStatsSnapshot {
  opaqueCutoutSubmissions: number;
  translucentSubmissions: number;
  programSwitches: number;
  textureBinds: number;
  vaoBinds: number;
  arenaPages: number;
  opaquePages: number;
  cutoutPages: number;
  translucentPages: number;
  activeTintSlots: number;
}

export class ChunkRenderer {
  private depth: FluidDepth;
  private inverseViewProj = mat4.create();
  private fluidTime = 0;
  private windTime = 0;
  private worldPaused = false;
  private visibleTranslucent: GPUSectionMesh[] = [];
  private previousVisibleTranslucentCount = 0;
  private sortedCamera: [number, number, number] = [Infinity, Infinity, Infinity];
  private sortDirty = true;
  private translucentVisibilityGeneration = 0;
  private readonly translucentLocal = new Float64Array(3);
  private uploadFrame = 0;
  private readonly compareTranslucent = (a: GPUSectionMesh, b: GPUSectionMesh) =>
    (b.sx * 16 + 8 - this.cameraPos[0]) ** 2 +
      (b.sy * 16 + 8 - this.cameraPos[1]) ** 2 +
      (b.sz * 16 + 8 - this.cameraPos[2]) ** 2 -
      ((a.sx * 16 + 8 - this.cameraPos[0]) ** 2 +
        (a.sy * 16 + 8 - this.cameraPos[1]) ** 2 +
        (a.sz * 16 + 8 - this.cameraPos[2]) ** 2) || a.sortRank - b.sortRank;
  public readonly opaqueArena: TerrainArena;
  public readonly cutoutArena: TerrainArena;
  public readonly translucentArena: TerrainArena;
  public multiDraw: MultiDrawExtension | null;
  public readonly batcher = new TerrainDrawBatcher();
  private readonly drawDataTextures: Array<WebGLTexture | null> = Array.from(
    { length: DRAW_DATA_TEXTURE_RING_SIZE },
    () => null,
  );
  private readonly drawDataTextureRing = new DrawDataTextureRing();
  private drawDataTexHeight = 0;
  private drawDataSnapshot = new Float32Array(0);
  private drawDataSnapshotCount = 0;
  private activeLightingVariant = -1;
  private boundVao: WebGLVertexArrayObject | null = null;
  private readonly programUniformCache = Array.from({ length: 8 }, () =>
    new Float64Array(88).fill(Number.NaN),
  );
  private readonly swayUniformsValid = new Uint8Array(8);
  private swayUniformAtlas: TextureAtlas | null = null;
  private locDrawBase: WebGLUniformLocation | null = null;
  private locUseMultiDrawId: WebGLUniformLocation | null = null;
  private locDrawDataTex: WebGLUniformLocation | null = null;
  private locTintAtlas: WebGLUniformLocation | null = null;
  private locEmissiveMap: WebGLUniformLocation | null = null;
  private glWrapper: GLWrapper;
  private program: WebGLProgram;
  private programs: Array<WebGLProgram | null>;
  private programLocations: Array<Record<string, WebGLUniformLocation | null> | null>;
  private readonly baseVertexSource: string;
  private readonly baseFragmentSource: string;
  private readonly uniformLocationFields: string[];
  private bloomProgramsCompiled = false;
  private emissiveTexture: WebGLTexture | null = null;
  private emissiveAtlas: TextureAtlas | null = null;
  private bloomActive = false;
  private readonly drawBuf1: [number];
  private readonly drawBuf2: [number, number];

  // Per-frame diagnostic counters for PERF-batch A/B reporting and acceptance tests
  public lastOpaqueCutoutSubmissions = 0;
  public lastTranslucentSubmissions = 0;
  public lastProgramSwitches = 0;
  public lastTextureBinds = 0;
  public lastVaoBinds = 0;

  private locFluidTime: WebGLUniformLocation;
  private locWaterTile: WebGLUniformLocation;
  private locLavaTile: WebGLUniformLocation;
  private locSceneDepth: WebGLUniformLocation;
  private locInverseViewProj: WebGLUniformLocation;
  private locViewport: WebGLUniformLocation;
  private locViewProj: WebGLUniformLocation;
  private locAtlasSampler: WebGLUniformLocation;
  private locAtlasSize: WebGLUniformLocation;
  private locCellSize: WebGLUniformLocation;
  private locIsCutout: WebGLUniformLocation;
  private locIsWireframe: WebGLUniformLocation;
  private locSkyBrightness: WebGLUniformLocation;
  private locSmoothLighting: WebGLUniformLocation;
  private locBrightness: WebGLUniformLocation;
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
  private locDimensionFog: WebGLUniformLocation;
  private locSwayOn: WebGLUniformLocation;
  private locWindTime: WebGLUniformLocation;
  private locSwayLeaf: WebGLUniformLocation;
  private locSwayPlant: WebGLUniformLocation;
  private locFastLeaves: WebGLUniformLocation;
  private foliage: {
    atlas: TextureAtlas;
    sway: SwayMasks;
  } | null = null;
  private rainFactor = 0;
  private lightningFlash = 0;
  private readonly dimensionFog = new Float32Array(4);
  private cameraFov = 0;
  private cameraAspect = 0;
  private lodAtmosphere: (LodAtmosphere & { lod?: LodRenderer }) | undefined;
  private skyBrightness = 1;
  private debugLight = false;
  private cameraPos: [number, number, number] = [0, 0, 0];
  private cameraYaw = 0;
  private cameraPitch = 0;
  private renderDistance = 8;
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
  public tintCache: ColumnTintCache;
  private sectionMeshes: Map<string, GPUSectionMesh> = new Map();
  private readonly pendingSectionUploads = new Map<string, PendingSectionUpload>();
  private readonly sectionCounts = new Uint32Array(20);
  // Includes empty meshes: those sections still carry connectivity through open space.
  private visibilityMasks = new SectionVisibility();
  private columnMeshes: Map<string, GPUSectionMesh[]> = new Map();
  private readonly columnLists: GPUSectionMesh[][] = [];
  // Fade-in of each column that has section meshes (decisions/M04b-fade-and-memory.md).
  private fades = new ColumnFades();
  private frustumPlanes = new Float64Array(24);

  // Per-frame scratch state of render(), kept as fields so the draw loop allocates nothing.
  private visColumns: GPUSectionMesh[][] = Array.from({ length: 69 * 69 }, () => []);
  private visColumnCount = 0;
  private visTintSlot = new Int32Array(69 * 69);
  private visFade = new Float32Array(69 * 69);
  private activeUnit = 0;
  private uploadTintUnitReady = false;
  private passDraws = 0;
  private passTriangles = 0;

  /** The section meshes drawn by the latest render() call: nonempty sections inside the frustum. */
  public lastVisible: GPUSectionMesh[] = [];

  constructor(glWrapper: GLWrapper) {
    this.glWrapper = glWrapper;
    this.opaqueArena = new TerrainArena(glWrapper, {
      initialPageQuads: 1_048_576,
      maxPageQuads: 2_097_152,
    });
    this.cutoutArena = new TerrainArena(glWrapper, {
      initialPageQuads: 524_288,
      maxPageQuads: 1_048_576,
    });
    this.translucentArena = new TerrainArena(glWrapper, {
      initialPageQuads: 262_144,
      maxPageQuads: 524_288,
    });
    this.depth = new FluidDepth(glWrapper);
    const gl = this.glWrapper.gl;
    this.drawBuf1 = [gl.COLOR_ATTACHMENT0];
    this.drawBuf2 = [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1];
    const extension = glWrapper.perDrawChecks
      ? null
      : (gl.getExtension('WEBGL_multi_draw') as MultiDrawExtension | null);
    this.multiDraw = typeof extension?.multiDrawElementsWEBGL === 'function' ? extension : null;
    const vertexSource = this.multiDraw
      ? VS_CHUNK.replace(
          '#version 300 es',
          '#version 300 es\n#extension GL_ANGLE_multi_draw : require',
        ).replace('__DRAW_ID_EXPR__', '(u_useMultiDrawId != 0 ? gl_DrawID : 0)')
      : VS_CHUNK.replace('__DRAW_ID_EXPR__', '0');
    const fragmentSource = FS_CHUNK.replace(
      'uniform float u_fade;',
      'flat in float v_drawFade;',
    ).replaceAll('u_fade', 'v_drawFade');
    this.baseVertexSource = vertexSource;
    this.baseFragmentSource = fragmentSource;
    this.program = this.glWrapper.createProgram(vertexSource, fragmentSource);
    const skyOnly = (source: string) =>
      source.replace('#version 300 es', '#version 300 es\n#define SKY_ONLY');
    const wallTorch = (source: string) =>
      source.replace('#version 300 es', '#version 300 es\n#define WALL_TORCH');
    this.programs = [
      this.program,
      this.glWrapper.createProgram(skyOnly(vertexSource), skyOnly(fragmentSource)),
      this.glWrapper.createProgram(wallTorch(vertexSource), fragmentSource),
      this.glWrapper.createProgram(skyOnly(wallTorch(vertexSource)), skyOnly(fragmentSource)),
      null,
      null,
      null,
      null,
    ];
    this.tintCache = new ColumnTintCache(glWrapper);
    this.ensureDrawDataTextures(this.batcher.getTextureHeight());

    this.locFluidTime = gl.getUniformLocation(this.program, 'u_fluidTime')!;
    this.locWaterTile = gl.getUniformLocation(this.program, 'u_waterTile')!;
    this.locLavaTile = gl.getUniformLocation(this.program, 'u_lavaTile')!;
    this.locSceneDepth = gl.getUniformLocation(this.program, 'u_sceneDepth')!;
    this.locInverseViewProj = gl.getUniformLocation(this.program, 'u_inverseViewProj')!;
    this.locViewport = gl.getUniformLocation(this.program, 'u_viewport')!;
    this.locViewProj = gl.getUniformLocation(this.program, 'u_viewProj')!;
    this.locAtlasSampler = gl.getUniformLocation(this.program, 'u_atlasSampler')!;
    this.locTintAtlas = gl.getUniformLocation(this.program, 'u_tintAtlas')!;
    this.locDrawDataTex = gl.getUniformLocation(this.program, 'u_drawDataTex')!;
    this.locDrawBase = gl.getUniformLocation(this.program, 'u_drawBase')!;
    this.locUseMultiDrawId = gl.getUniformLocation(this.program, 'u_useMultiDrawId')!;
    this.locAtlasSize = gl.getUniformLocation(this.program, 'u_atlasSize')!;
    this.locCellSize = gl.getUniformLocation(this.program, 'u_cellSize')!;
    this.locIsCutout = gl.getUniformLocation(this.program, 'u_isCutout')!;
    this.locIsWireframe = gl.getUniformLocation(this.program, 'u_isWireframe')!;
    this.locSkyBrightness = gl.getUniformLocation(this.program, 'u_skyBrightness')!;
    this.locSmoothLighting = gl.getUniformLocation(this.program, 'u_smoothLighting')!;
    this.locBrightness = gl.getUniformLocation(this.program, 'u_brightness')!;
    this.locDebugLight = gl.getUniformLocation(this.program, 'u_debugLight')!;
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
    this.locDimensionFog = gl.getUniformLocation(this.program, 'u_dimensionFog')!;
    this.locSwayOn = gl.getUniformLocation(this.program, 'u_swayOn')!;
    this.locWindTime = gl.getUniformLocation(this.program, 'u_windTime')!;
    this.locSwayLeaf = gl.getUniformLocation(this.program, 'u_swayLeaf')!;
    this.locSwayPlant = gl.getUniformLocation(this.program, 'u_swayPlant')!;
    this.locFastLeaves = gl.getUniformLocation(this.program, 'u_fastLeaves')!;
    this.uniformLocationFields = [
      'locFluidTime',
      'locWaterTile',
      'locLavaTile',
      'locSceneDepth',
      'locInverseViewProj',
      'locViewport',
      'locViewProj',
      'locDrawBase',
      'locUseMultiDrawId',
      'locDrawDataTex',
      'locTintAtlas',
      'locAtlasSampler',
      'locEmissiveMap',
      'locAtlasSize',
      'locCellSize',
      'locIsCutout',
      'locIsWireframe',
      'locSkyBrightness',
      'locSmoothLighting',
      'locBrightness',
      'locDebugLight',
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
      'locDimensionFog',
      'locSwayOn',
      'locWindTime',
      'locSwayLeaf',
      'locSwayPlant',
      'locFastLeaves',
    ];
    this.programLocations = [
      this.collectLocations(this.programs[0]!),
      this.collectLocations(this.programs[1]!),
      this.collectLocations(this.programs[2]!),
      this.collectLocations(this.programs[3]!),
      null,
      null,
      null,
      null,
    ];
  }

  public getBatchStats(): TerrainBatchStatsSnapshot {
    const opaquePages = this.opaqueArena.pages.length;
    const cutoutPages = this.cutoutArena.pages.length;
    const translucentPages = this.translucentArena.pages.length;
    return {
      opaqueCutoutSubmissions: this.lastOpaqueCutoutSubmissions,
      translucentSubmissions: this.lastTranslucentSubmissions,
      programSwitches: this.lastProgramSwitches,
      textureBinds: this.lastTextureBinds,
      vaoBinds: this.lastVaoBinds,
      arenaPages: opaquePages + cutoutPages + translucentPages,
      opaquePages,
      cutoutPages,
      translucentPages,
      activeTintSlots: this.tintCache.activeSlotCount,
    };
  }

  private ensureDrawDataTextures(requiredHeight: number): void {
    if (
      this.drawDataTexHeight === requiredHeight &&
      this.drawDataTextures.every((texture) => texture !== null)
    ) {
      return;
    }

    for (let i = 0; i < this.drawDataTextures.length; i++) {
      const texture = this.drawDataTextures[i]!;
      if (texture) this.glWrapper.deleteTexture(texture);
      this.drawDataTextures[i] = null;
    }

    const gl = this.glWrapper.gl;
    if (this.activeUnit !== SCRATCH_TEXTURE_UNIT) {
      gl.activeTexture(gl.TEXTURE0 + SCRATCH_TEXTURE_UNIT);
      this.activeUnit = SCRATCH_TEXTURE_UNIT;
    }
    for (let i = 0; i < this.drawDataTextures.length; i++) {
      const tex = this.glWrapper.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, DRAW_DATA_TEX_WIDTH, requiredHeight);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.drawDataTextures[i] = tex;
    }
    this.drawDataTexHeight = requiredHeight;
    this.drawDataSnapshot = new Float32Array(DRAW_DATA_TEX_WIDTH * requiredHeight * 4);
    this.drawDataSnapshotCount = 0;
    this.drawDataTextureRing.reset();
  }

  private uploadDrawDataTexture(rows: number): void {
    const drawCount = this.batcher.getTotalDraws();
    if (rows <= 0 || drawCount <= 0) return;

    this.ensureDrawDataTextures(this.batcher.getTextureHeight());
    const usedFloats = drawCount * FLOATS_PER_DRAW;
    let unchanged = this.drawDataSnapshotCount >= drawCount;
    if (unchanged) {
      for (let i = 0; i < usedFloats; i++) {
        if (this.batcher.drawData[i] !== this.drawDataSnapshot[i]) {
          unchanged = false;
          break;
        }
      }
    }

    const textureIndex = this.drawDataTextureRing.acquire(!unchanged);
    const tex = this.drawDataTextures[textureIndex]!;
    const gl = this.glWrapper.gl;
    if (this.activeUnit !== DRAW_DATA_UNIT) {
      gl.activeTexture(gl.TEXTURE0 + DRAW_DATA_UNIT);
      this.activeUnit = DRAW_DATA_UNIT;
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    this.lastTextureBinds++;

    if (!unchanged) {
      const uploadStart = renderPhaseStats.start();
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        DRAW_DATA_TEX_WIDTH,
        rows,
        gl.RGBA,
        gl.FLOAT,
        this.batcher.drawData,
        0,
      );
      this.drawDataSnapshot.set(this.batcher.drawData.subarray(0, usedFloats), 0);
      this.drawDataSnapshotCount = drawCount;
      renderPhaseStats.end('uniformUploadMs', uploadStart);
    }
  }

  private bindVao(vao: WebGLVertexArrayObject | null): void {
    if (this.boundVao === vao) return;
    this.glWrapper.gl.bindVertexArray(vao);
    this.boundVao = vao;
    if (vao !== null) this.lastVaoBinds++;
  }

  private collectLocations(program: WebGLProgram): Record<string, WebGLUniformLocation | null> {
    const gl = this.glWrapper.gl;
    return Object.fromEntries(
      this.uniformLocationFields.map((field) => [
        field,
        gl.getUniformLocation(program, `u_${field[3]!.toLowerCase()}${field.slice(4)}`),
      ]),
    );
  }

  private ensureBloomPrograms(): void {
    if (this.bloomProgramsCompiled) return;
    this.bloomProgramsCompiled = true;
    const skyOnly = (source: string) =>
      source.replace('#version 300 es', '#version 300 es\n#define SKY_ONLY');
    const wallTorch = (source: string) =>
      source.replace('#version 300 es', '#version 300 es\n#define WALL_TORCH');
    const bloom = (source: string) =>
      source.replace('#version 300 es', '#version 300 es\n#define BLOOM_EMISSIVE');
    const vs = bloom(this.baseVertexSource);
    const fs = bloom(this.baseFragmentSource);
    this.programs[4] = this.glWrapper.createProgram(vs, fs);
    this.programs[5] = this.glWrapper.createProgram(skyOnly(vs), skyOnly(fs));
    this.programs[6] = this.glWrapper.createProgram(wallTorch(vs), fs);
    this.programs[7] = this.glWrapper.createProgram(skyOnly(wallTorch(vs)), skyOnly(fs));
    for (let i = 4; i < 8; i++) {
      this.programLocations[i] = this.collectLocations(this.programs[i]!);
    }
  }

  private getEmissiveTexture(atlas: TextureAtlas): WebGLTexture {
    if (this.emissiveTexture && this.emissiveAtlas === atlas) {
      return this.emissiveTexture;
    }
    const gl = this.glWrapper.gl;
    if (!this.emissiveTexture) {
      this.emissiveTexture = this.glWrapper.createTexture();
    }
    this.emissiveAtlas = atlas;
    const table = buildEmissiveTileTable(BlockRegistry.getInstance(), atlas);
    gl.activeTexture(gl.TEXTURE0 + EMISSIVE_TEXTURE_UNIT);
    this.activeUnit = EMISSIVE_TEXTURE_UNIT;
    gl.bindTexture(gl.TEXTURE_2D, this.emissiveTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      EMISSIVE_TABLE_SIZE,
      EMISSIVE_TABLE_SIZE,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      table,
    );
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return this.emissiveTexture;
  }

  /** The simulation is paused: wind stands still, like every other world animation. */
  public setWorldPaused(paused: boolean): void {
    this.worldPaused = paused;
  }

  public setSkyBrightness(brightness: number): void {
    this.skyBrightness = Math.max(0, Math.min(1, brightness));
  }

  public setAtmosphere(params: {
    lod?: LodRenderer;
    cameraPos: ArrayLike<number>;
    cameraYaw?: number;
    cameraPitch?: number;
    cameraFov?: number;
    cameraAspect?: number;
    renderDistance?: number;
    fogStart: number;
    fogEnd: number;
    sunDir: readonly [number, number, number];
    dayFactor: number;
    twilightFactor: number;
    nightFactor: number;
    underwater?: UnderwaterView;
    rainFactor?: number;
    lightningFlash?: number;
    /** A dimension's fog colour replacing the sky's, or null for the sky. */
    dimensionFog?: readonly number[] | null;
  }): void {
    this.cameraPos[0] = params.cameraPos[0] ?? 0;
    this.cameraPos[1] = params.cameraPos[1] ?? 0;
    this.cameraPos[2] = params.cameraPos[2] ?? 0;
    this.cameraYaw = params.cameraYaw ?? 0;
    this.cameraPitch = params.cameraPitch ?? 0;
    this.cameraFov = params.cameraFov ?? 0;
    this.cameraAspect = params.cameraAspect ?? 0;
    this.lodAtmosphere = params;
    this.renderDistance = params.renderDistance ?? this.renderDistance;
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
    const fog = params.dimensionFog;
    this.dimensionFog[0] = fog?.[0] ?? 0;
    this.dimensionFog[1] = fog?.[1] ?? 0;
    this.dimensionFog[2] = fog?.[2] ?? 0;
    this.dimensionFog[3] = fog ? 1 : 0;
  }
  public setDebugLight(on: boolean): void {
    this.debugLight = on;
  }

  public invalidateSectionVisibility(sx: number, sy: number, sz: number): void {
    this.cancelPendingSectionUpload(`${sx},${sy},${sz}`);
    this.visibilityMasks.set(sx, sy, sz, undefined);
  }

  public invalidateColumnVisibility(sx: number, sz: number): void {
    this.cancelPendingColumnUploads(sx, sz);
    this.visibilityMasks.invalidateColumn(sx, sz);
  }

  public forgetColumnVisibility(sx: number, sz: number): void {
    this.cancelPendingColumnUploads(sx, sz);
    this.visibilityMasks.removeColumn(sx, sz);
  }

  /** A uniform section skipped by the streamer has no terrain geometry to retain. */
  public setSkippedSectionVisibility(sx: number, sy: number, sz: number, mask: number): void {
    this.removeSectionMesh(`${sx},${sy},${sz}`);
    this.visibilityMasks.set(sx, sy, sz, mask);
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
    fadeFromMs?: number | null,
  ): GPUSectionMesh;
  public uploadSectionMesh(
    sx: number,
    sy: number,
    sz: number,
    meshData: SectionMeshData,
    fadeFromMs: number | null,
    budgetMs: number,
  ): boolean;
  public uploadSectionMesh(
    sx: number,
    sy: number,
    sz: number,
    meshData: SectionMeshData,
    fadeFromMs: number | null = null,
    budgetMs = Infinity,
  ): GPUSectionMesh | boolean {
    const uploadStart = renderPhaseStats.start();
    const uploadClockStart = performance.now();
    const key = `${sx},${sy},${sz}`;
    const colKey = `${sx},${sz}`;
    let pending = this.pendingSectionUploads.get(key);
    if (!pending || pending.meshData !== meshData) {
      // Production results reserve ranges before entering the frame-budgeted upload path; direct
      // unbudgeted test calls expect a dedicated page per section upload.
      this.prepareSectionUpload(sx, sy, sz, meshData, !Number.isFinite(budgetMs));
      pending = this.pendingSectionUploads.get(key)!;
    }
    if (pending.fadeFromMs === undefined) pending.fadeFromMs = fadeFromMs;

    while (pending.nextBucket < 3) {
      const remaining = Math.max(0, budgetMs - (performance.now() - uploadClockStart));
      if (remaining <= 0) {
        renderPhaseStats.end('sectionUploadMs', uploadStart);
        return false;
      }
      const bucketIndex = pending.nextBucket;
      const bucket =
        bucketIndex === 0
          ? pending.gpuMesh.opaque
          : bucketIndex === 1
            ? pending.gpuMesh.cutout
            : pending.gpuMesh.translucent;
      if (!bucket) {
        pending.nextBucket++;
        continue;
      }
      const uploadRemaining = Math.max(0, budgetMs - (performance.now() - uploadClockStart));
      if (!bucket.arena.uploadPending(bucket.allocation, uploadRemaining, true)) {
        renderPhaseStats.end('sectionUploadMs', uploadStart);
        return false;
      }
      pending.nextBucket++;
    }

    this.pendingSectionUploads.delete(key);
    this.removeSectionMesh(key);
    this.visibilityMasks.set(sx, sy, sz, meshData.visibilityMask);
    const gpuMesh = pending.gpuMesh;
    if (gpuMesh.opaque || gpuMesh.cutout || gpuMesh.translucent) {
      const bookkeepingStart = renderPhaseStats.start();
      this.tintCache.onSectionAdded(sx, sy, sz);
      this.sectionMeshes.set(key, gpuMesh);
      if (sy >= 0 && sy < this.sectionCounts.length)
        this.sectionCounts[sy] = this.sectionCounts[sy]! + 1;
      const list = this.columnMeshes.get(colKey);
      if (list) list.push(gpuMesh);
      else {
        const column = [gpuMesh];
        this.columnMeshes.set(colKey, column);
        this.columnLists.push(column);
      }
      this.fades.onUpload(sx, sz, pending.hadSections, pending.fadeFromMs);
      renderPhaseStats.end('meshBookkeepingMs', bookkeepingStart);
    }
    renderPhaseStats.end('sectionUploadMs', uploadStart);
    return gpuMesh;
  }

  /** Reserve arena ranges and create GPU pages before the frame-budgeted transfer begins. */
  public prepareSectionUpload(
    sx: number,
    sy: number,
    sz: number,
    meshData: SectionMeshData,
    dedicatedPage = false,
  ): void {
    const key = `${sx},${sy},${sz}`;
    const existing = this.pendingSectionUploads.get(key);
    if (existing?.meshData === meshData) return;
    if (existing) this.cancelPendingSectionUpload(key);

    const bookkeepingStart = renderPhaseStats.start();
    const arenaBuffers = meshData.arenaBuffers;
    let hasWallTorch = meshData.hasWallTorch;
    if (hasWallTorch === undefined) {
      hasWallTorch = false;
      for (let i = 0; i < meshData.models.vertices.length; i += 2) {
        if (
          ((meshData.models.vertices[i]! >>> 15) & 7) >= 6 ||
          isShapeVertex(meshData.models.vertices[i]!, meshData.models.vertices[i + 1]!)
        ) {
          hasWallTorch = true;
          break;
        }
      }
    }
    const gpuMesh: GPUSectionMesh = {
      hasWallTorch,
      hasBlockLight: meshData.hasBlockLight ?? true,
      key,
      sx,
      sy,
      sz,
      opaque: this.createGPUBucketMesh(
        meshData.opaque,
        this.opaqueArena,
        false,
        undefined,
        dedicatedPage,
        arenaBuffers?.opaque,
      ),
      // Plants (cross models) share the cutout pass and its arena range with leaves.
      cutout: this.createGPUBucketMesh(
        meshData.cutout,
        this.cutoutArena,
        false,
        meshData.models,
        dedicatedPage,
        arenaBuffers?.cutout,
      ),
      translucent: this.createGPUBucketMesh(
        meshData.translucent,
        this.translucentArena,
        true,
        undefined,
        dedicatedPage,
        arenaBuffers?.translucent,
      ),
      visibleColumn: 0,
      translucentVisibleGeneration: 0,
      sortRank: 0,
    };
    this.pendingSectionUploads.set(key, {
      meshData,
      gpuMesh,
      fadeFromMs: undefined,
      hadSections: (this.columnMeshes.get(`${sx},${sz}`)?.length ?? 0) > 0,
      nextBucket: 0,
    });
    renderPhaseStats.end('meshBookkeepingMs', bookkeepingStart);
  }

  public removeSectionMesh(key: string): void {
    this.cancelPendingSectionUpload(key);
    const existing = this.sectionMeshes.get(key);
    if (!existing) return;
    this.visibilityMasks.meshChanged();

    this.tintCache.onSectionRemoved(existing.sx, existing.sy, existing.sz);

    this.freeGPUBucketMesh(existing.opaque);
    this.freeGPUBucketMesh(existing.cutout);
    this.freeGPUBucketMesh(existing.translucent);

    this.sectionMeshes.delete(key);
    if (existing.sy >= 0 && existing.sy < this.sectionCounts.length)
      this.sectionCounts[existing.sy] = this.sectionCounts[existing.sy]! - 1;
    const colKey = `${existing.sx},${existing.sz}`;
    const list = this.columnMeshes.get(colKey);
    if (list) {
      const i = list.indexOf(existing);
      if (i >= 0) list.splice(i, 1);
      if (list.length === 0) {
        this.columnMeshes.delete(colKey);
        const index = this.columnLists.indexOf(list);
        if (index >= 0) {
          this.columnLists[index] = this.columnLists[this.columnLists.length - 1]!;
          this.columnLists.pop();
        }
      }
    }
  }

  /** One GPU section per streaming free step; retain the column until the final step. */
  public removeColumnMeshStep(cx: number, cz: number): boolean {
    const key = `${cx},${cz}`;
    this.cancelPendingColumnUploads(cx, cz);
    const first = this.columnMeshes.get(key)?.[0];
    if (first) this.removeSectionMesh(first.key);
    const done = !this.columnMeshes.has(key);
    if (done) {
      this.visibilityMasks.removeColumn(cx, cz);
      this.fades.onEmptied(cx, cz);
    }
    return done;
  }

  /** Deletes every GPU resource of the section meshes of one column. */
  public removeColumnMeshes(cx: number, cz: number): void {
    this.cancelPendingColumnUploads(cx, cz);
    this.visibilityMasks.removeColumn(cx, cz);
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
    for (const [key, pending] of this.pendingSectionUploads)
      if (pending.gpuMesh.sx === cx && pending.gpuMesh.sz === cz && !keep.has(key))
        this.cancelPendingSectionUpload(key);
    this.visibilityMasks.retain(cx, cz, keep);
    const list = this.columnMeshes.get(`${cx},${cz}`);
    if (!list) return false;
    for (const mesh of Array.from(list)) {
      if (!keep.has(mesh.key)) this.removeSectionMesh(mesh.key);
    }
    const remains = this.columnMeshes.has(`${cx},${cz}`);
    if (!remains) this.fades.onEmptied(cx, cz);
    return remains;
  }

  /** The columns ("cx,cz") that have section meshes on the GPU. */
  public meshedColumns(): string[] {
    return Array.from(this.columnMeshes.keys());
  }

  /** Columns whose fade-in has not finished at `nowMs` (see column-fade.ts). */
  public fadingColumns(nowMs: number): number {
    return this.fades.fadingColumns(nowMs);
  }

  /**
   * Allocates and uploads the column's tint layers now, as part of its upload, instead of in the
   * first frame that draws it. The upload runs on the scratch texture unit (see render()).
   */
  public prepareColumnTints(
    cx: number,
    cz: number,
    world: import('../world/world').World | null,
  ): void {
    const start = renderPhaseStats.start();
    const gl = this.glWrapper.gl;
    if (!this.uploadTintUnitReady) {
      gl.activeTexture(gl.TEXTURE0 + SCRATCH_TEXTURE_UNIT);
      this.activeUnit = SCRATCH_TEXTURE_UNIT;
      this.uploadTintUnitReady = true;
    }
    this.tintCache.getColumnTints(cx, cz, world);
    renderPhaseStats.end('tintPrepareMs', start);
  }

  /** Number of section meshes on the GPU. */
  public get sectionMeshCount(): number {
    return this.sectionMeshes.size;
  }

  public clearAllMeshes(): void {
    for (const key of this.pendingSectionUploads.keys()) this.cancelPendingSectionUpload(key);
    for (const key of Array.from(this.sectionMeshes.keys())) {
      this.removeSectionMesh(key);
    }
    this.depth.dispose();
    if (this.emissiveTexture) {
      this.glWrapper.deleteTexture(this.emissiveTexture);
      this.emissiveTexture = null;
      this.emissiveAtlas = null;
    }
    this.visibleTranslucent.length = 0;
    this.previousVisibleTranslucentCount = 0;
    this.columnMeshes.clear();
    this.columnLists.length = 0;
    this.sectionCounts.fill(0);
    this.visibilityMasks.clear();
    this.fades.clear();
    this.lastVisible.length = 0;
    for (let i = 0; i < this.visColumnCount; i++) {
      this.visColumns[i]!.length = 0;
    }
    this.visColumnCount = 0;
    this.releaseBatchResources();
  }

  /**
   * World teardown: deletes every arena page (buffers + VAO) with its quarantined ranges, and
   * shrinks the draw-data texture ring back to its initial size. The arena pages are recreated
   * lazily by the next world. The three draw-data ring textures and the tint atlas are fixed-size
   * objects created with the renderer, so they stay as part of the pre-world baseline.
   */
  private releaseBatchResources(): void {
    this.opaqueArena.releaseAll();
    this.cutoutArena.releaseAll();
    this.translucentArena.releaseAll();
    this.batcher.resetCapacity();
    this.ensureDrawDataTextures(this.batcher.getTextureHeight());
    this.tintCache.clearAll();
    this.boundVao = null;
  }

  public beginUploadBatch(): void {
    const frame = ++this.uploadFrame;
    this.uploadTintUnitReady = false;
    this.opaqueArena.beginUploadBatch(frame);
    this.cutoutArena.beginUploadBatch(frame);
    this.translucentArena.beginUploadBatch(frame);
  }

  public endUploadBatch(): void {
    this.opaqueArena.endUploadBatch();
    this.cutoutArena.endUploadBatch();
    this.translucentArena.endUploadBatch();
  }

  private cancelPendingSectionUpload(key: string): void {
    const pending = this.pendingSectionUploads.get(key);
    if (!pending) return;
    this.pendingSectionUploads.delete(key);
    this.freeGPUBucketMesh(pending.gpuMesh.opaque);
    this.freeGPUBucketMesh(pending.gpuMesh.cutout);
    this.freeGPUBucketMesh(pending.gpuMesh.translucent);
  }

  private cancelPendingColumnUploads(sx: number, sz: number): void {
    for (const [key, pending] of this.pendingSectionUploads)
      if (pending.gpuMesh.sx === sx && pending.gpuMesh.sz === sz)
        this.cancelPendingSectionUpload(key);
  }

  private createGPUBucketMesh(
    bucket: MeshBucketData,
    arena: TerrainArena,
    sortable = false,
    additionalBucket?: MeshBucketData,
    dedicatedPage = false,
    packedVertices?: Uint32Array,
  ): GPUBucketMesh | null {
    const hasBucket = bucket.quadCount > 0 && bucket.vertices.length > 0;
    const hasAdditional =
      additionalBucket !== undefined &&
      additionalBucket.quadCount > 0 &&
      additionalBucket.vertices.length > 0;
    if (!hasBucket && !hasAdditional) {
      return null;
    }

    const quadCount = bucket.quadCount + (hasAdditional ? additionalBucket!.quadCount : 0);
    const allocation = packedVertices
      ? arena.uploadPacked(packedVertices, quadCount, dedicatedPage)
      : hasBucket && hasAdditional
        ? arena.upload(bucket, additionalBucket, dedicatedPage)
        : arena.upload(hasBucket ? bucket : additionalBucket!, undefined, dedicatedPage);

    let centers: Float32Array | undefined;
    let sorter: TranslucentSorter | undefined;
    if (sortable) {
      const sortStart = renderPhaseStats.start();
      centers = quadCenters(canonicalQuadVertices(bucket));
      sorter = new TranslucentSorter(centers);
      renderPhaseStats.end('translucentUploadPrepMs', sortStart);
    }
    return {
      vao: allocation.page.vao,
      get vbo() {
        return arena.debugReadbackVertices(allocation);
      },
      get ebo() {
        return arena.debugReadbackIndices(allocation, allocation.indexCount);
      },
      allocation,
      arena,
      lineEbo: null,
      sorter,
      sortCamera: sortable ? [Infinity, Infinity, Infinity] : undefined,
      indexCount: allocation.indexCount,
      lineIndexCount: quadCount * 8,
    };
  }

  /** Debug outlines are uploaded only when requested, rather than for every streamed mesh. */
  private wireframeBuffer(bucket: GPUBucketMesh): WebGLBuffer {
    if (bucket.lineEbo) return bucket.lineEbo;
    const gl = this.glWrapper.gl;
    const lineIndices = new Uint32Array(bucket.lineIndexCount);
    for (let q = 0; q < bucket.lineIndexCount / 8; q++) {
      const base = q * 4 + bucket.allocation.vertexBase;
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
    if (bucketMesh.lineEbo) this.glWrapper.deleteBuffer(bucketMesh.lineEbo);
    bucketMesh.arena.free(bucketMesh.allocation);
  }

  /** Sway masks, rebuilt only when the atlas changes. */
  private getFoliage(atlas: TextureAtlas) {
    if (this.foliage?.atlas === atlas) return this.foliage;
    const registry = BlockRegistry.getInstance();
    this.foliage = {
      atlas,
      sway: buildSwayMasks(registry, atlas),
    };
    return this.foliage;
  }

  private uniform1f(location: WebGLUniformLocation | null, slot: number, value: number): void {
    if (!location) return;
    const cache = this.programUniformCache[this.activeLightingVariant]!;
    if (cache[slot] === value) return;
    this.glWrapper.gl.uniform1f(location, value);
    cache[slot] = value;
  }

  private uniform1i(location: WebGLUniformLocation | null, slot: number, value: number): void {
    if (!location) return;
    const cache = this.programUniformCache[this.activeLightingVariant]!;
    if (cache[slot] === value) return;
    this.glWrapper.gl.uniform1i(location, value);
    cache[slot] = value;
  }

  private uniform2f(
    location: WebGLUniformLocation | null,
    slot: number,
    x: number,
    y: number,
  ): void {
    if (!location) return;
    const cache = this.programUniformCache[this.activeLightingVariant]!;
    if (cache[slot] === x && cache[slot + 1] === y) return;
    this.glWrapper.gl.uniform2f(location, x, y);
    cache[slot] = x;
    cache[slot + 1] = y;
  }

  private uniform3f(
    location: WebGLUniformLocation | null,
    slot: number,
    x: number,
    y: number,
    z: number,
  ): void {
    if (!location) return;
    const cache = this.programUniformCache[this.activeLightingVariant]!;
    if (cache[slot] === x && cache[slot + 1] === y && cache[slot + 2] === z) return;
    this.glWrapper.gl.uniform3f(location, x, y, z);
    cache[slot] = x;
    cache[slot + 1] = y;
    cache[slot + 2] = z;
  }

  private uniform4fv(
    location: WebGLUniformLocation | null,
    slot: number,
    values: Float32Array,
  ): void {
    if (!location) return;
    const cache = this.programUniformCache[this.activeLightingVariant]!;
    let changed = false;
    for (let i = 0; i < 4 && !changed; i++) changed = cache[slot + i] !== values[i];
    if (!changed) return;
    this.glWrapper.gl.uniform4fv(location, values);
    for (let i = 0; i < 4; i++) cache[slot + i] = values[i]!;
  }

  private uniformMatrix4fv(
    location: WebGLUniformLocation | null,
    slot: number,
    values: ArrayLike<number>,
  ): void {
    if (!location) return;
    const cache = this.programUniformCache[this.activeLightingVariant]!;
    let changed = false;
    for (let i = 0; i < 16 && !changed; i++) changed = cache[slot + i] !== values[i];
    if (!changed) return;
    this.glWrapper.gl.uniformMatrix4fv(location, false, values as Float32List);
    for (let i = 0; i < 16; i++) cache[slot + i] = values[i]!;
  }

  private selectLightingProgram(
    skyOnly: boolean,
    viewProjMatrix: mat4,
    atlas: TextureAtlas,
    wallTorch = false,
    bloom = this.bloomActive,
  ): void {
    const uniformStart = renderPhaseStats.start();
    const gl = this.glWrapper.gl;
    const index = (skyOnly ? 1 : 0) + (wallTorch ? 2 : 0) + (bloom ? 4 : 0);
    if (bloom && !this.programs[index]) {
      this.ensureBloomPrograms();
    }
    if (this.activeLightingVariant !== index) {
      this.activeLightingVariant = index;
      this.program = this.programs[index]!;
      Object.assign(this, this.programLocations[index]);
      gl.useProgram(this.program);
      this.lastProgramSwitches++;
    }
    const { sway } = this.getFoliage(atlas);
    this.uniform1f(this.locFluidTime, UNIFORM_CACHE_SLOT.fluidTime, this.fluidTime);
    if (atlas !== this.swayUniformAtlas) {
      this.swayUniformAtlas = atlas;
      this.swayUniformsValid.fill(0);
    }
    if (!this.swayUniformsValid[index]) {
      gl.uniform4uiv(this.locSwayLeaf, sway.leaf);
      gl.uniform4uiv(this.locSwayPlant, sway.plant);
      this.swayUniformsValid[index] = 1;
    }
    this.uniform1f(this.locSwayOn, UNIFORM_CACHE_SLOT.swayOn, settings.leaves === 'fast' ? 0 : 1);
    this.uniform1f(this.locWindTime, UNIFORM_CACHE_SLOT.windTime, this.windTime);
    this.uniform1i(
      this.locFastLeaves,
      UNIFORM_CACHE_SLOT.fastLeaves,
      settings.leaves === 'fast' ? 1 : 0,
    );
    this.uniform1i(
      this.locWaterTile,
      UNIFORM_CACHE_SLOT.waterTile,
      atlasTileIndex(atlas, 'water_0'),
    );
    this.uniform1i(this.locLavaTile, UNIFORM_CACHE_SLOT.lavaTile, atlasTileIndex(atlas, 'lava_0'));
    this.uniform1i(this.locSceneDepth, UNIFORM_CACHE_SLOT.sceneDepth, 4);
    if (this.locEmissiveMap) {
      this.uniform1i(this.locEmissiveMap, UNIFORM_CACHE_SLOT.emissiveMap, EMISSIVE_TEXTURE_UNIT);
    }
    this.uniformMatrix4fv(
      this.locInverseViewProj,
      UNIFORM_CACHE_SLOT.inverseViewProj,
      this.inverseViewProj,
    );
    this.uniform2f(
      this.locViewport,
      UNIFORM_CACHE_SLOT.viewport,
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
    );
    this.uniform1f(this.locSkyBrightness, UNIFORM_CACHE_SLOT.skyBrightness, this.skyBrightness);
    this.uniform1f(
      this.locSmoothLighting,
      UNIFORM_CACHE_SLOT.smoothLighting,
      settings.smoothLighting ? 1 : 0,
    );
    this.uniform1f(this.locBrightness, UNIFORM_CACHE_SLOT.brightness, settings.brightness);
    this.uniform1i(this.locDebugLight, UNIFORM_CACHE_SLOT.debugLight, this.debugLight ? 1 : 0);
    this.uniform1i(this.locAtlasSampler, UNIFORM_CACHE_SLOT.atlasSampler, 0);
    this.uniform1i(this.locTintAtlas, UNIFORM_CACHE_SLOT.tintAtlas, TINT_ATLAS_UNIT);
    this.uniform1i(this.locDrawDataTex, UNIFORM_CACHE_SLOT.drawDataTex, DRAW_DATA_UNIT);
    this.uniform2f(this.locAtlasSize, UNIFORM_CACHE_SLOT.atlasSize, atlas.width, atlas.height);
    this.uniform1f(this.locCellSize, UNIFORM_CACHE_SLOT.cellSize, CELL_SIZE);
    this.uniformMatrix4fv(this.locViewProj, UNIFORM_CACHE_SLOT.viewProj, viewProjMatrix);
    this.uniform3f(
      this.locCameraPos,
      UNIFORM_CACHE_SLOT.cameraPos,
      this.cameraPos[0],
      this.cameraPos[1],
      this.cameraPos[2],
    );
    this.uniform1f(this.locFogStart, UNIFORM_CACHE_SLOT.fogStart, this.fogStart);
    this.uniform1f(this.locFogEnd, UNIFORM_CACHE_SLOT.fogEnd, this.fogEnd);
    this.uniform3f(
      this.locSunDir,
      UNIFORM_CACHE_SLOT.sunDir,
      this.sunDir[0],
      this.sunDir[1],
      this.sunDir[2],
    );
    this.uniform1f(this.locDayFactor, UNIFORM_CACHE_SLOT.dayFactor, this.dayFactor);
    this.uniform1f(this.locTwilightFactor, UNIFORM_CACHE_SLOT.twilightFactor, this.twilightFactor);
    this.uniform1f(this.locNightFactor, UNIFORM_CACHE_SLOT.nightFactor, this.nightFactor);
    this.uniform1i(
      this.locUnderwater,
      UNIFORM_CACHE_SLOT.underwater,
      this.underwater?.submerged ? 1 : 0,
    );
    this.uniform1f(
      this.locUnderwaterFloor,
      UNIFORM_CACHE_SLOT.underwaterFloor,
      this.underwater?.brightnessFloor ?? 0,
    );
    const color = this.underwater?.fogColor;
    this.uniform3f(
      this.locWaterFogColor,
      UNIFORM_CACHE_SLOT.waterFogColor,
      color?.[0] ?? 0,
      color?.[1] ?? 0,
      color?.[2] ?? 0,
    );
    this.uniform1f(this.locRainFactor, UNIFORM_CACHE_SLOT.rainFactor, this.rainFactor);
    this.uniform1f(this.locLightningFlash, UNIFORM_CACHE_SLOT.lightningFlash, this.lightningFlash);
    this.uniform4fv(this.locDimensionFog, UNIFORM_CACHE_SLOT.dimensionFog, this.dimensionFog);
    renderPhaseStats.end('uniformUploadMs', uniformStart);
  }

  private submitPassCommands(
    pass: 0 | 1 | 2,
    arena: TerrainArena,
    viewProjMatrix: mat4,
    atlas: TextureAtlas,
  ): void {
    const gl = this.glWrapper.gl;
    const cmdCount = this.batcher.getCommandCount(pass);
    if (cmdCount === 0) return;

    const counts = this.batcher.counts;
    const offsets = this.batcher.offsets;
    let currentVariant = -1;

    for (let i = 0; i < cmdCount; i++) {
      const cmd = this.batcher.getCommand(pass, i);
      const page = arena.getPageById(cmd.pageId);
      if (!page) continue;

      if (cmd.variant !== currentVariant) {
        currentVariant = cmd.variant;
        const skyOnly = (currentVariant & 1) !== 0;
        const wallTorch = (currentVariant & 2) !== 0;
        this.selectLightingProgram(skyOnly, viewProjMatrix, atlas, wallTorch, this.bloomActive);
        const uniformStart = renderPhaseStats.start();
        this.uniform1i(this.locIsCutout, UNIFORM_CACHE_SLOT.isCutout, pass === 1 ? 1 : 0);
        this.uniform1i(this.locIsWireframe, UNIFORM_CACHE_SLOT.isWireframe, 0);
        this.uniform1i(
          this.locUseMultiDrawId,
          UNIFORM_CACHE_SLOT.useMultiDrawId,
          this.multiDraw ? 1 : 0,
        );
        renderPhaseStats.end('uniformUploadMs', uniformStart);
      }

      this.bindVao(page.vao);

      if (this.multiDraw) {
        const uniformStart = renderPhaseStats.start();
        this.uniform1i(this.locDrawBase, UNIFORM_CACHE_SLOT.drawBase, cmd.drawBase);
        renderPhaseStats.end('uniformUploadMs', uniformStart);

        const drawStart = renderPhaseStats.start();
        this.multiDraw.multiDrawElementsWEBGL(
          gl.TRIANGLES,
          counts,
          cmd.countsOffset,
          gl.UNSIGNED_INT,
          offsets,
          cmd.offsetsOffset,
          cmd.drawCount,
        );
        this.glWrapper.recordDrawSubmission();
        renderPhaseStats.end('drawSubmissionMs', drawStart);
        if (pass === 2) this.lastTranslucentSubmissions++;
        else this.lastOpaqueCutoutSubmissions++;
        this.passDraws += cmd.drawCount;
      } else {
        for (let d = 0; d < cmd.drawCount; d++) {
          const drawIdx = cmd.drawBase + d;
          const uniformStart = renderPhaseStats.start();
          this.uniform1i(this.locDrawBase, UNIFORM_CACHE_SLOT.drawBase, drawIdx);
          renderPhaseStats.end('uniformUploadMs', uniformStart);
          this.glWrapper.drawElements(
            gl.TRIANGLES,
            counts[drawIdx]!,
            gl.UNSIGNED_INT,
            offsets[drawIdx]!,
          );
          if (pass === 2) this.lastTranslucentSubmissions++;
          else this.lastOpaqueCutoutSubmissions++;
          this.passDraws++;
        }
      }
    }
  }

  private sortTranslucentMeshes(meshes: GPUSectionMesh[]): void {
    for (let i = 0; i < meshes.length; i++) meshes[i]!.sortRank = i;
    for (let root = Math.floor(meshes.length / 2) - 1; root >= 0; root--)
      this.siftTranslucent(meshes, root, meshes.length);
    for (let end = meshes.length - 1; end > 0; end--) {
      const first = meshes[0]!;
      meshes[0] = meshes[end]!;
      meshes[end] = first;
      this.siftTranslucent(meshes, 0, end);
    }
  }

  private siftTranslucent(meshes: GPUSectionMesh[], start: number, length: number): void {
    let root = start;
    for (;;) {
      const left = root * 2 + 1;
      if (left >= length) return;
      let largest = left;
      if (left + 1 < length && this.compareTranslucent(meshes[left + 1]!, meshes[left]!) > 0)
        largest = left + 1;
      if (this.compareTranslucent(meshes[largest]!, meshes[root]!) <= 0) return;
      const mesh = meshes[root]!;
      meshes[root] = meshes[largest]!;
      meshes[largest] = mesh;
      root = largest;
    }
  }

  public render(
    viewProjMatrix: mat4,
    atlasTexture: WebGLTexture,
    atlas: TextureAtlas,
    world?: import('../world/world').World | null,
    drawPlayer?: () => number,
    sceneFramebuffer: WebGLFramebuffer | null = null,
    bloomEnabled = false,
  ): void {
    const gl = this.glWrapper.gl;
    this.bloomActive = bloomEnabled && sceneFramebuffer !== null;
    const lod = this.lodAtmosphere?.lod;

    this.lastOpaqueCutoutSubmissions = 0;
    this.lastTranslucentSubmissions = 0;
    this.lastProgramSwitches = 0;
    this.lastTextureBinds = 0;
    this.lastVaoBinds = 0;
    this.activeLightingVariant = -1;
    this.boundVao = null;

    this.drawDataTextureRing.beginFrame();
    this.opaqueArena.beginDrawFrame();
    this.cutoutArena.beginDrawFrame();
    this.translucentArena.beginDrawFrame();

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
    this.lastTextureBinds++;

    const visibilityStart = renderPhaseStats.start();
    const planeStart = renderPhaseStats.start();
    const planes = extractFrustumPlanes(viewProjMatrix, this.frustumPlanes);
    renderPhaseStats.end('frustumCullMs', planeStart);
    if (cullingSettings.cave) {
      let minMeshY = 19;
      let maxMeshY = 0;
      for (let y = 0; y < this.sectionCounts.length; y++) {
        if (!this.sectionCounts[y]) continue;
        minMeshY = Math.min(minMeshY, y);
        maxMeshY = y;
      }
      this.visibilityMasks.prepare(
        this.cameraPos,
        planes,
        lod ? FULL_DETAIL_RADIUS : this.renderDistance,
        cullingSettings.frustum,
        minMeshY,
        maxMeshY,
        Math.round(this.cameraYaw * 20),
        Math.round(this.cameraPitch * 20),
        this.cameraFov,
        this.cameraAspect,
      );
    }
    renderPhaseStats.end('caveFrustumMs', visibilityStart);

    const drawListStart = renderPhaseStats.start();
    const meshes = this.lastVisible;
    meshes.length = 0;
    this.visibleTranslucent.length = 0;
    const previousTranslucentGeneration = this.translucentVisibilityGeneration;
    this.translucentVisibilityGeneration++;
    const columns = this.visColumns;
    const nowMs = performance.now();
    let columnCount = 0;
    const lodMask = lod?.mask;
    lodMask?.moveTo(Math.floor(this.cameraPos[0]! / 16), Math.floor(this.cameraPos[2]! / 16));
    gl.activeTexture(gl.TEXTURE0 + SCRATCH_TEXTURE_UNIT);
    this.activeUnit = SCRATCH_TEXTURE_UNIT;
    this.batcher.beginFrame();
    this.passDraws = 0;
    this.passTriangles = 0;

    for (let column = 0; column < this.columnLists.length; column++) {
      const list = this.columnLists[column]!;
      const first = list[0]!;
      if (lodMask && chebyshev(first.sx, first.sz, lodMask.cx, lodMask.cz) > FULL_DETAIL_RADIUS)
        continue;
      if (cullingSettings.frustum && !columnInFrustum(planes, first.sx, first.sz)) continue;
      const fullMesh = lod?.hasFullMesh(first.sx, first.sz);
      if (lod && !fullMesh && lod.covers(first.sx, first.sz)) continue;
      const visible = columns[columnCount]!;
      visible.length = 0;
      for (let i = 0; i < list.length; i++) {
        const mesh = list[i]!;
        if (cullingSettings.frustum && !sectionInFrustum(planes, mesh.sx, mesh.sy, mesh.sz))
          continue;
        if (cullingSettings.cave && !this.visibilityMasks.visible(mesh.sx, mesh.sy, mesh.sz))
          continue;
        visible.push(mesh);
        meshes.push(mesh);
        if (mesh.translucent) {
          this.visibleTranslucent.push(mesh);
          if (mesh.translucentVisibleGeneration !== previousTranslucentGeneration)
            this.sortDirty = true;
          mesh.translucentVisibleGeneration = this.translucentVisibilityGeneration;
        }
        mesh.visibleColumn = columnCount;
      }
      if (visible.length === 0) continue;
      columns[columnCount] = visible;
      const tintSlot = this.tintCache.getColumnTintSlot(first.sx, first.sz, world);
      const fade = lod ? 1 : this.fades.amount(first.sx, first.sz, nowMs);
      this.visTintSlot[columnCount] = tintSlot;
      this.visFade[columnCount] = fade;
      if (fullMesh) lodMask?.markDrawn(first.sx, first.sz);

      for (let i = 0; i < visible.length; i++) {
        const mesh = visible[i]!;
        const variant = (mesh.hasBlockLight ? 0 : 1) + (mesh.hasWallTorch ? 2 : 0);
        const ox = mesh.sx * 16;
        const oy = mesh.sy * 16;
        const oz = mesh.sz * 16;
        const opaque = mesh.opaque;
        if (opaque) {
          opaque.arena.markUsed(opaque.allocation);
          this.batcher.addUnordered(
            0,
            variant,
            opaque.allocation.page.id,
            opaque.indexCount,
            opaque.allocation.indices.offset,
            ox,
            oy,
            oz,
            fade,
            tintSlot,
          );
          this.passTriangles += opaque.indexCount / 3;
        }
        const cutout = mesh.cutout;
        if (cutout) {
          cutout.arena.markUsed(cutout.allocation);
          this.batcher.addUnordered(
            1,
            variant,
            cutout.allocation.page.id,
            cutout.indexCount,
            cutout.allocation.indices.offset,
            ox,
            oy,
            oz,
            fade,
            tintSlot,
          );
          this.passTriangles += cutout.indexCount / 3;
        }
      }
      columnCount++;
    }
    for (let i = columnCount; i < this.visColumnCount; i++) {
      columns[i]!.length = 0;
    }
    this.visColumnCount = columnCount;
    if (this.visibleTranslucent.length !== this.previousVisibleTranslucentCount)
      this.sortDirty = true;
    this.previousVisibleTranslucentCount = this.visibleTranslucent.length;

    // Pack opaque and cutout commands into the per-frame draw-data buffer
    this.batcher.finalizeUnorderedPass(0);
    this.batcher.finalizeUnorderedPass(1);
    renderPhaseStats.end('drawListMs', drawListStart);

    // Sort translucent sections and pack consecutive runs into the same per-frame draw-data buffer
    const translucentMeshes = this.visibleTranslucent;
    if (translucentMeshes.length > 0) {
      const camera = this.cameraPos;
      const moved = distanceSquared(camera, this.sortedCamera) >= TRANSLUCENT_SORT_STEP ** 2;
      if (moved || this.sortDirty) {
        const sortStart = renderPhaseStats.start();
        this.sortTranslucentMeshes(translucentMeshes);
        renderPhaseStats.end('translucentSortMs', sortStart);
        this.sortedCamera[0] = camera[0];
        this.sortedCamera[1] = camera[1];
        this.sortedCamera[2] = camera[2];
        this.sortDirty = false;
      }
      this.batcher.beginTranslucentPass();
      for (let i = 0; i < translucentMeshes.length; i++) {
        const mesh = translucentMeshes[i]!;
        const c = mesh.visibleColumn;
        const bucket = mesh.translucent!;
        bucket.arena.markUsed(bucket.allocation);
        const local = this.translucentLocal;
        local[0] = camera[0] - mesh.sx * 16;
        local[1] = camera[1] - mesh.sy * 16;
        local[2] = camera[2] - mesh.sz * 16;
        if (
          (local[0]! - 8) ** 2 + (local[1]! - 8) ** 2 + (local[2]! - 8) ** 2 <
            TRANSLUCENT_NEAR_DISTANCE ** 2 &&
          (!bucket.sortCamera ||
            distanceSquared(local, bucket.sortCamera) >= TRANSLUCENT_SORT_STEP ** 2)
        ) {
          this.bindVao(bucket.vao);
          const sorted = bucket.sorter!.sort(local, bucket.allocation.vertexBase);
          bucket.arena.updateSortedIndices(bucket.allocation, sorted);
          bucket.sortCamera![0] = local[0]!;
          bucket.sortCamera![1] = local[1]!;
          bucket.sortCamera![2] = local[2]!;
        }
        const variant = (mesh.hasBlockLight ? 0 : 1) + (mesh.hasWallTorch ? 2 : 0);
        this.batcher.appendTranslucentDraw(
          variant,
          bucket.allocation.page.id,
          bucket.indexCount,
          bucket.allocation.indices.offset,
          mesh.sx * 16,
          mesh.sy * 16,
          mesh.sz * 16,
          this.visFade[c]!,
          this.visTintSlot[c]!,
        );
        this.passTriangles += bucket.indexCount / 3;
      }
    }

    let wireStartDraw = 0;
    if (wireframeEnabled) {
      wireStartDraw = this.batcher.getTotalDraws();
      for (let c = 0; c < this.visColumnCount; c++) {
        const fade = this.visFade[c]!;
        const list = columns[c]!;
        for (let m = 0; m < list.length; m++) {
          const mesh = list[m]!;
          for (let pass = 0; pass < 3; pass++) {
            const bucket = pass === 0 ? mesh.opaque : pass === 1 ? mesh.cutout : mesh.translucent;
            if (bucket) {
              this.batcher.appendAuxiliaryDraw(
                mesh.sx * 16,
                mesh.sy * 16,
                mesh.sz * 16,
                fade,
                TINT_DEFAULT_SLOT,
              );
            }
          }
        }
      }
    }

    // Bind the shared 2D tint atlas once per frame on unit 1
    if (this.tintCache.texture) {
      gl.activeTexture(gl.TEXTURE0 + TINT_ATLAS_UNIT);
      this.activeUnit = TINT_ATLAS_UNIT;
      gl.bindTexture(gl.TEXTURE_2D, this.tintCache.texture);
      this.lastTextureBinds++;
    }

    // Bind the draw-data ring texture on unit 2; upload only when its payload changed.
    this.uploadDrawDataTexture(this.batcher.getDirtyRows());

    this.fluidTime = fluidAnimation.sample(nowMs);
    this.windTime = windAnimation.sample(nowMs, this.worldPaused || fluidAnimation.pausedState);
    mat4.invert(this.inverseViewProj, viewProjMatrix);

    if (this.bloomActive) {
      const emissiveTex = this.getEmissiveTexture(atlas);
      gl.activeTexture(gl.TEXTURE0 + EMISSIVE_TEXTURE_UNIT);
      this.activeUnit = EMISSIVE_TEXTURE_UNIT;
      gl.bindTexture(gl.TEXTURE_2D, emissiveTex);
      this.lastTextureBinds++;
      gl.drawBuffers(this.drawBuf2);
    }

    // 1. Opaque Pass
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    const opaquePassStart = renderPhaseStats.start();
    this.submitPassCommands(0, this.opaqueArena, viewProjMatrix, atlas);
    renderPhaseStats.end('opaquePassMs', opaquePassStart);

    lod?.prepare(planes, this.cameraPos);
    if (this.bloomActive && lod && this.lodAtmosphere) gl.drawBuffers(this.drawBuf1);
    const lodDraws =
      lod && this.lodAtmosphere
        ? lod.draw(
            false,
            viewProjMatrix,
            this.inverseViewProj,
            this.skyBrightness,
            this.lodAtmosphere,
            atlas,
            this.fluidTime,
            this.activeUnit,
            this.debugLight,
          )
        : 0;
    this.activeLightingVariant = -1;
    this.boundVao = null;
    if (this.bloomActive && lod && this.lodAtmosphere) gl.drawBuffers(this.drawBuf2);

    // 2. Cutout Pass
    const cutoutPassStart = renderPhaseStats.start();
    this.submitPassCommands(1, this.cutoutArena, viewProjMatrix, atlas);
    renderPhaseStats.end('cutoutPassMs', cutoutPassStart);

    if (this.bloomActive) gl.drawBuffers(this.drawBuf1);
    const playerDraws = drawPlayer?.() ?? 0;
    this.activeUnit = 0;
    this.activeLightingVariant = -1;
    this.boundVao = null;

    // Opaque and cutout rendering is the depth pre-pass for water absorption.
    const hasTranslucent = (lod?.hasWater ?? false) || translucentMeshes.length > 0;
    if (hasTranslucent) {
      const depthCaptureStart = renderPhaseStats.start();
      gl.activeTexture(gl.TEXTURE4);
      this.activeUnit = 4;
      this.depth.capture(sceneFramebuffer);
      this.activeUnit = 4;
      renderPhaseStats.end('depthCaptureMs', depthCaptureStart);
    }
    // 3. Translucent Pass (LOD water runs with single-output drawBuf1 before drawTranslucent switches to drawBuf2)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    const translucentPassStart = renderPhaseStats.start();
    const lodWaterDraws =
      lod && this.lodAtmosphere
        ? lod.draw(
            true,
            viewProjMatrix,
            this.inverseViewProj,
            this.skyBrightness,
            this.lodAtmosphere,
            atlas,
            this.fluidTime,
            this.activeUnit,
            this.debugLight,
          )
        : 0;
    this.activeLightingVariant = -1;
    this.boundVao = null;
    if (this.bloomActive) gl.drawBuffers(this.drawBuf2);
    this.submitPassCommands(2, this.translucentArena, viewProjMatrix, atlas);
    renderPhaseStats.end('translucentPassMs', translucentPassStart);
    if (this.bloomActive) gl.drawBuffers(this.drawBuf1);

    let drawCalls = this.passDraws + playerDraws + lodDraws + lodWaterDraws;
    const triangles = this.passTriangles + playerDraws * 12 + (lod?.submittedTriangles ?? 0);

    // Restore depth write
    gl.depthMask(true);

    // 4. Wireframe Overlay Pass (if enabled)
    if (wireframeEnabled) {
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-1.0, -1.0);

      // Wireframe draw metadata was packed before the frame's single texture upload.
      let cursor = wireStartDraw;
      for (let c = 0; c < this.visColumnCount; c++) {
        const list = columns[c]!;
        for (let m = 0; m < list.length; m++) {
          const mesh = list[m]!;
          for (let pass = 0; pass < 3; pass++) {
            const bucket = pass === 0 ? mesh.opaque : pass === 1 ? mesh.cutout : mesh.translucent;
            if (bucket) {
              this.selectLightingProgram(false, viewProjMatrix, atlas, mesh.hasWallTorch, false);
              this.uniform1i(this.locUseMultiDrawId, UNIFORM_CACHE_SLOT.useMultiDrawId, 0);
              this.uniform1i(this.locIsWireframe, UNIFORM_CACHE_SLOT.isWireframe, 1);
              this.uniform1i(this.locIsCutout, UNIFORM_CACHE_SLOT.isCutout, 0);
              this.uniform1i(this.locDrawBase, UNIFORM_CACHE_SLOT.drawBase, cursor++);
              this.bindVao(bucket.vao);
              gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.wireframeBuffer(bucket));
              this.glWrapper.drawElements(gl.LINES, bucket.lineIndexCount, gl.UNSIGNED_INT, 0);
              // The VAO records its element buffer: put the triangle indices back for the next frame.
              bucket.arena.bindSharedIndices(bucket.allocation);
              drawCalls++;
            }
          }
        }
      }

      gl.disable(gl.POLYGON_OFFSET_FILL);
    }

    this.bindVao(null);

    this.drawDataTextureRing.endFrame();
    this.opaqueArena.endDrawFrame();
    this.cutoutArena.endDrawFrame();
    this.translucentArena.endDrawFrame();

    renderStats.drawCalls = drawCalls;
    renderStats.triangles = triangles;
    // chunksLoaded and chunksMeshed come from the streamer (WorldManager); only the draw knows
    // how many section meshes were visible.
    renderStats.chunksVisible = meshes.length;
  }
}
