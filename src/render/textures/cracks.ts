import { LCG, createEmptyTexture, setPixel, type RGBA, type TextureData } from './noise';
export const CRACK_PALETTE: RGBA[] = [
  [0, 0, 0, 0],
  [27, 24, 33, 230],
  [66, 54, 49, 210],
  [135, 113, 84, 160],
];
/** Ten nested branching fractures. Wrap-aware strokes continue across tile edges. */
export function genCracks(seed = 42): TextureData[] {
  const rng = new LCG(seed),
    paths: Array<[number, number]> = [];
  for (let branch = 0; branch < 12; branch++) {
    let x = 8,
      y = 8;
    const angle = (branch * Math.PI) / 6 + rng.nextFloat() * 0.3;
    for (let step = 0; step < 12; step++) {
      x += Math.cos(angle) + (rng.nextFloat() - 0.5) * 0.8;
      y += Math.sin(angle) + (rng.nextFloat() - 0.5) * 0.8;
      paths.push([Math.round(x) & 15, Math.round(y) & 15]);
    }
  }
  return Array.from({ length: 10 }, (_, stage) => {
    const tile = createEmptyTexture();
    for (let branch = 0; branch <= stage + 2; branch++)
      for (let step = 0; step <= stage + 1; step++) {
        const [x, y] = paths[branch * 12 + step]!;
        setPixel(tile, (x + 15) & 15, (y + 15) & 15, CRACK_PALETTE[3]!);
        setPixel(tile, x, y, CRACK_PALETTE[1]!);
        if (stage >= 6) setPixel(tile, (x + 1) & 15, y, CRACK_PALETTE[2]!);
      }
    return tile;
  });
}
