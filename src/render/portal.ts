import type { mat4 } from 'gl-matrix';
import type { World } from '../world/world';
import type { PortalRecord } from '../world/portals';
import { aabbIntersectsFrustum, extractFrustumPlanes } from './frustum';
import type { GLWrapper } from './gl';

// Two triangles over the 2×3 opening, in the plane through the middle of its blocks.
const SURFACE_VS = `#version 300 es
uniform mat4 u_viewProj;
uniform vec3 u_origin;
uniform float u_axis;
out vec2 v_uv;
void main() {
  int i = gl_VertexID;
  vec2 c = vec2(float(i == 1 || i == 2 || i == 4), float(i == 2 || i == 4 || i == 5));
  vec2 uv = c * vec2(2.0, 3.0);
  v_uv = uv;
  vec3 p = u_axis < 0.5
    ? vec3(u_origin.x + uv.x, u_origin.y + uv.y, u_origin.z + 0.5)
    : vec3(u_origin.x + 0.5, u_origin.y + uv.y, u_origin.z + uv.x);
  gl_Position = u_viewProj * vec4(p, 1.0);
}`;

// Swirling cyan-violet noise, snapped to the 16-texel-per-block grid of the world's pixel art.
const SURFACE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform float u_time;
out vec4 fragColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 uv = (floor(v_uv * 16.0) + 0.5) / 16.0;
  vec2 c = uv - vec2(1.0, 1.5);
  float r = length(c);
  float a = atan(c.y, c.x) + r * 2.6 - u_time * 1.3;
  vec2 q = vec2(cos(a), sin(a)) * r * 2.2;
  float n = noise(q * 2.0 + u_time * 0.25) * 0.6 + noise(q * 5.0 - u_time * 0.45) * 0.4;
  n = floor(n * 6.0 + 0.5) / 6.0;
  vec3 violet = vec3(0.45, 0.28, 0.82);
  vec3 cyan = vec3(0.23, 0.78, 0.9);
  vec3 color = mix(violet, cyan, smoothstep(0.3, 0.7, n));
  color += vec3(0.62, 0.92, 1.0) * step(0.82, n) * 0.55;
  float edge = min(min(uv.x, 2.0 - uv.x), min(uv.y, 3.0 - uv.y));
  color += vec3(0.25, 0.2, 0.45) * step(edge, 0.19);
  fragColor = vec4(color, 0.8);
}`;

/**
 * Draws the surfaces of the active dimension's portals as one animated quad each, after the
 * terrain. Nothing is bound or drawn while no portal is loaded and in view.
 */
export class PortalRenderer {
  public draws = 0;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly viewProj: WebGLUniformLocation;
  private readonly origin: WebGLUniformLocation;
  private readonly axis: WebGLUniformLocation;
  private readonly time: WebGLUniformLocation;
  private readonly planes = new Float64Array(24);

  constructor(private readonly wrapper: GLWrapper) {
    this.program = wrapper.createProgram(SURFACE_VS, SURFACE_FS);
    this.vao = wrapper.createVertexArray();
    const gl = wrapper.gl;
    this.viewProj = gl.getUniformLocation(this.program, 'u_viewProj')!;
    this.origin = gl.getUniformLocation(this.program, 'u_origin')!;
    this.axis = gl.getUniformLocation(this.program, 'u_axis')!;
    this.time = gl.getUniformLocation(this.program, 'u_time')!;
  }

  /** Returns the draw calls made (two triangles each). */
  render(portals: readonly PortalRecord[], world: World, viewProj: mat4, seconds: number): number {
    this.draws = 0;
    if (portals.length === 0) return 0;
    extractFrustumPlanes(viewProj, this.planes);
    const gl = this.wrapper.gl;
    let bound = false;
    for (let i = 0; i < portals.length; i++) {
      const p = portals[i]!;
      if (!world.hasColumn(Math.floor(p.x / 16), Math.floor(p.z / 16))) continue;
      const maxX = p.axis === 'x' ? p.x + 2 : p.x + 1;
      const maxZ = p.axis === 'x' ? p.z + 1 : p.z + 2;
      if (!aabbIntersectsFrustum(this.planes, p.x, p.y, p.z, maxX, p.y + 3, maxZ)) continue;
      if (!bound) {
        bound = true;
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(this.program);
        gl.uniformMatrix4fv(this.viewProj, false, viewProj);
        gl.uniform1f(this.time, seconds % 3600);
        gl.bindVertexArray(this.vao);
      }
      gl.uniform3f(this.origin, p.x, p.y, p.z);
      gl.uniform1f(this.axis, p.axis === 'x' ? 0 : 1);
      this.wrapper.drawArrays(gl.TRIANGLES, 0, 6);
      this.draws++;
    }
    if (bound) {
      gl.bindVertexArray(null);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.enable(gl.CULL_FACE);
    }
    return this.draws;
  }
}

const WARP_VS = `#version 300 es
out vec2 v_pos;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_pos = p * 2.0 - 1.0;
  gl_Position = vec4(v_pos, 0.0, 1.0);
}`;

// A swirl that closes in from the edges of the screen as the warp grows.
const WARP_FS = `#version 300 es
precision highp float;
in vec2 v_pos;
uniform float u_warp;
uniform float u_time;
uniform float u_aspect;
out vec4 fragColor;
void main() {
  vec2 p = vec2(v_pos.x * u_aspect, v_pos.y);
  float r = length(p);
  float a = atan(p.y, p.x);
  float bands = sin(a * 5.0 + r * 9.0 - u_time * 4.0) * 0.5 + 0.5;
  vec3 color = mix(vec3(0.38, 0.2, 0.7), vec3(0.25, 0.8, 0.92), bands);
  float reach = smoothstep(1.35 - u_warp * 1.35, 1.6 - u_warp * 0.6, r + bands * 0.25 * u_warp);
  fragColor = vec4(color, clamp(reach * (0.35 + 0.6 * u_warp), 0.0, 0.92));
}`;

/** The screen warp of portal travel; draws nothing at strength 0. */
export class WarpOverlay {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly warp: WebGLUniformLocation;
  private readonly time: WebGLUniformLocation;
  private readonly aspect: WebGLUniformLocation;

  constructor(private readonly wrapper: GLWrapper) {
    this.program = wrapper.createProgram(WARP_VS, WARP_FS);
    this.vao = wrapper.createVertexArray();
    const gl = wrapper.gl;
    this.warp = gl.getUniformLocation(this.program, 'u_warp')!;
    this.time = gl.getUniformLocation(this.program, 'u_time')!;
    this.aspect = gl.getUniformLocation(this.program, 'u_aspect')!;
  }

  /** Returns 1 when it drew. */
  render(strength: number, seconds: number): number {
    if (strength <= 0) return 0;
    const gl = this.wrapper.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program);
    gl.uniform1f(this.warp, Math.min(1, strength));
    gl.uniform1f(this.time, seconds % 3600);
    gl.uniform1f(this.aspect, gl.drawingBufferWidth / Math.max(1, gl.drawingBufferHeight));
    gl.bindVertexArray(this.vao);
    this.wrapper.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    return 1;
  }
}
