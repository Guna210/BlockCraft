import { mat4 } from 'gl-matrix';
import { GLWrapper } from './gl';
import { Camera } from './camera';
import { settings } from '../engine/settings';
import {
  getWorldTime,
  skyAtmosphereFactors,
  skyLightMultiplier,
  sunDirection,
} from '../world/time';
import { GLSL_SKY_ATMOSPHERE } from './sky';
import { LCG } from './textures/noise';

export const CLOUD_CELL_SIZE = 12; // 12x12-block cells per Decision 1
export const CLOUD_GRID_CELLS = 32; // 32x32 cells = 384x384 blocks region
export const CLOUD_REGION_SIZE = CLOUD_CELL_SIZE * CLOUD_GRID_CELLS; // 384 blocks
export const CLOUD_Y_BOTTOM = 192; // Cloud field at y=192 per Decision 1
export const CLOUD_THICKNESS = 4; // Extruded 3D volumes ~4 blocks thick per Decision 1
export const CLOUD_Y_TOP = CLOUD_Y_BOTTOM + CLOUD_THICKNESS; // 196
export const CLOUD_WIND_SPEED = 1.0; // 1 block/s along +X per Decision 1
export const CLOUD_SHADE_TOP = 1.0; // Top face: white
export const CLOUD_SHADE_SIDE = 0.96; // Sides: near-white (thin bright rim along edges)
export const CLOUD_SHADE_BOTTOM = 0.78; // Underside: flat pale blue-grey tinted toward sky

/**
 * Generates a deterministic, seamlessly periodic 2D boolean cloud grid of 32x32 cells.
 * Tuned to roughly 30–40% coverage (35% target).
 * Produces chunky, compact blobs (most clouds 2–6 cells across in both directions,
 * with stepped outlines), mixing lone single cells and small 2–3 cell clumps.
 * Eliminates 1-cell-wide strands via 2x2 morphological opening.
 */
export function generateCloudGrid(
  seed = 12006,
  width = CLOUD_GRID_CELLS,
  height = CLOUD_GRID_CELLS,
  targetCoverage = 0.35,
): boolean[] {
  const rng = new LCG(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = rng.nextInt(0, i);
    const tmp = p[i]!;
    p[i] = p[j]!;
    p[j] = tmp;
  }
  const perm = (x: number, y: number) => p[(p[x & 255]! + (y & 255)) & 255]!;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const grad = (hash: number, x: number, y: number) => {
    const h = hash & 3;
    const u = h < 2 ? x : -x;
    const v = h === 0 || h === 3 ? y : -y;
    return u + v;
  };

  const perlin2DPeriodic = (x: number, y: number, period: number) => {
    const X = Math.floor(x);
    const Y = Math.floor(y);
    const xf = x - X;
    const yf = y - Y;
    const x0 = ((X % period) + period) % period;
    const y0 = ((Y % period) + period) % period;
    const x1 = (x0 + 1) % period;
    const y1 = (y0 + 1) % period;

    const u = smooth(xf);
    const v = smooth(yf);

    const n00 = grad(perm(x0, y0), xf, yf);
    const n10 = grad(perm(x1, y0), xf - 1, yf);
    const n01 = grad(perm(x0, y1), xf, yf - 1);
    const n11 = grad(perm(x1, y1), xf - 1, yf - 1);

    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    return nx0 + v * (nx1 - nx0);
  };

  const rawValues = new Float32Array(width * height);
  for (let cz = 0; cz < height; cz++) {
    for (let cx = 0; cx < width; cx++) {
      // Lower frequency periodic noise: period 8 (4-cell wavelength) + period 16 (2-cell wavelength)
      const gx = (cx + 8) % width;
      const gz = cz;
      const v1 = perlin2DPeriodic(gx / 4, gz / 4, 8);
      const v2 = perlin2DPeriodic(gx / 2, gz / 2, 16);
      rawValues[cz * width + cx] = v1 * 0.8 + v2 * 0.2;
    }
  }

  // Morphological open (erode then dilate) with a 2x2 structuring element
  const doOpen = (th: number): boolean[] => {
    const base = new Array<boolean>(width * height);
    for (let i = 0; i < width * height; i++) {
      base[i] = rawValues[i]! >= th;
    }
    const eroded = new Array<boolean>(width * height).fill(false);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const x1 = (x + 1) % width;
        const y1 = (y + 1) % height;
        if (
          base[y * width + x] &&
          base[y * width + x1] &&
          base[y1 * width + x] &&
          base[y1 * width + x1]
        ) {
          eroded[y * width + x] = true;
        }
      }
    }
    const opened = new Array<boolean>(width * height).fill(false);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (eroded[y * width + x]) {
          const x1 = (x + 1) % width;
          const y1 = (y + 1) % height;
          opened[y * width + x] = true;
          opened[y * width + x1] = true;
          opened[y1 * width + x] = true;
          opened[y1 * width + x1] = true;
        }
      }
    }
    return opened;
  };

  // Binary search for threshold matching desired target cell count
  const target = Math.round(width * height * targetCoverage - 2);
  let best: boolean[] = [];
  let bestDiff = Infinity;
  let low = -1.0;
  let high = 1.0;
  for (let iter = 0; iter < 32; iter++) {
    const mid = (low + high) / 2;
    const op = doOpen(mid);
    const count = op.filter(Boolean).length;
    const diff = Math.abs(count - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = op;
    }
    if (count > target) low = mid;
    else high = mid;
  }

  const result = best.slice();

  // Find isolated candidates for lone single cells and small 2–3 cell clumps
  const isIsolated = (x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = (x + dx + width) % width;
        const ny = (y + dy + height) % height;
        if (result[ny * width + nx]) return false;
      }
    }
    return true;
  };

  const candidates: { x: number; y: number; val: number }[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!result[idx] && isIsolated(x, y)) {
        candidates.push({ x, y, val: rawValues[idx]! });
      }
    }
  }
  candidates.sort((a, b) => b.val - a.val);

  let addedLone = 0;
  for (const c of candidates) {
    if (addedLone >= 3) break;
    if (isIsolated(c.x, c.y)) {
      result[c.y * width + c.x] = true;
      addedLone++;
    }
  }

  let addedClumps = 0;
  for (const c of candidates) {
    if (addedClumps >= 2) break;
    if (isIsolated(c.x, c.y)) {
      const nx = (c.x + 1) % width;
      const ny = c.y;
      if (isIsolated(nx, ny)) {
        result[c.y * width + c.x] = true;
        result[ny * width + nx] = true;
        addedClumps++;
      }
    }
  }

  return result;
}

