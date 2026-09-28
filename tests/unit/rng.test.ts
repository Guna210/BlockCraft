import { describe, it, expect } from 'vitest';
import { hashString, deriveSeed, hash2, hash3, PRNG } from '../../src/engine/rng';

describe('RNG and Hashing', () => {
  it('hashString is deterministic and handles different strings', () => {
    const hash1 = hashString('blockcraft-test-seed-42');
    const hash2a = hashString('blockcraft-test-seed-42');
    const hash3a = hashString('different-seed');

    expect(hash1).toBe(hash2a);
    expect(hash1).not.toBe(hash3a);
    expect(Number.isInteger(hash1)).toBe(true);
    expect(hash1).toBeGreaterThanOrEqual(0);
  });

  it('deriveSeed produces different seeds for different labels and streams are uncorrelated', () => {
    const baseSeed = 123456789;
    const seed1 = deriveSeed(baseSeed, 'continentalness');
    const seed2 = deriveSeed(baseSeed, 'erosion');

    expect(seed1).not.toBe(seed2);
    expect(seed1).toBe(deriveSeed(baseSeed, 'continentalness'));

    const prng1 = new PRNG(seed1);
    const prng2 = new PRNG(seed2);

    let same = true;
    for (let i = 0; i < 10; i++) {
      if (prng1.next() !== prng2.next()) {
        same = false;
        break;
      }
    }
    expect(same).toBe(false);
  });

  it('hash2 and hash3 return deterministic values in [0, 1) and no NaNs', () => {
    const seed = 987654321;

    const val2_1 = hash2(seed, 10, 20);
    const val2_2 = hash2(seed, 10, 20);
    const val2_3 = hash2(seed, 11, 20);

    expect(val2_1).toBe(val2_2);
    expect(val2_1).not.toBe(val2_3);
    expect(val2_1).toBeGreaterThanOrEqual(0);
    expect(val2_1).toBeLessThan(1);
    expect(Number.isNaN(val2_1)).toBe(false);

    const val3_1 = hash3(seed, 10, 20, 30);
    const val3_2 = hash3(seed, 10, 20, 30);
    const val3_3 = hash3(seed, 10, 21, 30);

    expect(val3_1).toBe(val3_2);
    expect(val3_1).not.toBe(val3_3);
    expect(val3_1).toBeGreaterThanOrEqual(0);
    expect(val3_1).toBeLessThan(1);
    expect(Number.isNaN(val3_1)).toBe(false);
  });

  it('PRNG xoshiro128** is deterministic, output in [0, 1), and no NaNs', () => {
    const seed = 555555;
    const prng1 = new PRNG(seed);
    const prng2 = new PRNG(seed);

    for (let i = 0; i < 100; i++) {
      const v1 = prng1.next();
      const v2 = prng2.next();

      expect(v1).toBe(v2);
      expect(v1).toBeGreaterThanOrEqual(0);
      expect(v1).toBeLessThan(1);
      expect(Number.isNaN(v1)).toBe(false);
    }

    const prng3 = new PRNG(555556);
    expect(prng1.next()).not.toBe(prng3.next());
  });
});
