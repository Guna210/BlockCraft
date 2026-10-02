// src/render/textures/terrain.ts
import { createEmptyTexture, TextureData, LCG, setPixel, fillSolid, hexToRgb } from './noise';

export const PAL_STONE = ['#4f5257', '#62666b', '#767a7f', '#8b8f94', '#a3a7ab'].map((h) =>
  hexToRgb(h),
);
export const PAL_FOUNDATION_STONE = ['#222427', '#323538', '#424549', '#54575b', '#6a6d71'].map(
  (h) => hexToRgb(h),
);
export const PAL_DIRT = ['#3f2a1c', '#5a3e2b', '#72513a', '#8a6448', '#a37d5d'].map((h) =>
  hexToRgb(h),
);
export const PAL_GRASS = ['#3f3f3f', '#5f5f5f', '#878787', '#b2b2b2', '#d5d5d5'].map((h) =>
  hexToRgb(h),
);
export const PAL_SAND = ['#b89c62', '#c9b27a', '#d8c28a', '#e6d29c', '#f1e2b4'].map((h) =>
  hexToRgb(h),
);
export const PAL_GRAVEL = ['#4e4e53', '#67676d', '#818188', '#9c9ca3', '#7a6a5a', '#96836f'].map(
  (h) => hexToRgb(h),
);
export const PAL_GLASS_FRAME = hexToRgb('#dff3fa', 220);
export const PAL_GLASS_GLINT = hexToRgb('#ffffff', 170);
export const PAL_GLASS_PANE = hexToRgb('#e9f6fb', 25);

export function getStonePalette() {
  return PAL_STONE;
}

export function genFoundationStone(seed: number = 45678): TextureData {
  const data = createEmptyTexture();
  const lcg = new LCG(seed);
  fillSolid(data, PAL_FOUNDATION_STONE[1]!);

  for (let i = 0; i < 8; i++) {
    const cx = lcg.nextInt(0, 15);
    const cy = lcg.nextInt(0, 15);
    const color = PAL_FOUNDATION_STONE[lcg.nextInt(0, PAL_FOUNDATION_STONE.length - 1)]!;

    const clusterSize = lcg.nextInt(3, 8);
    let px = cx,
      py = cy;
    for (let j = 0; j < clusterSize; j++) {
      setPixel(data, ((px % 16) + 16) % 16, ((py % 16) + 16) % 16, color);
      px += lcg.nextInt(-1, 1);
      py += lcg.nextInt(-1, 1);
    }
  }

  for (let i = 0; i < 3; i++) {
    const cx = lcg.nextInt(0, 15);
    const cy = lcg.nextInt(0, 15);
    const color = PAL_FOUNDATION_STONE[0]!;
    const dx = lcg.nextInt(-1, 1);
    const dy = lcg.nextInt(1, 2);
    setPixel(data, cx, cy, color);
    setPixel(data, (cx + dx + 16) % 16, (cy + dy + 16) % 16, color);
  }

  return data;
}

export function genStone(seed: number = 45678): TextureData {
  const data = createEmptyTexture();
  const lcg = new LCG(seed);
  fillSolid(data, PAL_STONE[1]!);

  for (let i = 0; i < 8; i++) {
    const cx = lcg.nextInt(0, 15);
    const cy = lcg.nextInt(0, 15);
    const color = PAL_STONE[lcg.nextInt(0, PAL_STONE.length - 1)]!;

    const clusterSize = lcg.nextInt(3, 8);
    let px = cx,
      py = cy;
    for (let j = 0; j < clusterSize; j++) {
      setPixel(data, (px + 16) % 16, (py + 16) % 16, color);
      px += lcg.nextInt(-1, 1);
      py += lcg.nextInt(-1, 1);
    }
  }

  for (let i = 0; i < 3; i++) {
    const cx = lcg.nextInt(0, 15);
    const cy = lcg.nextInt(0, 15);
    const color = PAL_STONE[0]!;
    const dx = lcg.nextInt(-1, 1);
    const dy = lcg.nextInt(1, 2);
    setPixel(data, cx, cy, color);
    setPixel(data, (cx + dx + 16) % 16, (cy + dy) % 16, color);
  }

  return data;
}

