import { LCG, createEmptyTexture, setPixel, type RGBA, type TextureData } from './noise';

export const PAL_TORCH: RGBA[] = [
  [0, 0, 0, 0],
  [51, 32, 28, 255],
  [112, 67, 38, 255],
  [193, 133, 64, 255],
  [201, 65, 23, 255],
  [245, 151, 43, 255],
  [255, 228, 135, 255],
];

/** A narrow standing shaft and a clustered teardrop flame, lit from the upper left. */
export function genTorch(seed = 31791): TextureData {
  const tile = createEmptyTexture();
  const rng = new LCG(seed);
  const lean = rng.nextInt(-1, 1);
  for (let y = 7; y < 16; y++)
    for (let x = 7; x <= 9; x++) {
      setPixel(tile, x, y, PAL_TORCH[x === 7 ? 3 : x === 9 ? 1 : 2]!);
    }
  for (let y = 2; y <= 8; y++) {
    const left = y < 4 ? 8 : y < 7 ? 6 : 7;
    const right = y < 4 ? 8 : y < 7 ? 10 : 9;
    for (let x = left; x <= right; x++)
      setPixel(
        tile,
        x + (y < 5 ? lean : 0),
        y,
        PAL_TORCH[x <= 8 && y <= 6 ? 6 : x === right ? 4 : 5]!,
      );
  }
  return tile;
}
