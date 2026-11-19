import type { Settings } from '../../engine/settings';
import type { DimensionId } from '../../world/dimension';
import type { GLWrapper } from '../gl';
import {
  computeGodRaysState,
  fillActivePostFxPasses,
  type GodRaysState,
  type PostFxPassName,
} from './sun-visibility';

const QUAD_VS = `#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const COPY_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
out vec4 fragColor;
void main() {
  fragColor = vec4(texture(u_scene, v_uv).rgb, 1.0);
}`;

// 4-bilinear-tap box downsample over a 4x4 full-resolution neighborhood to produce quarter-res bloom input.
const BLOOM_DOWNSAMPLE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform vec2 u_srcTexel;
out vec4 fragColor;
void main() {
  vec3 c = texture(u_source, v_uv + vec2(-u_srcTexel.x, -u_srcTexel.y)).rgb;
  c += texture(u_source, v_uv + vec2(u_srcTexel.x, -u_srcTexel.y)).rgb;
  c += texture(u_source, v_uv + vec2(-u_srcTexel.x, u_srcTexel.y)).rgb;
  c += texture(u_source, v_uv + vec2(u_srcTexel.x, u_srcTexel.y)).rgb;
  fragColor = vec4(c * 0.25, 1.0);
}`;

// 9-tap separable Gaussian blur along u_axis.
const BLOOM_BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform vec2 u_axis;
out vec4 fragColor;
void main() {
  const float w0 = 0.22702703;
  const float w1 = 0.19459459;
  const float w2 = 0.12162162;
  const float w3 = 0.05405405;
  const float w4 = 0.01621622;
  vec3 acc = texture(u_source, v_uv).rgb * w0;
  acc += (texture(u_source, v_uv + u_axis * 1.0).rgb + texture(u_source, v_uv - u_axis * 1.0).rgb) * w1;
  acc += (texture(u_source, v_uv + u_axis * 2.0).rgb + texture(u_source, v_uv - u_axis * 2.0).rgb) * w2;
  acc += (texture(u_source, v_uv + u_axis * 3.0).rgb + texture(u_source, v_uv - u_axis * 3.0).rgb) * w3;
  acc += (texture(u_source, v_uv + u_axis * 4.0).rgb + texture(u_source, v_uv - u_axis * 4.0).rgb) * w4;
  fragColor = vec4(acc, 1.0);
}`;

