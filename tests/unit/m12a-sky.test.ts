import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_WORLD_TIME,
  NIGHT_SKY_LIGHT_FLOOR,
  SUN_ORBIT_TILT_RAD,
  TICKS_PER_DAY,
  advance,
  dayNumber,
  getWorldTime,
  moonDirection,
  moonPhase,
  resetWorldTime,
  setWorldTime,
  skyAtmosphereFactors,
  skyLightMultiplier,
  sunDirection,
  timeOfDay,
} from '../../src/world/time';
import { TickLoop, TICK_SECONDS } from '../../src/engine/loop';
import {
  genMoon0,
  genMoon1,
  genMoon2,
  genMoon3,
  genMoon4,
  genMoon5,
  genMoon6,
  genMoon7,
  genSun,
} from '../../src/render/textures/sky';

describe('M12a: World time, sky-light curve, sun/moon orbit, and lunar phases', () => {
  beforeEach(() => {
    resetWorldTime();
  });

  it('starts new worlds at 6000 (noon) and advances via advance(ticks) and TickLoop', () => {
    expect(getWorldTime()).toBe(DEFAULT_WORLD_TIME);
    expect(getWorldTime()).toBe(6000);

    advance(15);
    expect(getWorldTime()).toBe(6015);

    let simCount = 0;
    const loop = new TickLoop(() => {
      simCount++;
    });

    // Real-time accumulator step of 3 ticks
    loop.advance(3 * TICK_SECONDS + 1e-6);
    expect(simCount).toBe(3);
    expect(getWorldTime()).toBe(6018);

    // Paused manual tick(n) advances worldTime by n
    loop.pause();
    loop.tick(10);
    expect(simCount).toBe(13);
    expect(getWorldTime()).toBe(6028);

    setWorldTime(18000);
    expect(getWorldTime()).toBe(18000);
  });

  it('sky-light curve is 1.0 at noon, ~0.2 at night, and has no step > 0.05 over a full 24,000-tick day', () => {
    expect(skyLightMultiplier(6000)).toBeCloseTo(1.0, 6);
    expect(skyLightMultiplier(3000)).toBeCloseTo(1.0, 6);
    expect(skyLightMultiplier(9000)).toBeCloseTo(1.0, 6);
    expect(skyLightMultiplier(18000)).toBeCloseTo(NIGHT_SKY_LIGHT_FLOOR, 6);
    expect(skyLightMultiplier(15000)).toBeCloseTo(NIGHT_SKY_LIGHT_FLOOR, 6);
    expect(skyLightMultiplier(21000)).toBeCloseTo(NIGHT_SKY_LIGHT_FLOOR, 6);
    expect(skyLightMultiplier(0)).toBeCloseTo(0.6, 5);
    expect(skyLightMultiplier(12000)).toBeCloseTo(0.6, 5);

    let maxStep = 0;
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      const curr = skyLightMultiplier(t);
      const next = skyLightMultiplier(t + 1);
      expect(curr).toBeGreaterThanOrEqual(NIGHT_SKY_LIGHT_FLOOR - 1e-9);
      expect(curr).toBeLessThanOrEqual(1.0 + 1e-9);
      const step = Math.abs(next - curr);
      if (step > maxStep) maxStep = step;
      expect(step).toBeLessThanOrEqual(0.05);
    }
    expect(maxStep).toBeGreaterThan(0);
    expect(maxStep).toBeLessThanOrEqual(0.05);
  });

  it('sun rises east (+X at 0), reaches 15-deg tilted zenith at noon (6000), and sets west (-X at 12000)', () => {
    const sunrise = sunDirection(0);
    expect(sunrise[0]).toBeCloseTo(1, 6);
    expect(sunrise[1]).toBeCloseTo(0, 6);
    expect(sunrise[2]).toBeCloseTo(0, 6);

    const noon = sunDirection(6000);
    expect(noon[0]).toBeCloseTo(0, 6);
    expect(noon[1]).toBeCloseTo(Math.cos(SUN_ORBIT_TILT_RAD), 6);
    expect(noon[2]).toBeCloseTo(Math.sin(SUN_ORBIT_TILT_RAD), 6);

    const sunset = sunDirection(12000);
    expect(sunset[0]).toBeCloseTo(-1, 6);
    expect(sunset[1]).toBeCloseTo(0, 6);
    expect(sunset[2]).toBeCloseTo(0, 6);

    const midnight = sunDirection(18000);
    expect(midnight[0]).toBeCloseTo(0, 6);
    expect(midnight[1]).toBeCloseTo(-Math.cos(SUN_ORBIT_TILT_RAD), 6);
    expect(midnight[2]).toBeCloseTo(-Math.sin(SUN_ORBIT_TILT_RAD), 6);

    for (let t = 0; t < TICKS_PER_DAY; t += 500) {
      const s = sunDirection(t);
      const m = moonDirection(t);
      const sLen = Math.hypot(s[0], s[1], s[2]);
      const mLen = Math.hypot(m[0], m[1], m[2]);
      expect(sLen).toBeCloseTo(1, 6);
      expect(mLen).toBeCloseTo(1, 6);
      expect(m[0]).toBeCloseTo(-s[0], 6);
      expect(m[1]).toBeCloseTo(-s[1], 6);
      expect(m[2]).toBeCloseTo(-s[2], 6);
    }
  });

  it('computes dayNumber, timeOfDay, moonPhase (day mod 8), and atmosphere factors', () => {
    expect(timeOfDay(0)).toBe(0);
    expect(timeOfDay(24000)).toBe(0);
    expect(timeOfDay(30000)).toBe(6000);

    for (let d = 0; d < 16; d++) {
      const ticks = d * TICKS_PER_DAY + 18000;
      expect(dayNumber(ticks)).toBe(d);
      expect(moonPhase(ticks)).toBe(d % 8);
    }

    const noonFactors = skyAtmosphereFactors(6000);
    expect(noonFactors.dayFactor).toBeCloseTo(1, 5);
    expect(noonFactors.twilightFactor).toBeCloseTo(0, 5);
    expect(noonFactors.nightFactor).toBeCloseTo(0, 5);

    const sunsetFactors = skyAtmosphereFactors(12000);
    expect(sunsetFactors.twilightFactor).toBeCloseTo(1, 5);
    expect(sunsetFactors.nightFactor).toBeCloseTo(0, 5);

    const midnightFactors = skyAtmosphereFactors(18000);
    expect(midnightFactors.dayFactor).toBeCloseTo(0, 5);
    expect(midnightFactors.twilightFactor).toBeCloseTo(0, 5);
    expect(midnightFactors.nightFactor).toBeCloseTo(1, 5);
  });

  it('generates distinct 16x16 procedural textures for the sun and all 8 moon phases', () => {
    const sun = genSun(42);
    expect(sun.length).toBe(16 * 16 * 4);

    const moons = [
      genMoon0(42),
      genMoon1(42),
      genMoon2(42),
      genMoon3(42),
      genMoon4(42),
      genMoon5(42),
      genMoon6(42),
      genMoon7(42),
    ];
    for (let i = 0; i < moons.length; i++) {
      expect(moons[i]!.length).toBe(16 * 16 * 4);
      for (let j = i + 1; j < moons.length; j++) {
        expect(Buffer.from(moons[i]!).equals(Buffer.from(moons[j]!))).toBe(false);
      }
    }
  });
});
