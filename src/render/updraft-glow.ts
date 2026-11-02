import type { mat4 } from 'gl-matrix';
import type { Camera } from './camera';
import type { GLWrapper } from './gl';
import {
  UPDRAFT_CELL,
  UPDRAFT_MAX_Y,
  UPDRAFT_MIN_Y,
  type UpdraftField,
  type UpdraftZone,
} from '../world/updrafts';

/** Zones drawn at once, motes per zone, and how far from the camera a zone still glows. */
export const UPDRAFT_GLOW_ZONES = 4;
export const UPDRAFT_GLOW_MOTES = 40;
export const UPDRAFT_GLOW_RANGE = 56;
const RISE = 1.6;
const SPAN = 28;

// Each mote is placed from its vertex id and the time alone: a random spot inside its zone's
// cylinder, rising through a 28-block band around the camera height, fading in and out.
const VS = `#version 300 es
uniform mat4 u_viewProj;
uniform vec3 u_camera;
uniform float u_time;
uniform vec4 u_zones[${UPDRAFT_GLOW_ZONES}];
uniform vec2 u_yRange;
uniform float u_pointScale;
out float v_alpha;
out float v_haze;
float hash(float n) { return fract(sin(n) * 43758.5453123); }
void main() {
  float id = float(gl_VertexID);
  int zoneIndex = gl_VertexID / ${UPDRAFT_GLOW_MOTES};
  vec4 zone = u_zones[zoneIndex];
  float t = (u_time * ${RISE.toFixed(2)} / ${SPAN.toFixed(1)}) + hash(id * 3.71);
  float cycle = floor(t);
  float age = t - cycle;
  float seed = id * 17.3 + cycle * 59.1;
  float angle = hash(seed) * 6.2831853;
  float radius = sqrt(hash(seed + 1.3)) * zone.z;
  vec3 p = vec3(zone.x + cos(angle) * radius, 0.0, zone.y + sin(angle) * radius);
  p.y = floor(u_camera.y) - ${(SPAN / 2).toFixed(1)} + age * ${SPAN.toFixed(1)};
  p.x += sin(u_time * 1.3 + id) * 0.2;
  p.z += cos(u_time * 1.1 + id * 0.7) * 0.2;
  float inside = step(u_yRange.x, p.y) * step(p.y, u_yRange.y);
  // One mote in four is a wide, faint halo: together they read as a soft glowing column.
  float haze = step(0.75, hash(id * 1.91));
  v_haze = haze;
  v_alpha = zone.w * inside * sin(3.14159265 * age) * mix(1.0, 0.32, haze);
  vec4 clip = u_viewProj * vec4(p, 1.0);
  gl_Position = clip;
  gl_PointSize = min(256.0, max(2.0, 0.14 * u_pointScale / max(clip.w, 0.1)) * (1.0 + haze * 9.0));
}`;

const FS = `#version 300 es
precision mediump float;
in float v_alpha;
in float v_haze;
out vec4 fragColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = dot(c, c);
  if (r > 0.25 || v_alpha <= 0.0) discard;
  float core = v_haze > 0.5 ? exp(-r * 14.0) : 1.0 - r * 4.0;
  fragColor = vec4(vec3(0.62, 0.92, 1.0), v_alpha * core * 0.9);
}`;

/**
 * The soft glow of Updrafts: rising motes in the few zones nearest the camera, one draw of points.
 * Nothing is drawn (and nothing bound) when no zone is in range; the zone lookup touches the 3×3
 * cells around the camera and allocates nothing.
 */
export class UpdraftGlowRenderer {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly locViewProj: WebGLUniformLocation;
  private readonly locCamera: WebGLUniformLocation;
  private readonly locTime: WebGLUniformLocation;
  private readonly locZones: WebGLUniformLocation;
  private readonly locYRange: WebGLUniformLocation;
  private readonly locPointScale: WebGLUniformLocation;
  private readonly zones = new Float32Array(UPDRAFT_GLOW_ZONES * 4);
  private readonly zone: UpdraftZone = { x: 0, z: 0, radius: 0 };
  /** Zones drawn in the last frame. */
  public lastZones = 0;

  constructor(private readonly wrapper: GLWrapper) {
    this.program = wrapper.createProgram(VS, FS);
    this.vao = wrapper.createVertexArray();
    const gl = wrapper.gl;
    const at = (name: string) => gl.getUniformLocation(this.program, name)!;
    this.locViewProj = at('u_viewProj');
    this.locCamera = at('u_camera');
    this.locTime = at('u_time');
    this.locZones = at('u_zones');
    this.locYRange = at('u_yRange');
    this.locPointScale = at('u_pointScale');
  }

  /** Fills the zone uniforms; returns how many zones are near (x, z). */
  gatherZones(field: UpdraftField, x: number, z: number): number {
    const gx = Math.floor(x / UPDRAFT_CELL),
      gz = Math.floor(z / UPDRAFT_CELL);
    let n = 0;
    this.zones.fill(0);
    for (let dz = -1; dz <= 1 && n < UPDRAFT_GLOW_ZONES; dz++)
      for (let dx = -1; dx <= 1 && n < UPDRAFT_GLOW_ZONES; dx++) {
        if (!field.zoneOfCell(gx + dx, gz + dz, this.zone)) continue;
        const d = Math.hypot(this.zone.x - x, this.zone.z - z) - this.zone.radius;
        if (d > UPDRAFT_GLOW_RANGE) continue;
        const o = n * 4;
        this.zones[o] = this.zone.x;
        this.zones[o + 1] = this.zone.z;
        this.zones[o + 2] = this.zone.radius;
        this.zones[o + 3] = 1 - Math.max(0, d) / UPDRAFT_GLOW_RANGE;
        n++;
      }
    return n;
  }

  /** Returns the draw calls made (0 or 1). */
  render(field: UpdraftField, viewProj: mat4, camera: Camera, seconds: number): number {
    const p = camera.position;
    const n = this.gatherZones(field, p[0]!, p[2]!);
    this.lastZones = n;
    if (n === 0) return 0;
    const gl = this.wrapper.gl;
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.locViewProj, false, viewProj);
    gl.uniform3f(this.locCamera, p[0]!, p[1]!, p[2]!);
    gl.uniform1f(this.locTime, seconds % 3600);
    gl.uniform4fv(this.locZones, this.zones);
    gl.uniform2f(this.locYRange, UPDRAFT_MIN_Y, UPDRAFT_MAX_Y);
    gl.uniform1f(this.locPointScale, gl.drawingBufferHeight * camera.projectionMatrix[5]! * 0.5);
    gl.bindVertexArray(this.vao);
    this.wrapper.drawArrays(gl.POINTS, 0, n * UPDRAFT_GLOW_MOTES);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    return 1;
  }
}
