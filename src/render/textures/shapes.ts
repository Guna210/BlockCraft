// Doors and trapdoors (BLOCKS-shapes). Stairs and fences reuse the plank tiles; these tiles are
// drawn with rectangles on top of a plank-board base. Every tile keeps its outermost ring one flat
// colour, so it repeats without a seam, and uses its wood ramp (dark -> light) plus two iron
// shades for the handle (ART.md §1, light from the top-left).
import { createEmptyTexture, setPixel, hexToRgb, TextureData, RGBA } from './noise';
import { PAL_OAK_WOOD, PAL_BIRCH_WOOD, PAL_PINE_WOOD } from './wood';
import { PAL_RAINWOOD_WOOD, PAL_ACACIA_WOOD } from './wood-extra';

export const SHAPE_WOODS = ['oak', 'birch', 'pine', 'acacia', 'rainwood'] as const;
export type ShapeWood = (typeof SHAPE_WOODS)[number];
const WOOD_RAMPS: Record<ShapeWood, RGBA[]> = {
  oak: PAL_OAK_WOOD,
  birch: PAL_BIRCH_WOOD,
  pine: PAL_PINE_WOOD,
  acacia: PAL_ACACIA_WOOD,
  rainwood: PAL_RAINWOOD_WOOD,
};
const IRON_DARK = hexToRgb('#6a5748');
const IRON_LIGHT = hexToRgb('#d9bea8');
const CLEAR: RGBA = [0, 0, 0, 0];

export function shapePalette(wood: ShapeWood, sprite = false): RGBA[] {
  return [...WOOD_RAMPS[wood], IRON_DARK, IRON_LIGHT, ...(sprite ? [CLEAR] : [])];
}

type Painter = (x: number, y: number, c: RGBA) => void;
function rect(p: Painter, x0: number, y0: number, x1: number, y1: number, c: RGBA): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) p(x, y, c);
}
/** A recessed panel: shadow on its top and left rims, a highlight on the bottom and right. */
function panel(p: Painter, x0: number, y0: number, x1: number, y1: number, w: RGBA[]): void {
  rect(p, x0, y0, x1, y1, w[1]!);
  rect(p, x0, y0, x1, y0, w[0]!);
  rect(p, x0, y0, x0, y1, w[0]!);
  rect(p, x0, y1, x1, y1, w[3]!);
  rect(p, x1, y0, x1, y1, w[3]!);
  rect(p, x0, y0, x0, y0, w[0]!);
  rect(p, x1, y1, x1, y1, w[3]!);
  // Grain strokes inside the panel: short vertical runs of the mid shade.
  for (let x = x0 + 2; x < x1 - 1; x += 3) rect(p, x, y0 + 2, x, Math.min(y1 - 2, y0 + 5), w[2]!);
  for (let x = x0 + 3; x < x1 - 1; x += 4) rect(p, x, y0 + 7, x, y1 - 2, w[2]!);
}
function knob(p: Painter, x: number, y: number): void {
  p(x, y, IRON_LIGHT);
  p(x + 1, y, IRON_LIGHT);
  p(x, y + 1, IRON_DARK);
  p(x + 1, y + 1, IRON_DARK);
}
function mirrorX(data: TextureData): TextureData {
  const out = createEmptyTexture();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++)
      out.set(data.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4), (y * 16 + 15 - x) * 4);
  return out;
}
/** Scatters a few mid-shade grain flecks inside a rectangle; the seed picks where they land. */
function flecks(p: Painter, seed: number, x0: number, y0: number, x1: number, y1: number, c: RGBA) {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (let n = 0; n < 6; n++) {
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    p(x0 + (h % (x1 - x0 + 1)), y0 + ((h >>> 8) % (y1 - y0 + 1)), c);
  }
}
function paint(fn: (p: Painter) => void): TextureData {
  const data = createEmptyTexture();
  fn((x, y, c) => setPixel(data, x, y, c));
  return data;
}

/** Stiles and rails in the mid shade with a bevelled inner edge, two panels per door. */
function doorBase(p: Painter, w: RGBA[], lower: boolean): void {
  rect(p, 0, 0, 15, 15, w[2]!);
  // Stile bevel: highlight on the outer side of each stile, shadow towards the panel.
  rect(p, 1, 0, 1, 15, w[3]!);
  rect(p, 14, 0, 14, 15, w[1]!);
  rect(p, 2, 0, 2, 15, w[1]!);
  rect(p, 13, 0, 13, 15, w[2]!);
  if (lower) rect(p, 2, 14, 13, 14, w[1]!);
  else rect(p, 2, 1, 13, 1, w[3]!);
  panel(p, 3, lower ? 3 : 2, 12, lower ? 12 : 12, w);
  if (lower) rect(p, 1, 14, 14, 14, w[1]!);
}

