import { describe, expect, it } from 'vitest';
import { deflate, inflate } from '../../src/persist/compress';

/** Bytes that barely compress, from a fixed xorshift stream. */
function noise(length: number): Uint8Array {
  const out = new Uint8Array(length);
  let x = 0x9e3779b9;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out[i] = x & 255;
  }
  return out;
}

describe('M17b — compression of large, poorly compressible data', () => {
  it('round-trips 4 MiB of noise (the case where a write-before-read pipe stalls)', async () => {
    const data = noise(4 * 1024 * 1024);
    const packed = await deflate(data);
    expect(packed.byteLength).toBeGreaterThan(data.byteLength * 0.9);
    const back = await inflate(packed);
    expect(back.byteLength).toBe(data.byteLength);
    expect(Buffer.compare(Buffer.from(back), Buffer.from(data))).toBe(0);
  }, 30_000);

  it('round-trips empty and tiny inputs', async () => {
    for (const length of [0, 1, 17]) {
      const data = noise(length);
      expect([...(await inflate(await deflate(data)))]).toEqual([...data]);
    }
  });
});
