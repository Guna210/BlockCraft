import { mat4 } from 'gl-matrix';
import { GLWrapper } from './gl';
import { TextureAtlas, CELL_SIZE } from './atlas';
import { SectionMeshData, MeshBucketData } from '../mesh/greedy';
import { renderStats } from '../debug/api/core';
import { wireframeEnabled } from '../debug/api/wireframe';

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

out vec4 fragColor;

void main() {
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

  // Per-block smooth tint sampling from column tint map
  vec2 localXZ = fract(v_worldPos.xz / 16.0);
  vec3 grassTint = texture(u_grassTintMap, localXZ).rgb;
  vec3 foliageTint = texture(u_foliageTintMap, localXZ).rgb;

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

  vec3 lightDir = normalize(vec3(0.4, 0.8, 0.5));
  float diff = max(dot(v_normal, lightDir), 0.35);

  fragColor = vec4(texColor.rgb * diff, texColor.a);
}
`;

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

  private grassTintTexture: WebGLTexture;
  private foliageTintTexture: WebGLTexture;
  private defaultGrassTintData: Uint8Array;
  private defaultFoliageTintData: Uint8Array;

  private sectionMeshes: Map<string, GPUSectionMesh> = new Map();

  constructor(glWrapper: GLWrapper) {
    this.glWrapper = glWrapper;
    this.program = this.glWrapper.createProgram(VS_CHUNK, FS_CHUNK);

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

    // Create 16x16 column tint textures
    this.grassTintTexture = this.glWrapper.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.grassTintTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.foliageTintTexture = this.glWrapper.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.foliageTintTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Default Plains tint data (256 * 3 bytes)
    this.defaultGrassTintData = new Uint8Array(256 * 3);
    this.defaultFoliageTintData = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      this.defaultGrassTintData[i * 3] = 124;
      this.defaultGrassTintData[i * 3 + 1] = 189;
      this.defaultGrassTintData[i * 3 + 2] = 71;

      this.defaultFoliageTintData[i * 3] = 119;
      this.defaultFoliageTintData[i * 3 + 1] = 177;
      this.defaultFoliageTintData[i * 3 + 2] = 58;
    }
  }

  public uploadSectionMesh(
    sx: number,
    sy: number,
    sz: number,
    meshData: SectionMeshData,
  ): GPUSectionMesh {
    const key = `${sx},${sy},${sz}`;
    this.removeSectionMesh(key);

    const opaque = this.createGPUBucketMesh(meshData.opaque);
    const cutout = this.createGPUBucketMesh(meshData.cutout);
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
    return gpuMesh;
  }

  public removeSectionMesh(key: string): void {
    const existing = this.sectionMeshes.get(key);
    if (!existing) return;

    this.freeGPUBucketMesh(existing.opaque);
    this.freeGPUBucketMesh(existing.cutout);
    this.freeGPUBucketMesh(existing.translucent);

    this.sectionMeshes.delete(key);
  }

  public clearAllMeshes(): void {
    for (const key of Array.from(this.sectionMeshes.keys())) {
      this.removeSectionMesh(key);
    }
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

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.grassTintTexture);
    gl.uniform1i(this.locGrassTintMap, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.foliageTintTexture);
    gl.uniform1i(this.locFoliageTintMap, 2);

    gl.uniform2f(this.locAtlasSize, atlas.width, atlas.height);
    gl.uniform1f(this.locCellSize, CELL_SIZE);
    gl.uniformMatrix4fv(this.locViewProj, false, viewProjMatrix);

    let drawCalls = 0;
    let triangles = 0;

    const meshes = Array.from(this.sectionMeshes.values());

    // Helper to upload 16x16 per-column tint textures for column (sx, sz)
    const setColumnTints = (sx: number, sz: number) => {
      let gData = this.defaultGrassTintData;
      let fData = this.defaultFoliageTintData;

      if (world && world.worldType !== 'flat') {
        const col = world.getColumn(sx, sz, false);
        if (col && col.grassTints && col.foliageTints) {
          gData = col.grassTints;
          fData = col.foliageTints;
        }
      }

      gl.activeTexture(gl.TEXTURE1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 16, 16, 0, gl.RGB, gl.UNSIGNED_BYTE, gData);

      gl.activeTexture(gl.TEXTURE2);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 16, 16, 0, gl.RGB, gl.UNSIGNED_BYTE, fData);
    };

    // 1. Opaque Pass
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.uniform1i(this.locIsCutout, 0);
    gl.uniform1i(this.locIsWireframe, 0);

    for (const mesh of meshes) {
      if (mesh.opaque) {
        setColumnTints(mesh.sx, mesh.sz);
        gl.uniform3f(this.locSectionOrigin, mesh.sx * 16, mesh.sy * 16, mesh.sz * 16);
        gl.bindVertexArray(mesh.opaque.vao);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.opaque.ebo);
        this.glWrapper.drawElements(gl.TRIANGLES, mesh.opaque.indexCount, gl.UNSIGNED_INT, 0);
        drawCalls++;
        triangles += mesh.opaque.indexCount / 3;
      }
    }

    // 2. Cutout Pass
    gl.uniform1i(this.locIsCutout, 1);
    for (const mesh of meshes) {
      if (mesh.cutout) {
        setColumnTints(mesh.sx, mesh.sz);
        gl.uniform3f(this.locSectionOrigin, mesh.sx * 16, mesh.sy * 16, mesh.sz * 16);
        gl.bindVertexArray(mesh.cutout.vao);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.cutout.ebo);
        this.glWrapper.drawElements(gl.TRIANGLES, mesh.cutout.indexCount, gl.UNSIGNED_INT, 0);
        drawCalls++;
        triangles += mesh.cutout.indexCount / 3;
      }
    }

    // 3. Translucent Pass
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.uniform1i(this.locIsCutout, 0);

    for (const mesh of meshes) {
      if (mesh.translucent) {
        gl.uniform3f(this.locSectionOrigin, mesh.sx * 16, mesh.sy * 16, mesh.sz * 16);
        gl.bindVertexArray(mesh.translucent.vao);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.translucent.ebo);
        this.glWrapper.drawElements(gl.TRIANGLES, mesh.translucent.indexCount, gl.UNSIGNED_INT, 0);
        drawCalls++;
        triangles += mesh.translucent.indexCount / 3;
      }
    }

    // Restore depth write
    gl.depthMask(true);

    // 4. Wireframe Overlay Pass (if enabled)
    if (wireframeEnabled) {
      gl.uniform1i(this.locIsWireframe, 1);
      gl.uniform1i(this.locIsCutout, 0);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-1.0, -1.0);

      for (const mesh of meshes) {
        const buckets = [mesh.opaque, mesh.cutout, mesh.translucent];
        for (const bucket of buckets) {
          if (bucket) {
            gl.uniform3f(this.locSectionOrigin, mesh.sx * 16, mesh.sy * 16, mesh.sz * 16);
            gl.bindVertexArray(bucket.vao);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bucket.lineEbo);
            this.glWrapper.drawElements(gl.LINES, bucket.lineIndexCount, gl.UNSIGNED_INT, 0);
            drawCalls++;
          }
        }
      }

      gl.disable(gl.POLYGON_OFFSET_FILL);
    }

    gl.bindVertexArray(null);

    renderStats.drawCalls = drawCalls;
    renderStats.triangles = triangles;
    renderStats.chunksLoaded = meshes.length;
    renderStats.chunksMeshed = meshes.length;
    renderStats.chunksVisible = meshes.length;
  }
}