const CLOUD_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_pos;
layout(location = 1) in float a_shade;
layout(location = 2) in vec2 a_uv;

uniform mat4 u_viewProj;
uniform vec3 u_cameraPos;
uniform vec2 u_regionOffset;
uniform float u_fogStart;
uniform float u_fogEnd;

out vec3 v_worldPos;
out float v_shade;
out vec2 v_uv;
out float v_fogFactor;

void main() {
  vec3 worldPos = a_pos + vec3(u_regionOffset.x, 0.0, u_regionOffset.y);
  v_worldPos = worldPos;
  v_shade = a_shade;
  v_uv = a_uv;

  // Horizontal distance across the cloud sheet to avoid overhead or view-angle fade
  float dist = length(worldPos.xz - u_cameraPos.xz);
  v_fogFactor = smoothstep(u_fogStart, u_fogEnd, dist);

  gl_Position = u_viewProj * vec4(worldPos, 1.0);
}
`;

const CLOUD_FS = `#version 300 es
precision highp float;

in vec3 v_worldPos;
in float v_shade;
in vec2 v_uv;
in float v_fogFactor;

uniform vec3 u_cameraPos;
uniform vec3 u_sunDir;
uniform float u_dayFactor;
uniform float u_twilightFactor;
uniform float u_nightFactor;
uniform float u_skyBrightness;
uniform int u_isFast;
uniform sampler2D u_cloudTexture;

out vec4 fragColor;

${GLSL_SKY_ATMOSPHERE}