const BLOOM_COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform float u_strength;
out vec4 fragColor;
void main() {
  vec3 scene = texture(u_scene, v_uv).rgb;
  vec3 bloom = texture(u_bloom, v_uv).rgb;
  // Soft highlight preservation so non-emissive surfaces stay completely untouched when bloom == 0.
  vec3 color = scene + bloom * (u_strength * (1.0 - 0.25 * scene));
  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;

const GOD_RAYS_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform highp sampler2D u_depth;
uniform vec2 u_sunUV;
uniform vec2 u_resolution;
uniform float u_intensity;
uniform vec3 u_sunColor;
out vec4 fragColor;
void main() {
  vec3 scene = texture(u_scene, v_uv).rgb;
  const int SAMPLES = 36;
  vec2 delta = (v_uv - u_sunUV) * (0.90 / float(SAMPLES));
  vec2 sampleUV = v_uv;
  float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  sampleUV -= delta * jitter;

  float decay = 1.0;
  float shafts = 0.0;
  for (int i = 0; i < SAMPLES; i++) {
    sampleUV -= delta;
    if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) continue;
    float d = texture(u_depth, sampleUV).r;
    float skyMask = smoothstep(0.99987, 0.999895, d);
    shafts += skyMask * decay;
    decay *= 0.945;
  }
  shafts /= float(SAMPLES);

  float aspect = u_resolution.x / max(1.0, u_resolution.y);
  float sunDist = length((v_uv - u_sunUV) * vec2(aspect, 1.0));
  float radialMask = 1.0 - smoothstep(0.15, 1.45, sunDist);
  vec3 rays = u_sunColor * (shafts * u_intensity * radialMask * 0.48);
  fragColor = vec4(clamp(scene + rays, 0.0, 1.0), 1.0);
}`;

// Original single-pass luma-based FXAA implemented from scratch in GLSL ES 3.00.
const FXAA_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform vec2 u_texelSize;
out vec4 fragColor;

float luma(vec3 rgb) {
  return dot(rgb, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec3 cM = texture(u_scene, v_uv).rgb;
  float lM = luma(cM);
  float lN = luma(texture(u_scene, v_uv + vec2(0.0, u_texelSize.y)).rgb);
  float lS = luma(texture(u_scene, v_uv - vec2(0.0, u_texelSize.y)).rgb);
  float lE = luma(texture(u_scene, v_uv + vec2(u_texelSize.x, 0.0)).rgb);
  float lW = luma(texture(u_scene, v_uv - vec2(u_texelSize.x, 0.0)).rgb);

  float lMin = min(lM, min(min(lN, lS), min(lE, lW)));
  float lMax = max(lM, max(max(lN, lS), max(lE, lW)));
  float contrast = lMax - lMin;
  if (contrast < max(0.0312, lMax * 0.125)) {
    fragColor = vec4(cM, 1.0);
    return;
  }

  float lNW = luma(texture(u_scene, v_uv + vec2(-u_texelSize.x, u_texelSize.y)).rgb);
  float lNE = luma(texture(u_scene, v_uv + vec2(u_texelSize.x, u_texelSize.y)).rgb);
  float lSW = luma(texture(u_scene, v_uv + vec2(-u_texelSize.x, -u_texelSize.y)).rgb);
  float lSE = luma(texture(u_scene, v_uv + vec2(u_texelSize.x, -u_texelSize.y)).rgb);

  float lNS = lN + lS;
  float lEW = lE + lW;
  float subpixAvg = (2.0 * (lNS + lEW) + lNW + lNE + lSW + lSE) / 12.0;
  float subpixNorm = clamp(abs(subpixAvg - lM) / contrast, 0.0, 1.0);
  float subpixSmooth = subpixNorm * subpixNorm * (3.0 - 2.0 * subpixNorm);
  float subpixOffset = subpixSmooth * subpixSmooth * 0.75;

  float edgeHoriz =
    abs(lNW + lNE - 2.0 * lN) +
    abs(lW + lE - 2.0 * lM) * 2.0 +
    abs(lSW + lSE - 2.0 * lS);
  float edgeVert =
    abs(lNW + lSW - 2.0 * lW) +
    abs(lN + lS - 2.0 * lM) * 2.0 +
    abs(lNE + lSE - 2.0 * lE);
  bool isHoriz = edgeHoriz >= edgeVert;

  float lNeg = isHoriz ? lS : lW;
  float lPos = isHoriz ? lN : lE;
  float gradNeg = abs(lNeg - lM);
  float gradPos = abs(lPos - lM);
  bool negSteeper = gradNeg >= gradPos;

  float stepNormal = isHoriz ? u_texelSize.y : u_texelSize.x;
  if (negSteeper) stepNormal = -stepNormal;
  vec2 stepVec = isHoriz ? vec2(0.0, stepNormal) : vec2(stepNormal, 0.0);
  vec2 tangent = isHoriz ? vec2(u_texelSize.x, 0.0) : vec2(0.0, u_texelSize.y);

  float edgeLuma = 0.5 * (lM + (negSteeper ? lNeg : lPos));
  float gradThresh = 0.25 * max(gradNeg, gradPos);

  vec2 uvMid = v_uv + stepVec * 0.5;
  vec2 uvNeg = uvMid - tangent;
  vec2 uvPos = uvMid + tangent;
  float endNeg = luma(texture(u_scene, uvNeg).rgb) - edgeLuma;
  float endPos = luma(texture(u_scene, uvPos).rgb) - edgeLuma;
  bool doneNeg = abs(endNeg) >= gradThresh;
  bool donePos = abs(endPos) >= gradThresh;

  const float STEPS[5] = float[5](1.0, 1.5, 2.0, 3.0, 4.0);
  for (int i = 0; i < 5; i++) {
    if (!doneNeg) {
      uvNeg -= tangent * STEPS[i];
      endNeg = luma(texture(u_scene, uvNeg).rgb) - edgeLuma;
      doneNeg = abs(endNeg) >= gradThresh;
    }
    if (!donePos) {
      uvPos += tangent * STEPS[i];
      endPos = luma(texture(u_scene, uvPos).rgb) - edgeLuma;
      donePos = abs(endPos) >= gradThresh;
    }
    if (doneNeg && donePos) break;
  }

  float distNeg = isHoriz ? (uvMid.x - uvNeg.x) : (uvMid.y - uvNeg.y);
  float distPos = isHoriz ? (uvPos.x - uvMid.x) : (uvPos.y - uvMid.y);
  bool useNeg = distNeg <= distPos;
  float endClosest = useNeg ? endNeg : endPos;
  bool validSpan = (lM < edgeLuma) != (endClosest < 0.0);
  float span = max(distNeg + distPos, 1e-6);
  float minDist = min(distNeg, distPos);
  float edgeOffset = validSpan ? (0.5 - minDist / span) : 0.0;
  float finalOffset = max(edgeOffset, subpixOffset);

  fragColor = vec4(texture(u_scene, v_uv + stepVec * finalOffset).rgb, 1.0);
}`;

