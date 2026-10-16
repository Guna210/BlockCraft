import { mat4, vec3 } from 'gl-matrix';
import { GLWrapper } from './gl';
import { Camera } from './camera';
import { World } from '../world/world';
import { LCG } from './textures/noise';
import { getWeather, getPrecipitationType, weatherManager } from '../world/weather';

export interface LightningSegment {
  p0: [number, number, number];
  p1: [number, number, number];
  thickness: number;
  intensity: number;
}

type Vec3 = [number, number, number];

/** One continuous branch (trunk or fork) of a bolt: a polyline whose width tapers along its length. */
export interface LightningPolyline {
  points: Vec3[];
  /** Base half-width in blocks before tapering. */
  thickness: number;
  /** Width multiplier at the first and at the last point; it falls linearly in between. */
  taper: [number, number];
  intensity: number;
}

/**
 * Procedural branching lightning bolt generator (Decision 4).
 * A trunk from `start` to `end` (midpoint displacement down to roughly one block, so it is
 * jagged at small scale) plus 2 to 4 seeded forks that leave the trunk at one of its points and
 * head downward. Each branch is one continuous polyline. Completely deterministic for the same
 * seed and endpoints; the trunk's first point is `start` and its last point is `end`.
 */
export function generateLightningPolylines(
  seed: number,
  start: Vec3,
  end: Vec3,
): LightningPolyline[] {
  const rng = new LCG(seed);

  function jagged(p0: Vec3, p1: Vec3, depth: number, out: Vec3[]): void {
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    if (depth <= 0 || len < 0.9) {
      out.push(p1);
      return;
    }
    const mid: Vec3 = [
      (p0[0] + p1[0]) * 0.5 + (rng.nextFloat() - 0.5) * len * 0.12,
      (p0[1] + p1[1]) * 0.5 + (rng.nextFloat() - 0.5) * len * 0.03,
      (p0[2] + p1[2]) * 0.5 + (rng.nextFloat() - 0.5) * len * 0.12,
    ];
    jagged(p0, mid, depth - 1, out);
    jagged(mid, p1, depth - 1, out);
  }

  const trunk: Vec3[] = [start];
  jagged(start, end, 8, trunk);
  const polylines: LightningPolyline[] = [
    { points: trunk, thickness: 0.45, taper: [1.0, 0.45], intensity: 1.0 },
  ];

  const branchCount = 2 + Math.floor(rng.nextFloat() * 3); // 2..4
  const n = trunk.length;
  for (let i = 0; i < branchCount; i++) {
    // Spread the forks along the trunk, away from both ends
    const t = (i + 0.5) / branchCount;
    const idx = Math.min(
      n - 2,
      Math.max(1, Math.floor((0.1 + 0.8 * t) * n + (rng.nextFloat() - 0.5) * 2)),
    );
    const from = trunk[idx]!;
    const angle = rng.nextFloat() * Math.PI * 2;
    const length = 12 + rng.nextFloat() * 14;
    const to: Vec3 = [
      from[0] + Math.cos(angle) * length * 0.6,
      from[1] - length * (0.5 + rng.nextFloat() * 0.3),
      from[2] + Math.sin(angle) * length * 0.6,
    ];
    const pts: Vec3[] = [from];
    jagged(from, to, 6, pts);
    polylines.push({ points: pts, thickness: 0.26, taper: [0.8, 0.12], intensity: 0.8 });
  }
  return polylines;
}

/**
 * The same bolt as flat segments. The trunk's first segment is first and its last segment is
 * last, so the array runs from `start` to `end`.
 */
export function generateLightningBolt(seed: number, start: Vec3, end: Vec3): LightningSegment[] {
  const toSegments = (line: LightningPolyline): LightningSegment[] =>
    line.points.slice(1).map((p1, i) => ({
      p0: line.points[i]!,
      p1,
      thickness: line.thickness,
      intensity: line.intensity,
    }));
  const [trunk, ...forks] = generateLightningPolylines(seed, start, end).map(toSegments);
  return [trunk![0]!, ...forks.flat(), ...trunk!.slice(1)];
}

export const BOLT_FLOATS_PER_VERTEX = 8; // x y z u r g b a

