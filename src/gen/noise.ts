import { hash2, hash3 } from '../engine/rng';

export type Noise2D = (x: number, y: number) => number;
export type Noise3D = (x: number, y: number, z: number) => number;

// Simplex noise (2D and 3D) implementation without Math.sin or per-sample allocation

const GRAD3 = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1,
  0, 1, -1, 0, -1, -1,
]);

const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;

export function makeSimplex2D(seed: number): Noise2D {
  return function (x: number, y: number): number {
    let n0 = 0,
      n1 = 0,
      n2 = 0;
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = x - X0;
    const y0 = y - Y0;

    let i1, j1;
    if (x0 > y0) {
      i1 = 1;
      j1 = 0;
    } else {
      i1 = 0;
      j1 = 1;
    }

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1.0 + 2.0 * G2;
    const y2 = y0 - 1.0 + 2.0 * G2;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      t0 *= t0;
      const h = Math.floor(hash2(seed, i, j) * 12) * 3;
      n0 = t0 * t0 * (GRAD3[h]! * x0 + GRAD3[h + 1]! * y0);
    }

    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      t1 *= t1;
      const h = Math.floor(hash2(seed, i + i1, j + j1) * 12) * 3;
      n1 = t1 * t1 * (GRAD3[h]! * x1 + GRAD3[h + 1]! * y1);
    }

    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      t2 *= t2;
      const h = Math.floor(hash2(seed, i + 1, j + 1) * 12) * 3;
      n2 = t2 * t2 * (GRAD3[h]! * x2 + GRAD3[h + 1]! * y2);
    }

    // Scale to [-1, 1]
    return 70.0 * (n0 + n1 + n2);
  };
}

const F3 = 1.0 / 3.0;
const G3 = 1.0 / 6.0;

export function makeSimplex3D(seed: number): Noise3D {
  return function (x: number, y: number, z: number): number {
    let n0, n1, n2, n3;
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const X0 = i - t;
    const Y0 = j - t;
    const Z0 = k - t;
    const x0 = x - X0;
    const y0 = y - Y0;
    const z0 = z - Z0;

    let i1, j1, k1;
    let i2, j2, k2;

    if (x0 >= y0) {
      if (y0 >= z0) {
        i1 = 1;
        j1 = 0;
        k1 = 0;
        i2 = 1;
        j2 = 1;
        k2 = 0;
      } else if (x0 >= z0) {
        i1 = 1;
        j1 = 0;
        k1 = 0;
        i2 = 1;
        j2 = 0;
        k2 = 1;
      } else {
        i1 = 0;
        j1 = 0;
        k1 = 1;
        i2 = 1;
        j2 = 0;
        k2 = 1;
      }
    } else {
      if (y0 < z0) {
        i1 = 0;
        j1 = 0;
        k1 = 1;
        i2 = 0;
        j2 = 1;
        k2 = 1;
      } else if (x0 < z0) {
        i1 = 0;
        j1 = 1;
        k1 = 0;
        i2 = 0;
        j2 = 1;
        k2 = 1;
      } else {
        i1 = 0;
        j1 = 1;
        k1 = 0;
        i2 = 1;
        j2 = 1;
        k2 = 0;
      }
    }

    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2.0 * G3;
    const y2 = y0 - j2 + 2.0 * G3;
    const z2 = z0 - k2 + 2.0 * G3;
    const x3 = x0 - 1.0 + 3.0 * G3;
    const y3 = y0 - 1.0 + 3.0 * G3;
    const z3 = z0 - 1.0 + 3.0 * G3;

    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 < 0) n0 = 0.0;
    else {
      t0 *= t0;
      const h = Math.floor(hash3(seed, i, j, k) * 12) * 3;
      n0 = t0 * t0 * (GRAD3[h]! * x0 + GRAD3[h + 1]! * y0 + GRAD3[h + 2]! * z0);
    }

    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 < 0) n1 = 0.0;
    else {
      t1 *= t1;
      const h = Math.floor(hash3(seed, i + i1, j + j1, k + k1) * 12) * 3;
      n1 = t1 * t1 * (GRAD3[h]! * x1 + GRAD3[h + 1]! * y1 + GRAD3[h + 2]! * z1);
    }

    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 < 0) n2 = 0.0;
    else {
      t2 *= t2;
      const h = Math.floor(hash3(seed, i + i2, j + j2, k + k2) * 12) * 3;
      n2 = t2 * t2 * (GRAD3[h]! * x2 + GRAD3[h + 1]! * y2 + GRAD3[h + 2]! * z2);
    }

    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 < 0) n3 = 0.0;
    else {
      t3 *= t3;
      const h = Math.floor(hash3(seed, i + 1, j + 1, k + 1) * 12) * 3;
      n3 = t3 * t3 * (GRAD3[h]! * x3 + GRAD3[h + 1]! * y3 + GRAD3[h + 2]! * z3);
    }

    return 32.0 * (n0 + n1 + n2 + n3);
  };
}

// Value noise implementation (returns [-1, 1])

function lerp(t: number, a: number, b: number) {
  return a + t * (b - a);
}

function fade(t: number) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function makeValueNoise2D(seed: number): Noise2D {
  return function (x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;

    const v00 = hash2(seed, ix, iy) * 2 - 1;
    const v10 = hash2(seed, ix + 1, iy) * 2 - 1;
    const v01 = hash2(seed, ix, iy + 1) * 2 - 1;
    const v11 = hash2(seed, ix + 1, iy + 1) * 2 - 1;

    const sx = fade(fx);
    const sy = fade(fy);

    const nx0 = lerp(sx, v00, v10);
    const nx1 = lerp(sx, v01, v11);

    return lerp(sy, nx0, nx1);
  };
}