const ZERO_4 = new Float32Array([0, 0, 0, 0]);
const ONE_BUFFERS = [0x8ce0]; // COLOR_ATTACHMENT0 (numeric value assigned dynamically via gl.COLOR_ATTACHMENT0)
void ONE_BUFFERS;

export interface PostFxStats {
  enabled: boolean;
  passes: PostFxPassName[];
  targetSize: [number, number];
  passMs: {
    scene: number;
    bloom: number;
    godRays: number;
    fxaa: number;
    total: number;
  };
}

export interface PostFxContext {
  settings: Pick<Settings, 'bloom' | 'godRays' | 'fxaa'>;
  dimension: DimensionId;
  underwater: boolean;
  sunDir: readonly [number, number, number];
  dayFactor: number;
  twilightFactor: number;
  rainFactor: number;
  viewMatrix: ArrayLike<number>;
  projectionMatrix: ArrayLike<number>;
}

/**
 * Owns the offscreen scene render target and executes Bloom, God Rays, and FXAA passes without
 * per-frame heap allocations or touching the default framebuffer path when all toggles are off.
 */
export class PostProcessor {
  private width = 0;
  private height = 0;
  private bloomW = 0;
  private bloomH = 0;

  private vao: WebGLVertexArrayObject | null = null;
  private sceneFbo: WebGLFramebuffer | null = null;
  private sceneCopyFbo: WebGLFramebuffer | null = null;
  private sceneColorTex: WebGLTexture | null = null;
  private sceneDepthTex: WebGLTexture | null = null;
  private sceneEmissiveTex: WebGLTexture | null = null;
  private emissiveAttached = false;

  private postTempFbo: WebGLFramebuffer | null = null;
  private postTempTex: WebGLTexture | null = null;

  private bloomFboA: WebGLFramebuffer | null = null;
  private bloomFboB: WebGLFramebuffer | null = null;
  private bloomTexA: WebGLTexture | null = null;
  private bloomTexB: WebGLTexture | null = null;

  private copyProgram: WebGLProgram | null = null;
  private copyLocScene: WebGLUniformLocation | null = null;

  private downsampleProgram: WebGLProgram | null = null;
  private downsampleLocSource: WebGLUniformLocation | null = null;
  private downsampleLocTexel: WebGLUniformLocation | null = null;

  private blurProgram: WebGLProgram | null = null;
  private blurLocSource: WebGLUniformLocation | null = null;
  private blurLocAxis: WebGLUniformLocation | null = null;

  private bloomProgram: WebGLProgram | null = null;
  private bloomLocScene: WebGLUniformLocation | null = null;
  private bloomLocBloom: WebGLUniformLocation | null = null;
  private bloomLocStrength: WebGLUniformLocation | null = null;

  private godRaysProgram: WebGLProgram | null = null;
  private godRaysLocScene: WebGLUniformLocation | null = null;
  private godRaysLocDepth: WebGLUniformLocation | null = null;
  private godRaysLocSunUV: WebGLUniformLocation | null = null;
  private godRaysLocResolution: WebGLUniformLocation | null = null;
  private godRaysLocIntensity: WebGLUniformLocation | null = null;
  private godRaysLocSunColor: WebGLUniformLocation | null = null;

