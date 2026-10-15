import { mat4, vec3 } from 'gl-matrix';
import { GLWrapper } from './gl';
import { Camera } from './camera';
import { TextureAtlas } from './atlas';
import {
  getWorldTime,
  moonDirection,
  moonPhase,
  skyAtmosphereFactors,
  sunDirection,
} from '../world/time';
import { getWeather, weatherManager } from '../world/weather';

/**
 * Shared GLSL function that computes the sky atmosphere colour for any world-space ray `dir`.
 * Used by both the full-screen sky pass and the chunk shader's distance fog so fog blends
 * seamlessly into the sky in the view direction at every time of day.
 */
export const GLSL_SKY_ATMOSPHERE = `
vec3 skyAtmosphereColor(vec3 dir, vec3 sunDir, float dayFactor, float twilightFactor, float nightFactor) {
  float h = clamp(dir.y, 0.0, 1.0);
  float zenithT = h * (2.0 - h);

  // Day sky: horizon RGB(132, 212, 255) -> zenith RGB(72, 168, 248)
  vec3 dayHorizon = vec3(132.0 / 255.0, 212.0 / 255.0, 1.0);
  vec3 dayZenith = vec3(72.0 / 255.0, 168.0 / 255.0, 248.0 / 255.0);
  vec3 dayCol = mix(dayHorizon, dayZenith, zenithT);

  // Night sky: deep navy horizon RGB(10, 14, 28) -> zenith RGB(4, 6, 15)
  vec3 nightHorizon = vec3(10.0 / 255.0, 14.0 / 255.0, 28.0 / 255.0);
  vec3 nightZenith = vec3(4.0 / 255.0, 6.0 / 255.0, 15.0 / 255.0);
  vec3 nightCol = mix(nightHorizon, nightZenith, zenithT);

  vec3 sky = mix(nightCol, dayCol, dayFactor);

  if (twilightFactor > 0.001) {
    // Twilight sky base (indigo zenith + warm amber horizon)
    vec3 duskZenith = vec3(32.0 / 255.0, 38.0 / 255.0, 82.0 / 255.0);
    vec3 duskHorizon = vec3(198.0 / 255.0, 96.0 / 255.0, 52.0 / 255.0);
    vec3 duskSky = mix(duskHorizon, duskZenith, sqrt(h));
    sky = mix(sky, duskSky, twilightFactor * 0.78);

    // Sunrise/sunset directional orange-red glow toward the sun near the horizon
    vec2 horizView = normalize(dir.xz + vec2(1e-5, 0.0));
    vec2 horizSun = normalize(sunDir.xz + vec2(1e-5, 0.0));
    float sunAzimuth = clamp(dot(horizView, horizSun) * 0.5 + 0.5, 0.0, 1.0);
    float az2 = sunAzimuth * sunAzimuth;
    float ay = clamp(1.0 - abs(dir.y) * 2.2, 0.0, 1.0);
    float horizonBand = ay * ay;
    float glow = twilightFactor * horizonBand * (0.35 + 0.65 * az2);
    vec3 sunsetGlow = mix(
      vec3(235.0 / 255.0, 84.0 / 255.0, 28.0 / 255.0),
      vec3(255.0 / 255.0, 148.0 / 255.0, 36.0 / 255.0),
      az2
    );
    sky = mix(sky, sunsetGlow, clamp(glow * 1.15, 0.0, 1.0));
  }

  return clamp(sky, 0.0, 1.0);
}
`;

const SKY_VS = `#version 300 es
precision highp float;

uniform mat4 u_invRotViewProj;
out vec3 v_worldRay;

void main() {
  vec2 pos = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
  v_worldRay = (u_invRotViewProj * vec4(pos, 1.0, 1.0)).xyz;
  gl_Position = vec4(pos, 0.9999, 1.0);
}
`;

