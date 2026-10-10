import { mat4 } from 'gl-matrix';
import { GLWrapper } from './gl';
import { TextureAtlas, CELL_SIZE } from './atlas';
import { SectionMeshData, MeshBucketData } from '../mesh/greedy';
import { renderStats } from '../debug/api/core';
import { wireframeEnabled } from '../debug/api/wireframe';
import { ColumnTintCache } from './tint-cache';
import { mergeMeshBuckets } from '../mesh/models';
import { columnInFrustum, extractFrustumPlanes } from './frustum';
import { bayerGlsl } from './dither';
import { ColumnFades, UniformValueCache } from './column-fade';

const VS_CHUNK = `#version 300 es
precision highp float;

layout(location = 0) in uint a_word0;
layout(location = 1) in uint a_word1;

uniform mat4 u_viewProj;
uniform vec3 u_sectionOrigin;

out vec3 v_normal;
out vec2 v_unwrappedUV;
out vec3 v_worldPos;
flat out uint v_tileIndex;
flat out uint v_tintIndex;

const vec3 NORMALS[6] = vec3[6](
  vec3(1.0, 0.0, 0.0),   // 0: +X
  vec3(-1.0, 0.0, 0.0),  // 1: -X
  vec3(0.0, 1.0, 0.0),   // 2: +Y
  vec3(0.0, -1.0, 0.0),  // 3: -Y
  vec3(0.0, 0.0, 1.0),   // 4: +Z
  vec3(0.0, 0.0, -1.0)   // 5: -Z
);

void main() {
  uint x = a_word0 & 31u;
  uint y = (a_word0 >> 5u) & 31u;
  uint z = (a_word0 >> 10u) & 31u;
  uint normalIdx = (a_word0 >> 15u) & 7u;

  uint tileIdx = a_word1 & 65535u;
  float u_local = float((a_word1 >> 16u) & 255u);
  float v_local = float((a_word1 >> 24u) & 255u);

  vec3 localPos = vec3(float(x), float(y), float(z));
  vec3 worldPos = u_sectionOrigin + localPos;

  uint tintIdx = (a_word0 >> 28u) & 15u;

  v_normal = NORMALS[normalIdx];
  v_unwrappedUV = vec2(u_local, v_local);
  v_worldPos = worldPos;
  v_tileIndex = tileIdx;
  v_tintIndex = tintIdx;

  gl_Position = u_viewProj * vec4(worldPos, 1.0);
}
`;