  private fxaaProgram: WebGLProgram | null = null;
  private fxaaLocScene: WebGLUniformLocation | null = null;
  private fxaaLocTexel: WebGLUniformLocation | null = null;

  private readonly godRaysState: GodRaysState = {
    enabled: false,
    sunUV: [0.5, 0.5],
    intensity: 0,
  };
  private readonly activePasses: PostFxPassName[] = [];
  private beginMs = 0;
  private sceneMs = 0;
  private bloomMs = 0;
  private godRaysMs = 0;
  private fxaaMs = 0;
  private totalMs = 0;
  private activeInLastFrame = false;

  constructor(private readonly glWrapper: GLWrapper) {}

  private ensureSceneTarget(needBloom: boolean, needTempTarget: boolean): void {
    const gl = this.glWrapper.gl;
    const w = Math.max(1, gl.drawingBufferWidth);
    const h = Math.max(1, gl.drawingBufferHeight);
    const resized = w !== this.width || h !== this.height || !this.sceneFbo;

    if (!this.vao) {
      this.vao = this.glWrapper.createVertexArray();
    }

    if (resized) {
      this.disposeRenderTargets();
      this.width = w;
      this.height = h;
      this.bloomW = Math.max(1, w >> 2);
      this.bloomH = Math.max(1, h >> 2);

      // Match the default framebuffer's depth-stencil internal format so FluidDepth blitFramebuffer works cleanly.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const depthBits = gl.getParameter(gl.DEPTH_BITS);
      const depthInternal = depthBits === 32 ? gl.DEPTH32F_STENCIL8 : gl.DEPTH24_STENCIL8;
      const depthType = depthBits === 32 ? gl.FLOAT_32_UNSIGNED_INT_24_8_REV : gl.UNSIGNED_INT_24_8;

      this.sceneColorTex = this.createColorTexture(w, h);
      this.sceneDepthTex = this.glWrapper.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.sceneDepthTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, depthInternal, w, h, 0, gl.DEPTH_STENCIL, depthType, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, null);

      this.sceneFbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this.sceneColorTex,
        0,
      );
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.DEPTH_STENCIL_ATTACHMENT,
        gl.TEXTURE_2D,
        this.sceneDepthTex,
        0,
      );

      this.sceneCopyFbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneCopyFbo);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this.sceneColorTex,
        0,
      );

      this.emissiveAttached = false;
    }

    if (needBloom && !this.sceneEmissiveTex) {
      this.sceneEmissiveTex = this.createColorTexture(w, h);
      this.bloomTexA = this.createColorTexture(this.bloomW, this.bloomH);
      this.bloomTexB = this.createColorTexture(this.bloomW, this.bloomH);
      this.bloomFboA = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomFboA);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this.bloomTexA,
        0,
      );
      this.bloomFboB = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomFboB);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this.bloomTexB,
        0,
      );
    }

    if (needTempTarget && !this.postTempTex) {
      this.postTempTex = this.createColorTexture(w, h);
      this.postTempFbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.postTempFbo);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this.postTempTex,
        0,
      );
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    if (needBloom !== this.emissiveAttached) {
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT1,
        gl.TEXTURE_2D,
        needBloom ? this.sceneEmissiveTex : null,
        0,
      );
      this.emissiveAttached = needBloom;
    }
  }

  private createColorTexture(w: number, h: number): WebGLTexture {
    const gl = this.glWrapper.gl;
    const tex = this.glWrapper.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }

  private ensureCopyProgram(): void {
    if (this.copyProgram) return;
    const gl = this.glWrapper.gl;
    this.copyProgram = this.glWrapper.createProgram(QUAD_VS, COPY_FS);
    this.copyLocScene = gl.getUniformLocation(this.copyProgram, 'u_scene');
  }

  private ensureBloomPrograms(): void {
    if (this.bloomProgram) return;
    const gl = this.glWrapper.gl;
    this.downsampleProgram = this.glWrapper.createProgram(QUAD_VS, BLOOM_DOWNSAMPLE_FS);
    this.downsampleLocSource = gl.getUniformLocation(this.downsampleProgram, 'u_source');
    this.downsampleLocTexel = gl.getUniformLocation(this.downsampleProgram, 'u_srcTexel');

    this.blurProgram = this.glWrapper.createProgram(QUAD_VS, BLOOM_BLUR_FS);
    this.blurLocSource = gl.getUniformLocation(this.blurProgram, 'u_source');
    this.blurLocAxis = gl.getUniformLocation(this.blurProgram, 'u_axis');

    this.bloomProgram = this.glWrapper.createProgram(QUAD_VS, BLOOM_COMPOSITE_FS);
    this.bloomLocScene = gl.getUniformLocation(this.bloomProgram, 'u_scene');
    this.bloomLocBloom = gl.getUniformLocation(this.bloomProgram, 'u_bloom');
    this.bloomLocStrength = gl.getUniformLocation(this.bloomProgram, 'u_strength');
  }

  private ensureGodRaysProgram(): void {
    if (this.godRaysProgram) return;
    const gl = this.glWrapper.gl;
    this.godRaysProgram = this.glWrapper.createProgram(QUAD_VS, GOD_RAYS_FS);
    this.godRaysLocScene = gl.getUniformLocation(this.godRaysProgram, 'u_scene');
    this.godRaysLocDepth = gl.getUniformLocation(this.godRaysProgram, 'u_depth');
    this.godRaysLocSunUV = gl.getUniformLocation(this.godRaysProgram, 'u_sunUV');
    this.godRaysLocResolution = gl.getUniformLocation(this.godRaysProgram, 'u_resolution');
    this.godRaysLocIntensity = gl.getUniformLocation(this.godRaysProgram, 'u_intensity');
    this.godRaysLocSunColor = gl.getUniformLocation(this.godRaysProgram, 'u_sunColor');
  }

  private ensureFxaaProgram(): void {
    if (this.fxaaProgram) return;
    const gl = this.glWrapper.gl;
    this.fxaaProgram = this.glWrapper.createProgram(QUAD_VS, FXAA_FS);
    this.fxaaLocScene = gl.getUniformLocation(this.fxaaProgram, 'u_scene');
    this.fxaaLocTexel = gl.getUniformLocation(this.fxaaProgram, 'u_texelSize');
  }

  /**
   * Begins offscreen world capture when at least one post-processing toggle is active.
   * Returns the offscreen framebuffer handle (or `null` if post-processing is inactive).
   */
  public begin(settings: Pick<Settings, 'bloom' | 'godRays' | 'fxaa'>): WebGLFramebuffer | null {
    fillActivePostFxPasses(settings, this.activePasses);
    if (this.activePasses.length === 0) {
      this.activeInLastFrame = false;
      this.sceneMs = 0;
      this.bloomMs = 0;
      this.godRaysMs = 0;
      this.fxaaMs = 0;
      this.totalMs = 0;
      return null;
    }

    this.activeInLastFrame = true;
    this.beginMs = performance.now();
    this.bloomMs = 0;
    this.godRaysMs = 0;
    this.fxaaMs = 0;

    const needTempTarget = this.activePasses.length > 1;
    this.ensureSceneTarget(settings.bloom, needTempTarget);

    const gl = this.glWrapper.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    gl.viewport(0, 0, this.width, this.height);
    if (settings.bloom) {
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.clearBufferfv(gl.COLOR, 1, ZERO_4);
    }
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    return this.sceneFbo;
  }

  /**
   * Executes active composite passes (`bloom` -> `godRays` -> `fxaa`) onto the default framebuffer.
   */
  public end(context: PostFxContext): void {
    if (!this.activeInLastFrame || !this.sceneFbo || !this.sceneColorTex || !this.vao) {
      return;
    }

    const gl = this.glWrapper.gl;
    this.sceneMs = performance.now() - this.beginMs;

    const { settings } = context;
    const doBloom = settings.bloom;
    const gr = computeGodRaysState(
      {
        enabled: settings.godRays,
        dimension: context.dimension,
        underwater: context.underwater,
        sunDir: context.sunDir,
        dayFactor: context.dayFactor,
        twilightFactor: context.twilightFactor,
        rainFactor: context.rainFactor,
        viewMatrix: context.viewMatrix,
        projectionMatrix: context.projectionMatrix,
      },
      this.godRaysState,
    );
    const doGodRays = gr.enabled;
    const doFxaa = settings.fxaa;

    const cullWasEnabled = gl.isEnabled(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);

    let srcTex: WebGLTexture = this.sceneColorTex;
    let altFbo: WebGLFramebuffer = this.postTempFbo ?? this.sceneCopyFbo ?? this.sceneFbo;

    if (!doBloom && !doGodRays && !doFxaa) {
      // E.g. God rays toggled on at night/underwater/Hollowdeep: copy scene color straight to null.
      this.ensureCopyProgram();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
      gl.useProgram(this.copyProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform1i(this.copyLocScene, 0);
      this.glWrapper.drawArrays(gl.TRIANGLES, 0, 3);
    }

    if (doBloom && this.sceneEmissiveTex && this.bloomFboA && this.bloomFboB) {
      const t0 = performance.now();
      this.ensureBloomPrograms();

      // 1. Downsample emissive attachment to quarter resolution.
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomFboA);
      gl.viewport(0, 0, this.bloomW, this.bloomH);
      gl.useProgram(this.downsampleProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.sceneEmissiveTex);
      gl.uniform1i(this.downsampleLocSource, 0);
      gl.uniform2f(this.downsampleLocTexel, 1 / this.width, 1 / this.height);
      this.glWrapper.drawArrays(gl.TRIANGLES, 0, 3);

      // 2. Two iterations of separable horizontal + vertical Gaussian blur.
      gl.useProgram(this.blurProgram);
      gl.uniform1i(this.blurLocSource, 0);
      for (let pass = 0; pass < 2; pass++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomFboB);
        gl.bindTexture(gl.TEXTURE_2D, this.bloomTexA);
        gl.uniform2f(this.blurLocAxis, 1 / this.bloomW, 0);
        this.glWrapper.drawArrays(gl.TRIANGLES, 0, 3);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomFboA);
        gl.bindTexture(gl.TEXTURE_2D, this.bloomTexB);
        gl.uniform2f(this.blurLocAxis, 0, 1 / this.bloomH);
        this.glWrapper.drawArrays(gl.TRIANGLES, 0, 3);
      }

      // 3. Subtle additive composite into next buffer (or default framebuffer if final pass).
      const isLast = !doGodRays && !doFxaa;
      gl.bindFramebuffer(gl.FRAMEBUFFER, isLast ? null : altFbo);
      gl.viewport(0, 0, this.width, this.height);
      gl.useProgram(this.bloomProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform1i(this.bloomLocScene, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.bloomTexA);
      gl.uniform1i(this.bloomLocBloom, 1);
      gl.uniform1f(this.bloomLocStrength, 0.52);
      this.glWrapper.drawArrays(gl.TRIANGLES, 0, 3);

      if (!isLast) {
        srcTex = this.postTempTex ?? srcTex;
        altFbo = this.sceneCopyFbo ?? this.sceneFbo;
      }
      this.bloomMs = performance.now() - t0;
    }

    if (doGodRays && this.sceneDepthTex) {
      const t0 = performance.now();
      this.ensureGodRaysProgram();
      const isLast = !doFxaa;
      gl.bindFramebuffer(gl.FRAMEBUFFER, isLast ? null : altFbo);
      gl.viewport(0, 0, this.width, this.height);
      gl.useProgram(this.godRaysProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform1i(this.godRaysLocScene, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.sceneDepthTex);
      gl.uniform1i(this.godRaysLocDepth, 1);
      gl.uniform2f(this.godRaysLocSunUV, gr.sunUV[0], gr.sunUV[1]);
      gl.uniform2f(this.godRaysLocResolution, this.width, this.height);
      gl.uniform1f(this.godRaysLocIntensity, gr.intensity);
      // Warm amber at sunrise/sunset, crisp warm white toward noon.
      const warm = context.twilightFactor;
      const r = 1.0;
      const g = 0.94 - warm * 0.24;
      const b = 0.82 - warm * 0.44;
      gl.uniform3f(this.godRaysLocSunColor, r, g, b);
      this.glWrapper.drawArrays(gl.TRIANGLES, 0, 3);

      if (!isLast) {
        srcTex = doBloom ? this.sceneColorTex : (this.postTempTex ?? this.sceneColorTex);
      }
      this.godRaysMs = performance.now() - t0;
    }

    if (doFxaa) {
      const t0 = performance.now();
      this.ensureFxaaProgram();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
      gl.useProgram(this.fxaaProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform1i(this.fxaaLocScene, 0);
      gl.uniform2f(this.fxaaLocTexel, 1 / this.width, 1 / this.height);
      this.glWrapper.drawArrays(gl.TRIANGLES, 0, 3);
      this.fxaaMs = performance.now() - t0;
    }

    this.totalMs = performance.now() - this.beginMs;

    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    if (cullWasEnabled) gl.enable(gl.CULL_FACE);
  }

  public getStats(settings: Pick<Settings, 'bloom' | 'godRays' | 'fxaa'>): PostFxStats {
    const passes = fillActivePostFxPasses(settings, []);
    const enabled = passes.length > 0;
    return {
      enabled,
      passes,
      targetSize: enabled && this.width > 0 ? [this.width, this.height] : [0, 0],
      passMs: {
        scene: enabled ? this.sceneMs : 0,
        bloom: enabled && settings.bloom ? this.bloomMs : 0,
        godRays: enabled && settings.godRays ? this.godRaysMs : 0,
        fxaa: enabled && settings.fxaa ? this.fxaaMs : 0,
        total: enabled ? this.totalMs : 0,
      },
    };
  }

  private disposeRenderTargets(): void {
    const gl = this.glWrapper.gl;
    if (this.sceneColorTex) this.glWrapper.deleteTexture(this.sceneColorTex);
    if (this.sceneDepthTex) this.glWrapper.deleteTexture(this.sceneDepthTex);
    if (this.sceneEmissiveTex) this.glWrapper.deleteTexture(this.sceneEmissiveTex);
    if (this.postTempTex) this.glWrapper.deleteTexture(this.postTempTex);
    if (this.bloomTexA) this.glWrapper.deleteTexture(this.bloomTexA);
    if (this.bloomTexB) this.glWrapper.deleteTexture(this.bloomTexB);
    if (this.sceneFbo) gl.deleteFramebuffer(this.sceneFbo);
    if (this.sceneCopyFbo) gl.deleteFramebuffer(this.sceneCopyFbo);
    if (this.postTempFbo) gl.deleteFramebuffer(this.postTempFbo);
    if (this.bloomFboA) gl.deleteFramebuffer(this.bloomFboA);
    if (this.bloomFboB) gl.deleteFramebuffer(this.bloomFboB);

    this.sceneColorTex = null;
    this.sceneDepthTex = null;
    this.sceneEmissiveTex = null;
    this.postTempTex = null;
    this.bloomTexA = null;
    this.bloomTexB = null;
    this.sceneFbo = null;
    this.sceneCopyFbo = null;
    this.postTempFbo = null;
    this.bloomFboA = null;
    this.bloomFboB = null;
    this.emissiveAttached = false;
  }

  public dispose(): void {
    this.disposeRenderTargets();
    if (this.vao) this.glWrapper.deleteVertexArray(this.vao);
    if (this.copyProgram) this.glWrapper.deleteProgram(this.copyProgram);
    if (this.downsampleProgram) this.glWrapper.deleteProgram(this.downsampleProgram);
    if (this.blurProgram) this.glWrapper.deleteProgram(this.blurProgram);
    if (this.bloomProgram) this.glWrapper.deleteProgram(this.bloomProgram);
    if (this.godRaysProgram) this.glWrapper.deleteProgram(this.godRaysProgram);
    if (this.fxaaProgram) this.glWrapper.deleteProgram(this.fxaaProgram);
    this.vao = null;
    this.copyProgram = null;
    this.downsampleProgram = null;
    this.blurProgram = null;
    this.bloomProgram = null;
    this.godRaysProgram = null;
    this.fxaaProgram = null;
    this.width = 0;
    this.height = 0;
  }
}