const SKY_FS = `#version 300 es
precision highp float;

in vec3 v_worldRay;

uniform vec3 u_sunDir;
uniform float u_dayFactor;
uniform float u_twilightFactor;
uniform float u_nightFactor;
uniform float u_worldTime;
uniform float u_rainFactor;
uniform float u_lightningFlash;

out vec4 fragColor;

${GLSL_SKY_ATMOSPHERE}

void main() {
  vec3 dir = normalize(v_worldRay);
  vec3 sky = skyAtmosphereColor(dir, u_sunDir, u_dayFactor, u_twilightFactor, u_nightFactor);

  // Hashed direction grid stars with subtle twinkle, fading in at dusk
  if (u_nightFactor > 0.01 && dir.y > 0.03) {
    vec2 skyUV = (dir.xz / (1.0 + dir.y)) * 85.0;
    vec2 cell = floor(skyUV);
    vec2 uv = fract(skyUV);
    vec2 fw = max(fwidth(skyUV), vec2(1e-4));

    float h1 = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
    if (h1 > 0.76) {
      float h2 = fract(sin(dot(cell, vec2(269.5, 183.3))) * 43758.5453);
      float h3 = fract(sin(dot(cell, vec2(419.2, 371.9))) * 43758.5453);
      vec2 starPos = vec2(0.22 + 0.56 * h2, 0.22 + 0.56 * h3);
      vec2 d = abs(uv - starPos);
      if (d.x < fw.x * 0.48 && d.y < fw.y * 0.48) {
        float twinklePhase = u_worldTime * 0.12 + h1 * 62.83;
        float twinkle = 0.82 + 0.18 * sin(twinklePhase);
        float horizonFade = smoothstep(0.03, 0.14, dir.y);
        float starBright = u_nightFactor * twinkle * horizonFade;
        vec3 starTint = mix(vec3(0.88, 0.93, 1.0), vec3(1.0, 0.96, 0.86), h2);
        sky = max(sky, starTint * (0.80 + 0.20 * h3) * starBright);
      }
    }
  }

  // Sun glare halo around the sun (Decision 5)
  if (u_sunDir.y > -0.08) {
    float cosSun = dot(dir, normalize(u_sunDir));
    if (cosSun > 0.70) {
      float sunHeight = clamp(u_sunDir.y, 0.0, 1.0);
      float highFactor = smoothstep(0.05, 0.65, sunHeight);

      // Halo expands and softens as the sun rises
      float haloStart = mix(0.965, 0.82, highFactor);
      float halo = smoothstep(haloStart, 0.992, cosSun);

      // Core saturates to near white when high so the pixel disc is washed out
      float core = smoothstep(0.985, 0.998, cosSun) * highFactor;

      // Color warms to orange near the horizon, bright white when high
      vec3 warmColor = vec3(1.0, 0.55, 0.15);
      vec3 whiteColor = vec3(1.0, 1.0, 1.0);
      vec3 glareColor = mix(warmColor, whiteColor, highFactor);

      // Intensity: soft warm glow at sunset, blinding white saturation at noon
      float intensity = mix(0.40 * halo, min(1.0, halo * 0.75 + core * 1.5), highFactor);
      sky = mix(sky, glareColor, clamp(intensity, 0.0, 1.0));
    }
  }

  // Weather darkening and desaturation (Decision 3) & lightning flash (Decision 4)
  if (u_rainFactor > 0.001) {
    float lum = dot(sky, vec3(0.2126, 0.7152, 0.0722));
    sky = mix(sky, vec3(lum), 0.55 * u_rainFactor) * mix(1.0, 0.45, u_rainFactor);
  }
  if (u_lightningFlash > 0.001) {
    sky += vec3(u_lightningFlash * 0.9);
  }

  fragColor = vec4(sky, 1.0);
}
`;

const BILLBOARD_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in float a_alpha;

uniform mat4 u_rotViewProj;

out vec2 v_uv;
out float v_alpha;

void main() {
  v_uv = a_uv;
  v_alpha = a_alpha;
  vec4 clip = u_rotViewProj * vec4(a_pos, 1.0);
  gl_Position = vec4(clip.xy, clip.w * 0.9998, clip.w);
}
`;

const BILLBOARD_FS = `#version 300 es
precision highp float;

in vec2 v_uv;
in float v_alpha;

uniform sampler2D u_atlas;

out vec4 fragColor;