const FS_CHUNK = `#version 300 es
precision highp float;

in vec3 v_normal;
in vec2 v_unwrappedUV;
in vec3 v_worldPos;
flat in uint v_tileIndex;
flat in uint v_tintIndex;

uniform sampler2D u_atlasSampler;
uniform sampler2D u_grassTintMap;
uniform sampler2D u_foliageTintMap;
uniform vec2 u_atlasSize;
uniform float u_cellSize;
uniform int u_isCutout;
uniform int u_isWireframe;
// Fade-in of the column, 0 (nothing drawn) to 1 (all of it), dithered with the Bayer table below.
uniform float u_fade;

const float BAYER_4X4[16] = ${bayerGlsl()};

out vec4 fragColor;

void main() {
  if (u_fade < 1.0) {
    ivec2 pixel = ivec2(gl_FragCoord.xy);
    float threshold = BAYER_4X4[(pixel.y & 3) * 4 + (pixel.x & 3)];
    if (threshold >= u_fade) {
      discard;
    }
  }

  if (u_isWireframe == 1) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // Grid math derivation of atlas tile rect
  uint cellsPerRow = uint(u_atlasSize.x / u_cellSize);
  uint col = v_tileIndex % cellsPerRow;
  uint row = v_tileIndex / cellsPerRow;

  vec2 tilePos = vec2(float(col) * u_cellSize + 4.0, float(row) * u_cellSize + 4.0);
  vec2 tileSize = vec2(16.0, 16.0);

  vec2 uMinVmin = tilePos / u_atlasSize;
  vec2 uSizeVsize = tileSize / u_atlasSize;

  vec2 localUV = fract(v_unwrappedUV);

  vec2 dUVdx = dFdx(v_unwrappedUV) * uSizeVsize;
  vec2 dUVdy = dFdy(v_unwrappedUV) * uSizeVsize;

  vec2 halfTexel = vec2(0.5) / u_atlasSize;
  vec2 tileUV = clamp(uMinVmin + localUV * uSizeVsize, uMinVmin + halfTexel, uMinVmin + uSizeVsize - halfTexel);

  vec4 texColor = textureGrad(u_atlasSampler, tileUV, dUVdx, dUVdy);

  if (u_isCutout == 1 && texColor.a < 0.5) {
    discard;
  }

  // Per-block tint lookup for the block that owns the face
  // TS reference implementation: tintTexelForFace in src/render/tint-utils.ts
  ivec3 blockPos = ivec3(floor(v_worldPos - 0.5 * v_normal));
  ivec2 tintTexel = (blockPos.xz % 16 + 16) % 16;
  vec3 grassTint = texelFetch(u_grassTintMap, tintTexel, 0).rgb;
  vec3 foliageTint = texelFetch(u_foliageTintMap, tintTexel, 0).rgb;

  // Biome Tinting
  if (v_tintIndex == 1u) {
    // Grass top
    texColor.rgb *= grassTint;
  } else if (v_tintIndex == 2u) {
    // Foliage tinting (oak leaves)
    texColor.rgb *= foliageTint;
  } else if (v_tintIndex == 3u) {
    // Grass side: tint fringe (texColor.a == 1.0), dirt base (texColor.a == 0.0) stays untinted
    vec3 tintedRgb = texColor.rgb * grassTint;
    texColor = vec4(mix(texColor.rgb, tintedRgb, texColor.a), 1.0);
  }

  // Fixed face shade: top 1.0, +-Z 0.8, +-X 0.6, bottom 0.5 (decisions/M03g-face-shading.md)
  float diff = v_normal.y > 0.5 ? 1.0 : (v_normal.y < -0.5 ? 0.5 : (abs(v_normal.z) > 0.5 ? 0.8 : 0.6));

  fragColor = vec4(texColor.rgb * diff, texColor.a);
}
`;

// Texture units 0, 1 and 2 hold the atlas and the grass and foliage tint maps while drawing.
const SCRATCH_TEXTURE_UNIT = 3;

export interface GPUBucketMesh {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  ebo: WebGLBuffer;
  lineEbo: WebGLBuffer;
  indexCount: number;
  lineIndexCount: number;
}

export interface GPUSectionMesh {
  key: string;
  sx: number;
  sy: number;
  sz: number;
  opaque: GPUBucketMesh | null;
  cutout: GPUBucketMesh | null;
  translucent: GPUBucketMesh | null;
}

export class ChunkRenderer {
  private glWrapper: GLWrapper;
  private program: WebGLProgram;

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

  /** The section meshes drawn by the latest render() call: those of columns inside the frustum. */
  public lastVisible: GPUSectionMesh[] = [];

  constructor(glWrapper: GLWrapper) {
    this.glWrapper = glWrapper;
    this.program = this.glWrapper.createProgram(VS_CHUNK, FS_CHUNK);
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
    this.locFade = gl.getUniformLocation(this.program, 'u_fade')!;
    this.fadeUniform = new UniformValueCache((value) => gl.uniform1f(this.locFade, value));
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

    this.tintCache.onSectionAdded(sx, sy, sz);

    const opaque = this.createGPUBucketMesh(meshData.opaque);
    // Plants (cross models) are drawn in the cutout pass, in the same draw call as the leaves
    const cutout = this.createGPUBucketMesh(mergeMeshBuckets(meshData.cutout, meshData.models));
    const translucent = this.createGPUBucketMesh(meshData.translucent);

    const gpuMesh: GPUSectionMesh = {
      key,
      sx,
      sy,
      sz,
      opaque,
      cutout,
      translucent,
    };

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
  }

