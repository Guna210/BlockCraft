import type { Settings } from '../../engine/settings';
import type { DimensionId } from '../../world/dimension';

export type PostFxPassName = 'bloom' | 'godRays' | 'fxaa';

export interface GodRaysState {
  enabled: boolean;
  sunUV: [number, number];
  intensity: number;
}

export interface GodRaysParams {
  enabled: boolean;
  dimension: DimensionId;
  underwater: boolean;
  sunDir: readonly [number, number, number];
  dayFactor: number;
  twilightFactor: number;
  rainFactor: number;
  viewMatrix: ArrayLike<number>;
  projectionMatrix: ArrayLike<number>;
}

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Returns active post-processing passes in fixed composite order:
 * bloom -> godRays -> fxaa.
 */
export function getActivePostFxPasses(
  source: Pick<Settings, 'bloom' | 'godRays' | 'fxaa'>,
): PostFxPassName[] {
  const passes: PostFxPassName[] = [];
  if (source.bloom) passes.push('bloom');
  if (source.godRays) passes.push('godRays');
  if (source.fxaa) passes.push('fxaa');
  return passes;
}

/**
 * Fills a preallocated pass list in fixed composite order without allocating in the render path.
 */
export function fillActivePostFxPasses(
  source: Pick<Settings, 'bloom' | 'godRays' | 'fxaa'>,
  out: PostFxPassName[],
): PostFxPassName[] {
  out.length = 0;
  if (source.bloom) out.push('bloom');
  if (source.godRays) out.push('godRays');
  if (source.fxaa) out.push('fxaa');
  return out;
}

/**
 * Computes screen-space sun UV and god-rays intensity using rotation-only camera matrices with
 * zero per-call array allocations when `out` is reused.
 */
export function computeGodRaysState(
  params: GodRaysParams,
  out: GodRaysState = { enabled: false, sunUV: [0.5, 0.5], intensity: 0 },
): GodRaysState {
  out.enabled = false;
  out.intensity = 0;

  if (!params.enabled || params.dimension !== 'overworld' || params.underwater) {
    return out;
  }

  const sx = params.sunDir[0];
  const sy = params.sunDir[1];
  const sz = params.sunDir[2];
  if (sy <= -0.02) {
    return out;
  }

  const lightWeight = Math.min(1, params.dayFactor + params.twilightFactor * 0.45);
  if (lightWeight <= 0.002) {
    return out;
  }

  const v = params.viewMatrix;
  const p = params.projectionMatrix;

  // Transform world sun direction through rotation-only view matrix (translation zeroed).
  const vx = v[0]! * sx + v[4]! * sy + v[8]! * sz;
  const vy = v[1]! * sx + v[5]! * sy + v[9]! * sz;
  const vz = v[2]! * sx + v[6]! * sy + v[10]! * sz;

  // View space forward is -Z in standard right-handed lookAt matrices.
  const forwardDot = -vz;
  if (forwardDot <= 0.1) {
    return out;
  }

  // Project infinite direction through perspective projection matrix.
  const cx = p[0]! * vx + p[4]! * vy + p[8]! * vz;
  const cy = p[1]! * vx + p[5]! * vy + p[9]! * vz;
  const cw = p[3]! * vx + p[7]! * vy + p[11]! * vz;
  if (cw <= 1e-4) {
    return out;
  }

  const ndcX = cx / cw;
  const ndcY = cy / cw;
  const uvX = ndcX * 0.5 + 0.5;
  const uvY = ndcY * 0.5 + 0.5;

  const horizonFade = smoothstep(-0.02, 0.18, sy);
  const angleFade = smoothstep(0.15, 0.72, forwardDot);
  const rainAtten = Math.max(0.15, 1 - clamp01(params.rainFactor) * 0.75);
  const intensity = horizonFade * lightWeight * angleFade * rainAtten;
  if (intensity <= 0.002) {
    return out;
  }

  out.enabled = true;
  out.sunUV[0] = uvX;
  out.sunUV[1] = uvY;
  out.intensity = intensity;
  return out;
}
