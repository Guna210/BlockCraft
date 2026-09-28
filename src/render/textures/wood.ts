// src/render/textures/wood.ts
import {
  createEmptyTexture,
  TextureData,
  LCG,
  setPixel,
  fillSolid,
  SimpleNoise,
  RGB,
} from './noise';

function genLogTop(baseColor: RGB, ringColor: RGB, seed: number): TextureData {
  const data = createEmptyTexture();
  const noise = new SimpleNoise(seed);
  fillSolid(data, baseColor);

  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x - 7.5;
      const dy = y - 7.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const n = noise.noise2D(x * 0.1, y * 0.1);

      const ring = Math.sin((dist + n * 2) * 1.5); // Ring pattern
      if (ring > 0.5 && dist < 7) {
        setPixel(data, x, y, ringColor);
      }

      // Bark border
      if (dist >= 7) {
        const barkDark: RGB = [baseColor[0]! - 40, baseColor[1]! - 40, baseColor[2]! - 40];
        setPixel(data, x, y, barkDark);
      }
    }
  }
  return data;
}

function genLogSide(baseColor: RGB, barkColor: RGB, seed: number): TextureData {
  const data = createEmptyTexture();
  const noise = new SimpleNoise(seed);

  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      // vertical noise lines
      const n = noise.noise2D(x * 0.5, y * 0.1);
      const isBark = Math.abs(n) > 0.3;
      const c = isBark ? barkColor : baseColor;
      const offset = Math.floor(n * 10);
      setPixel(data, x, y, [c[0]! + offset, c[1]! + offset, c[2]! + offset]);
    }
  }
  return data;
}

export function genOakLogTop(): TextureData {
  return genLogTop([160, 130, 90], [130, 100, 60], 111);
}
export function genOakLogSide(): TextureData {
  return genLogSide([100, 80, 50], [70, 50, 30], 112);
}
export function genBirchLogTop(): TextureData {
  return genLogTop([210, 200, 170], [180, 170, 140], 221);
}
export function genBirchLogSide(): TextureData {
  const data = genLogSide([230, 230, 220], [200, 200, 190], 222);
  const lcg = new LCG(223);
  // Birch black streaks
  for (let i = 0; i < 20; i++) {
    const x = lcg.nextInt(0, 15);
    const y = lcg.nextInt(0, 15);
    const w = lcg.nextInt(2, 4);
    for (let dx = 0; dx < w; dx++) {
      if (x + dx < 16) setPixel(data, x + dx, y, [50, 50, 50]);
    }
  }
  return data;
}
export function genPineLogTop(): TextureData {
  return genLogTop([130, 90, 50], [100, 60, 30], 331);
}
export function genPineLogSide(): TextureData {
  return genLogSide([80, 50, 30], [50, 30, 20], 332);
}

function genPlanks(baseColor: RGB, seed: number): TextureData {
  const data = createEmptyTexture();
  const noise = new SimpleNoise(seed);
  const lcg = new LCG(seed);

  for (let y = 0; y < 16; y++) {
    const isBorder = y % 4 === 0;

    for (let x = 0; x < 16; x++) {
      const n = noise.noise2D(x * 0.2, y * 0.1);
      let offset = Math.floor(n * 15);

      // Plank shifting
      const shift = lcg.nextInt(-5, 5);
      offset += shift;

      if (isBorder || x % 16 === 0) {
        setPixel(data, x, y, [baseColor[0]! - 30, baseColor[1]! - 30, baseColor[2]! - 30]);
      } else {
        setPixel(data, x, y, [
          baseColor[0]! + offset,
          baseColor[1]! + offset,
          baseColor[2]! + offset,
        ]);
      }
    }
  }
  return data;
}

export function genOakPlanks(): TextureData {
  return genPlanks([160, 130, 90], 441);
}
export function genBirchPlanks(): TextureData {
  return genPlanks([210, 200, 170], 442);
}
export function genPinePlanks(): TextureData {
  return genPlanks([140, 100, 60], 443);
}

function genLeaves(baseColor: RGB, seed: number): TextureData {
  const data = createEmptyTexture();
  const lcg = new LCG(seed);
  fillSolid(data, [0, 0, 0, 0]); // transparent base if cutout is needed, but for simplicity let's make it opaque or solid with holes

  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (lcg.nextFloat() < 0.2) {
        // Transparent hole
        setPixel(data, x, y, [0, 0, 0, 0]);
      } else {
        const offset = lcg.nextInt(-20, 20);
        setPixel(data, x, y, [
          baseColor[0]! + offset,
          baseColor[1]! + offset,
          baseColor[2]! + offset,
          255,
        ]);
      }
    }
  }
  return data;
}

export function genOakLeaves(): TextureData {
  return genLeaves([50, 120, 40], 551);
}
export function genBirchLeaves(): TextureData {
  return genLeaves([80, 140, 60], 552);
}
export function genPineLeaves(): TextureData {
  return genLeaves([40, 90, 40], 553);
}