export function genCobblestone(seed: number = 56789): TextureData {
  const data = createEmptyTexture();
  const lcg = new LCG(seed);
  fillSolid(data, PAL_STONE[0]!);

  const numStones = lcg.nextInt(6, 9);
  const stoneCenters = Array.from({ length: numStones }, () => [
    lcg.nextInt(0, 15),
    lcg.nextInt(0, 15),
  ]);

  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let minDist = 999;
      let closestIdx = -1;
      let secondMinDist = 999;

      for (let i = 0; i < numStones; i++) {
        const cx = stoneCenters[i]![0]!;
        const cy = stoneCenters[i]![1]!;

        let dx = Math.abs(x - cx);
        if (dx > 8) dx = 16 - dx;
        let dy = Math.abs(y - cy);
        if (dy > 8) dy = 16 - dy;

        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDist) {
          secondMinDist = minDist;
          minDist = dist;
          closestIdx = i;
        } else if (dist < secondMinDist) {
          secondMinDist = dist;
        }
      }

      if (secondMinDist - minDist < 1.0) continue;
      if (minDist > 3.5) continue;

      const cx = stoneCenters[closestIdx]![0]!;
      const cy = stoneCenters[closestIdx]![1]!;
      let dx = x - cx;
      let dy = y - cy;
      if (dx > 8) dx -= 16;
      if (dx < -8) dx += 16;
      if (dy > 8) dy -= 16;
      if (dy < -8) dy += 16;

      let shadeIdx = 2;
      if (dx <= 0 && dy <= 0) shadeIdx = 4;
      else if (dx >= 0 && dy >= 0) shadeIdx = 1;

      setPixel(data, x, y, PAL_STONE[shadeIdx]!);
    }
  }

  return data;
}

export function genDirt(seed: number = 23456): TextureData {
  const data = createEmptyTexture();
  const lcg = new LCG(seed);
  fillSolid(data, PAL_DIRT[2]!);

  for (let i = 0; i < 15; i++) {
    const cx = lcg.nextInt(0, 15);
    const cy = lcg.nextInt(0, 15);
    const color = lcg.nextFloat() < 0.5 ? PAL_DIRT[1]! : PAL_DIRT[3]!;

    setPixel(data, cx, cy, color);
    if (lcg.nextFloat() < 0.5) setPixel(data, (cx + 1) % 16, cy, color);
    if (lcg.nextFloat() < 0.5) setPixel(data, cx, (cy + 1) % 16, color);
  }

  for (let i = 0; i < 4; i++) {
    const cx = lcg.nextInt(0, 15);
    const cy = lcg.nextInt(0, 15);
    setPixel(data, cx, cy, PAL_DIRT[4]!);
  }

  return data;
}

export function genGrassTop(seed: number = 12345): TextureData {
  const data = createEmptyTexture();
  const lcg = new LCG(seed);
  fillSolid(data, PAL_GRASS[2]!);

  for (let i = 0; i < 20; i++) {
    const cx = lcg.nextInt(0, 15);
    const cy = lcg.nextInt(0, 15);
    const h = lcg.nextInt(2, 3);
    const color = lcg.nextFloat() < 0.5 ? PAL_GRASS[0]! : PAL_GRASS[4]!;

    for (let dy = 0; dy < h; dy++) {
      setPixel(data, cx, (cy + dy) % 16, color);
    }
  }
  return data;
}

