import { createEmptyTexture, fillSolid, hexToRgb, LCG, setPixel, type TextureData } from './noise';

export const PAL_BLACKGLASS = ['#11151d', '#242d39', '#3a4755', '#596979', '#8595a3'].map((h) =>
  hexToRgb(h),
);

/** Dark cooled-glass facets with short upper-left glints; all strokes wrap at tile edges. */
export function genBlackglass(seed = 8128): TextureData {
  const tile = createEmptyTexture();
  const rng = new LCG(seed);
  fillSolid(tile, PAL_BLACKGLASS[1]!);
  for (let facet = 0; facet < 10; facet++) {
    const x = rng.nextInt(0, 15),
      y = rng.nextInt(0, 15);
    const width = rng.nextInt(3, 6),
      height = rng.nextInt(2, 4);
    for (let v = 0; v < height; v++) {
      for (let u = 0; u < width - v; u++) {
        const tone = v === 0 ? (u < 2 ? 4 : 3) : u === width - v - 1 ? 0 : 2;
        setPixel(tile, (x + u) & 15, (y + v) & 15, PAL_BLACKGLASS[tone]!);
      }
    }
  }
  return tile;
}
