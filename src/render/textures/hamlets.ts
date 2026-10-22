import { createEmptyTexture, LCG, setPixel, type RGBA, type TextureData } from './noise';

export const PAL_FARMLAND: RGBA[] = [
  [75, 50, 30, 255],
  [108, 73, 42, 255],
  [145, 101, 59, 255],
  [188, 147, 91, 255],
  [94, 66, 39, 255],
];

const CROP_CLEAR: RGBA = [0, 0, 0, 0];
const CROP_TRANSPARENT_GREEN: RGBA = [91, 151, 53, 0];
export const PAL_WHEAT_CROP: RGBA[] = [
  CROP_CLEAR,
  [57, 111, 43, 255],
  [91, 151, 53, 255],
  [135, 178, 62, 255],
  [182, 170, 58, 255],
  [216, 190, 78, 255],
  [238, 207, 103, 255],
  [112, 78, 35, 255],
  CROP_TRANSPARENT_GREEN,
];

export function genFarmlandTop(seed = 0): TextureData {
  const texture = createEmptyTexture();
  const rng = new LCG(seed);
  const base = PAL_FARMLAND[2]!;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const furrow = y === 3 || y === 4 || y === 10 || y === 11;
      const fleck = x > 0 && x < 15 && y > 0 && y < 15 && rng.nextFloat() < 0.07;
      setPixel(texture, x, y, furrow ? PAL_FARMLAND[0]! : fleck ? PAL_FARMLAND[3]! : base);
    }
  }
  return texture;
}

export function genFarmlandSide(seed = 0): TextureData {
  const texture = createEmptyTexture();
  const rng = new LCG(seed);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const lip = y < 3 || y >= 13;
      const color = lip
        ? PAL_FARMLAND[0]!
        : x > 0 && x < 15 && rng.nextFloat() < 0.08
          ? PAL_FARMLAND[3]!
          : PAL_FARMLAND[1]!;
      setPixel(texture, x, y, color);
    }
  }
  return texture;
}

function line(
  texture: TextureData,
  from: readonly [number, number],
  to: readonly [number, number],
  color: RGBA,
): void {
  const dx = Math.sign(to[0] - from[0]);
  const dy = Math.sign(to[1] - from[1]);
  const length = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
  for (let step = 0; step <= length; step++)
    setPixel(texture, from[0] + dx * step, from[1] + dy * step, color);
}

export function genWheatCrop(age: number, seed = 0): TextureData {
  const texture = createEmptyTexture();
  const rng = new LCG(seed);
  for (let i = 0; i < 256; i++) {
    texture[i * 4] = PAL_WHEAT_CROP[2]![0];
    texture[i * 4 + 1] = PAL_WHEAT_CROP[2]![1];
    texture[i * 4 + 2] = PAL_WHEAT_CROP[2]![2];
    texture[i * 4 + 3] = 0;
  }
  const height = 3 + Math.round((age / 7) * 11);
  const foot = 15;
  const top = foot - height;
  const stalk = age >= 6 ? PAL_WHEAT_CROP[4]! : PAL_WHEAT_CROP[2]!;
  line(texture, [8, foot], [8, top], stalk);
  setPixel(texture, 8, 15, PAL_WHEAT_CROP[7]!);
  setPixel(texture, 6, 14, PAL_WHEAT_CROP[3]!);
  if (height >= 5) {
    line(texture, [8, foot - 2], [5, foot - 4], PAL_WHEAT_CROP[1]!);
    line(texture, [8, foot - 3], [11, foot - 5], PAL_WHEAT_CROP[2]!);
  }
  if (height >= 8) {
    line(texture, [8, foot - 5], [4, foot - 7], PAL_WHEAT_CROP[2]!);
    line(texture, [8, foot - 6], [12, foot - 8], PAL_WHEAT_CROP[3]!);
  }
  if (age >= 5) {
    for (let y = Math.max(0, top - 2); y <= top + 2; y++) {
      setPixel(texture, 7, y, PAL_WHEAT_CROP[5]!);
      setPixel(texture, 8, y, PAL_WHEAT_CROP[6]!);
      if ((y + age) % 2 === 0) setPixel(texture, 9, y, PAL_WHEAT_CROP[4]!);
    }
    setPixel(texture, 6, top, PAL_WHEAT_CROP[7]!);
    setPixel(texture, 10, top + 1, PAL_WHEAT_CROP[7]!);
  }
  if (age === 0) {
    setPixel(texture, 7, 13, PAL_WHEAT_CROP[2]!);
    setPixel(texture, 9, 14, PAL_WHEAT_CROP[1]!);
    line(texture, [8, 14], [4, 12], PAL_WHEAT_CROP[2]!);
    line(texture, [8, 14], [12, 11], PAL_WHEAT_CROP[3]!);
    line(texture, [8, 13], [7, 10], PAL_WHEAT_CROP[1]!);
    line(texture, [8, 13], [9, 10], PAL_WHEAT_CROP[2]!);
  }
  const leafColor = age >= 5 ? PAL_WHEAT_CROP[5]! : PAL_WHEAT_CROP[3]!;
  for (let fleck = 0; fleck < 4; fleck++) {
    const x = 4 + rng.nextInt(0, 8);
    const y = Math.max(top, 8) + rng.nextInt(0, Math.max(0, 15 - Math.max(top, 8)));
    setPixel(texture, x, y, leafColor);
  }
  return texture;
}
