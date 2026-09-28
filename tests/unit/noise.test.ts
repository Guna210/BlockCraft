import { describe, it, expect } from 'vitest';
import {
  makeSimplex2D,
  makeSimplex3D,
  makeValueNoise2D,
  makeValueNoise3D,
  makeFbm2D,
  makeRidged3D,
} from '../../src/gen/noise';

describe('Noise Functions', () => {
  it('Simplex2D determinism and bounds', () => {
    const seed = 12345;
    const noise1 = makeSimplex2D(seed);
    const noise2 = makeSimplex2D(seed);
    const noiseDiff = makeSimplex2D(54321);

    let sum = 0;
    const samples = 1000;

    for (let i = 0; i < samples; i++) {
      const x = (i * 0.1) % 100;
      const y = (i * 0.15) % 100;

      const v1 = noise1(x, y);
      const v2 = noise2(x, y);
      noiseDiff(x, y);

      expect(v1).toBe(v2);
      expect(v1).not.toBeNaN();
      expect(v1).toBeGreaterThanOrEqual(-1.5); // Depending on normalization, should be roughly [-1, 1]
      expect(v1).toBeLessThanOrEqual(1.5);

      sum += v1;
    }

    const mean = sum / samples;
    expect(Math.abs(mean)).toBeLessThan(0.1); // Mean near 0
  });

  it('Simplex3D determinism and bounds', () => {
    const seed = 999;
    const noise = makeSimplex3D(seed);
    let sum = 0;
    const samples = 1000;

    for (let i = 0; i < samples; i++) {
      const x = (i * 0.1) % 50;
      const y = (i * 0.2) % 50;
      const z = (i * 0.3) % 50;

      const v = noise(x, y, z);
      expect(v).not.toBeNaN();
      expect(v).toBeGreaterThanOrEqual(-1.5);
      expect(v).toBeLessThanOrEqual(1.5);
      sum += v;
    }
    const mean = sum / samples;
    expect(Math.abs(mean)).toBeLessThan(0.1);
  });

  it('Value noise 2D and 3D ranges', () => {
    const n2d = makeValueNoise2D(42);
    const n3d = makeValueNoise3D(42);

    for (let i = 0; i < 100; i++) {
      const v2 = n2d(i * 0.1, i * 0.2);
      const v3 = n3d(i * 0.1, i * 0.2, i * 0.3);

      expect(v2).toBeGreaterThanOrEqual(-1);
      expect(v2).toBeLessThanOrEqual(1);

      expect(v3).toBeGreaterThanOrEqual(-1);
      expect(v3).toBeLessThanOrEqual(1);
    }
  });

  it('Noise is continuous (small steps = small diffs)', () => {
    const noise = makeSimplex2D(123);
    const x = 10.5;
    const y = 20.5;

    const base = noise(x, y);
    const smallStep = noise(x + 0.001, y);
    const largeStep = noise(x + 10, y);

    const smallDiff = Math.abs(base - smallStep);
    const largeDiff = Math.abs(base - largeStep);

    expect(smallDiff).toBeLessThan(0.05);
    expect(largeDiff).toBeGreaterThan(smallDiff); // Almost certainly true for different enough points
  });

  it('fBm works correctly', () => {
    const base = makeSimplex2D(111);
    const fbm = makeFbm2D(base, 4, 0.5, 2.0);

    const v = fbm(10, 10);
    expect(v).not.toBeNaN();
    expect(v).toBeGreaterThanOrEqual(-1.5);
    expect(v).toBeLessThanOrEqual(1.5);
  });

  it('Rough isotropy check (variance in different directions)', () => {
    const noise = makeSimplex2D(444);
    let sumX = 0,
      sumY = 0;
    const samples = 100;

    for (let i = 0; i < samples; i++) {
      sumX += Math.abs(noise(i * 0.1, 0));
      sumY += Math.abs(noise(0, i * 0.1));
    }

    const avgX = sumX / samples;
    const avgY = sumY / samples;

    // The averages of absolute values along different axes should be similar
    expect(Math.abs(avgX - avgY)).toBeLessThan(0.2);
  });

  it('Benchmark noise performance (informational)', () => {
    const noise2D = makeSimplex2D(123);
    const noise3D = makeSimplex3D(123);

    const count = 100000;

    const start2 = performance.now();
    for (let i = 0; i < count; i++) {
      noise2D(i * 0.01, i * 0.02);
    }
    const end2 = performance.now();

    const start3 = performance.now();
    for (let i = 0; i < count; i++) {
      noise3D(i * 0.01, i * 0.02, i * 0.03);
    }
    const end3 = performance.now();

    const samplesPerSec2D = Math.floor(count / ((end2 - start2) / 1000));
    const samplesPerSec3D = Math.floor(count / ((end3 - start3) / 1000));

    console.log(`2D Noise: ${samplesPerSec2D} samples/sec`);
    console.log(`3D Noise: ${samplesPerSec3D} samples/sec`);

    expect(samplesPerSec2D).toBeGreaterThan(0);
    expect(samplesPerSec3D).toBeGreaterThan(0);
  });
});
