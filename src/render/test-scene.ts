import { mat4, vec3 } from 'gl-matrix';
import { Camera } from './camera';
import { GLWrapper } from './gl';
import { TextureAtlas, ATLAS_MAX_MIP } from './atlas';
import { textureGenerators } from './textures/index';
import { TextureData } from './textures/noise';
import { createSentinelTile, resolveTexture, SENTINEL_KEY } from './texture-resolve';
import { SCENE_MATERIALS, CubeMaterial } from './scene-materials';
import { renderStats } from '../debug/api/core';
import { setActiveCamera } from '../debug/api/camera';
import { InputEngine } from '../engine/input';

const VS_SOURCE = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;
in vec2 aTexCoord;

uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;

out vec3 vNormal;
out vec2 vTexCoord;

void main() {
  vNormal = aNormal;
  vTexCoord = aTexCoord;
  gl_Position = uProjection * uView * uModel * vec4(aPosition, 1.0);
}
`;

const FS_SOURCE = `#version 300 es
precision mediump float;

in vec3 vNormal;
in vec2 vTexCoord;

uniform sampler2D uSampler;
uniform int uCutout;

out vec4 fragColor;

void main() {
  vec4 texColor = texture(uSampler, vTexCoord);

  if (uCutout == 1 && texColor.a < 0.5) {
    discard;
  }

  // Simple directional light from top-right-front
  vec3 lightDir = normalize(vec3(0.4, 0.8, 0.5));
  float diff = max(dot(vNormal, lightDir), 0.35);

  fragColor = vec4(texColor.rgb * diff, texColor.a);
}
`;

interface MeshPass {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  count: number;
}

export class TestScene {
  private glWrapper: GLWrapper;
  public camera: Camera;
  public atlas: TextureAtlas;
  private program: WebGLProgram;

  private locProjection: WebGLUniformLocation;
  private locView: WebGLUniformLocation;
  private locModel: WebGLUniformLocation;
  private locSampler: WebGLUniformLocation;
  private locCutout: WebGLUniformLocation;

  private texture: WebGLTexture;

  private opaquePass: MeshPass;
  private cutoutPass: MeshPass;
  private translucentPass: MeshPass;

  constructor(glWrapper: GLWrapper, aspect: number) {
    this.glWrapper = glWrapper;

    // 1. Build Atlas with Sentinel
    const tiles = new Map<string, TextureData>();
    for (const [name, generator] of Object.entries(textureGenerators)) {
      const res = generator(42);
      if (Array.isArray(res)) {
        res.forEach((frame, idx) => {
          tiles.set(`${name}_${idx}`, frame);
        });
      } else {
        tiles.set(name, res);
      }
    }
    tiles.set(SENTINEL_KEY, createSentinelTile());

    this.atlas = new TextureAtlas(tiles);
    renderStats.textureAtlasSize = [this.atlas.width, this.atlas.height];

    // 2. Upload Mipmap Texture to WebGL
    const gl = this.glWrapper.gl;
    this.texture = this.glWrapper.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);

    for (let k = 0; k <= ATLAS_MAX_MIP; k++) {
      const w = this.atlas.width >> k;
      const h = this.atlas.height >> k;
      gl.texImage2D(
        gl.TEXTURE_2D,
        k,
        gl.RGBA,
        w,
        h,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.atlas.mips[k]!,
      );
    }

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, ATLAS_MAX_MIP);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // 3. Compile Shaders
    this.program = this.glWrapper.createProgram(VS_SOURCE, FS_SOURCE);
    this.locProjection = gl.getUniformLocation(this.program, 'uProjection')!;
    this.locView = gl.getUniformLocation(this.program, 'uView')!;
    this.locModel = gl.getUniformLocation(this.program, 'uModel')!;
    this.locSampler = gl.getUniformLocation(this.program, 'uSampler')!;
    this.locCutout = gl.getUniformLocation(this.program, 'uCutout')!;

    // 4. Setup Camera
    this.camera = new Camera(aspect);
    // Camera starting position: looking down at 30-45 deg onto 5x5 grid
    this.camera.position = vec3.fromValues(0, 3.2, 4.8);
    this.camera.yaw = -Math.PI / 2;
    this.camera.pitch = -0.52;
    this.camera.updateView();
    setActiveCamera(this.camera);

    // 5. Build Mesh Passes
    const opaqueVerts: number[] = [];
    const cutoutVerts: number[] = [];
    const translucentVerts: number[] = [];

    const spacing = 1.8;
    for (let i = 0; i < SCENE_MATERIALS.length; i++) {
      const mat = SCENE_MATERIALS[i]!;
      const row = Math.floor(i / 5);
      const col = i % 5;
      const cx = (col - 2) * spacing;
      const cz = (row - 2) * spacing;
      const cy = 0.0;

      const target = mat.transparent ? translucentVerts : mat.cutout ? cutoutVerts : opaqueVerts;

      this.addCubeToMesh(target, mat, cx, cy, cz);
    }

    this.opaquePass = this.createMeshPass(opaqueVerts);
    this.cutoutPass = this.createMeshPass(cutoutVerts);
    this.translucentPass = this.createMeshPass(translucentVerts);
  }

  private addCubeToMesh(verts: number[], mat: CubeMaterial, cx: number, cy: number, cz: number) {
    const s = 0.5; // half size -> 1.0 cube size

    const topRect = resolveTexture(mat.top, this.atlas);
    const sideRect = resolveTexture(mat.side, this.atlas);
    const bottomRect = resolveTexture(mat.bottom, this.atlas);

    // Helper to push 6 vertices (2 triangles) for a quad face
    const addQuad = (
      p1: number[],
      p2: number[],
      p3: number[],
      p4: number[],
      norm: number[],
      rect: { x: number; y: number; w: number; h: number },
    ) => {
      const u0 = rect.x / this.atlas.width;
      const v0 = rect.y / this.atlas.height;
      const u1 = (rect.x + rect.w) / this.atlas.width;
      const v1 = (rect.y + rect.h) / this.atlas.height;

      const pushV = (p: number[], u: number, v: number) => {
        verts.push(p[0]!, p[1]!, p[2]!, norm[0]!, norm[1]!, norm[2]!, u, v);
      };

      pushV(p1, u0, v0);
      pushV(p2, u0, v1);
      pushV(p3, u1, v1);

      pushV(p1, u0, v0);
      pushV(p3, u1, v1);
      pushV(p4, u1, v0);
    };

    // Front (+Z)
    addQuad(
      [cx - s, cy + s, cz + s],
      [cx - s, cy - s, cz + s],
      [cx + s, cy - s, cz + s],
      [cx + s, cy + s, cz + s],
      [0, 0, 1],
      sideRect,
    );

    // Back (-Z)
    addQuad(
      [cx + s, cy + s, cz - s],
      [cx + s, cy - s, cz - s],
      [cx - s, cy - s, cz - s],
      [cx - s, cy + s, cz - s],
      [0, 0, -1],
      sideRect,
    );

    // Left (-X)
    addQuad(
      [cx - s, cy + s, cz - s],
      [cx - s, cy - s, cz - s],
      [cx - s, cy - s, cz + s],
      [cx - s, cy + s, cz + s],
      [-1, 0, 0],
      sideRect,
    );

    // Right (+X)
    addQuad(
      [cx + s, cy + s, cz + s],
      [cx + s, cy - s, cz + s],
      [cx + s, cy - s, cz - s],
      [cx + s, cy + s, cz - s],
      [1, 0, 0],
      sideRect,
    );

    // Top (+Y)
    addQuad(
      [cx - s, cy + s, cz - s],
      [cx - s, cy + s, cz + s],
      [cx + s, cy + s, cz + s],
      [cx + s, cy + s, cz - s],
      [0, 1, 0],
      topRect,
    );

    // Bottom (-Y)
    addQuad(
      [cx - s, cy - s, cz + s],
      [cx - s, cy - s, cz - s],
      [cx + s, cy - s, cz - s],
      [cx + s, cy - s, cz + s],
      [0, -1, 0],
      bottomRect,
    );
  }

  private createMeshPass(verts: number[]): MeshPass {
    const gl = this.glWrapper.gl;
    const vao = this.glWrapper.createVertexArray();
    const vbo = this.glWrapper.createBuffer();

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);

    const stride = 8 * 4; // 8 floats per vertex

    // Position (3 floats)
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);

    // Normal (3 floats)
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * 4);

    // TexCoord (2 floats)
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 6 * 4);

    gl.bindVertexArray(null);

    return {
      vao,
      vbo,
      count: verts.length / 8,
    };
  }

  public render(dt: number, input: InputEngine) {
    this.camera.update(dt, input);

    const gl = this.glWrapper.gl;

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    gl.useProgram(this.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.locSampler, 0);

    const model = mat4.create();
    gl.uniformMatrix4fv(this.locProjection, false, this.camera.projectionMatrix);
    gl.uniformMatrix4fv(this.locView, false, this.camera.viewMatrix);
    gl.uniformMatrix4fv(this.locModel, false, model);

    let totalDrawCalls = 0;
    let totalTriangles = 0;

    // 1. Opaque Pass
    if (this.opaquePass.count > 0) {
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.uniform1i(this.locCutout, 0);
      gl.bindVertexArray(this.opaquePass.vao);
      this.glWrapper.drawArrays(gl.TRIANGLES, 0, this.opaquePass.count);
      totalDrawCalls++;
      totalTriangles += this.opaquePass.count / 3;
    }

    // 2. Cutout Pass (Leaves)
    if (this.cutoutPass.count > 0) {
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.uniform1i(this.locCutout, 1);
      gl.bindVertexArray(this.cutoutPass.vao);
      this.glWrapper.drawArrays(gl.TRIANGLES, 0, this.cutoutPass.count);
      totalDrawCalls++;
      totalTriangles += this.cutoutPass.count / 3;
    }

    // 3. Translucent Pass (Glass, Water)
    if (this.translucentPass.count > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(true);
      gl.uniform1i(this.locCutout, 0);
      gl.bindVertexArray(this.translucentPass.vao);
      this.glWrapper.drawArrays(gl.TRIANGLES, 0, this.translucentPass.count);
      totalDrawCalls++;
      totalTriangles += this.translucentPass.count / 3;
    }

    gl.bindVertexArray(null);

    renderStats.drawCalls = totalDrawCalls;
    renderStats.triangles = totalTriangles;
  }
}
