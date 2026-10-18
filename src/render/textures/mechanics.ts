import { createEmptyTexture, setPixel, type RGBA, type TextureData } from './noise';

// Pistons, Dispenser and Note Block. Light comes from the top-left: every ramp's lighter shades
// sit on top/left edges and its darker shades on bottom/right edges.
const STONE: RGBA[] = [
  [32, 35, 42, 255],
  [66, 71, 78, 255],
  [104, 111, 119, 255],
  [148, 153, 156, 255],
  [191, 191, 180, 255],
];
const WOOD: RGBA[] = [
  [43, 29, 21, 255],
  [79, 51, 30, 255],
  [122, 81, 44, 255],
  [167, 118, 65, 255],
  [209, 165, 99, 255],
];
const IRON: RGBA[] = [
  [60, 48, 44, 255],
  [143, 115, 95, 255],
  [184, 154, 134, 255],
  [217, 190, 168, 255],
];
const RESIN: RGBA[] = [
  [30, 52, 40, 255],
  [56, 104, 70, 255],
  [86, 150, 90, 255],
  [140, 196, 120, 255],
  [196, 230, 160, 255],
];
const COPPER: RGBA[] = [
  [83, 49, 34, 255],
  [153, 85, 48, 255],
  [186, 108, 55, 255],
  [226, 153, 82, 255],
];

function rect(tile: TextureData, x0: number, y0: number, x1: number, y1: number, color: RGBA) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setPixel(tile, x, y, color);
}

/**
 * Beveled stone frame shared by every piston and dispenser face: a dark outline whose opposite
 * edges match so the tile wraps, then a bevel lit from the top-left.
 */
function stoneFrame(tile: TextureData, width: number): void {
  rect(tile, 0, 0, 15, 15, STONE[2]!);
  rect(tile, 1, 1, 14, width, STONE[3]!);
  rect(tile, 1, 1, width, 14, STONE[3]!);
  rect(tile, 1, 15 - width, 14, 14, STONE[1]!);
  rect(tile, 15 - width, 1, 14, 14, STONE[1]!);
  rect(tile, 0, 0, 15, 0, STONE[0]!);
  rect(tile, 0, 15, 15, 15, STONE[0]!);
  rect(tile, 0, 0, 0, 15, STONE[0]!);
  rect(tile, 15, 0, 15, 15, STONE[0]!);
}

function pick(seed: number, span: number, salt: number): number {
  return ((seed >>> 0) + salt * 2654435761) % span;
}

export function genPistonSide(seed = 15101): TextureData {
  const tile = createEmptyTexture();
  stoneFrame(tile, 1);
  // A riveted iron band wraps the body.
  rect(tile, 1, 5, 14, 10, IRON[1]!);
  rect(tile, 1, 5, 14, 5, IRON[3]!);
  rect(tile, 1, 6, 14, 6, IRON[2]!);
  rect(tile, 1, 10, 14, 10, IRON[0]!);
  for (const x of [3, 7, 11]) {
    rect(tile, x, 7, x + 1, 8, IRON[2]!);
    setPixel(tile, x + 1, 8, IRON[0]!);
  }
  setPixel(tile, 2 + pick(seed, 10, 1), 2, STONE[4]!);
  setPixel(tile, 2 + pick(seed, 10, 2), 13, STONE[0]!);
  return tile;
}

function plateFace(tile: TextureData, plate: readonly RGBA[], seed: number): void {
  stoneFrame(tile, 2);
  rect(tile, 2, 2, 13, 13, plate[2]!);
  for (const y of [5, 9]) rect(tile, 2, y, 13, y, plate[0]!);
  for (const [y, shift] of [
    [2, 0],
    [6, 5],
    [10, 2],
  ] as const) {
    rect(tile, 2, y, 13, y, plate[4]!);
    rect(tile, 2 + shift, y + 1, 3 + shift, y + 2, plate[3]!);
  }
  rect(tile, 2, 13, 13, 13, plate[1]!);
  setPixel(tile, 4 + pick(seed, 8, 3), 4, plate[4]!);
}

export function genPistonFront(seed = 15102): TextureData {
  const tile = createEmptyTexture();
  plateFace(tile, WOOD, seed);
  return tile;
}