/**
 * Builds one pass of the bolt as triangles (6 vertices per segment). Every joint of a polyline
 * has a single pair of vertices, offset along the mitred perpendicular of its two neighbouring
 * segments (miter length clamped at 2x), so adjacent quads share their edge exactly. `u` runs
 * from -1 to 1 across the ribbon for the fragment shader's falloff.
 */
export function buildBoltPass(
  lines: LightningPolyline[],
  camPos: Vec3,
  pass: 'glow' | 'core',
  out: number[],
): void {
  const [r, g, b] = pass === 'glow' ? [0.55, 0.7, 1.0] : [0.97, 0.99, 1.0];
  for (const line of lines) {
    const pts = line.points;
    const count = pts.length;
    if (count < 2) continue;

    // Camera-facing unit perpendicular of every segment
    const perps: Vec3[] = [];
    const dirs: Vec3[] = [];
    for (let i = 0; i < count - 1; i++) {
      const a = pts[i]!;
      const c = pts[i + 1]!;
      const dx = c[0] - a[0];
      const dy = c[1] - a[1];
      const dz = c[2] - a[2];
      const dl = Math.hypot(dx, dy, dz) || 1;
      const tx = camPos[0] - (a[0] + c[0]) * 0.5;
      const ty = camPos[1] - (a[1] + c[1]) * 0.5;
      const tz = camPos[2] - (a[2] + c[2]) * 0.5;
      const rx = dy * tz - dz * ty;
      const ry = dz * tx - dx * tz;
      const rz = dx * ty - dy * tx;
      const rl = Math.hypot(rx, ry, rz) || 1;
      perps.push([rx / rl, ry / rl, rz / rl]);
      dirs.push([dx / dl, dy / dl, dz / dl]);
    }

    // Arc length for the taper
    const arc: number[] = [0];
    for (let i = 1; i < count; i++) {
      const a = pts[i - 1]!;
      const c = pts[i]!;
      arc.push(arc[i - 1]! + Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]));
    }
    const total = arc[count - 1]! || 1;

    const left: Vec3[] = [];
    const right: Vec3[] = [];
    for (let i = 0; i < count; i++) {
      const p = pts[i]!;
      const n0 = perps[Math.max(0, i - 1)]!;
      const n1 = perps[Math.min(count - 2, i)]!;
      let mx = n0[0] + n1[0];
      let my = n0[1] + n1[1];
      let mz = n0[2] + n1[2];
      let ml = Math.hypot(mx, my, mz);
      if (ml < 1e-6) {
        mx = n0[0];
        my = n0[1];
        mz = n0[2];
        ml = 1;
      }
      mx /= ml;
      my /= ml;
      mz /= ml;
      const cosHalf = Math.max(0.5, mx * n0[0] + my * n0[1] + mz * n0[2]);
      const dist = Math.hypot(camPos[0] - p[0], camPos[1] - p[1], camPos[2] - p[2]);
      const w = line.taper[0] + (line.taper[1] - line.taper[0]) * (arc[i]! / total);
      // The core keeps a few pixels of width at any distance
      const core = Math.max(line.thickness * w * 0.45, 0.006 * dist);
      const half = (pass === 'glow' ? core * 4.5 : core) / cosHalf;
      left.push([p[0] - mx * half, p[1] - my * half, p[2] - mz * half]);
      right.push([p[0] + mx * half, p[1] + my * half, p[2] + mz * half]);
    }

    // Glow is soft and faint; the core is drawn last with a fixed opaque centre
    const alpha = pass === 'glow' ? 0.3 * line.intensity : line.intensity;
    const v = (q: Vec3, u: number): void => {
      out.push(q[0], q[1], q[2], u, r, g, b, alpha);
    };
    for (let i = 0; i < count - 1; i++) {
      v(left[i]!, -1);
      v(right[i]!, 1);
      v(right[i + 1]!, 1);
      v(left[i]!, -1);
      v(right[i + 1]!, 1);
      v(left[i + 1]!, -1);
    }
  }
}

const WEATHER_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_quadPos;
layout(location = 1) in vec3 a_basePos;
layout(location = 2) in vec2 a_particleData; // x: seed, y: speedMultiplier