void main() {
  vec4 tex = textureLod(u_atlas, v_uv, 0.0);
  if (tex.a < 0.05 || v_alpha <= 0.01) {
    discard;
  }
  fragColor = vec4(tex.rgb, tex.a * v_alpha);
}
`;

const BILLBOARD_DISTANCE = 10.0;
const BILLBOARD_HALF_SIZE = 1.15;

export class SkyRenderer {
  private readonly glWrapper: GLWrapper;
  private readonly skyProgram: WebGLProgram;
  private readonly skyVao: WebGLVertexArrayObject;
  private readonly uInvRotViewProj: WebGLUniformLocation | null;
  private readonly uSunDir: WebGLUniformLocation | null;
  private readonly uDayFactor: WebGLUniformLocation | null;
  private readonly uTwilightFactor: WebGLUniformLocation | null;
  private readonly uNightFactor: WebGLUniformLocation | null;
  private readonly uWorldTime: WebGLUniformLocation | null;
  private readonly uRainFactor: WebGLUniformLocation | null;
  private readonly uLightningFlash: WebGLUniformLocation | null;

  private readonly billboardProgram: WebGLProgram;
  private readonly billboardVao: WebGLVertexArrayObject;
  private readonly billboardVbo: WebGLBuffer;
  private readonly uRotViewProj: WebGLUniformLocation | null;
  private readonly uAtlas: WebGLUniformLocation | null;

  private readonly viewRot = mat4.create();
  private readonly rotViewProj = mat4.create();
  private readonly invRotViewProj = mat4.create();
  private readonly billboardData = new Float32Array(12 * 6);
  private readonly rightVec = vec3.create();
  private readonly upVec = vec3.create();
  private readonly refUp = vec3.create();

  constructor(glWrapper: GLWrapper) {
    this.glWrapper = glWrapper;
    const gl = glWrapper.gl;

    this.skyProgram = glWrapper.createProgram(SKY_VS, SKY_FS);
    this.skyVao = glWrapper.createVertexArray();
    this.uInvRotViewProj = gl.getUniformLocation(this.skyProgram, 'u_invRotViewProj');
    this.uSunDir = gl.getUniformLocation(this.skyProgram, 'u_sunDir');
    this.uDayFactor = gl.getUniformLocation(this.skyProgram, 'u_dayFactor');
    this.uTwilightFactor = gl.getUniformLocation(this.skyProgram, 'u_twilightFactor');
    this.uNightFactor = gl.getUniformLocation(this.skyProgram, 'u_nightFactor');
    this.uWorldTime = gl.getUniformLocation(this.skyProgram, 'u_worldTime');
    this.uRainFactor = gl.getUniformLocation(this.skyProgram, 'u_rainFactor');
    this.uLightningFlash = gl.getUniformLocation(this.skyProgram, 'u_lightningFlash');

    this.billboardProgram = glWrapper.createProgram(BILLBOARD_VS, BILLBOARD_FS);
    this.billboardVao = glWrapper.createVertexArray();
    this.billboardVbo = glWrapper.createBuffer();
    this.uRotViewProj = gl.getUniformLocation(this.billboardProgram, 'u_rotViewProj');
    this.uAtlas = gl.getUniformLocation(this.billboardProgram, 'u_atlas');

    gl.bindVertexArray(this.billboardVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.billboardVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.billboardData.byteLength, gl.DYNAMIC_DRAW);
    const stride = 6 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 3 * 4);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 5 * 4);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  private writeBillboardQuad(
    offsetFloats: number,
    dir: [number, number, number],
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    alpha: number,
  ): void {
    const forward = vec3.fromValues(dir[0], dir[1], dir[2]);
    vec3.normalize(forward, forward);
    if (Math.abs(forward[1]) < 0.99) {
      vec3.set(this.refUp, 0, 1, 0);
    } else {
      vec3.set(this.refUp, 0, 0, 1);
    }
    vec3.cross(this.rightVec, forward, this.refUp);
    vec3.normalize(this.rightVec, this.rightVec);
    vec3.cross(this.upVec, this.rightVec, forward);
    vec3.normalize(this.upVec, this.upVec);

    const cx = forward[0] * BILLBOARD_DISTANCE;
    const cy = forward[1] * BILLBOARD_DISTANCE;
    const cz = forward[2] * BILLBOARD_DISTANCE;

    const rx = this.rightVec[0] * BILLBOARD_HALF_SIZE;
    const ry = this.rightVec[1] * BILLBOARD_HALF_SIZE;
    const rz = this.rightVec[2] * BILLBOARD_HALF_SIZE;

    const ux = this.upVec[0] * BILLBOARD_HALF_SIZE;
    const uy = this.upVec[1] * BILLBOARD_HALF_SIZE;
    const uz = this.upVec[2] * BILLBOARD_HALF_SIZE;

    // 4 corners: 0=BL, 1=BR, 2=TR, 3=TL
    const x0 = cx - rx - ux;
    const y0 = cy - ry - uy;
    const z0 = cz - rz - uz;

    const x1 = cx + rx - ux;
    const y1 = cy + ry - uy;
    const z1 = cz + rz - uz;

    const x2 = cx + rx + ux;
    const y2 = cy + ry + uy;
    const z2 = cz + rz + uz;

    const x3 = cx - rx + ux;
    const y3 = cy - ry + uy;
    const z3 = cz - rz + uz;

    const out = this.billboardData;
    let i = offsetFloats;

    // Triangle 1: BL, BR, TR
    out[i++] = x0;
    out[i++] = y0;
    out[i++] = z0;
    out[i++] = u0;
    out[i++] = v1;
    out[i++] = alpha;

    out[i++] = x1;
    out[i++] = y1;
    out[i++] = z1;
    out[i++] = u1;
    out[i++] = v1;
    out[i++] = alpha;

    out[i++] = x2;
    out[i++] = y2;
    out[i++] = z2;
    out[i++] = u1;
    out[i++] = v0;
    out[i++] = alpha;

    // Triangle 2: BL, TR, TL
    out[i++] = x0;
    out[i++] = y0;
    out[i++] = z0;
    out[i++] = u0;
    out[i++] = v1;
    out[i++] = alpha;

    out[i++] = x2;
    out[i++] = y2;
    out[i++] = z2;
    out[i++] = u1;
    out[i++] = v0;
    out[i++] = alpha;

    out[i++] = x3;
    out[i++] = y3;
    out[i++] = z3;
    out[i++] = u0;
    out[i++] = v0;
    out[i] = alpha;
  }

  /**
   * Renders the full-screen sky pass and sun/moon billboards with depth writes disabled.
   * Returns `{ drawCalls, triangles }` so WorldManager can add them to renderStats.
   */
  public render(
    camera: Camera,
    atlasTexture: WebGLTexture,
    atlas: TextureAtlas,
    ticks: number = getWorldTime(),
    rainFactor = 0,
    lightningFlash = 0,
  ): { drawCalls: number; triangles: number } {
    const gl = this.glWrapper.gl;

    mat4.copy(this.viewRot, camera.viewMatrix);
    this.viewRot[12] = 0;
    this.viewRot[13] = 0;
    this.viewRot[14] = 0;
    mat4.multiply(this.rotViewProj, camera.projectionMatrix, this.viewRot);
    mat4.invert(this.invRotViewProj, this.rotViewProj);

    const sunDir = sunDirection(ticks);
    const moonDir = moonDirection(ticks);
    const phase = moonPhase(ticks);
    const { dayFactor, twilightFactor, nightFactor } = skyAtmosphereFactors(ticks);

    const weather = getWeather();
    const effectiveRain =
      rainFactor > 0 ? rainFactor : weather === 'clear' ? 0.0 : weather === 'rain' ? 1.0 : 1.25;
    const effectiveFlash = lightningFlash > 0 ? lightningFlash : weatherManager.flashIntensity;

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    // 1. Full-screen sky dome pass
    gl.useProgram(this.skyProgram);
    gl.uniformMatrix4fv(this.uInvRotViewProj, false, this.invRotViewProj);
    gl.uniform3f(this.uSunDir, sunDir[0], sunDir[1], sunDir[2]);
    gl.uniform1f(this.uDayFactor, dayFactor);
    gl.uniform1f(this.uTwilightFactor, twilightFactor);
    gl.uniform1f(this.uNightFactor, nightFactor);
    gl.uniform1f(this.uWorldTime, ticks);
    gl.uniform1f(this.uRainFactor, effectiveRain);
    gl.uniform1f(this.uLightningFlash, effectiveFlash);

    gl.bindVertexArray(this.skyVao);
    this.glWrapper.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. Sun and Moon billboard quads
    const sunRect = atlas.rects.get('sun');
    const moonRect = atlas.rects.get(`moon_${phase}`) ?? atlas.rects.get('moon_0');
    let drawCalls = 1;
    let triangles = 1;

    if (sunRect && moonRect) {
      const sunAlphaBase = Math.max(0, Math.min(1, (sunDir[1] + 0.18) / 0.22));
      const sunHeight = Math.max(0, Math.min(1, sunDir[1]));
      const highFactor = Math.max(0, Math.min(1, (sunHeight - 0.05) / 0.6));
      const sunAlpha =
        sunAlphaBase * (1.0 - highFactor * 1.0) * (1.0 - Math.min(1.0, effectiveRain * 0.9));
      const moonAlpha =
        Math.max(0, Math.min(1, (moonDir[1] + 0.18) / 0.22)) *
        (1.0 - Math.min(1.0, effectiveRain * 0.9));

      this.writeBillboardQuad(
        0,
        sunDir,
        sunRect.x / atlas.width,
        sunRect.y / atlas.height,
        (sunRect.x + sunRect.w) / atlas.width,
        (sunRect.y + sunRect.h) / atlas.height,
        sunAlpha,
      );
      this.writeBillboardQuad(
        6 * 6,
        moonDir,
        moonRect.x / atlas.width,
        moonRect.y / atlas.height,
        (moonRect.x + moonRect.w) / atlas.width,
        (moonRect.y + moonRect.h) / atlas.height,
        moonAlpha,
      );

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.billboardProgram);
      gl.uniformMatrix4fv(this.uRotViewProj, false, this.rotViewProj);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
      gl.uniform1i(this.uAtlas, 0);

      gl.bindVertexArray(this.billboardVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.billboardVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.billboardData);
      this.glWrapper.drawArrays(gl.TRIANGLES, 0, 12);

      drawCalls += 1;
      triangles += 4;
    }

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);

    return { drawCalls, triangles };
  }
}
