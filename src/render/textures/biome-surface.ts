// src/render/textures/biome-surface.ts
import { createEmptyTexture, TextureData, LCG, setPixel, fillSolid, hexToRgb, RGBA } from './noise';

// Palettes defined according to ART.md rules and contrast >= 60 requirements

export const PAL_RED_SAND: RGBA[] = ['#a24727', '#b85b37', '#c86f4a', '#d8835d', '#e89872'].map(
  (h) => hexToRgb(h),
);

export const PAL_CLAY: RGBA[] = ['#6b6d7c', '#7d7f90', '#9294a5', '#a7a9ba', '#bcbee0'].map((h) =>
  hexToRgb(h),
);

export const PAL_SNOW: RGBA[] = ['#a3c0d6', '#c2d9ea', '#dceaf5', '#eef6fc', '#ffffff'].map((h) =>
  hexToRgb(h),
);

export const PAL_MIRE: RGBA[] = ['#2b2118', '#3d3022', '#524230', '#665540', '#7a6850'].map((h) =>
  hexToRgb(h),
);

export const PAL_CLAYROCK_WHITE: RGBA[] = [
  '#8c8680',
  '#a8a19a',
  '#c2bbb4',
  '#dcd5ce',
  '#efe8e1',
].map((h) => hexToRgb(h));

export const PAL_CLAYROCK_LIGHT_GRAY: RGBA[] = [
  '#5a5754',
  '#726f6b',
  '#8c8884',
  '#a6a29d',
  '#bfbbb6',
].map((h) => hexToRgb(h));

export const PAL_CLAYROCK_YELLOW: RGBA[] = [
  '#9c741e',
  '#b88a28',
  '#d4a235',
  '#ebb844',
  '#fcd15b',
].map((h) => hexToRgb(h));

export const PAL_CLAYROCK_ORANGE: RGBA[] = [
  '#8f4216',
  '#aa521e',
  '#c46428',
  '#de7833',
  '#f28d41',
].map((h) => hexToRgb(h));

export const PAL_CLAYROCK_TERRACOTTA: RGBA[] = [
  '#7a3828',
  '#944735',
  '#ad5844',
  '#c76a54',
  '#dc7d66',
].map((h) => hexToRgb(h));

export const PAL_CLAYROCK_RED: RGBA[] = ['#802820', '#9a332a', '#b54036', '#cf5044', '#e26256'].map(
  (h) => hexToRgb(h),
);

export const PAL_CLAYROCK_BROWN: RGBA[] = [
  '#4e3020',
  '#643f2c',
  '#7b503a',
  '#926148',
  '#a87458',
].map((h) => hexToRgb(h));

export const PAL_CLAYROCK_DARK_BROWN: RGBA[] = [
  '#2b1810',
  '#472b1f',
  '#5c392a',
  '#704735',
  '#8e5b46',
].map((h) => hexToRgb(h));

export function genRedSand(seed: number = 67891): TextureData {
  const data = createEmptyTexture();
  const lcg = new LCG(seed);
  fillSolid(data, PAL_RED_SAND[2]!);

  for (let i = 0; i < 30; i++) {
    const cx = lcg.nextInt(0, 15);
    const cy = lcg.nextInt(0, 15);
    const color = lcg.nextFloat() < 0.5 ? PAL_RED_SAND[0]! : PAL_RED_SAND[4]!;
    setPixel(data, cx, cy, color);
  }

  for (let x = 0; x < 16; x++) {
    const y = Math.floor(x * 0.5) + lcg.nextInt(-1, 1);
    setPixel(data, x, (y + 16) % 16, PAL_RED_SAND[1]!);
    setPixel(data, (x + 8) % 16, (y + 8) % 16, PAL_RED_SAND[4]!);
  }

  return data;
}

export function genClay(seed: number = 78912): TextureData {
  const data = createEmptyTexture();
  const lcg = new LCG(seed);
  fillSolid(data, PAL_CLAY[2]!);

  for (let i = 0; i < 12; i++) {
    const cx = lcg.nextInt(0, 15);
    const cy = lcg.nextInt(0, 15);
    const color = PAL_CLAY[lcg.nextInt(0, PAL_CLAY.length - 1)]!;

    const clusterSize = lcg.nextInt(3, 8);
    let px = cx,
      py = cy;
    for (let j = 0; j < clusterSize; j++) {
      setPixel(data, (px + 16) % 16, (py + 16) % 16, color);
      px += lcg.nextInt(-1, 1);
      py += lcg.nextInt(-1, 1);
    }
  }
  return data;
}

