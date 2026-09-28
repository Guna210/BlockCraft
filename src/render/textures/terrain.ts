// src/render/textures/terrain.ts
import {
  createEmptyTexture,
  TextureData,
  LCG,
  setPixel,
  fillSolid,
  SimpleNoise,
  RGB,
} from './noise';

export function genGrassTop(): TextureData {
  const data = createEmptyTexture();
  const lcg = new LCG(12345);
  const baseColor: RGB = [85, 153, 51]; // Green
  const varColor1: RGB = [75, 140, 45];
  const varColor2: RGB = [95, 165, 60];

  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const r = lcg.nextFloat();
      let color = baseColor;
      if (r < 0.2) color = varColor1;
      else if (r > 0.8) color = varColor2;
      setPixel(data, x, y, color);
    }
  }
  return data;
}

export function genDirt(): TextureData {
  const data = createEmptyTexture();
  const lcg = new LCG(23456);
  const baseColor: RGB = [102, 68, 34]; // Brown
  const varColor1: RGB = [85, 51, 17];
  const varColor2: RGB = [119, 85, 51];

  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const r = lcg.nextFloat();
      let color = baseColor;
      if (r < 0.3) color = varColor1;
      else if (r > 0.7) color = varColor2;
      setPixel(data, x, y, color);
    }
  }
  return data;
}

export function genGrassSide(): TextureData {
  const data = genDirt();
  const grassTop = genGrassTop();
  const lcg = new LCG(34567);

  // Fringe overhang
  for (let x = 0; x < 16; x++) {
    const fringeDepth = lcg.nextInt(2, 5);
    for (let y = 0; y < fringeDepth; y++) {
      const i = (y * 16 + x) * 4;
      data[i] = grassTop[i]!;
      data[i + 1] = grassTop[i + 1]!;
      data[i + 2] = grassTop[i + 2]!;
    }
    // Bottom fringe pixel is darker
    const yi = fringeDepth - 1;
    const ii = (yi * 16 + x) * 4;
    data[ii] = Math.max(0, data[ii]! - 20);
    data[ii + 1] = Math.max(0, data[ii + 1]! - 20);
    data[ii + 2] = Math.max(0, data[ii + 2]! - 20);
  }
  return data;
}

export function genStone(): TextureData {
  const data = createEmptyTexture();
  const noise = new SimpleNoise(45678);
  const baseColor: RGB = [128, 128, 128];

  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const n = noise.noise2D(x * 0.2, y * 0.2); // [-1, 1]
      const offset = Math.round(n * 15);
      setPixel(data, x, y, [
        baseColor[0]! + offset,
        baseColor[1]! + offset,
        baseColor[2]! + offset,
      ]);
    }
  }
  return data;
}

export function genCobblestone(): TextureData {
  const data = createEmptyTexture();
  const lcg = new LCG(56789);
  fillSolid(data, [100, 100, 100]);

  // Draw somewhat irregular blocks
  for (let i = 0; i < 15; i++) {
    const cx = lcg.nextInt(0, 15);
    const cy = lcg.nextInt(0, 15);
    const w = lcg.nextInt(3, 6);
    const h = lcg.nextInt(3, 6);
    const colorOffset = lcg.nextInt(-20, 20);
    const c: RGB = [128 + colorOffset, 128 + colorOffset, 128 + colorOffset];
    const shadow: RGB = [c[0]! - 30, c[1]! - 30, c[2]! - 30];
    const highlight: RGB = [c[0]! + 20, c[1]! + 20, c[2]! + 20];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let drawColor = c;
        if (x === 0 || y === 0) drawColor = highlight;
        if (x === w - 1 || y === h - 1) drawColor = shadow;
        // make corners rounder randomly
        if (
          (x === 0 && y === 0) ||
          (x === w - 1 && y === 0) ||
          (x === 0 && y === h - 1) ||
          (x === w - 1 && y === h - 1)
        ) {
          if (lcg.nextFloat() < 0.5) continue;
        }
        setPixel(data, (cx + x) % 16, (cy + y) % 16, drawColor);
      }
    }
  }
  return data;
}

export function genSand(): TextureData {
  const data = createEmptyTexture();
  const lcg = new LCG(67890);
  const baseColor: RGB = [218, 210, 153];

  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const r = lcg.nextFloat();
      let color = baseColor;
      if (r < 0.1)
        color = [200, 190, 140]; // darker speckles
      else if (r > 0.9) color = [230, 225, 170]; // lighter speckles
      setPixel(data, x, y, color);
    }
  }
  return data;
}

export function genGravel(): TextureData {
  const data = createEmptyTexture();
  const lcg = new LCG(78901);
  const baseColor: RGB = [136, 126, 126];

  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const offset = lcg.nextInt(-25, 25);
      const isPinkish = lcg.nextFloat() < 0.05;
      const c = isPinkish
        ? [160, 130, 130]
        : [baseColor[0]! + offset, baseColor[1]! + offset, baseColor[2]! + offset];
      setPixel(data, x, y, c as RGB);
    }
  }
  return data;
}

export function genGlass(): TextureData {
  const data = createEmptyTexture();
  fillSolid(data, [200, 230, 255, 60]); // translucent light blue

  // Frame
  for (let i = 0; i < 16; i++) {
    setPixel(data, i, 0, [230, 245, 255, 200]);
    setPixel(data, i, 15, [180, 210, 230, 200]);
    setPixel(data, 0, i, [230, 245, 255, 200]);
    setPixel(data, 15, i, [180, 210, 230, 200]);
  }

  // Shine streak
  setPixel(data, 2, 2, [255, 255, 255, 220]);
  setPixel(data, 3, 3, [255, 255, 255, 180]);
  setPixel(data, 4, 4, [255, 255, 255, 120]);

  return data;
}
