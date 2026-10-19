import { createEmptyTexture, hexToRgb, setPixel, type RGBA } from './noise';

export const PAL_BED: RGBA[] = [
  [43, 31, 39, 255],
  [103, 48, 47, 255],
  [169, 65, 65, 255],
  [218, 116, 108, 255],
  [246, 188, 153, 255],
  [103, 76, 53, 255],
  [164, 125, 76, 255],
  [207, 175, 116, 255],
];

function genBedTop(head: boolean, seed = 42): Uint8Array {
  const tile = createEmptyTexture();
  const salt = (seed >>> 0) % 4;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      let color = y < 3 || y > 12 ? PAL_BED[2]! : PAL_BED[3]!;
      if (y === 3 || y === 12) color = PAL_BED[4]!;
      if (y >= 4 && y <= 11) {
        color = (x + salt) % 4 < 2 ? PAL_BED[4]! : PAL_BED[3]!;
        if ((x + y + salt) % 8 === 0) color = PAL_BED[2]!;
      }
      if (head && y >= 4 && y <= 7 && x >= 2 && x <= 13) {
        color = y === 4 || y === 7 || x === 2 || x === 13 ? PAL_BED[4]! : PAL_BED[3]!;
      }
      setPixel(tile, x, y, color);
    }
  return tile;
}

export function genBedFootTop(seed?: number): Uint8Array {
  return genBedTop(false, seed);
}

export function genBedHeadTop(seed?: number): Uint8Array {
  return genBedTop(true, seed);
}

export function genBedSide(seed = 42): Uint8Array {
  const tile = createEmptyTexture();
  const offset = (seed >>> 0) % 4;
  const grain = [PAL_BED[5]!, PAL_BED[6]!, PAL_BED[7]!, PAL_BED[6]!];
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const color = grain[(x + y + offset) % 4]!;
      setPixel(tile, x, y, color);
    }
  return tile;
}

export function genBedItem(seed = 42): Uint8Array {
  const tile = createEmptyTexture();
  const linen = [PAL_BED[2]!, PAL_BED[3]!, PAL_BED[4]!];
  const shift = (seed >>> 0) % 3;
  for (let y = 3; y <= 12; y++)
    for (let x = 2; x <= 13; x++) {
      const edge = y === 3 || y === 12 || x === 2 || x === 13;
      const wood = y >= 10;
      setPixel(
        tile,
        x,
        y,
        wood ? PAL_BED[5 + ((x + shift) % 3)]! : edge ? linen[0]! : linen[1 + ((x + y) % 2)]!,
      );
    }
  return tile;
}

export const BED_ITEM_PALETTE: RGBA[] = [
  [0, 0, 0, 0],
  ...['#a94141', '#da746c', '#f6bc99', '#674c35', '#a47d4c', '#cfaf74'].map((color) =>
    hexToRgb(color),
  ),
];