uniform mat4 u_viewProj;
uniform vec3 u_cameraPos;
uniform float u_time;
uniform float u_rainFactor;
uniform sampler2D u_heightmap;
uniform vec2 u_heightmapOrigin;
uniform float u_heightmapSize;

out vec4 v_color;

void main() {
  if (u_rainFactor <= 0.001) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vec3 boxSize = vec3(32.0, 24.0, 32.0);
  vec3 halfBox = boxSize * 0.5;

  float seed = a_particleData.x;
  float speed = a_particleData.y;

  vec3 offset = a_basePos;
  offset.y -= u_time * (18.0 * speed);
  vec3 worldPos = mod(offset - u_cameraPos + halfBox, boxSize) - halfBox + u_cameraPos;

  // Sample heightmap
  vec2 hmUV = (worldPos.xz - u_heightmapOrigin) / u_heightmapSize;
  if (hmUV.x < 0.0 || hmUV.x > 1.0 || hmUV.y < 0.0 || hmUV.y > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vec4 hm = textureLod(u_heightmap, hmUV, 0.0);
  float topSolidY = hm.r * 255.0 + hm.g * 255.0 * 256.0;
  float precipType = hm.b; // 0.0 = none, 0.5 = rain, 1.0 = snow

  if (worldPos.y <= topSolidY || precipType < 0.25) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  float dist = length(worldPos - u_cameraPos);
  // Skip particles close to the camera: their perspective-scaled quads read as huge streaks
  if (dist < 3.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float alpha = smoothstep(16.0, 12.0, dist) * smoothstep(3.5, 5.5, dist) * u_rainFactor;

  if (precipType > 0.75) {
    // Snow: fluttering drift
    worldPos.x += sin(u_time * 2.5 + seed * 6.28) * 0.25;
    worldPos.z += cos(u_time * 2.0 + seed * 6.28) * 0.25;

    // Billboard quad
    vec3 camRight = vec3(u_viewProj[0][0], u_viewProj[1][0], u_viewProj[2][0]);
    vec3 camUp = vec3(u_viewProj[0][1], u_viewProj[1][1], u_viewProj[2][1]);
    vec3 p = worldPos + (camRight * a_quadPos.x + camUp * a_quadPos.y) * 0.10;
    gl_Position = u_viewProj * vec4(p, 1.0);
    v_color = vec4(0.96, 0.98, 1.0, alpha * 0.90);
  } else {
    // Rain: vertical elongated streak
    vec3 streak = vec3(0.0, -0.65, 0.0);
    vec3 camRight = vec3(u_viewProj[0][0], u_viewProj[1][0], u_viewProj[2][0]);
    vec3 p = worldPos + camRight * (a_quadPos.x * 0.04) + streak * (a_quadPos.y + 0.5);
    gl_Position = u_viewProj * vec4(p, 1.0);
    v_color = vec4(0.72, 0.82, 0.95, alpha * 0.70);
  }
}
`;

const WEATHER_FS = `#version 300 es
precision highp float;

in vec4 v_color;
out vec4 fragColor;

void main() {
  if (v_color.a <= 0.01) discard;
  fragColor = v_color;
}
`;

const SPLASH_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_quadPos;
layout(location = 1) in vec2 a_baseXZ;
layout(location = 2) in float a_seed;

uniform mat4 u_viewProj;
uniform vec3 u_cameraPos;
uniform float u_time;
uniform float u_rainFactor;
uniform sampler2D u_heightmap;
uniform vec2 u_heightmapOrigin;
uniform float u_heightmapSize;

out vec4 v_color;

void main() {
  if (u_rainFactor <= 0.001) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vec2 boxSize = vec2(32.0, 32.0);
  vec2 halfBox = boxSize * 0.5;

  vec2 offset = a_baseXZ;
  vec2 worldXZ = mod(offset - u_cameraPos.xz + halfBox, boxSize) - halfBox + u_cameraPos.xz;

  vec2 hmUV = (worldXZ - u_heightmapOrigin) / u_heightmapSize;
  if (hmUV.x < 0.0 || hmUV.x > 1.0 || hmUV.y < 0.0 || hmUV.y > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vec4 hm = textureLod(u_heightmap, hmUV, 0.0);
  float topSolidY = hm.r * 255.0 + hm.g * 255.0 * 256.0;
  float precipType = hm.b;

  // Splashes occur only for rain on surfaces
  if (precipType < 0.25 || precipType > 0.75) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  float phase = fract(u_time * 6.0 + a_seed * 13.0);
  float scale = 0.08 + phase * 0.22;
  float alpha = (1.0 - phase) * u_rainFactor * 0.65;

  vec3 worldPos = vec3(worldXZ.x + a_quadPos.x * scale, topSolidY + 1.02, worldXZ.y + a_quadPos.y * scale);
  gl_Position = u_viewProj * vec4(worldPos, 1.0);
  v_color = vec4(0.78, 0.88, 1.0, alpha);
}
`;

const LIGHTNING_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_pos;
layout(location = 1) in float a_u;
layout(location = 2) in vec4 a_color;

uniform mat4 u_viewProj;
out vec4 v_color;
out float v_u;

void main() {
  v_color = a_color;
  v_u = a_u;
  gl_Position = u_viewProj * vec4(a_pos, 1.0);
}
`;

const LIGHTNING_FS = `#version 300 es
precision highp float;

in vec4 v_color;
in float v_u;
uniform float u_soft;
out vec4 fragColor;

void main() {
  float e = abs(v_u);
  // Glow fades smoothly to nothing; the core is solid with a thin anti-aliased rim
  float falloff = u_soft > 0.5 ? pow(1.0 - e, 2.0) : 1.0 - smoothstep(0.6, 1.0, e);
  fragColor = vec4(v_color.rgb, v_color.a * falloff);
}
`;

export const PARTICLE_COUNT = 1024;
export const SPLASH_COUNT = 256;
const HEIGHTMAP_SIZE = 64; // 64x64 blocks around camera

export class WeatherRenderer {
  private readonly glWrapper: GLWrapper;

  // Particle shaders & buffers
  private readonly particleProgram: WebGLProgram;
  private readonly particleVao: WebGLVertexArrayObject;
  private readonly particleVbo: WebGLBuffer;
  private readonly quadVbo: WebGLBuffer;
  private readonly uViewProj: WebGLUniformLocation | null;
  private readonly uCameraPos: WebGLUniformLocation | null;
  private readonly uTime: WebGLUniformLocation | null;
  private readonly uRainFactor: WebGLUniformLocation | null;
  private readonly uHeightmap: WebGLUniformLocation | null;
  private readonly uHeightmapOrigin: WebGLUniformLocation | null;
  private readonly uHeightmapSize: WebGLUniformLocation | null;

  // Splash shaders & buffers
  private readonly splashProgram: WebGLProgram;
  private readonly splashVao: WebGLVertexArrayObject;
  private readonly splashVbo: WebGLBuffer;
  private readonly uSplashViewProj: WebGLUniformLocation | null;
  private readonly uSplashCameraPos: WebGLUniformLocation | null;
  private readonly uSplashTime: WebGLUniformLocation | null;
  private readonly uSplashRainFactor: WebGLUniformLocation | null;
  private readonly uSplashHeightmap: WebGLUniformLocation | null;
  private readonly uSplashHeightmapOrigin: WebGLUniformLocation | null;
  private readonly uSplashHeightmapSize: WebGLUniformLocation | null;

  // Lightning shaders & buffers
  private readonly lightningProgram: WebGLProgram;
  private readonly lightningVao: WebGLVertexArrayObject;
  private readonly lightningVbo: WebGLBuffer;
  private readonly uLightningViewProj: WebGLUniformLocation | null;
  private readonly uLightningSoft: WebGLUniformLocation | null;
  private lightningVertexCount = 0;

  // Heightmap texture for vertex texture fetch
  private readonly heightmapTexture: WebGLTexture;
  private readonly heightmapData = new Uint8Array(HEIGHTMAP_SIZE * HEIGHTMAP_SIZE * 4);
  private heightmapOriginX = -32;
  private heightmapOriginZ = -32;

  // CPU particle structures for rapid stats evaluation
  private readonly particles: {
    baseX: number;
    baseY: number;
    baseZ: number;
    seed: number;
    speed: number;
  }[] = [];

  constructor(glWrapper: GLWrapper) {
    this.glWrapper = glWrapper;
    const gl = glWrapper.gl;

    // 1. Particle program
    this.particleProgram = glWrapper.createProgram(WEATHER_VS, WEATHER_FS);
    this.uViewProj = gl.getUniformLocation(this.particleProgram, 'u_viewProj');
    this.uCameraPos = gl.getUniformLocation(this.particleProgram, 'u_cameraPos');
    this.uTime = gl.getUniformLocation(this.particleProgram, 'u_time');
    this.uRainFactor = gl.getUniformLocation(this.particleProgram, 'u_rainFactor');
    this.uHeightmap = gl.getUniformLocation(this.particleProgram, 'u_heightmap');
    this.uHeightmapOrigin = gl.getUniformLocation(this.particleProgram, 'u_heightmapOrigin');
    this.uHeightmapSize = gl.getUniformLocation(this.particleProgram, 'u_heightmapSize');

    // Quad geometry (2 triangles)
    const quadVertices = new Float32Array([
      -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5,
    ]);

    this.quadVbo = glWrapper.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

    // Static instance data for particles
    const particleData = new Float32Array(PARTICLE_COUNT * 5); // baseX, baseY, baseZ, seed, speed
    const rng = new LCG(54321);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const baseX = (rng.nextFloat() - 0.5) * 32.0;
      const baseY = (rng.nextFloat() - 0.5) * 24.0;
      const baseZ = (rng.nextFloat() - 0.5) * 32.0;
      const seed = rng.nextFloat();
      const speed = 0.85 + rng.nextFloat() * 0.3;

      this.particles.push({ baseX, baseY, baseZ, seed, speed });

      const o = i * 5;
      particleData[o] = baseX;
      particleData[o + 1] = baseY;
      particleData[o + 2] = baseZ;
      particleData[o + 3] = seed;
      particleData[o + 4] = speed;
    }

    this.particleVao = glWrapper.createVertexArray();
    this.particleVbo = glWrapper.createBuffer();

    gl.bindVertexArray(this.particleVao);

    // Attrib 0: Quad pos (per vertex)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 2 * 4, 0);

    // Attrib 1 & 2: Instance data (per instance)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleVbo);
    gl.bufferData(gl.ARRAY_BUFFER, particleData, gl.STATIC_DRAW);

    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 5 * 4, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 5 * 4, 3 * 4);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);

    // 2. Splash program & buffers
    this.splashProgram = glWrapper.createProgram(SPLASH_VS, WEATHER_FS);
    this.uSplashViewProj = gl.getUniformLocation(this.splashProgram, 'u_viewProj');
    this.uSplashCameraPos = gl.getUniformLocation(this.splashProgram, 'u_cameraPos');
    this.uSplashTime = gl.getUniformLocation(this.splashProgram, 'u_time');
    this.uSplashRainFactor = gl.getUniformLocation(this.splashProgram, 'u_rainFactor');
    this.uSplashHeightmap = gl.getUniformLocation(this.splashProgram, 'u_heightmap');
    this.uSplashHeightmapOrigin = gl.getUniformLocation(this.splashProgram, 'u_heightmapOrigin');
    this.uSplashHeightmapSize = gl.getUniformLocation(this.splashProgram, 'u_heightmapSize');

    const splashData = new Float32Array(SPLASH_COUNT * 3); // baseXZ.x, baseXZ.y, seed
    for (let i = 0; i < SPLASH_COUNT; i++) {
      splashData[i * 3] = (rng.nextFloat() - 0.5) * 32.0;
      splashData[i * 3 + 1] = (rng.nextFloat() - 0.5) * 32.0;
      splashData[i * 3 + 2] = rng.nextFloat();
    }

    this.splashVao = glWrapper.createVertexArray();
    this.splashVbo = glWrapper.createBuffer();

    gl.bindVertexArray(this.splashVao);

    // Attrib 0: Quad pos
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 2 * 4, 0);

    // Attrib 1 & 2: Instance data
    gl.bindBuffer(gl.ARRAY_BUFFER, this.splashVbo);
    gl.bufferData(gl.ARRAY_BUFFER, splashData, gl.STATIC_DRAW);

    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 3 * 4, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 3 * 4, 2 * 4);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);

    // 3. Lightning program & buffers
    this.lightningProgram = glWrapper.createProgram(LIGHTNING_VS, LIGHTNING_FS);
    this.uLightningViewProj = gl.getUniformLocation(this.lightningProgram, 'u_viewProj');
    this.uLightningSoft = gl.getUniformLocation(this.lightningProgram, 'u_soft');

    this.lightningVao = glWrapper.createVertexArray();
    this.lightningVbo = glWrapper.createBuffer();
    gl.bindVertexArray(this.lightningVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lightningVbo);
    const stride = BOLT_FLOATS_PER_VERTEX * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 3 * 4);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 4 * 4);
    gl.bindVertexArray(null);

    // 4. Heightmap texture
    this.heightmapTexture = glWrapper.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.heightmapTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      HEIGHTMAP_SIZE,
      HEIGHTMAP_SIZE,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  public updateHeightmapTexture(world: World, cameraPos: vec3): void {
    const gl = this.glWrapper.gl;
    const originX = Math.floor(cameraPos[0]) - HEIGHTMAP_SIZE / 2;
    const originZ = Math.floor(cameraPos[2]) - HEIGHTMAP_SIZE / 2;
    this.heightmapOriginX = originX;
    this.heightmapOriginZ = originZ;

    const data = this.heightmapData;
    let idx = 0;

    for (let z = 0; z < HEIGHTMAP_SIZE; z++) {
      for (let x = 0; x < HEIGHTMAP_SIZE; x++) {
        const wx = originX + x;
        const wz = originZ + z;
        const topY = weatherManager.heightmap.getTopSolidY(world, wx, wz);
        const biome = world.getBiome(wx, wz);
        const precip = getPrecipitationType(biome, topY);

        // Pack topSolidY in R & G
        const clampedY = Math.max(0, Math.min(319, Math.floor(topY)));
        data[idx] = clampedY & 255;
        data[idx + 1] = (clampedY >> 8) & 255;

        // B: precipitation type: 0 = none, 128 = rain, 255 = snow
        data[idx + 2] = precip === 'none' ? 0 : precip === 'rain' ? 128 : 255;
        data[idx + 3] = 255;
        idx += 4;
      }
    }

    gl.bindTexture(gl.TEXTURE_2D, this.heightmapTexture);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      HEIGHTMAP_SIZE,
      HEIGHTMAP_SIZE,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data,
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /**
   * Fast CPU evaluation of active precipitation particles within 16 blocks of camera.
   * Directly drives getRenderStats().weather.activeParticles.
   */
  public getActiveParticleCounts(
    cameraPos: ArrayLike<number>,
    world: World,
    timeSeconds = 0,
  ): { rain: number; snow: number } {
    const state = getWeather();
    if (state === 'clear') {
      return { rain: 0, snow: 0 };
    }

    let rain = 0;
    let snow = 0;
    const boxX = 32.0;
    const boxY = 24.0;
    const boxZ = 32.0;
    const halfBoxX = boxX * 0.5;
    const halfBoxY = boxY * 0.5;
    const halfBoxZ = boxZ * 0.5;

    const camX = cameraPos[0] ?? 0;
    const camY = cameraPos[1] ?? 0;
    const camZ = cameraPos[2] ?? 0;

    const wrap = (val: number, size: number) => ((val % size) + size) % size;

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]!;
      const wx = wrap(p.baseX - camX + halfBoxX, boxX) - halfBoxX + camX;
      const wy =
        wrap(p.baseY - timeSeconds * (18.0 * p.speed) - camY + halfBoxY, boxY) - halfBoxY + camY;
      const wz = wrap(p.baseZ - camZ + halfBoxZ, boxZ) - halfBoxZ + camZ;

      const dx = wx - camX;
      const dy = wy - camY;
      const dz = wz - camZ;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq <= 16.0 * 16.0 && distSq >= 3.5 * 3.5) {
        const topY = weatherManager.heightmap.getTopSolidY(world, Math.floor(wx), Math.floor(wz));
        if (wy > topY) {
          const biome = world.getBiome(Math.floor(wx), Math.floor(wz));
          const precip = getPrecipitationType(biome, wy);
          if (precip === 'rain') rain++;
          else if (precip === 'snow') snow++;
        }
      }
    }

    return { rain, snow };
  }

  public render(
    camera: Camera,
    world: World,
    ticks: number,
  ): { drawCalls: number; triangles: number } {
    const state = getWeather();
    const rainFactor = state === 'clear' ? 0.0 : state === 'rain' ? 1.0 : 1.25;

    let drawCalls = 0;
    let triangles = 0;

    const gl = this.glWrapper.gl;

    if (rainFactor > 0.001) {
      // 1. Update heightmap texture
      this.updateHeightmapTexture(world, camera.position);

      const timeSeconds = ticks / 20.0;
      const viewProj = mat4.create();
      mat4.multiply(viewProj, camera.projectionMatrix, camera.viewMatrix);

      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      // 2. Render rain streaks & snowflakes
      gl.useProgram(this.particleProgram);
      gl.uniformMatrix4fv(this.uViewProj, false, viewProj);
      gl.uniform3f(this.uCameraPos, camera.position[0], camera.position[1], camera.position[2]);
      gl.uniform1f(this.uTime, timeSeconds);
      gl.uniform1f(this.uRainFactor, rainFactor);
      gl.uniform2f(this.uHeightmapOrigin, this.heightmapOriginX, this.heightmapOriginZ);
      gl.uniform1f(this.uHeightmapSize, HEIGHTMAP_SIZE);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.heightmapTexture);
      gl.uniform1i(this.uHeightmap, 0);

      gl.bindVertexArray(this.particleVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, PARTICLE_COUNT);
      drawCalls++;
      triangles += PARTICLE_COUNT * 2;

      // 3. Render surface splashes (during rain)
      gl.useProgram(this.splashProgram);
      gl.uniformMatrix4fv(this.uSplashViewProj, false, viewProj);
      gl.uniform3f(
        this.uSplashCameraPos,
        camera.position[0],
        camera.position[1],
        camera.position[2],
      );
      gl.uniform1f(this.uSplashTime, timeSeconds);
      gl.uniform1f(this.uSplashRainFactor, rainFactor);
      gl.uniform2f(this.uSplashHeightmapOrigin, this.heightmapOriginX, this.heightmapOriginZ);
      gl.uniform1f(this.uSplashHeightmapSize, HEIGHTMAP_SIZE);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.heightmapTexture);
      gl.uniform1i(this.uSplashHeightmap, 0);

      gl.bindVertexArray(this.splashVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, SPLASH_COUNT);
      drawCalls++;
      triangles += SPLASH_COUNT * 2;

      gl.bindVertexArray(null);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // 4. Render lightning bolt if active: one continuous ribbon per branch, a soft additive glow
    // first, then the opaque core last so overlapping branches never add up to extra brightness.
    const strike = weatherManager.activeStrike;
    if (strike) {
      const lines = generateLightningPolylines(strike.seed, strike.start, strike.end);
      const camPos = camera.position;
      const camVec: Vec3 = [camPos[0], camPos[1], camPos[2]];
      const viewProj = mat4.create();
      mat4.multiply(viewProj, camera.projectionMatrix, camera.viewMatrix);

      const glowVerts: number[] = [];
      buildBoltPass(lines, camVec, 'glow', glowVerts);
      const coreVerts: number[] = [];
      buildBoltPass(lines, camVec, 'core', coreVerts);
      const glowCount = glowVerts.length / BOLT_FLOATS_PER_VERTEX;
      this.lightningVertexCount = glowCount + coreVerts.length / BOLT_FLOATS_PER_VERTEX;

      gl.enable(gl.BLEND);
      gl.depthMask(false);
      gl.useProgram(this.lightningProgram);
      gl.uniformMatrix4fv(this.uLightningViewProj, false, viewProj);

      gl.bindVertexArray(this.lightningVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lightningVbo);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([...glowVerts, ...coreVerts]),
        gl.DYNAMIC_DRAW,
      );

      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.uniform1f(this.uLightningSoft, 1.0);
      this.glWrapper.drawArrays(gl.TRIANGLES, 0, glowCount);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(this.uLightningSoft, 0.0);
      this.glWrapper.drawArrays(gl.TRIANGLES, glowCount, this.lightningVertexCount - glowCount);

      drawCalls += 2;
      triangles += this.lightningVertexCount / 3;

      gl.bindVertexArray(null);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    return { drawCalls, triangles };
  }
}
