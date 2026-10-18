import type { mat4 } from 'gl-matrix';
import type { GLWrapper } from './gl';
import type { BlockInteraction } from '../gameplay/block-interaction';
import { genCracks } from './textures/cracks';
const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_pos;layout(location=1) in vec2 a_uv;
uniform mat4 u_vp;uniform vec3 u_min;uniform vec3 u_size;
out vec2 v_uv;
void main(){v_uv=a_uv;gl_Position=u_vp*vec4(u_min+a_pos*u_size,1.0);gl_Position.z-=0.00003*gl_Position.w;}`;
const FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 v_uv;uniform sampler2DArray u_cracks;uniform int u_stage;out vec4 color;
void main(){color=u_stage<0?vec4(0.08,0.065,0.09,1.0):texture(u_cracks,vec3(v_uv,float(u_stage)));if(color.a<0.01)discard;}`;
/** Static GPU geometry and ten textures; no allocation in the render path. */
export class BlockSelectionRenderer {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly texture: WebGLTexture;
  private readonly vp: WebGLUniformLocation;
  private readonly min: WebGLUniformLocation;
  private readonly size: WebGLUniformLocation;
  private readonly stage: WebGLUniformLocation;
  constructor(private readonly wrapper: GLWrapper) {
    const gl = wrapper.gl;
    this.program = wrapper.createProgram(VS, FS);
    this.vao = wrapper.createVertexArray();
    this.vp = gl.getUniformLocation(this.program, 'u_vp')!;
    this.min = gl.getUniformLocation(this.program, 'u_min')!;
    this.size = gl.getUniformLocation(this.program, 'u_size')!;
    this.stage = gl.getUniformLocation(this.program, 'u_stage')!;
    const corners = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ];
    const faces = [
      [0, 3, 2, 1],
      [5, 6, 7, 4],
      [1, 2, 6, 5],
      [4, 7, 3, 0],
      [3, 7, 6, 2],
      [4, 0, 1, 5],
    ];
    const data: number[] = [];
    for (const f of faces)
      for (const c of [0, 1, 2, 0, 2, 3])
        data.push(...corners[f[c]!]!, c === 1 || c === 2 ? 1 : 0, c < 2 ? 1 : 0);
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ]) {
      data.push(...corners[a!]!, 0, 0, ...corners[b!]!, 0, 0);
    }
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, wrapper.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.bindVertexArray(null);
    this.texture = wrapper.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    const pixels = new Uint8Array(1024 * 10);
    genCracks().forEach((t, i) => pixels.set(t, i * 1024));
    gl.texImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      gl.RGBA8,
      16,
      16,
      10,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
  }
  render(i: BlockInteraction | null, vp: mat4): number {
    if (!i?.target.hit || i.player.detached) return 0;
    const t = i.target,
      parts = i.raycaster.shapes.parts[t.stateId];
    if (!parts) return 0;
    const gl = this.wrapper.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(this.vp, false, vp);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    let draws = 0;
    for (const box of parts) {
      gl.uniform3f(this.min, t.x + box[0] - 0.001, t.y + box[1] - 0.001, t.z + box[2] - 0.001);
      gl.uniform3f(
        this.size,
        box[3] - box[0] + 0.002,
        box[4] - box[1] + 0.002,
        box[5] - box[2] + 0.002,
      );
      if (i.progress > 0) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
        gl.uniform1i(this.stage, Math.min(9, Math.floor(i.progress * 10)));
        this.wrapper.drawArrays(gl.TRIANGLES, 0, 36);
        draws++;
      }
      gl.uniform1i(this.stage, -1);
      this.wrapper.drawArrays(gl.LINES, 36, 24);
      draws++;
    }
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    return draws;
  }
}
