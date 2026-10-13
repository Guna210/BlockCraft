import { LCG, createEmptyTexture, setPixel, type RGBA, type TextureData } from './noise';

export const PAL_PLAYER_HEAD: RGBA[] = [
  [52, 43, 57, 255],
  [117, 74, 64, 255],
  [181, 122, 85, 255],
  [230, 175, 124, 255],
  [249, 212, 161, 255],
];
export const PAL_PLAYER_COAT: RGBA[] = [
  [57, 40, 55, 255],
  [112, 57, 52, 255],
  [169, 86, 53, 255],
  [222, 144, 81, 255],
  [250, 202, 132, 255],
  [23, 65, 74, 255],
  [51, 128, 127, 255],
  [145, 216, 183, 255],
];
export const PAL_PLAYER_LEG: RGBA[] = [
  [28, 32, 47, 255],
  [59, 64, 83, 255],
  [97, 111, 129, 255],
  [161, 169, 176, 255],
  [213, 213, 199, 255],
];
function base(palette: RGBA[], seed: number): TextureData {
  const tile = createEmptyTexture();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) setPixel(tile, x, y, palette[2]!);
  const rng = new LCG(seed);
  // Small folded cloth/skin clusters, avoiding a rectangular border around every repeat.
  for (let i = 0; i < 8; i++) {
    const x = rng.nextInt(2, 11),
      y = rng.nextInt(2, 11);
    for (let dy = 0; dy < 3; dy++)
      for (let dx = 0; dx < 3; dx++)
        setPixel(tile, x + dx, y + dy, palette[dx === 0 || dy === 0 ? 4 : dx === 2 ? 0 : 3]!);
  }
  return tile;
}
/** Copper jacket with an asymmetric sea-green shoulder sash; original expedition outfit. */
export function genPlayerCoat(seed = 42): TextureData {
  const tile = base(PAL_PLAYER_COAT, seed);
  for (let y = 2; y < 14; y++) {
    const x = 3 + Math.floor(y / 3);
    setPixel(tile, x, y, PAL_PLAYER_COAT[7]!);
    setPixel(tile, x + 1, y, PAL_PLAYER_COAT[6]!);
    setPixel(tile, x + 2, y, PAL_PLAYER_COAT[5]!);
  }
  for (let x = 9; x <= 12; x++)
    for (let y = 10; y <= 12; y++) setPixel(tile, x, y, PAL_PLAYER_COAT[y === 10 ? 3 : 1]!);
  return tile;
}
export function genPlayerHead(seed = 42): TextureData {
  const tile = base(PAL_PLAYER_HEAD, seed);
  // Broad swept hair and a two-pixel eye stripe; highlights remain clustered.
  for (const y of [0, 1, 2, 3, 4, 15])
    for (let x = 0; x < 16; x++)
      setPixel(tile, x, y, PAL_PLAYER_HEAD[x >= 2 && x < 5 && (y < 3 || y === 15) ? 1 : 0]!);
  for (const x of [4, 10])
    for (let dx = 0; dx < 2; dx++) setPixel(tile, x + dx, 7, PAL_PLAYER_HEAD[0]!);
  for (let x = 6; x <= 9; x++) setPixel(tile, x, 12, PAL_PLAYER_HEAD[1]!);
  return tile;
}
export function genPlayerLeg(seed = 42): TextureData {
  const tile = base(PAL_PLAYER_LEG, seed);
  for (let y = 3; y < 12; y++) {
    setPixel(tile, 4, y, PAL_PLAYER_LEG[3]!);
    setPixel(tile, 5, y, PAL_PLAYER_LEG[1]!);
  }
  for (const y of [0, 12, 13, 14, 15])
    for (let x = 0; x < 16; x++) setPixel(tile, x, y, PAL_PLAYER_LEG[y === 12 && x < 12 ? 3 : 0]!);
  return tile;
}

/** Wrap-aware swept hair clumps for the back and sides; no facial marks. */
export function genPlayerHair(seed = 42): TextureData {
  const tile = createEmptyTexture();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) setPixel(tile, x, y, PAL_PLAYER_HEAD[0]!);
  const shift = new LCG(seed).nextInt(0, 3);
  for (const x of [1, 6, 11])
    for (let y = 0; y < 16; y++) {
      const offset = (x + shift + Math.floor(Math.min(y, 15 - y) / 4)) & 15;
      setPixel(tile, offset, y, PAL_PLAYER_HEAD[y % 4 === 0 || y === 15 ? 3 : 1]!);
      setPixel(tile, (offset + 1) & 15, y, PAL_PLAYER_HEAD[1]!);
    }
  return tile;
}