void main() {
  if (v_fogFactor >= 0.999) {
    discard;
  }

  if (u_isFast == 1) {
    vec4 tex = texture(u_cloudTexture, v_uv);
    if (tex.a < 0.5) {
      discard;
    }
  }

  vec3 viewDir = normalize(v_worldPos - u_cameraPos);
  vec3 skyCol = skyAtmosphereColor(viewDir, u_sunDir, u_dayFactor, u_twilightFactor, u_nightFactor);

  // Shading per Owner Requirements:
  // - underside: lavender-blue tint toward sky colour roughly mix(underside, skyCol, 0.30)
  // - sides: near-white rim, softened side-to-underside contrast
  // - top: white
  vec3 dayCol;
  if (u_isFast == 1) {
    dayCol = mix(vec3(0.72, 0.74, 0.82), skyCol, 0.30);
  } else if (v_shade >= 0.99) {
    dayCol = vec3(1.0, 1.0, 1.0);
  } else if (v_shade >= 0.85) {
    dayCol = vec3(0.90, 0.92, 0.95);
  } else {
    dayCol = mix(vec3(0.72, 0.74, 0.82), skyCol, 0.30);
  }

  // Sunrise/sunset: warm horizon/sunset colour (orange-pink tint, lighter where the sun is)
  vec2 horizView = normalize((v_worldPos.xz - u_cameraPos.xz) + vec2(1e-5, 0.0));
  vec2 horizSun = normalize(u_sunDir.xz + vec2(1e-5, 0.0));
  float sunAzimuth = clamp(dot(horizView, horizSun) * 0.5 + 0.5, 0.0, 1.0);
  vec3 sunsetCol = mix(vec3(0.85, 0.52, 0.42), vec3(0.98, 0.72, 0.55), sunAzimuth) * (v_shade * 0.35 + 0.65);

  // Night: dim blue-grey driven by sky brightness
  vec3 nightCol = vec3(0.12, 0.15, 0.22) * v_shade;

  vec3 litCol = mix(mix(nightCol, dayCol, u_dayFactor), sunsetCol, u_twilightFactor * 0.85);
  litCol *= (0.20 + 0.80 * u_skyBrightness);

  // Fade only far away: smooth gentle fade into sky/horizon color
  vec3 finalRgb = mix(litCol, skyCol, v_fogFactor);

  // Fully solid opaque clouds (alpha 1, depth-tested against sky, hiding sun disc & glare)
  fragColor = vec4(finalRgb, 1.0);
}
`;

export class CloudRenderer {
  private readonly glWrapper: GLWrapper;
  private readonly program: WebGLProgram;

  // Fancy 3D volume mesh (built once, kept in GPU buffers)
  private readonly fancyVao: WebGLVertexArrayObject;
  private readonly fancyVbo: WebGLBuffer;
  private readonly fancyVertexCount: number;

  // Fast 2D flat plane mesh (built once)
  private readonly fastVao: WebGLVertexArrayObject;
  private readonly fastVbo: WebGLBuffer;
  private readonly fastVertexCount: number;
  private readonly cloudTexture: WebGLTexture;

  // Active grid for unit test inspection and fast texture
  public readonly activeGrid: boolean[];

  private readonly uViewProj: WebGLUniformLocation | null;
  private readonly uCameraPos: WebGLUniformLocation | null;
  private readonly uRegionOffset: WebGLUniformLocation | null;
  private readonly uFogStart: WebGLUniformLocation | null;
  private readonly uFogEnd: WebGLUniformLocation | null;
  private readonly uSunDir: WebGLUniformLocation | null;
  private readonly uDayFactor: WebGLUniformLocation | null;
  private readonly uTwilightFactor: WebGLUniformLocation | null;
  private readonly uNightFactor: WebGLUniformLocation | null;
  private readonly uSkyBrightness: WebGLUniformLocation | null;
  private readonly uIsFast: WebGLUniformLocation | null;
  private readonly uCloudTexture: WebGLUniformLocation | null;

  private readonly viewProj = mat4.create();

  constructor(glWrapper: GLWrapper) {
    this.glWrapper = glWrapper;
    const gl = glWrapper.gl;

    this.program = glWrapper.createProgram(CLOUD_VS, CLOUD_FS);
    this.uViewProj = gl.getUniformLocation(this.program, 'u_viewProj');
    this.uCameraPos = gl.getUniformLocation(this.program, 'u_cameraPos');
    this.uRegionOffset = gl.getUniformLocation(this.program, 'u_regionOffset');
    this.uFogStart = gl.getUniformLocation(this.program, 'u_fogStart');
    this.uFogEnd = gl.getUniformLocation(this.program, 'u_fogEnd');
    this.uSunDir = gl.getUniformLocation(this.program, 'u_sunDir');
    this.uDayFactor = gl.getUniformLocation(this.program, 'u_dayFactor');
    this.uTwilightFactor = gl.getUniformLocation(this.program, 'u_twilightFactor');
    this.uNightFactor = gl.getUniformLocation(this.program, 'u_nightFactor');
    this.uSkyBrightness = gl.getUniformLocation(this.program, 'u_skyBrightness');
    this.uIsFast = gl.getUniformLocation(this.program, 'u_isFast');
    this.uCloudTexture = gl.getUniformLocation(this.program, 'u_cloudTexture');

    // 1. Generate active noise grid
    this.activeGrid = generateCloudGrid(12006, CLOUD_GRID_CELLS, CLOUD_GRID_CELLS, 0.35);

    // 2. Build 3D fancy volume mesh
    const fancyVertices: number[] = [];
    const width = CLOUD_GRID_CELLS;
    const height = CLOUD_GRID_CELLS;
    const cellSize = CLOUD_CELL_SIZE;
    const y0 = CLOUD_Y_BOTTOM;
    const y1 = CLOUD_Y_TOP;

    const isActive = (cx: number, cz: number): boolean => {
      const x = ((cx % width) + width) % width;
      const z = ((cz % height) + height) % height;
      return this.activeGrid[z * width + x]!;
    };

    const addQuad = (
      p0: [number, number, number],
      p1: [number, number, number],
      p2: [number, number, number],
      p3: [number, number, number],
      shade: number,
      u0 = 0,
      v0 = 0,
      u1 = 0,
      v1 = 0,
    ) => {
      // Triangle 1: p0, p1, p2
      fancyVertices.push(p0[0], p0[1], p0[2], shade, u0, v0);
      fancyVertices.push(p1[0], p1[1], p1[2], shade, u0, v1);
      fancyVertices.push(p2[0], p2[1], p2[2], shade, u1, v1);
      // Triangle 2: p0, p2, p3
      fancyVertices.push(p0[0], p0[1], p0[2], shade, u0, v0);
      fancyVertices.push(p2[0], p2[1], p2[2], shade, u1, v1);
      fancyVertices.push(p3[0], p3[1], p3[2], shade, u1, v0);
    };

    for (let cz = 0; cz < height; cz++) {
      for (let cx = 0; cx < width; cx++) {
        if (!isActive(cx, cz)) continue;

        const x0 = cx * cellSize;
        const x1 = (cx + 1) * cellSize;
        const z0 = cz * cellSize;
        const z1 = (cz + 1) * cellSize;

        // Top face (y1, lighter shade 1.0)
        addQuad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], CLOUD_SHADE_TOP);

        // Bottom face (y0, darker shade 0.70)
        addQuad([x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], CLOUD_SHADE_BOTTOM);

        // Side faces: intermediate shade 0.85
        // North (-Z)
        if (!isActive(cx, cz - 1)) {
          addQuad([x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], CLOUD_SHADE_SIDE);
        }
        // South (+Z)
        if (!isActive(cx, cz + 1)) {
          addQuad([x0, y1, z1], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], CLOUD_SHADE_SIDE);
        }
        // West (-X)
        if (!isActive(cx - 1, cz)) {
          addQuad([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], CLOUD_SHADE_SIDE);
        }
        // East (+X)
        if (!isActive(cx + 1, cz)) {
          addQuad([x1, y1, z1], [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], CLOUD_SHADE_SIDE);
        }
      }
    }

    this.fancyVertexCount = fancyVertices.length / 6;
    const fancyData = new Float32Array(fancyVertices);

    this.fancyVao = glWrapper.createVertexArray();
    this.fancyVbo = glWrapper.createBuffer();
    gl.bindVertexArray(this.fancyVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fancyVbo);
    gl.bufferData(gl.ARRAY_BUFFER, fancyData, gl.STATIC_DRAW);

    const stride = 6 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 3 * 4);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 4 * 4);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    // 3. Build 2D flat plane mesh for Fast mode
    const regSize = CLOUD_REGION_SIZE;
    const fastVertices: number[] = [
      // Bottom side (viewed from below)
      0,
      y0,
      regSize,
      CLOUD_SHADE_SIDE,
      0,
      1,
      0,
      y0,
      0,
      CLOUD_SHADE_SIDE,
      0,
      0,
      regSize,
      y0,
      0,
      CLOUD_SHADE_SIDE,
      1,
      0,
      0,
      y0,
      regSize,
      CLOUD_SHADE_SIDE,
      0,
      1,
      regSize,
      y0,
      0,
      CLOUD_SHADE_SIDE,
      1,
      0,
      regSize,
      y0,
      regSize,
      CLOUD_SHADE_SIDE,
      1,
      1,
      // Top side (viewed from above)
      0,
      y0,
      0,
      CLOUD_SHADE_SIDE,
      0,
      0,
      0,
      y0,
      regSize,
      CLOUD_SHADE_SIDE,
      0,
      1,
      regSize,
      y0,
      regSize,
      CLOUD_SHADE_SIDE,
      1,
      1,
      0,
      y0,
      0,
      CLOUD_SHADE_SIDE,
      0,
      0,
      regSize,
      y0,
      regSize,
      CLOUD_SHADE_SIDE,
      1,
      1,
      regSize,
      y0,
      0,
      CLOUD_SHADE_SIDE,
      1,
      0,
    ];
    this.fastVertexCount = fastVertices.length / 6;
    const fastData = new Float32Array(fastVertices);

    this.fastVao = glWrapper.createVertexArray();
    this.fastVbo = glWrapper.createBuffer();
    gl.bindVertexArray(this.fastVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fastVbo);
    gl.bufferData(gl.ARRAY_BUFFER, fastData, gl.STATIC_DRAW);

    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 3 * 4);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 4 * 4);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    // 4. Create 32x32 2D texture for fast mode
    const texData = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      if (this.activeGrid[i]) {
        texData[i * 4] = 255;
        texData[i * 4 + 1] = 255;
        texData[i * 4 + 2] = 255;
        texData[i * 4 + 3] = 255;
      }
    }
    this.cloudTexture = glWrapper.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.cloudTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, texData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /**
   * Renders the cloud field.
   * Returns `{ drawCalls, triangles }` so WorldManager can record renderStats.
   */
  public render(
    camera: Camera,
    ticks: number = getWorldTime(),
    renderDistance = 8,
  ): { drawCalls: number; triangles: number } {
    const mode = settings.clouds;
    if (mode === 'off') {
      return { drawCalls: 0, triangles: 0 };
    }

    const gl = this.glWrapper.gl;

    // Cloud range reaches visibly to horizon: max(512, 2 * fogEnd), fading gently from 50%
    const terrainFogEnd = (renderDistance - 1) * 16;
    const cloudRange = Math.max(512, 2 * terrainFogEnd);
    const fogStart = cloudRange * 0.5;
    const fogEnd = cloudRange;

    // Wind drift at 1 block/s along +X, advanced on fixed tick per Decision 1
    const windOffset = (ticks / 20.0) * CLOUD_WIND_SPEED;

    const camX = camera.position[0];
    const camZ = camera.position[2];

    const gridCamX = camX - windOffset;
    const gridCamZ = camZ;

    const regSize = CLOUD_REGION_SIZE;
    const baseGridX = Math.floor(gridCamX / regSize) * regSize;
    const baseGridZ = Math.floor(gridCamZ / regSize) * regSize;

    mat4.multiply(this.viewProj, camera.projectionMatrix, camera.viewMatrix);

    const sunDir = sunDirection(ticks);
    const { dayFactor, twilightFactor, nightFactor } = skyAtmosphereFactors(ticks);
    const skyBrightness = skyLightMultiplier(ticks);

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uViewProj, false, this.viewProj);
    gl.uniform3f(this.uCameraPos, camera.position[0], camera.position[1], camera.position[2]);
    gl.uniform1f(this.uFogStart, fogStart);
    gl.uniform1f(this.uFogEnd, fogEnd);
    gl.uniform3f(this.uSunDir, sunDir[0], sunDir[1], sunDir[2]);
    gl.uniform1f(this.uDayFactor, dayFactor);
    gl.uniform1f(this.uTwilightFactor, twilightFactor);
    gl.uniform1f(this.uNightFactor, nightFactor);
    gl.uniform1f(this.uSkyBrightness, skyBrightness);

    // Opaque clouds: fully solid (alpha 1), depth-tested, writing depth, no translucency
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    let drawCalls = 0;
    let triangles = 0;

    const isFast = mode === 'fast';
    gl.uniform1i(this.uIsFast, isFast ? 1 : 0);

    if (isFast) {
      gl.disable(gl.CULL_FACE);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.cloudTexture);
      gl.uniform1i(this.uCloudTexture, 0);
      gl.bindVertexArray(this.fastVao);
    } else {
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.bindVertexArray(this.fancyVao);
    }

    const vertexCount = isFast ? this.fastVertexCount : this.fancyVertexCount;
    const triCountPerInstance = vertexCount / 3;

    // Tile regions covering cloud range to reach visibly to horizon
    const radius = Math.ceil(fogEnd / regSize);
    for (let j = -radius; j <= radius; j++) {
      for (let i = -radius; i <= radius; i++) {
        const instGridX = baseGridX + i * regSize;
        const instGridZ = baseGridZ + j * regSize;
        const worldX = instGridX + windOffset;
        const worldZ = instGridZ;

        // Bounding box distance test against fogEnd
        const dx = Math.max(0, Math.max(worldX - camX, camX - (worldX + regSize)));
        const dz = Math.max(0, Math.max(worldZ - camZ, camZ - (worldZ + regSize)));
        const minDist = Math.sqrt(dx * dx + dz * dz);

        if (minDist >= fogEnd) {
          continue;
        }

        gl.uniform2f(this.uRegionOffset, worldX, worldZ);
        this.glWrapper.drawArrays(gl.TRIANGLES, 0, vertexCount);
        drawCalls++;
        triangles += triCountPerInstance;
      }
    }

    gl.bindVertexArray(null);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(true);

    return { drawCalls, triangles };
  }
}
