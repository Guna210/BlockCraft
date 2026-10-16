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

/**
 * Procedural branching lightning bolt generator (Decision 4).
 * A jagged trunk from `start` to `end` (midpoint displacement) plus 2 to 4 seeded side branches
 * that leave the trunk and fork downward. Completely deterministic for the same seed and
 * endpoints. The first segment starts at `start` and the last one ends at `end`.
 */
export function generateLightningBolt(seed: number, start: Vec3, end: Vec3): LightningSegment[] {
  const rng = new LCG(seed);

  function jagged(
    out: LightningSegment[],
    p0: Vec3,
    p1: Vec3,
    depth: number,
    thickness: number,
    intensity: number,
  ): void {
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    if (depth <= 0 || len < 3.0) {
      out.push({ p0, p1, thickness, intensity });
      return;
    }
    const mid: Vec3 = [
      (p0[0] + p1[0]) * 0.5 + (rng.nextFloat() - 0.5) * len * 0.28,
      (p0[1] + p1[1]) * 0.5 + (rng.nextFloat() - 0.5) * len * 0.08,
      (p0[2] + p1[2]) * 0.5 + (rng.nextFloat() - 0.5) * len * 0.28,
    ];
    jagged(out, p0, mid, depth - 1, thickness, intensity);
    jagged(out, mid, p1, depth - 1, thickness, intensity);
  }

  const trunk: LightningSegment[] = [];
  jagged(trunk, start, end, 5, 0.45, 1.0);

  const branchCount = 2 + Math.floor(rng.nextFloat() * 3); // 2..4
  const branches: LightningSegment[] = [];
  const n = trunk.length;
  for (let i = 0; i < branchCount; i++) {
    // Spread the forks along the trunk, away from both ends
    const t = (i + 0.5) / branchCount;
    const idx = Math.min(
      n - 2,
      Math.max(1, Math.floor((0.1 + 0.8 * t) * n + (rng.nextFloat() - 0.5) * 2)),
    );
    const from = trunk[idx]!.p1;
    const angle = rng.nextFloat() * Math.PI * 2;
    const length = 12 + rng.nextFloat() * 14;
    const to: Vec3 = [
      from[0] + Math.cos(angle) * length * 0.6,
      from[1] - length * (0.5 + rng.nextFloat() * 0.3),
      from[2] + Math.sin(angle) * length * 0.6,
    ];
    jagged(branches, from, to, 3, 0.26, 0.8);
  }

  // Keep the trunk's first and last segments at the ends of the array
  return [trunk[0]!, ...branches, ...trunk.slice(1)];
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
layout(location = 1) in vec4 a_color;

uniform mat4 u_viewProj;
out vec4 v_color;

void main() {
  v_color = a_color;
  gl_Position = u_viewProj * vec4(a_pos, 1.0);
}
`;

const LIGHTNING_FS = `#version 300 es
precision highp float;

in vec4 v_color;
out vec4 fragColor;

void main() {
  fragColor = v_color;
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

    this.lightningVao = glWrapper.createVertexArray();
    this.lightningVbo = glWrapper.createBuffer();
    gl.bindVertexArray(this.lightningVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lightningVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 7 * 4, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 7 * 4, 3 * 4);
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

    // 4. Render lightning bolt if active
    const strike = weatherManager.activeStrike;
    if (strike) {
      const segments = generateLightningBolt(strike.seed, strike.start, strike.end);
      const boltVerts: number[] = [];

      const camPos = camera.position;
      const viewProj = mat4.create();
      mat4.multiply(viewProj, camera.projectionMatrix, camera.viewMatrix);

      const pushRibbon = (
        p0: Vec3,
        p1: Vec3,
        half: number,
        r: number,
        g: number,
        b: number,
        a: number,
      ): void => {
        const toCamX = camPos[0] - (p0[0] + p1[0]) * 0.5;
        const toCamY = camPos[1] - (p0[1] + p1[1]) * 0.5;
        const toCamZ = camPos[2] - (p0[2] + p1[2]) * 0.5;
        const dirX = p1[0] - p0[0];
        const dirY = p1[1] - p0[1];
        const dirZ = p1[2] - p0[2];
        // Camera-facing ribbon: dir x toCam
        let rx = dirY * toCamZ - dirZ * toCamY;
        let ry = dirZ * toCamX - dirX * toCamZ;
        let rz = dirX * toCamY - dirY * toCamX;
        const rLen = Math.hypot(rx, ry, rz) || 1.0;
        rx = (rx / rLen) * half;
        ry = (ry / rLen) * half;
        rz = (rz / rLen) * half;
        boltVerts.push(p0[0] - rx, p0[1] - ry, p0[2] - rz, r, g, b, a);
        boltVerts.push(p0[0] + rx, p0[1] + ry, p0[2] + rz, r, g, b, a);
        boltVerts.push(p1[0] + rx, p1[1] + ry, p1[2] + rz, r, g, b, a);
        boltVerts.push(p0[0] - rx, p0[1] - ry, p0[2] - rz, r, g, b, a);
        boltVerts.push(p1[0] + rx, p1[1] + ry, p1[2] + rz, r, g, b, a);
        boltVerts.push(p1[0] - rx, p1[1] - ry, p1[2] - rz, r, g, b, a);
      };

      // Glow pass first (wide, soft blue-white), then the bright white core on top. The core
      // half-width grows with distance so it stays a few pixels wide far from the camera.
      for (const seg of segments) {
        const dist = Math.hypot(
          camPos[0] - (seg.p0[0] + seg.p1[0]) * 0.5,
          camPos[1] - (seg.p0[1] + seg.p1[1]) * 0.5,
          camPos[2] - (seg.p0[2] + seg.p1[2]) * 0.5,
        );
        const core = Math.max(seg.thickness * 0.45, 0.006 * dist);
        pushRibbon(seg.p0, seg.p1, core * 4.0, 0.45, 0.62, 1.0, 0.16 * seg.intensity);
        pushRibbon(seg.p0, seg.p1, core * 2.2, 0.6, 0.75, 1.0, 0.28 * seg.intensity);
      }
      for (const seg of segments) {
        const dist = Math.hypot(
          camPos[0] - (seg.p0[0] + seg.p1[0]) * 0.5,
          camPos[1] - (seg.p0[1] + seg.p1[1]) * 0.5,
          camPos[2] - (seg.p0[2] + seg.p1[2]) * 0.5,
        );
        const core = Math.max(seg.thickness * 0.45, 0.006 * dist);
        pushRibbon(seg.p0, seg.p1, core, 0.97, 0.99, 1.0, seg.intensity);
      }

      this.lightningVertexCount = boltVerts.length / 7;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive glowing core
      gl.depthMask(false);

      gl.useProgram(this.lightningProgram);
      gl.uniformMatrix4fv(this.uLightningViewProj, false, viewProj);

      gl.bindVertexArray(this.lightningVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lightningVbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(boltVerts), gl.DYNAMIC_DRAW);
      this.glWrapper.drawArrays(gl.TRIANGLES, 0, this.lightningVertexCount);

      drawCalls++;
      triangles += this.lightningVertexCount / 3;

      gl.bindVertexArray(null);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    return { drawCalls, triangles };
  }
}