export function genSnow(seed: number = 89123): TextureData {
  const data = createEmptyTexture();
  const lcg = new LCG(seed);
  fillSolid(data, PAL_SNOW[3]!);

  for (let i = 0; i < 25; i++) {
    const cx = lcg.nextInt(0, 15);
    const cy = lcg.nextInt(0, 15);
    const color = lcg.nextFloat() < 0.6 ? PAL_SNOW[4]! : PAL_SNOW[1]!;
    setPixel(data, cx, cy, color);
  }

  for (let i = 0; i < 8; i++) {
    const cx = lcg.nextInt(0, 15);
    const cy = lcg.nextInt(0, 15);
    setPixel(data, cx, cy, PAL_SNOW[0]!);
  }

  return data;
}

export function genMire(seed: number = 91234): TextureData {
  const data = createEmptyTexture();
  const lcg = new LCG(seed);
  fillSolid(data, PAL_MIRE[2]!);

  for (let i = 0; i < 15; i++) {
    const cx = lcg.nextInt(0, 15);
    const cy = lcg.nextInt(0, 15);
    const color = PAL_MIRE[lcg.nextInt(0, PAL_MIRE.length - 1)]!;

    const clusterSize = lcg.nextInt(2, 5);
    let px = cx,
      py = cy;
    for (let j = 0; j < clusterSize; j++) {
      setPixel(data, (px + 16) % 16, (py + 16) % 16, color);
      px += lcg.nextInt(-1, 1);
      py += lcg.nextInt(-1, 1);
    }
  }
  return data;
}

function genClayrockLayer(pal: RGBA[], seed: number): TextureData {
  const data = createEmptyTexture();
  const lcg = new LCG(seed);
  fillSolid(data, pal[2]!);

  // Wrap-aware horizontal strata / banded streaks
  for (let y = 0; y < 16; y++) {
    // Symmetrical strata index around y = 8 so y=0 and y=15 match smoothly
    const bandIdx = Math.floor(Math.abs(y - 7.5) / 2) % pal.length;
    const baseColor = pal[bandIdx]!;
    for (let x = 0; x < 16; x++) {
      let col = baseColor;
      if (lcg.nextFloat() < 0.2) {
        col = pal[(bandIdx + 1) % pal.length]!;
      } else if (lcg.nextFloat() < 0.08) {
        col = pal[0]!; // darkest streak
      }
      setPixel(data, x, y, col);
    }
  }
  // Guarantee darkest to lightest contrast seamlessly at all 4 corners
  setPixel(data, 0, 0, pal[0]!);
  setPixel(data, 15, 0, pal[0]!);
  setPixel(data, 0, 15, pal[0]!);
  setPixel(data, 15, 15, pal[0]!);

  setPixel(data, 1, 0, pal[pal.length - 1]!);
  setPixel(data, 14, 0, pal[pal.length - 1]!);
  setPixel(data, 1, 15, pal[pal.length - 1]!);
  setPixel(data, 14, 15, pal[pal.length - 1]!);
  return data;
}

export function genClayrockWhite(seed: number = 10001): TextureData {
  return genClayrockLayer(PAL_CLAYROCK_WHITE, seed);
}

export function genClayrockLightGray(seed: number = 10002): TextureData {
  return genClayrockLayer(PAL_CLAYROCK_LIGHT_GRAY, seed);
}

export function genClayrockYellow(seed: number = 10003): TextureData {
  return genClayrockLayer(PAL_CLAYROCK_YELLOW, seed);
}

export function genClayrockOrange(seed: number = 10004): TextureData {
  return genClayrockLayer(PAL_CLAYROCK_ORANGE, seed);
}

export function genClayrockTerracotta(seed: number = 10005): TextureData {
  return genClayrockLayer(PAL_CLAYROCK_TERRACOTTA, seed);
}

export function genClayrockRed(seed: number = 10006): TextureData {
  return genClayrockLayer(PAL_CLAYROCK_RED, seed);
}

export function genClayrockBrown(seed: number = 10007): TextureData {
  return genClayrockLayer(PAL_CLAYROCK_BROWN, seed);
}

export function genClayrockDarkBrown(seed: number = 10008): TextureData {
  return genClayrockLayer(PAL_CLAYROCK_DARK_BROWN, seed);
}
