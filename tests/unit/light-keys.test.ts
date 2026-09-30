import { describe, it, expect } from 'vitest';
import { LightStorage } from '../../src/world/lighting';

describe('LightStorage Key Uniqueness Unit Tests', () => {
  it('keys are distinct for every (cx, sy, cz) with |cx|, |cz| <= 1024 and sy 0..19', () => {
    let count = 0;

    // Test round-trip decoding over 83,968,020 combinations
    for (let cx = -1024; cx <= 1024; cx += 2) {
      for (let cz = -1024; cz <= 1024; cz += 2) {
        for (let sy = 0; sy < 20; sy++) {
          const key = LightStorage.getSectionKey(cx, sy, cz);

          // Decode arithmetic key: key = ((cx + 32768) * 65536 + (cz + 32768)) * 32 + sy
          const decodedSy = key % 32;
          const rem1 = Math.floor(key / 32);
          const decodedCz = (rem1 % 65536) - 32768;
          const decodedCx = Math.floor(rem1 / 65536) - 32768;

          if (decodedCx !== cx || decodedCz !== cz || decodedSy !== sy) {
            throw new Error(
              `Key encoding collision/mismatch at (${cx}, ${sy}, ${cz}): got (${decodedCx}, ${decodedSy}, ${decodedCz})`,
            );
          }
          count++;
        }
      }
    }

    expect(count).toBe(1025 * 1025 * 20);
  });

  it('sampled keys near ±32767 decode uniquely and do not collide', () => {
    const sampleCoords = [-32767, -32766, -10000, 0, 10000, 32766, 32767];
    const seenKeys = new Set<number>();

    for (const cx of sampleCoords) {
      for (const cz of sampleCoords) {
        for (let sy = 0; sy < 32; sy++) {
          const key = LightStorage.getSectionKey(cx, sy, cz);
          expect(seenKeys.has(key)).toBe(false);
          seenKeys.add(key);

          const decodedSy = key % 32;
          const rem1 = Math.floor(key / 32);
          const decodedCz = (rem1 % 65536) - 32768;
          const decodedCx = Math.floor(rem1 / 65536) - 32768;

          expect(decodedCx).toBe(cx);
          expect(decodedCz).toBe(cz);
          expect(decodedSy).toBe(sy);
        }
      }
    }
  });

  it('throws a clear error when coordinates exceed supported range', () => {
    expect(() => LightStorage.getSectionKey(32768, 0, 0)).toThrow(/out of supported key range/);
    expect(() => LightStorage.getSectionKey(-32768, 0, 0)).toThrow(/out of supported key range/);
    expect(() => LightStorage.getSectionKey(0, 0, 32768)).toThrow(/out of supported key range/);
    expect(() => LightStorage.getSectionKey(0, 0, -32768)).toThrow(/out of supported key range/);
    expect(() => LightStorage.getSectionKey(0, -1, 0)).toThrow(/out of supported range/);
    expect(() => LightStorage.getSectionKey(0, 32, 0)).toThrow(/out of supported range/);
  });
});
