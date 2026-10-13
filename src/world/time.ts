export const TICKS_PER_DAY = 24000;
export const DEFAULT_WORLD_TIME = 6000;
export const SUN_ORBIT_TILT_RAD = (15 * Math.PI) / 180;
export const NIGHT_SKY_LIGHT_FLOOR = 0.2;

let worldTime = DEFAULT_WORLD_TIME;

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function smoothstep01(v: number): number {
  const u = clamp01(v);
  return u * u * (3 - 2 * u);
}

/**
 * Returns the current world time in simulation ticks since world start.
 */
export function getWorldTime(): number {
  return worldTime;
}

/**
 * Resets world time to the new-world default (6000 = noon).
 */
export function resetWorldTime(): void {
  worldTime = DEFAULT_WORLD_TIME;
}

/**
 * Sets the world time in ticks directly (used by debug API setTimeOfDay and world reset).
 */
export function setWorldTime(ticks: number): number {
  if (!Number.isFinite(ticks)) {
    throw new Error(`Invalid ticks value: ${String(ticks)}`);
  }
  const normalized = Math.floor(ticks);
  worldTime =
    normalized >= 0 ? normalized : ((normalized % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY;
  return worldTime;
}

/**
 * Single simulation entry point to advance world time by `ticks`.
 */
export function advance(ticks: number = 1): number {
  if (!Number.isFinite(ticks) || ticks <= 0) return worldTime;
  worldTime += Math.floor(ticks);
  return worldTime;
}

/**
 * Returns time of day wrapped into [0, 23999].
 * 0 = sunrise, 6000 = noon, 12000 = sunset, 18000 = midnight.
 */
export function timeOfDay(ticks: number = worldTime): number {
  const t = Math.floor(ticks);
  return ((t % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY;
}

/**
 * Returns the zero-based day number (Math.floor(ticks / 24000)).
 */
export function dayNumber(ticks: number = worldTime): number {
  return Math.max(0, Math.floor(ticks / TICKS_PER_DAY));
}

/**
 * Returns the current moon phase index in 0..7 (dayNumber mod 8).
 */
export function moonPhase(ticks: number = worldTime): number {
  return ((dayNumber(ticks) % 8) + 8) % 8;
}

/**
 * Returns the sine of the sun's orbital angle:
 * 0 at sunrise (0), +1 at noon (6000), 0 at sunset (12000), -1 at midnight (18000).
 * Equivalent to cos(theta - pi/2) where theta = 2*pi*timeOfDay/24000.
 */
export function sunElevationSin(ticks: number = worldTime): number {
  const tod = timeOfDay(ticks);
  const theta = (2 * Math.PI * tod) / TICKS_PER_DAY;
  return Math.sin(theta);
}

/**
 * Unit vector pointing toward the sun in world coordinates.
 *
 * Camera yaw convention (src/render/camera.ts):
 * - yaw = 0 looks along +X (East, sunrise direction at ticks = 0)
 * - yaw = Math.PI looks along -X (West, sunset direction at ticks = 12000)
 * - yaw = -Math.PI / 2 looks along -Z (North)
 * - yaw = Math.PI / 2 looks along +Z (South)
 *
 * The sun orbits from East (+X) through zenith (+Y tilted 15 deg toward +Z) to West (-X).
 */
export function sunDirection(ticks: number = worldTime): [number, number, number] {
  const tod = timeOfDay(ticks);
  const theta = (2 * Math.PI * tod) / TICKS_PER_DAY;
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);
  const x = cosTheta;
  const y = sinTheta * Math.cos(SUN_ORBIT_TILT_RAD);
  const z = sinTheta * Math.sin(SUN_ORBIT_TILT_RAD);
  return [x, y, z];
}

/**
 * Unit vector pointing toward the moon in world coordinates (opposite the sun).
 */
export function moonDirection(ticks: number = worldTime): [number, number, number] {
  const [sx, sy, sz] = sunDirection(ticks);
  return [-sx, -sy, -sz];
}

/**
 * Smooth cosine-based sky-light multiplier with eased dawn and dusk transitions.
 * Returns 1.0 through the day and 0.2 at night (moonlight floor).
 * Drives the chunk shader u_skyBrightness uniform without chunk re-meshing.
 */
export function skyLightMultiplier(ticks: number = worldTime): number {
  const s = sunElevationSin(ticks);
  const eased = smoothstep01((s + 0.25) / 0.5);
  return NIGHT_SKY_LIGHT_FLOOR + (1.0 - NIGHT_SKY_LIGHT_FLOOR) * eased;
}

export interface SkyAtmosphereFactors {
  dayFactor: number;
  twilightFactor: number;
  nightFactor: number;
}

/**
 * Precomputed smooth atmosphere weights for the sky shader and chunk distance fog.
 */
export function skyAtmosphereFactors(ticks: number = worldTime): SkyAtmosphereFactors {
  const s = sunElevationSin(ticks);
  const dayFactor = smoothstep01((s + 0.15) / 0.45);
  const twilightFactor = smoothstep01(1.0 - Math.abs(s) / 0.38);
  const nightFactor = smoothstep01((-s - 0.02) / 0.35);
  return { dayFactor, twilightFactor, nightFactor };
}