export function genDoorLower(wood: ShapeWood, seed = 0): TextureData {
  const w = WOOD_RAMPS[wood];
  return paint((p) => {
    doorBase(p, w, true);
    flecks(p, seed, 4, 4, 11, 11, w[0]!);
    knob(p, 11, 1);
  });
}
export function genDoorUpper(wood: ShapeWood, seed = 0): TextureData {
  const w = WOOD_RAMPS[wood];
  return paint((p) => {
    doorBase(p, w, false);
    flecks(p, seed, 4, 9, 11, 11, w[0]!);
    // Three small window slats cut into the upper panel.
    rect(p, 5, 4, 10, 4, w[0]!);
    rect(p, 5, 7, 10, 7, w[0]!);
    rect(p, 5, 5, 10, 6, w[2]!);
    rect(p, 5, 8, 10, 8, w[3]!);
  });
}
export const genDoorLowerFlip = (wood: ShapeWood, seed = 0) => mirrorX(genDoorLower(wood, seed));
export const genDoorUpperFlip = (wood: ShapeWood, seed = 0) => mirrorX(genDoorUpper(wood, seed));

export function genTrapdoor(wood: ShapeWood, seed = 0): TextureData {
  const w = WOOD_RAMPS[wood];
  return paint((p) => {
    rect(p, 0, 0, 15, 15, w[2]!);
    // Bevelled frame, one pixel inside the flat outer ring.
    rect(p, 1, 1, 14, 1, w[3]!);
    rect(p, 1, 1, 1, 14, w[3]!);
    rect(p, 1, 14, 14, 14, w[0]!);
    rect(p, 14, 1, 14, 14, w[0]!);
    rect(p, 2, 2, 13, 13, w[1]!);
    // Three boards with dark seams; a lighter top edge on each board.
    for (const y of [5, 9]) {
      rect(p, 2, y, 13, y, w[0]!);
      rect(p, 2, y + 1, 13, y + 1, w[3]!);
    }
    for (const [y0, y1] of [
      [2, 4],
      [6, 8],
      [10, 13],
    ] as const)
      for (let x = 3 + (y0 % 3); x < 13; x += 4) rect(p, x, y0, x, y1, w[2]!);
    flecks(p, seed, 3, 2, 12, 4, w[0]!);
    knob(p, 7, 11);
  });
}

/** Inventory sprite of the whole two-block door: 10 pixels wide, 16 tall, dark outline. */
export function genDoorItem(wood: ShapeWood, seed = 0): TextureData {
  const w = WOOD_RAMPS[wood];
  const data = createEmptyTexture();
  const p: Painter = (x, y, c) => setPixel(data, x, y, c);
  rect(p, 3, 0, 12, 15, w[0]!);
  rect(p, 4, 1, 11, 14, w[2]!);
  rect(p, 4, 1, 4, 14, w[3]!);
  rect(p, 11, 1, 11, 14, w[1]!);
  rect(p, 5, 2, 10, 6, w[1]!);
  rect(p, 5, 2, 10, 2, w[0]!);
  rect(p, 5, 6, 10, 6, w[3]!);
  rect(p, 5, 9, 10, 13, w[1]!);
  rect(p, 5, 9, 10, 9, w[0]!);
  rect(p, 5, 13, 10, 13, w[3]!);
  flecks(p, seed, 5, 10, 10, 12, w[0]!);
  p(9, 7, IRON_LIGHT);
  p(10, 7, IRON_DARK);
  return data;
}

export const shapeGenerators: Record<string, (seed?: number) => TextureData> = {};
export const shapePalettes: Record<string, RGBA[]> = {};
for (const wood of SHAPE_WOODS) {
  const entries: Array<[string, (seed?: number) => TextureData, boolean]> = [
    [`${wood}_door_lower`, (seed) => genDoorLower(wood, seed), false],
    [`${wood}_door_upper`, (seed) => genDoorUpper(wood, seed), false],
    [`${wood}_door_lower_flip`, (seed) => genDoorLowerFlip(wood, seed), false],
    [`${wood}_door_upper_flip`, (seed) => genDoorUpperFlip(wood, seed), false],
    [`${wood}_trapdoor`, (seed) => genTrapdoor(wood, seed), false],
    [`${wood}_door_item`, (seed) => genDoorItem(wood, seed), true],
  ];
  for (const [name, gen, sprite] of entries) {
    shapeGenerators[name] = gen;
    shapePalettes[name] = shapePalette(wood, sprite);
  }
}
