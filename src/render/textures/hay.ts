import { LCG, createEmptyTexture, setPixel, type RGBA, type TextureData } from './noise';

export const PAL_HAY: RGBA[] = [
  [51, 62, 23, 255],
  [104, 99, 32, 255],
  [160, 136, 48, 255],
  [209, 171, 78, 255],
  [246, 212, 136, 255],
];

/** Wrap-aware bundled straw strokes, with shaded olive binding bands on the sides. */
function hay(seed: number, bands: boolean): TextureData {
  const tile = createEmptyTexture();
  const rng = new LCG(seed);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) setPixel(tile, x, y, PAL_HAY[2]!);
  for (let bundle = 0; bundle < 32; bundle++) {
    const x = rng.nextInt(0, 15),
      y = rng.nextInt(0, 15),
      length = rng.nextInt(3, 7);
    for (let i = 0; i < length; i++) {
      setPixel(tile, x, (y + i) & 15, PAL_HAY[i === 0 ? 4 : 3]!);
      setPixel(tile, (x + 1) & 15, (y + i) & 15, PAL_HAY[i === length - 1 ? 0 : 1]!);
    }
  }
  if (bands)
    for (const y of [3, 11])
      for (let x = 0; x < 16; x++) {
        setPixel(tile, x, y, PAL_HAY[1]!);
        setPixel(tile, x, y + 1, PAL_HAY[0]!);
      }
  return tile;
}
export function genHayTop(seed = 42): TextureData {
  return hay(seed, false);
}
export function genHaySide(seed = 42): TextureData {
  return hay(seed, true);
}