  private createGPUBucketMesh(bucket: MeshBucketData): GPUBucketMesh | null {
    if (bucket.quadCount === 0 || bucket.vertices.length === 0) {
      return null;
    }

    const gl = this.glWrapper.gl;
    const vao = this.glWrapper.createVertexArray();
    const vbo = this.glWrapper.createBuffer();
    const ebo = this.glWrapper.createBuffer();
    const lineEbo = this.glWrapper.createBuffer();

    gl.bindVertexArray(vao);

    // VBO (packed 2xuint32 per vertex)
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, bucket.vertices, gl.STATIC_DRAW);

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
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, bucket.indices, gl.STATIC_DRAW);

    // Line EBO (Lines: 8 Uint32 indices per quad)
    const lineIndices = new Uint32Array(bucket.quadCount * 8);
    for (let q = 0; q < bucket.quadCount; q++) {
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

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lineEbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, lineIndices, gl.STATIC_DRAW);

    // Re-bind triangle EBO as default for VAO
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);

    gl.bindVertexArray(null);

    return {
      vao,
      vbo,
      ebo,
      lineEbo,
      indexCount: bucket.indices.length,
      lineIndexCount: lineIndices.length,
    };
  }

  private freeGPUBucketMesh(bucketMesh: GPUBucketMesh | null): void {
    if (!bucketMesh) return;
    this.glWrapper.deleteVertexArray(bucketMesh.vao);
    this.glWrapper.deleteBuffer(bucketMesh.vbo);
    this.glWrapper.deleteBuffer(bucketMesh.ebo);
    this.glWrapper.deleteBuffer(bucketMesh.lineEbo);
  }

  /** Draws one pass (0 opaque, 1 cutout, 2 translucent) over the visible columns gathered by render(). */
  private drawPass(pass: number): void {
    const gl = this.glWrapper.gl;
    const columns = this.visColumns;
    for (let c = 0; c < columns.length; c++) {
      const list = columns[c]!;
      let tintsBound = false;
      for (let i = 0; i < list.length; i++) {
        const mesh = list[i]!;
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

  public render(
    viewProjMatrix: mat4,
    atlasTexture: WebGLTexture,
    atlas: TextureAtlas,
    world?: import('../world/world').World | null,
  ): void {
    const gl = this.glWrapper.gl;

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    gl.useProgram(this.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
    gl.uniform1i(this.locAtlasSampler, 0);

    gl.uniform1i(this.locGrassTintMap, 1);
    gl.uniform1i(this.locFoliageTintMap, 2);

    gl.uniform2f(this.locAtlasSize, atlas.width, atlas.height);
    gl.uniform1f(this.locCellSize, CELL_SIZE);
    gl.uniformMatrix4fv(this.locViewProj, false, viewProjMatrix);

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
      const pair = this.tintCache.getColumnTints(first.sx, first.sz, world);
      columns[columnCount] = list;
      this.visGrass[columnCount] = pair.grassTexture;
      this.visFoliage[columnCount] = pair.foliageTexture;
      this.visFade[columnCount] = this.fades.amount(first.sx, first.sz, nowMs);
      columnCount++;
      for (const mesh of list) meshes.push(mesh);
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
    gl.uniform1i(this.locIsCutout, 0);
    gl.uniform1i(this.locIsWireframe, 0);
    this.drawPass(0);

    // 2. Cutout Pass
    gl.uniform1i(this.locIsCutout, 1);
    this.drawPass(1);

    // 3. Translucent Pass
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.uniform1i(this.locIsCutout, 0);
    this.drawPass(2);

    let drawCalls = this.passDraws;
    const triangles = this.passTriangles;

    // Restore depth write
    gl.depthMask(true);

    // 4. Wireframe Overlay Pass (if enabled)
    if (wireframeEnabled) {
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
              gl.uniform3f(this.locSectionOrigin, mesh.sx * 16, mesh.sy * 16, mesh.sz * 16);
              gl.bindVertexArray(bucket.vao);
              gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bucket.lineEbo);
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