export function genStickyPistonFront(seed = 15103): TextureData {
  const tile = createEmptyTexture();
  plateFace(tile, RESIN, seed);
  // Resin pools in blobs over the plate.
  rect(tile, 4, 4, 6, 5, RESIN[3]!);
  setPixel(tile, 4, 4, RESIN[4]!);
  rect(tile, 9, 8, 12, 10, RESIN[3]!);
  setPixel(tile, 9, 8, RESIN[4]!);
  rect(tile, 10, 11, 11, 12, RESIN[1]!);
  return tile;
}

function openFace(tile: TextureData, smear: readonly RGBA[] | null, seed: number): void {
  stoneFrame(tile, 2);
  rect(tile, 3, 3, 12, 12, STONE[0]!);
  // A seed-placed chip in the recess keeps the tile deterministic but not identical across seeds.
  setPixel(tile, 3 + pick(seed, 8, 1), 10 + pick(seed, 2, 3), STONE[1]!);
  rect(tile, 3, 3, 12, 3, STONE[1]!);
  rect(tile, 3, 3, 3, 12, STONE[1]!);
  rect(tile, 6, 6, 9, 9, IRON[1]!);
  rect(tile, 6, 6, 9, 6, IRON[3]!);
  rect(tile, 6, 6, 6, 9, IRON[2]!);
  rect(tile, 9, 7, 9, 9, IRON[0]!);
  rect(tile, 7, 9, 9, 9, IRON[0]!);
  if (smear) {
    rect(tile, 4, 4, 11, 4, smear[2]!);
    rect(tile, 4, 11, 11, 11, smear[1]!);
    rect(tile, 4, 5, 4, 10, smear[2]!);
    rect(tile, 11, 5, 11, 10, smear[1]!);
    setPixel(tile, 5, 4, smear[4]!);
    setPixel(tile, 4, 5, smear[3]!);
  }
}

export function genPistonFrontOpen(seed = 15108): TextureData {
  const tile = createEmptyTexture();
  openFace(tile, null, seed);
  return tile;
}

export function genStickyPistonFrontOpen(seed = 15109): TextureData {
  const tile = createEmptyTexture();
  openFace(tile, RESIN, seed);
  return tile;
}

/** Iron rod and plate-back: vertical highlight on the left, shade on the right, dark joints. */
export function genPistonShaft(seed = 15104): TextureData {
  const tile = createEmptyTexture();
  rect(tile, 0, 0, 15, 15, IRON[1]!);
  rect(tile, 0, 0, 15, 0, IRON[0]!);
  rect(tile, 0, 15, 15, 15, IRON[0]!);
  for (const x of [1, 6, 11]) {
    rect(tile, x, 1, x + 1, 14, IRON[2]!);
    rect(tile, x, 1, x, 14, IRON[3]!);
    rect(tile, x + 2, 1, x + 2, 14, IRON[0]!);
  }
  for (const y of [4, 11]) rect(tile, 0, y, 15, y, IRON[0]!);
  setPixel(tile, 3 + pick(seed, 9, 4), 2, IRON[3]!);
  return tile;
}

export function genDispenserSide(seed = 15105): TextureData {
  const tile = createEmptyTexture();
  rect(tile, 0, 0, 15, 15, STONE[2]!);
  // Three courses of rounded stones with 1-pixel mortar.
  for (const [y0, offset] of [
    [0, 0],
    [5, 4],
    [10, 2],
  ] as const) {
    rect(tile, 0, y0 + 4, 15, y0 + 4, STONE[0]!);
    for (let x = offset; x < 16 + offset; x += 8) {
      const left = x % 16;
      rect(tile, left, y0, left, y0 + 3, STONE[0]!);
      rect(tile, left + 1, y0, left + 6 > 15 ? 15 : left + 6, y0, STONE[3]!);
      rect(tile, left + 1, y0 + 1, left + 1, y0 + 3, STONE[3]!);
      rect(
        tile,
        left + 5 > 15 ? 15 : left + 5,
        y0 + 2,
        left + 6 > 15 ? 15 : left + 6,
        y0 + 3,
        STONE[1]!,
      );
    }
  }
  setPixel(tile, 2 + pick(seed, 10, 5), 2, STONE[4]!);
  return tile;
}

