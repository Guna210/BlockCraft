import type { World } from '../world/world';
import { BlockRegistry } from '../world/blocks/registry';
import type { GLWrapper } from './gl';

/** Camera medium, independent of the player's AABB (also works in third person). */
export class UnderwaterView {
  public submerged = false;
  public brightnessFloor = 0;
  public readonly fogColor: [number, number, number] = [0, 0, 0];
  public readonly fogStart = 2;
  public readonly fogEnd = 24;
  private readonly water: Uint8Array;
  constructor() {
    const registry = BlockRegistry.getInstance();
    this.water = new Uint8Array(registry.getMaxStateId() + 1);
    for (const id of registry.getAllStateIds())
      this.water[id] = registry.getResolvedState(id)?.blockId === 'water' ? 1 : 0;
  }
  update(world: World, eye: ArrayLike<number>, skyBrightness: number): void {
    this.submerged =
      !!this.water[
        world.getBlockStateId(Math.floor(eye[0]!), Math.floor(eye[1]!), Math.floor(eye[2]!))
      ];
    this.brightnessFloor = this.submerged
      ? Math.max(0.028, 0.28 * skyBrightness * skyBrightness)
      : 0;
    this.fogColor[0] = 0.075 * skyBrightness;
    this.fogColor[1] = 0.24 * skyBrightness;
    this.fogColor[2] = 0.43 * skyBrightness;
  }
}

const VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
uniform vec3 u_color;
out vec4 fragColor;
void main() { fragColor = vec4(u_color, 0.16); }`;

/** Final blue blend over the entire frame; no framebuffer or per-frame resources. */
export class UnderwaterTint {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly color: WebGLUniformLocation;
  constructor(private readonly wrapper: GLWrapper) {
    this.program = wrapper.createProgram(VS, FS);
    this.vao = wrapper.createVertexArray();
    this.color = wrapper.gl.getUniformLocation(this.program, 'u_color')!;
  }
  render(view: UnderwaterView): void {
    if (!view.submerged) return;
    const gl = this.wrapper.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program);
    gl.uniform3fv(this.color, view.fogColor);
    gl.bindVertexArray(this.vao);
    this.wrapper.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
  }
}
