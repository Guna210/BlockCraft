// FNV-1a hash to convert string to a 32-bit integer seed
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// SplitMix32 for mixing and generating uncorrelated states
function splitmix32(a: number): () => number {
  let state = a | 0;
  return function () {
    state = (state + 0x9e3779b9) | 0;
    let t = state ^ (state >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

export function deriveSeed(seed: number, label: string): number {
  const labelHash = hashString(label);
  let h = (seed + 0x9e3779b9) | 0;
  h = Math.imul(h ^ labelHash, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// Positional hash 2D -> [0, 1)
export function hash2(seed: number, x: number, z: number): number {
  let h = (seed + 0x9e3779b9) | 0;
  h = Math.imul(h ^ (x | 0), 0x85ebca6b);
  h = Math.imul(h ^ (z | 0), 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x735a2d97);
  h ^= h >>> 15;
  h = Math.imul(h, 0x21f0aaad);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296.0;
}

// Positional hash 3D -> [0, 1)
export function hash3(seed: number, x: number, y: number, z: number): number {
  let h = (seed + 0x9e3779b9) | 0;
  h = Math.imul(h ^ (x | 0), 0x85ebca6b);
  h = Math.imul(h ^ (y | 0), 0xc2b2ae35);
  h = Math.imul(h ^ (z | 0), 0x27d4eb2f);
  h ^= h >>> 16;
  h = Math.imul(h, 0x735a2d97);
  h ^= h >>> 15;
  h = Math.imul(h, 0x21f0aaad);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296.0;
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

export class PRNG {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    const sm = splitmix32(seed);
    this.a = sm();
    this.b = sm();
    this.c = sm();
    this.d = sm();
    // Ensure state is not all zeros
    if (this.a === 0 && this.b === 0 && this.c === 0 && this.d === 0) {
      this.a = 1;
    }
  }

  // Returns [0, 1)
  next(): number {
    const result = Math.imul(rotl(Math.imul(this.b, 5), 7), 9) >>> 0;
    const t = this.b << 9;

    this.c ^= this.a;
    this.d ^= this.b;
    this.b ^= this.c;
    this.a ^= this.d;

    this.c ^= t;
    this.d = rotl(this.d, 11);

    return result / 4294967296.0;
  }
}
