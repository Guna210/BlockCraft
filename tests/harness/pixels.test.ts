import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import {
  assertNotBlank,
  assertNoMissingTexture,
  assertColorVariance,
  regionMeanColor,
  assertHueInRange,
  diffFraction,
} from './pixels';

function createPng(width: number, height: number): PNG {
  return new PNG({ width, height });
}

function fillRect(
  png: PNG,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const idx = ((y + dy) * png.width + (x + dx)) * 4;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = 255;
    }
  }
}

function fillNoise(png: PNG) {
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = Math.random() * 255;
    png.data[i + 1] = Math.random() * 255;
    png.data[i + 2] = Math.random() * 255;
    png.data[i + 3] = 255;
  }
}

describe('pixels utilities', () => {
  it('assertNotBlank passes on noisy image', () => {
    const png = createPng(100, 100);
    fillNoise(png);
    expect(() => assertNotBlank(png)).not.toThrow();
  });

  it('assertNotBlank fails on solid image', () => {
    const png = createPng(100, 100);
    fillRect(png, 0, 0, 100, 100, 120, 120, 120);
    expect(() => assertNotBlank(png)).toThrow('assertNotBlank failed');
  });

  it('assertNotBlank passes when 97% is solid', () => {
    const png = createPng(100, 100);
    fillRect(png, 0, 0, 100, 100, 120, 120, 120);
    // Make 3% a different color (dE > 3)
    fillRect(png, 0, 0, 100, 3, 200, 200, 200);
    expect(() => assertNotBlank(png)).not.toThrow();
  });

  it('assertNotBlank fails when 99% is solid', () => {
    const png = createPng(100, 100);
    fillRect(png, 0, 0, 100, 100, 120, 120, 120);
    // Make 1% a different color
    fillRect(png, 0, 0, 100, 1, 200, 200, 200);
    expect(() => assertNotBlank(png)).toThrow('assertNotBlank failed');
  });

  it('assertNoMissingTexture passes on image without magenta', () => {
    const png = createPng(100, 100);
    fillRect(png, 0, 0, 100, 100, 0, 255, 0); // Solid green, definitely no magenta
    expect(() => assertNoMissingTexture(png)).not.toThrow();
  });

  it('assertNoMissingTexture fails on image with magenta > 0.05%', () => {
    const png = createPng(100, 100);
    fillRect(png, 0, 0, 100, 100, 0, 0, 0);
    // 0.05% of 10,000 = 5 pixels.
    fillRect(png, 0, 0, 6, 1, 255, 0, 255); // 6 pixels = 0.06%
    expect(() => assertNoMissingTexture(png)).toThrow('assertNoMissingTexture failed');
  });

  it('assertNoMissingTexture passes on image with magenta <= 0.05%', () => {
    const png = createPng(100, 100);
    fillRect(png, 0, 0, 100, 100, 0, 0, 0);
    fillRect(png, 0, 0, 4, 1, 255, 0, 255); // 4 pixels = 0.04%
    expect(() => assertNoMissingTexture(png)).not.toThrow();
  });

  it('assertColorVariance passes on noisy image', () => {
    const png = createPng(100, 100);
    fillNoise(png);
    // uniform random [0, 255] has variance ~ 255^2 / 12 = 5418, stdDev ~ 73
    expect(() => assertColorVariance(png, 50)).not.toThrow();
  });

  it('assertColorVariance fails on solid image', () => {
    const png = createPng(100, 100);
    fillRect(png, 0, 0, 100, 100, 120, 120, 120);
    expect(() => assertColorVariance(png, 10)).toThrow('assertColorVariance failed');
  });

  it('regionMeanColor calculates mean color correctly', () => {
    const png = createPng(100, 100);
    fillRect(png, 0, 0, 100, 100, 0, 0, 0);
    fillRect(png, 10, 10, 10, 10, 200, 100, 50);

    const mean = regionMeanColor(png, { x: 10, y: 10, width: 10, height: 10 });
    expect(mean[0]).toBe(200);
    expect(mean[1]).toBe(100);
    expect(mean[2]).toBe(50);
  });

  it('assertHueInRange passes for matching hue', () => {
    const png = createPng(100, 100);
    // sky-blue color: h ~ 200
    fillRect(png, 0, 0, 100, 100, 50, 150, 250);
    expect(() =>
      assertHueInRange(png, { x: 0, y: 0, width: 100, height: 100 }, [190, 215], 0.9),
    ).not.toThrow();
  });

  it('assertHueInRange fails for non-matching hue', () => {
    const png = createPng(100, 100);
    // red color
    fillRect(png, 0, 0, 100, 100, 250, 50, 50);
    expect(() =>
      assertHueInRange(png, { x: 0, y: 0, width: 100, height: 100 }, [190, 215], 0.9),
    ).toThrow('assertHueInRange failed');
  });

  it('diffFraction calculates correctly', () => {
    const pngA = createPng(100, 100);
    const pngB = createPng(100, 100);

    fillRect(pngA, 0, 0, 100, 100, 0, 0, 0);
    fillRect(pngB, 0, 0, 100, 100, 0, 0, 0);

    // modify 10x10 square (100 pixels) -> 1% of 10000
    fillRect(pngB, 0, 0, 10, 10, 255, 255, 255);

    expect(diffFraction(pngA, pngB)).toBe(0.01);
  });
});
