import { createEmptyTexture, setPixel, type RGBA, type TextureData } from './noise';

/** Mauve pressed spore cakes in a copper cage, with a cream three-lobed seal. */
export const BLAST_PALETTE: RGBA[] = [
  [39, 27, 43, 255],
  [78, 43, 75, 255],
  [129, 72, 115, 255],
  [183, 118, 147, 255],
  [99, 57, 33, 255],
  [192, 118, 56, 255],
  [245, 201, 129, 255],
  [238, 222, 183, 255],
];
export function genBlastCharge(seed = 42, top = false): TextureData {
  const tile = createEmptyTexture();
  const shift = (seed >>> 0) % 4;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      let c = 1 + ((Math.floor((x + shift) / 4) + Math.floor(y / 4)) % 3);
      if (x % 8 === 0 || y % 8 === 0) c = 4;
      if (x % 8 === 1 || y % 8 === 1) c = 6;
      if (x % 8 === 2 || y % 8 === 2) c = 5;
      if (x >= 5 && x <= 10 && y >= 5 && y <= 10) c = 0;
      if (
        top
          ? (x === 7 || x === 8) && y >= 5 && y <= 9
          : (y === 6 && x >= 6 && x <= 9) || (y >= 7 && y <= 9 && (x === 6 || x === 9))
      )
        c = 7;
      setPixel(tile, x, y, BLAST_PALETTE[c]!);
    }
  return tile;
}