export function makeValueNoise3D(seed: number): Noise3D {
  return function (x: number, y: number, z: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);

    const fx = x - ix;
    const fy = y - iy;
    const fz = z - iz;

    const sx = fade(fx);
    const sy = fade(fy);
    const sz = fade(fz);

    const v000 = hash3(seed, ix, iy, iz) * 2 - 1;
    const v100 = hash3(seed, ix + 1, iy, iz) * 2 - 1;
    const v010 = hash3(seed, ix, iy + 1, iz) * 2 - 1;
    const v110 = hash3(seed, ix + 1, iy + 1, iz) * 2 - 1;

    const v001 = hash3(seed, ix, iy, iz + 1) * 2 - 1;
    const v101 = hash3(seed, ix + 1, iy, iz + 1) * 2 - 1;
    const v011 = hash3(seed, ix, iy + 1, iz + 1) * 2 - 1;
    const v111 = hash3(seed, ix + 1, iy + 1, iz + 1) * 2 - 1;

    const nx00 = lerp(sx, v000, v100);
    const nx10 = lerp(sx, v010, v110);
    const nx01 = lerp(sx, v001, v101);
    const nx11 = lerp(sx, v011, v111);

    const nxy0 = lerp(sy, nx00, nx10);
    const nxy1 = lerp(sy, nx01, nx11);

    return lerp(sz, nxy0, nxy1);
  };
}

// Fractal Brownian Motion (fBm)

export function makeFbm2D(
  baseNoise: Noise2D,
  octaves: number,
  persistence: number = 0.5,
  lacunarity: number = 2.0,
): Noise2D {
  // Compute max amplitude for normalization to [-1, 1]
  let maxAmp = 0;
  let amp = 1.0;
  for (let i = 0; i < octaves; i++) {
    maxAmp += amp;
    amp *= persistence;
  }

  return function (x: number, y: number): number {
    let total = 0;
    let freq = 1.0;
    let amplitude = 1.0;

    for (let i = 0; i < octaves; i++) {
      total += baseNoise(x * freq, y * freq) * amplitude;
      freq *= lacunarity;
      amplitude *= persistence;
    }

    return total / maxAmp;
  };
}

export function makeFbm3D(
  baseNoise: Noise3D,
  octaves: number,
  persistence: number = 0.5,
  lacunarity: number = 2.0,
): Noise3D {
  let maxAmp = 0;
  let amp = 1.0;
  for (let i = 0; i < octaves; i++) {
    maxAmp += amp;
    amp *= persistence;
  }

  return function (x: number, y: number, z: number): number {
    let total = 0;
    let freq = 1.0;
    let amplitude = 1.0;

    for (let i = 0; i < octaves; i++) {
      total += baseNoise(x * freq, y * freq, z * freq) * amplitude;
      freq *= lacunarity;
      amplitude *= persistence;
    }

    return total / maxAmp;
  };
}

// Domain Warping (2D example)

export function makeDomainWarp2D(
  baseNoise: Noise2D,
  warpNoiseX: Noise2D,
  warpNoiseY: Noise2D,
  amplitude: number,
): Noise2D {
  return function (x: number, y: number): number {
    const wx = warpNoiseX(x, y) * amplitude;
    const wy = warpNoiseY(x, y) * amplitude;
    return baseNoise(x + wx, y + wy);
  };
}

// Ridged noise

export function makeRidged2D(
  baseNoise: Noise2D,
  octaves: number,
  persistence: number = 0.5,
  lacunarity: number = 2.0,
): Noise2D {
  let maxAmp = 0;
  let amp = 1.0;
  for (let i = 0; i < octaves; i++) {
    maxAmp += amp;
    amp *= persistence;
  }

  return function (x: number, y: number): number {
    let total = 0;
    let freq = 1.0;
    let amplitude = 1.0;
    let weight = 1.0;

    for (let i = 0; i < octaves; i++) {
      let v = baseNoise(x * freq, y * freq);
      v = 1.0 - Math.abs(v);
      v *= v;
      v *= weight;
      weight = v * 2.0; // simple feedback
      if (weight > 1.0) weight = 1.0;
      if (weight < 0.0) weight = 0.0;

      total += v * amplitude;
      freq *= lacunarity;
      amplitude *= persistence;
    }

    return (total / maxAmp) * 2.0 - 1.0; // approximate normalization back to [-1, 1]
  };
}

export function makeRidged3D(
  baseNoise: Noise3D,
  octaves: number,
  persistence: number = 0.5,
  lacunarity: number = 2.0,
): Noise3D {
  let maxAmp = 0;
  let amp = 1.0;
  for (let i = 0; i < octaves; i++) {
    maxAmp += amp;
    amp *= persistence;
  }

  return function (x: number, y: number, z: number): number {
    let total = 0;
    let freq = 1.0;
    let amplitude = 1.0;
    let weight = 1.0;

    for (let i = 0; i < octaves; i++) {
      let v = baseNoise(x * freq, y * freq, z * freq);
      v = 1.0 - Math.abs(v);
      v *= v;
      v *= weight;
      weight = v * 2.0;
      if (weight > 1.0) weight = 1.0;
      if (weight < 0.0) weight = 0.0;

      total += v * amplitude;
      freq *= lacunarity;
      amplitude *= persistence;
    }

    return (total / maxAmp) * 2.0 - 1.0;
  };
}
