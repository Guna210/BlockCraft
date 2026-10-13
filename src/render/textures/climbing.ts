import { LCG, createEmptyTexture, setPixel, type RGBA, type TextureData } from './noise';

export const PAL_LADDER: RGBA[] = [
  [0, 0, 0, 0],
  [53, 39, 29, 255],
  [106, 73, 42, 255],
  [168, 119, 60, 255],
  [229, 181, 106, 255],
];
// Neutral leaf ramp is multiplied by the existing biome foliage tint.
export const PAL_VINE: RGBA[] = [
  [0, 0, 0, 0],
  [37, 45, 50, 255],
  [80, 88, 91, 255],
  [132, 140, 134, 255],
  [202, 208, 180, 255],
];
export function genLadder(seed = 42): TextureData {
  const tile = createEmptyTexture();
  for (let y = 0; y < 16; y++)
    for (const x of [2, 12]) {
      setPixel(tile, x, y, PAL_LADDER[4]!);
      setPixel(tile, x + 1, y, PAL_LADDER[3]!);
      setPixel(tile, x + 2, y, PAL_LADDER[1]!);
    }
  for (const y of [2, 6, 10, 14])
    for (let x = 3; x <= 13; x++) {
      setPixel(tile, x, y, PAL_LADDER[4]!);
      setPixel(tile, x, y + 1, PAL_LADDER[x === 13 ? 1 : 2]!);
    }
  const rng = new LCG(seed);
  for (const x of [3, 13]) {
    const start = rng.nextInt(0, 15);
    for (let dy = 0; dy < 3; dy++) setPixel(tile, x, (start + dy) & 15, PAL_LADDER[2]!);
  }
  return tile;
}
export function genVine(seed = 42): TextureData {
  const tile = createEmptyTexture();
  for (let y = 0; y < 16; y++) {
    const x = 7 + (y >= 4 && y < 12 ? 1 : 0);
    setPixel(tile, x, y, PAL_VINE[3]!);
    setPixel(tile, x + 1, y, PAL_VINE[1]!);
  }
  const phase = new LCG(seed).nextInt(0, 3);
  for (const baseY of [0, 4, 8, 12])
    for (const side of [-1, 1]) {
      const y = baseY + phase;
      const x = side < 0 ? 3 : 10;
      for (let row = 0; row < 3; row++)
        for (let col = 0; col < 3; col++) {
          if ((row === 0 && col === 2) || (row === 2 && col === 0)) continue;
          setPixel(tile, x + col, (y + row) & 15, PAL_VINE[row === 0 ? 4 : col === 2 ? 1 : 2]!);
        }
      setPixel(tile, side < 0 ? 6 : 9, (y + 2) & 15, PAL_VINE[3]!);
    }
  return tile;
}