export function genGrassSide(seed: number = 34567): TextureData {
  const dirt = genDirt(seed);
  const grassTop = genGrassTop(seed);
  const lcg = new LCG(seed);
  const data = createEmptyTexture();

  for (let x = 0; x < 16; x++) {
    const fringeDepth = lcg.nextInt(3, 6);
    for (let y = 0; y < 16; y++) {
      const i = (y * 16 + x) * 4;
      if (y < fringeDepth) {
        // Grass fringe: grayscale RGB, Alpha = 255
        const col =
          y === fringeDepth - 1
            ? PAL_GRASS[0]!
            : [grassTop[i]!, grassTop[i + 1]!, grassTop[i + 2]!];
        data[i] = col[0]!;
        data[i + 1] = col[1]!;
        data[i + 2] = col[2]!;
        data[i + 3] = 255;
      } else {
        // Dirt base: untinted brown RGB, Alpha = 255
        data[i] = dirt[i]!;
        data[i + 1] = dirt[i + 1]!;
        data[i + 2] = dirt[i + 2]!;
        data[i + 3] = 255;
      }
    }
  }
  return data;
}

export function genSand(seed: number = 67890): TextureData {
  const data = createEmptyTexture();
  const lcg = new LCG(seed);
  fillSolid(data, PAL_SAND[2]!);

  for (let i = 0; i < 30; i++) {
    const cx = lcg.nextInt(0, 15);
    const cy = lcg.nextInt(0, 15);
    const color = lcg.nextFloat() < 0.5 ? PAL_SAND[0]! : PAL_SAND[4]!;
    setPixel(data, cx, cy, color);
  }

  for (let x = 0; x < 16; x++) {
    const y = Math.floor(x * 0.5) + lcg.nextInt(-1, 1);
    setPixel(data, x, (y + 16) % 16, PAL_SAND[1]!);
    setPixel(data, (x + 8) % 16, (y + 8) % 16, PAL_SAND[4]!);
  }

  return data;
}

export function genGravel(seed: number = 78901): TextureData {
  const data = createEmptyTexture();
  const lcg = new LCG(seed);
  fillSolid(data, PAL_GRAVEL[0]!);

  const numPebbles = lcg.nextInt(6, 9);

  for (let p = 0; p < numPebbles; p++) {
    const cx = lcg.nextInt(0, 15);
    const cy = lcg.nextInt(0, 15);
    const w = lcg.nextInt(3, 5);
    const h = lcg.nextInt(3, 5);
    const isWarm = lcg.nextFloat() < 0.3;

    const baseCol = isWarm ? PAL_GRAVEL[4]! : PAL_GRAVEL[2]!;
    const hlCol = isWarm ? PAL_GRAVEL[5]! : PAL_GRAVEL[3]!;
    const shCol = isWarm ? PAL_GRAVEL[4]! : PAL_GRAVEL[1]!;

    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (
          (dx === 0 && dy === 0) ||
          (dx === w - 1 && dy === 0) ||
          (dx === 0 && dy === h - 1) ||
          (dx === w - 1 && dy === h - 1)
        ) {
          if (lcg.nextFloat() < 0.7) continue;
        }

        let shade = baseCol;
        if (dx <= 1 && dy <= 1) shade = hlCol;
        else if (dx >= w - 2 && dy >= h - 2) shade = shCol;

        setPixel(data, (cx + dx) % 16, (cy + dy) % 16, shade);
      }
    }
  }

  return data;
}

export function genGlass(_seed: number = 0): TextureData {
  const data = createEmptyTexture();
  fillSolid(data, PAL_GLASS_PANE);

  for (let i = 0; i < 16; i++) {
    setPixel(data, i, 0, PAL_GLASS_FRAME);
    setPixel(data, i, 15, PAL_GLASS_FRAME);
    setPixel(data, 0, i, PAL_GLASS_FRAME);
    setPixel(data, 15, i, PAL_GLASS_FRAME);
  }

  setPixel(data, 2, 2, PAL_GLASS_GLINT);
  setPixel(data, 3, 3, PAL_GLASS_GLINT);
  setPixel(data, 4, 4, PAL_GLASS_GLINT);

  return data;
}
