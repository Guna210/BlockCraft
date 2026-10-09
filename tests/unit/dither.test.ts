import { describe, it, expect } from 'vitest';
import { BAYER_4X4, bayerGlsl, bayerThreshold } from '../../src/render/dither';

/** The fragment shader keeps a pixel when its threshold is below the column's fade (discard otherwise). */
function keptFraction(fade: number): number {
  let kept = 0;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      if (bayerThreshold(x, y) < fade) kept++;
    }
  }
  return kept / 16;
}

describe('dither: the Bayer 4x4 threshold table', () => {
  it('is a permutation of 0..15', () => {
    expect([...BAYER_4X4].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i));
  });

  it('gives sixteen distinct thresholds strictly between 0 and 1', () => {
    const values = new Set<number>();
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) values.add(bayerThreshold(x, y));
    }
    expect(values.size).toBe(16);
    for (const v of values) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('repeats every four pixels in x and y, for any pixel of the screen', () => {
    for (const [x, y] of [
      [0, 0],
      [5, 9],
      [1279, 719],
      [400, 1000],
    ] as const) {
      expect(bayerThreshold(x + 4, y)).toBe(bayerThreshold(x, y));
      expect(bayerThreshold(x, y + 4)).toBe(bayerThreshold(x, y));
    }
  });

  it('keeps exactly k of every 16 pixels at fade k/16, so the fade is the fraction of pixels drawn', () => {
    for (let k = 0; k <= 16; k++) {
      expect(keptFraction(k / 16), `fade ${k}/16`).toBe(k / 16);
    }
  });

  it('keeps nothing at fade 0 and everything at fade 1', () => {
    expect(keptFraction(0)).toBe(0);
    expect(keptFraction(1)).toBe(1);
  });

  it('gives the shader the same table, in the same order, as the code', () => {
    const glsl = bayerGlsl();
    expect(glsl.startsWith('float[16](')).toBe(true);
    const numbers = glsl
      .slice('float[16]('.length, -1)
      .split(',')
      .map((s) => Number(s.trim()));
    expect(numbers).toHaveLength(16);
    numbers.forEach((value, i) => {
      // The shader indexes the table with (y & 3) * 4 + (x & 3).
      expect(value).toBeCloseTo(bayerThreshold(i % 4, Math.floor(i / 4)), 6);
    });
  });
});
