import {
  createEmptyTexture,
  fillSolid,
  hexToRgb,
  setPixel,
  type RGBA,
  type TextureData,
} from './noise';

export const PAL_CHEST: RGBA[] = [
  hexToRgb('#2d1b13'),
  hexToRgb('#4b2b1b'),
  hexToRgb('#704126'),
  hexToRgb('#986033'),
  hexToRgb('#bf8650'),
  hexToRgb('#dfad69'),
  hexToRgb('#ead3a4'),
];

function boardTexture(seed: number, vertical: boolean, top: boolean): TextureData {
  const data = createEmptyTexture();
  fillSolid(data, PAL_CHEST[2]!);
  const shift = (seed >>> 2) & 3;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const along = vertical ? y : x;
      const across = vertical ? x : y;
      let color = PAL_CHEST[2]!;
      if (across === 0 || across === 15 || along === 0 || along === 15) color = PAL_CHEST[2]!;
      else if (across === 1 || along === 1) color = PAL_CHEST[4]!;
      else if (across === 14 || along === 14) color = PAL_CHEST[1]!;
      else if ((across + shift) % 4 === 0) color = PAL_CHEST[1]!;
      else if ((across + shift) % 4 === 1) color = PAL_CHEST[3]!;
      else if ((along + shift) % 7 === 2) color = PAL_CHEST[4]!;
      if (top && x >= 6 && x <= 9 && y >= 6 && y <= 10) {
        color =
          y === 6 || y === 10 ? PAL_CHEST[1]! : x === 7 || x === 8 ? PAL_CHEST[5]! : PAL_CHEST[3]!;
      }
      if ((x === 1 || y === 1) && !top) color = PAL_CHEST[4]!;
      if ((x === 14 || y === 14) && !top) color = PAL_CHEST[1]!;
      setPixel(data, x, y, color);
    }
  }
  return data;
}

/** Top boards framed by a low rim and a compact pale latch. */
export function genChestTop(seed = 8201): TextureData {
  return boardTexture(seed, false, true);
}

/** Side boards have a dark central seam and a small metal clasp. */
export function genChestSide(seed = 8202): TextureData {
  const data = boardTexture(seed, true, false);
  for (let y = 6; y <= 9; y++) {
    setPixel(data, 7, y, PAL_CHEST[0]!);
    setPixel(data, 8, y, PAL_CHEST[5]!);
  }
  setPixel(data, 7, 6, PAL_CHEST[6]!);
  setPixel(data, 8, 6, PAL_CHEST[6]!);
  return data;
}

/** Underside planks keep the same chest wood ramp without a latch. */
export function genChestBottom(seed = 8203): TextureData {
  return boardTexture(seed, false, false);
}