export function genDispenserTop(seed = 15110): TextureData {
  const tile = createEmptyTexture();
  stoneFrame(tile, 1);
  rect(tile, 4, 4, 11, 11, STONE[1]!);
  rect(tile, 5, 5, 10, 10, STONE[0]!);
  rect(tile, 4, 4, 11, 4, COPPER[3]!);
  rect(tile, 4, 4, 4, 11, COPPER[2]!);
  rect(tile, 4, 11, 11, 11, COPPER[0]!);
  rect(tile, 11, 4, 11, 11, COPPER[1]!);
  setPixel(tile, 5, 5, STONE[3]!);
  setPixel(tile, 2 + pick(seed, 12, 8), 13, STONE[3]!);
  return tile;
}

export function genDispenserFront(seed = 15111): TextureData {
  const tile = createEmptyTexture();
  stoneFrame(tile, 2);
  // A copper-lined barrel mouth.
  rect(tile, 4, 4, 11, 11, COPPER[1]!);
  rect(tile, 4, 4, 11, 4, COPPER[3]!);
  rect(tile, 4, 4, 4, 11, COPPER[2]!);
  rect(tile, 5, 5, 10, 10, STONE[0]!);
  rect(tile, 6, 6, 9, 9, STONE[1]!);
  rect(tile, 7, 7, 8, 8, STONE[0]!);
  rect(tile, 5, 5, 10, 5, STONE[1]!);
  setPixel(tile, 2 + pick(seed, 12, 9), 13, STONE[3]!);
  return tile;
}

function planks(tile: TextureData, seed: number): void {
  rect(tile, 0, 0, 15, 15, WOOD[2]!);
  for (const y of [0, 4, 8, 12]) {
    rect(tile, 0, y, 15, y, WOOD[3]!);
    rect(tile, 0, y + 3, 15, y + 3, y === 12 ? WOOD[3]! : WOOD[0]!);
    rect(tile, 3 + ((y * 5) % 8), y + 1, 6 + ((y * 5) % 8), y + 1, WOOD[1]!);
  }
  for (const [x, y] of [
    [2, 0],
    [11, 4],
    [6, 8],
    [13, 12],
  ] as const)
    rect(tile, x, y, x, y + 3, WOOD[1]!);
  setPixel(tile, pick(seed, 13, 6), 2, WOOD[4]!);
}

export function genNoteBlockSide(seed = 15106): TextureData {
  const tile = createEmptyTexture();
  planks(tile, seed);
  // A copper note glyph inlaid in the middle: two heads on a bar.
  rect(tile, 5, 4, 12, 5, COPPER[2]!);
  rect(tile, 5, 4, 12, 4, COPPER[3]!);
  rect(tile, 5, 6, 5, 10, COPPER[1]!);
  rect(tile, 12, 6, 12, 9, COPPER[1]!);
  rect(tile, 3, 10, 5, 11, COPPER[2]!);
  rect(tile, 10, 9, 12, 10, COPPER[2]!);
  setPixel(tile, 3, 10, COPPER[3]!);
  setPixel(tile, 10, 9, COPPER[3]!);
  setPixel(tile, 5, 11, COPPER[0]!);
  setPixel(tile, 12, 10, COPPER[0]!);
  return tile;
}

export function genNoteBlockTop(seed = 15107): TextureData {
  const tile = createEmptyTexture();
  planks(tile, seed);
  rect(tile, 4, 4, 11, 11, COPPER[1]!);
  rect(tile, 4, 4, 11, 4, COPPER[3]!);
  rect(tile, 4, 4, 4, 11, COPPER[2]!);
  rect(tile, 5, 5, 10, 10, WOOD[0]!);
  rect(tile, 6, 6, 9, 9, WOOD[1]!);
  setPixel(tile, 6, 6, WOOD[2]!);
  return tile;
}

export const MECHANICS_PALETTES = {
  pistonSide: [...STONE, IRON[0]!, IRON[1]!, IRON[2]!, IRON[3]!],
  pistonFront: [...STONE, ...WOOD],
  stickyPistonFront: [...STONE, ...RESIN],
  pistonOpen: [...STONE, IRON[0]!, IRON[1]!, IRON[2]!, IRON[3]!],
  stickyPistonOpen: [...STONE.slice(0, 4), ...IRON, RESIN[1]!, RESIN[2]!, RESIN[3]!, RESIN[4]!],
  pistonShaft: IRON,
  dispenser: [...STONE, COPPER[0]!, COPPER[1]!, COPPER[2]!, COPPER[3]!],
  noteBlock: [...WOOD, COPPER[0]!, COPPER[1]!, COPPER[2]!, COPPER[3]!],
};
