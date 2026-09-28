// src/render/textures/noise.ts
// Helper to implement pseudo-randomness and noise for procedural textures.
// Note: Can be migrated to M03a RNG and noise later.

export class LCG {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  // Next float [0, 1)
  nextFloat(): number {
    this.state = (this.state * 1664525 + 1013904223) >>> 0;
    return this.state / 4294967296;
  }

  // Next int [min, max]
  nextInt(min: number, max: number): number {
    return Math.floor(this.nextFloat() * (max - min + 1)) + min;
  }
}

// Simple deterministic hash for a string to seed LCG
export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash >>> 0;
}

export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];
export type TextureData = Uint8Array; // 16x16 * 4 (RGBA) = 1024 bytes

export function createEmptyTexture(): TextureData {
  return new Uint8Array(16 * 16 * 4);
}

// Write pixel to TextureData (16x16)
export function setPixel(data: TextureData, x: number, y: number, color: RGBA | RGB) {
  if (x < 0 || x >= 16 || y < 0 || y >= 16) return;
  const i = (y * 16 + x) * 4;
  data[i] = color[0]!;
  data[i + 1] = color[1]!;
  data[i + 2] = color[2]!;
  data[i + 3] = color.length === 4 ? color[3]! : 255;
}

// Fill solid color
export function fillSolid(data: TextureData, color: RGBA | RGB) {
  for (let i = 0; i < 256; i++) {
    data[i * 4] = color[0]!;
    data[i * 4 + 1] = color[1]!;
    data[i * 4 + 2] = color[2]!;
    data[i * 4 + 3] = color.length === 4 ? color[3]! : 255;
  }
}

// Blend colors
export function blend(c1: RGB, c2: RGB, t: number): RGB {
  return [
    Math.round(c1[0]! + (c2[0]! - c1[0]!) * t),
    Math.round(c1[1]! + (c2[1]! - c1[1]!) * t),
    Math.round(c1[2]! + (c2[2]! - c1[2]!) * t),
  ];
}

// Basic Perlin-like 2D noise mapping
export class SimpleNoise {
  private p: number[] = new Array(512);

  constructor(seed: number) {
    const lcg = new LCG(seed);
    const p = new Array(256);
    for (let i = 0; i < 256; i++) {
      p[i] = i;
    }
    for (let i = 255; i > 0; i--) {
      const j = lcg.nextInt(0, i);
      const temp = p[i]!;
      p[i] = p[j]!;
      p[j] = temp;
    }
    for (let i = 0; i < 512; i++) {
      this.p[i] = p[i & 255]!;
    }
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(t: number, a: number, b: number): number {
    return a + t * (b - a);
  }

  private grad(hash: number, x: number, y: number): number {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : 0;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  noise2D(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    const u = this.fade(x);
    const v = this.fade(y);
    const A = this.p[X]! + Y;
    const B = this.p[X + 1]! + Y;
    return this.lerp(
      v,
      this.lerp(u, this.grad(this.p[A]!, x, y), this.grad(this.p[B]!, x - 1, y)),
      this.lerp(u, this.grad(this.p[A + 1]!, x, y - 1), this.grad(this.p[B + 1]!, x - 1, y - 1)),
    );
  }
}
