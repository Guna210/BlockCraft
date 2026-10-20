import type { AnimationClip, KeyframeChannel, Vec3 } from './model';

export const DEFAULT_HEAD_MAX_YAW = (60 * Math.PI) / 180;
export const DEFAULT_HEAD_MAX_PITCH = (40 * Math.PI) / 180;
/** Fraction of the remaining head angle closed each tick. */
export const HEAD_SMOOTHING = 0.35;

/** Limb swing in radians: maxSwing · sin(phase) · min(speed / refSpeed, 1). */
export function walkSwing(
  maxSwing: number,
  phase: number,
  speed: number,
  refSpeed: number,
): number {
  return maxSwing * Math.sin(phase) * Math.min(Math.max(speed, 0) / refSpeed, 1);
}

/** Phase gained by moving `distance` horizontal blocks with a cycle of `stride` blocks. */
export function walkPhaseStep(distance: number, stride: number): number {
  return (distance * Math.PI * 2) / stride;
}

/** Wraps an angle into (-π, π]. */
export function wrapAngle(angle: number): number {
  const turn = Math.PI * 2;
  angle = (((angle + Math.PI) % turn) + turn) % turn;
  return angle === 0 ? Math.PI : angle - Math.PI;
}

/**
 * Head yaw and pitch, relative to the body, that look from `eye` at `target`, clamped to the limits.
 * Yaw follows the world convention: forward is (cos yaw, 0, sin yaw). Pitch is positive upward.
 */
export function headLook(
  bodyYaw: number,
  eye: Readonly<Vec3>,
  target: Readonly<Vec3>,
  maxYaw: number,
  maxPitch: number,
): [number, number] {
  const dx = target[0] - eye[0],
    dy = target[1] - eye[1],
    dz = target[2] - eye[2];
  const horizontal = Math.hypot(dx, dz);
  const yaw = horizontal === 0 ? 0 : wrapAngle(Math.atan2(dz, dx) - bodyYaw);
  const pitch = Math.atan2(dy, horizontal);
  return [clamp(yaw, -maxYaw, maxYaw), clamp(pitch, -maxPitch, maxPitch)];
}

export function smoothToward(current: number, target: number, factor = HEAD_SMOOTHING): number {
  return current + (target - current) * factor;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Channel value at `tick`; holds the first and last keys outside their range. */
export function sampleChannel(channel: KeyframeChannel, tick: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const keys = channel.keys;
  let next = 0;
  while (next < keys.length && keys[next]!.tick <= tick) next++;
  const a = keys[Math.max(0, next - 1)]!,
    b = keys[Math.min(keys.length - 1, next)]!;
  if (next === 0 || next === keys.length || channel.interpolation === 'step' || a === b) {
    const key = next === 0 ? keys[0]! : a;
    out[0] = key.value[0];
    out[1] = key.value[1];
    out[2] = key.value[2];
    return out;
  }
  const t = (tick - a.tick) / (b.tick - a.tick);
  out[0] = lerp(a.value[0], b.value[0], t);
  out[1] = lerp(a.value[1], b.value[1], t);
  out[2] = lerp(a.value[2], b.value[2], t);
  return out;
}

/** Local clip time for `elapsed` ticks since it started, or null once a one-shot clip has ended. */
export function clipTime(clip: AnimationClip, elapsed: number): number | null {
  if (elapsed < 0) return 0;
  if (clip.loop) return elapsed % clip.length;
  return elapsed > clip.length ? null : elapsed;
}
