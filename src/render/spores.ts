import type { mat4 } from 'gl-matrix';
import type { Camera } from './camera';
import type { GLWrapper } from './gl';

/** How the floating spores of a dimension look and move (HOLLOWDEEP_ENVIRONMENT.spores). */
export interface SporeSettings {
  readonly color: readonly number[];
  readonly particlesPerSecond: number;
  readonly radius: number;
  readonly lifetimeSeconds: number;
  readonly riseSpeed: number;
  readonly size: number;
}

// Every spore is a point placed from its vertex id and the time alone: each lives one lifetime at a
// world position in a box that wraps around the camera, rising slowly, then is reborn elsewhere.
const SPORE_VS = `#version 300 es
uniform mat4 u_viewProj;
uniform vec3 u_camera;
uniform float u_time;
uniform float u_radius;
uniform float u_lifetime;
uniform float u_rise;
uniform float u_size;
uniform float u_pointScale;
out float v_alpha;
float hash(float n) { return fract(sin(n) * 43758.5453123); }
void main() {
  float id = float(gl_VertexID);
  float t = u_time / u_lifetime + hash(id * 7.13);
  float cycle = floor(t);
  float age = t - cycle;
  float seed = id * 13.7 + cycle * 101.3;
  vec3 base = vec3(hash(seed), hash(seed + 1.7), hash(seed + 3.1)) * (2.0 * u_radius);
  vec3 p = mod(base - u_camera + u_radius, 2.0 * u_radius) - u_radius + u_camera;
  p.y += age * u_lifetime * u_rise;
  p.x += sin(u_time * 0.7 + id) * 0.15;
  p.z += cos(u_time * 0.53 + id * 1.3) * 0.15;
  float edge = 1.0 - smoothstep(0.7 * u_radius, u_radius, length(p - u_camera));
  v_alpha = sin(3.14159265 * age) * edge;
  vec4 clip = u_viewProj * vec4(p, 1.0);
  gl_Position = clip;
  gl_PointSize = max(1.5, u_size * u_pointScale / max(clip.w, 0.1));
}`;

const SPORE_FS = `#version 300 es
precision mediump float;
in float v_alpha;
uniform vec3 u_color;
out vec4 fragColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (dot(c, c) > 0.25) discard;
  fragColor = vec4(u_color, v_alpha * 0.85);
}`;

/** The glowing spores floating through a dimension's air: one draw of points, no CPU work per spore. */
export class SporeRenderer {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly viewProj: WebGLUniformLocation;
  private readonly camera: WebGLUniformLocation;
  private readonly time: WebGLUniformLocation;
  private readonly radius: WebGLUniformLocation;
  private readonly lifetime: WebGLUniformLocation;
  private readonly rise: WebGLUniformLocation;
  private readonly size: WebGLUniformLocation;
  private readonly pointScale: WebGLUniformLocation;
  private readonly color: WebGLUniformLocation;

  constructor(private readonly wrapper: GLWrapper) {
    this.program = wrapper.createProgram(SPORE_VS, SPORE_FS);
    this.vao = wrapper.createVertexArray();
    const gl = wrapper.gl;
    const at = (name: string) => gl.getUniformLocation(this.program, name)!;
    this.viewProj = at('u_viewProj');
    this.camera = at('u_camera');
    this.time = at('u_time');
    this.radius = at('u_radius');
    this.lifetime = at('u_lifetime');
    this.rise = at('u_rise');
    this.size = at('u_size');
    this.pointScale = at('u_pointScale');
    this.color = at('u_color');
  }

  /** Returns the draw calls made (one). */
  render(spores: SporeSettings, viewProj: mat4, camera: Camera, seconds: number): number {
    const count = Math.round(spores.particlesPerSecond * spores.lifetimeSeconds);
    if (count <= 0) return 0;
    const gl = this.wrapper.gl;
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.viewProj, false, viewProj);
    gl.uniform3f(this.camera, camera.position[0], camera.position[1], camera.position[2]);
    gl.uniform1f(this.time, seconds % 3600);
    gl.uniform1f(this.radius, spores.radius);
    gl.uniform1f(this.lifetime, spores.lifetimeSeconds);
    gl.uniform1f(this.rise, spores.riseSpeed);
    gl.uniform1f(this.size, spores.size);
    gl.uniform1f(this.pointScale, gl.drawingBufferHeight * camera.projectionMatrix[5]! * 0.5);
    gl.uniform3f(this.color, spores.color[0]!, spores.color[1]!, spores.color[2]!);
    gl.bindVertexArray(this.vao);
    this.wrapper.drawArrays(gl.POINTS, 0, count);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    return 1;
  }
}
