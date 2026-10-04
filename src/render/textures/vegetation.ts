// src/render/textures/vegetation.ts
// M03f: plants (cross-model sprites), cactus, pumpkin, sugar reeds, mushrooms, mossy cobblestone
// and packed ice. Sprites are built from shapes (blades, stems, petals, caps), not noise
// (ART.md §1.2). Light comes from the top-left, so every shape has its lighter pixels on the
// left/top and darker ones on the right/bottom. Every tile declares its palette (≤ 12 colours).
// The transparent colour of a sprite carries a mid-tone RGB so that the mip chain, which filters
// RGBA without premultiplying, does not pull a dark fringe into the visible edge.
import { createEmptyTexture, TextureData, LCG, setPixel, hexToRgb, RGBA } from './noise';
import { PAL_STONE, genCobblestone } from './terrain';

const pal = (hexes: string[]): RGBA[] => hexes.map((h) => hexToRgb(h));

// ---- palettes --------------------------------------------------------------------------------

// Neutral ramp multiplied by the biome grass tint at draw time (tint index 1), like grass_top.
export const PAL_TALL_GRASS: RGBA[] = [
  ...pal(['#4a4a4a', '#6e6e6e', '#969696', '#c0c0c0', '#e6e6e6']),
  hexToRgb('#6e6e6e', 0),
];

// Shared stem and leaf greens of the flowers (dark → light)
const STEM = ['#1f4a1a', '#2f6a26', '#4a8f35', '#7abd4f'];
const STEM_TRANS = hexToRgb('#2f6a26', 0);

export const PAL_BLUEBELL: RGBA[] = [
  ...pal(STEM),
  ...pal(['#26338a', '#3f55c4', '#6f89ec', '#b9c8ff']),
  STEM_TRANS,
];
export const PAL_BUTTERCUP: RGBA[] = [
  ...pal(STEM),
  ...pal(['#a8740a', '#d9a514', '#f5d12e', '#fff29a']),
  STEM_TRANS,
];
export const PAL_MARIGOLD: RGBA[] = [
  ...pal(STEM),
  ...pal(['#9a3d08', '#d4691a', '#f59a2e', '#ffd08a']),
  STEM_TRANS,
];
export const PAL_VIOLET: RGBA[] = [
  ...pal(STEM),
  ...pal(['#3f2288', '#6a42b8', '#9a76e2', '#d2bcff']),
  hexToRgb('#f2d34a'),
  STEM_TRANS,
];
export const PAL_DAISY: RGBA[] = [
  ...pal(STEM),
  ...pal(['#aeb6c2', '#d8dee6', '#f6f8fa', '#ffffff']),
  ...pal(['#b8860f', '#f5c62e']),
  STEM_TRANS,
];
export const PAL_WILD_ROSE: RGBA[] = [
  ...pal(STEM),
  ...pal(['#8c1c44', '#cf3c76', '#f07aa8', '#ffc0d6']),
  hexToRgb('#f2d34a'),
  STEM_TRANS,
];
export const PAL_LUPINE: RGBA[] = [
  ...pal(STEM),
  ...pal(['#2e2688', '#5148c8', '#8678ee', '#c4bcff']),
  STEM_TRANS,
];
export const PAL_HEATHER: RGBA[] = [
  ...pal(STEM),
  ...pal(['#6e2470', '#a63f9c', '#d672c4', '#f4b0e4']),
  STEM_TRANS,
];

export const PAL_REEDS: RGBA[] = [
  ...pal(['#27502a', '#3a7a3a', '#62a84c', '#98d26e', '#c8eaa0']),
  hexToRgb('#3a7a3a', 0),
];

const MUSH_STEM = ['#a8977c', '#d0c2a6', '#ece2cc', '#faf4e4'];
export const PAL_BROWN_MUSHROOM: RGBA[] = [
  ...pal(['#3a2212', '#62401f', '#8c5c32', '#b98650']),
  ...pal(MUSH_STEM),
  hexToRgb(MUSH_STEM[0]!, 0),
];
export const PAL_RED_MUSHROOM: RGBA[] = [
  ...pal(['#5c1010', '#9c1c1c', '#d03030', '#f0645a']),
  ...pal(MUSH_STEM),
  hexToRgb(MUSH_STEM[0]!, 0),
];

export const PAL_CACTUS: RGBA[] = pal(['#1d4a26', '#2b6a35', '#3f8c45', '#62b05a', '#f0e6b8']);
export const PAL_PUMPKIN: RGBA[] = pal([
  '#8a3a0a',
  '#b8571a',
  '#dd7a26',
  '#f59c3a',
  '#ffbf6a',
  '#3f5a1e',
  '#6a8a30',
]);
export const PAL_MOSSY: RGBA[] = [...PAL_STONE, ...pal(['#2f5a22', '#4a8232', '#74ae4a'])];
export const PAL_PACKED_ICE: RGBA[] = pal(['#5686c0', '#79ace0', '#a1cdf2', '#cde8fb', '#f0faff']);

// ---- drawing helpers -------------------------------------------------------------------------

/** A sprite canvas: pixels are palette indices, -1 is transparent. */
class Sprite {
  private px: Int8Array = new Int8Array(256).fill(-1);

  set(x: number, y: number, idx: number): void {
    if (x < 0 || x > 15 || y < 0 || y > 15) return;
    this.px[y * 16 + x] = idx;
  }

  get(x: number, y: number): number {
    return this.px[y * 16 + x]!;
  }

  /** Vertical stroke from (x, y0) to (x, y1) in one palette index. */
  vline(x: number, y0: number, y1: number, idx: number): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.set(x, y, idx);
  }

  /** Filled ellipse with half-open radii; top-left pixels use `light`, bottom-right `dark`. */
  blob(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    light: number,
    mid: number,
    dark: number,
  ): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const d = dx * dx + dy * dy;
        if (d > 1.05) continue;
        const shade = dx + dy; // negative = towards the light
        this.set(x, y, shade < -0.55 ? light : shade > 0.45 ? dark : mid);
      }
    }
  }

  /**
   * Seeded variation of a finished sprite: an optional mirror and a small sideways bend of the
   * upper half, so that two seeds give two clearly different but equally well-formed plants.
   */
  vary(r: LCG): void {
    const mirror = r.nextFloat() < 0.5;
    const bend = r.nextInt(-1, 1);
    const next = new Int8Array(256).fill(-1);
    for (let y = 0; y < 16; y++) {
      const shift = y < 6 ? bend : 0;
      for (let x = 0; x < 16; x++) {
        const idx = this.px[y * 16 + x]!;
        if (idx < 0) continue;
        const nx = (mirror ? 15 - x : x) + shift;
        if (nx < 0 || nx > 15) continue;
        next[y * 16 + nx] = idx;
      }
    }
    this.px = next;
  }

  toTexture(palette: RGBA[], transparent: RGBA): TextureData {
    const data = createEmptyTexture();
    for (let i = 0; i < 256; i++) {
      const idx = this.px[i]!;
      setPixel(data, i % 16, (i / 16) | 0, idx < 0 ? transparent : palette[idx]!);
    }
    return data;
  }
}

/** A leaning stem of two pixels, bottom at y = 15; used by the flowers. Stem palette: 0..3. */
function stem(s: Sprite, x: number, topY: number, lean = 0): void {
  for (let y = 15; y >= topY; y--) {
    const t = (15 - y) / Math.max(1, 15 - topY);
    const sx = x + Math.round(lean * t * t);
    s.set(sx, y, 2);
    s.set(sx + 1, y, 1);
  }
}

function leaf(s: Sprite, x: number, y: number, dir: -1 | 1): void {
  // a 3 x 2 leaf leaning away from the stem: light edge on top, dark underside
  s.set(x + dir, y, 3);
  s.set(x + 2 * dir, y - 1, 3);
  s.set(x + dir, y + 1, 1);
  s.set(x + 2 * dir, y, 2);
  s.set(x + 3 * dir, y - 1, 2);
}

// ---- tall grass ------------------------------------------------------------------------------

export function genTallGrass(seed: number = 9101): TextureData {
  const s = new Sprite();
  // Blades of 2 px curving towards `lean`; the left pixel catches the light.
  const blades: Array<[number, number, number]> = [
    [2, 8, -1],
    [11, 8, 1],
    [2, 5, -1],
    [11, 3, 1],
    [4, 2, -1],
    [8, 1, 0],
    [6, 7, 0],
    [9, 6, 1],
  ];
  const r = new LCG(seed);
  for (const [bx0, top0, lean0] of blades) {
    const bx = Math.max(2, Math.min(11, bx0 + r.nextInt(-1, 0)));
    const top = Math.min(12, top0 + r.nextInt(0, 2));
    const lean = r.nextFloat() < 0.35 ? r.nextInt(-1, 1) : lean0;
    for (let y = 15; y >= top; y--) {
      const t = (15 - y) / (15 - top); // 0 at the root, 1 at the tip
      const x = Math.max(1, Math.min(13, bx + Math.round(lean * t * t * 2)));
      const left = Math.min(4, 1 + Math.round(t * 3));
      s.set(x, y, left);
      if (y !== top) s.set(x + 1, y, y === 15 ? left : left - 1);
    }
  }
  return s.toTexture(PAL_TALL_GRASS, PAL_TALL_GRASS[5]!);
}

// ---- flowers ---------------------------------------------------------------------------------
// Palette layout of every flower: 0..3 stem greens (dark → light), 4..7 flower ramp (dark → light),
// optional 8 = accent, last = transparent.

export function genBluebell(seed: number = 9102): TextureData {
  const s = new Sprite();
  const r = new LCG(seed);
  stem(s, 6, 3, 2);
  leaf(s, 6, 13, -1);
  leaf(s, 7, 11, 1);
  // Bells hang from the arched stem: a 3 x 3 bell with a darker lip
  const bell = (bx: number, by: number): void => {
    s.set(bx, by, 7);
    s.set(bx + 1, by, 6);
    s.set(bx - 1, by + 1, 6);
    s.set(bx, by + 1, 7);
    s.set(bx + 1, by + 1, 5);
    s.set(bx - 1, by + 2, 5);
    s.set(bx, by + 2, 6);
    s.set(bx + 1, by + 2, 4);
  };
  bell(9, 3);
  bell(10, 6);
  bell(4, 5);
  bell(5, 8);
  s.set(8, 2, 3);
  s.vary(r);
  return s.toTexture(PAL_BLUEBELL, STEM_TRANS);
}

export function genButtercup(seed: number = 9103): TextureData {
  const s = new Sprite();
  const r = new LCG(seed);
  stem(s, 7, 7, 0);
  leaf(s, 7, 12, -1);
  leaf(s, 8, 10, 1);
  s.blob(7.5, 4.5, 3.6, 3.4, 7, 6, 5);
  s.blob(7, 4, 1.4, 1.4, 5, 5, 4); // darker nectar centre
  s.set(6, 3, 7);
  s.vary(r);
  return s.toTexture(PAL_BUTTERCUP, STEM_TRANS);
}

export function genMarigold(seed: number = 9104): TextureData {
  const s = new Sprite();
  const r = new LCG(seed);
  stem(s, 7, 8, 0);
  leaf(s, 7, 13, -1);
  leaf(s, 8, 11, 1);
  s.blob(7.5, 4.5, 4.2, 3.8, 6, 5, 4); // layered pom-pom
  s.blob(7.5, 4.5, 2.5, 2.2, 7, 6, 5);
  s.set(7, 4, 4);
  s.set(8, 5, 4);
  s.set(6, 3, 7);
  s.set(5, 4, 6);
  s.vary(r);
  return s.toTexture(PAL_MARIGOLD, STEM_TRANS);
}

export function genViolet(seed: number = 9105): TextureData {
  const s = new Sprite();
  const r = new LCG(seed);
  stem(s, 7, 8, 0);
  // heart-shaped leaves low on the plant
  for (const [lx, ly, dir] of [
    [6, 13, -1],
    [8, 12, 1],
    [6, 10, -1],
  ] as const) {
    leaf(s, lx, ly, dir);
  }
  // two small five-petal flowers
  const bloom = (cx: number, cy: number): void => {
    s.set(cx, cy - 1, 7);
    s.set(cx - 1, cy, 7);
    s.set(cx + 1, cy, 6);
    s.set(cx, cy + 1, 5);
    s.set(cx - 1, cy - 1, 6);
    s.set(cx + 1, cy - 1, 6);
    s.set(cx - 1, cy + 1, 5);
    s.set(cx + 1, cy + 1, 4);
    s.set(cx, cy, 8);
  };
  bloom(6, 5);
  bloom(10, 7);
  s.vary(r);
  return s.toTexture(PAL_VIOLET, STEM_TRANS);
}

export function genDaisy(seed: number = 9106): TextureData {
  const s = new Sprite();
  const r = new LCG(seed);
  stem(s, 7, 8, 0);
  leaf(s, 7, 13, -1);
  leaf(s, 8, 11, 1);
  // eight white petals around a yellow eye
  const cx = 7;
  const cy = 4;
  const dirs: Array<[number, number]> = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ];
  for (const [dx, dy] of dirs) {
    const lit = dx + dy < 0;
    s.set(cx + dx * 2, cy + dy * 2, lit ? 7 : 6);
    s.set(cx + dx * 3, cy + dy * 3, lit ? 6 : 5);
  }
  for (const [dx, dy] of dirs) s.set(cx + dx, cy + dy, dx + dy < 0 ? 7 : 6);
  s.set(cx, cy, 9);
  s.set(cx + 1, cy, 8);
  s.set(cx, cy + 1, 8);
  s.vary(r);
  return s.toTexture(PAL_DAISY, STEM_TRANS);
}

export function genWildRose(seed: number = 9107): TextureData {
  const s = new Sprite();
  const r = new LCG(seed);
  stem(s, 7, 7, 0);
  s.set(6, 12, 0); // thorns
  s.set(9, 10, 0);
  s.set(6, 9, 0);
  leaf(s, 7, 13, -1);
  leaf(s, 8, 11, 1);
  s.blob(7.5, 4, 4.2, 3.6, 7, 6, 5);
  s.blob(7.5, 4, 2.4, 2.0, 6, 5, 4); // rolled petals
  s.set(7, 4, 4);
  s.set(8, 4, 4);
  s.set(8, 3, 4);
  s.set(5, 2, 7);
  s.vary(r);
  return s.toTexture(PAL_WILD_ROSE, STEM_TRANS);
}

export function genLupine(seed: number = 9108): TextureData {
  const s = new Sprite();
  const r = new LCG(seed);
  stem(s, 7, 8, 0);
  leaf(s, 7, 14, -1);
  leaf(s, 8, 12, 1);
  // A tall spike of small blossoms; it widens from the tip down to the stem.
  for (let y = 0; y < 9; y++) {
    const width = Math.min(7, 2 + Math.floor(y * 0.7));
    const x0 = 8 - Math.ceil(width / 2);
    for (let dx = 0; dx < width; dx++) {
      const checker = (dx + y) % 2 === 0;
      let idx = checker ? 6 : 5;
      if (dx === 0 && checker) idx = 7; // lit left edge
      if (dx === width - 1) idx = checker ? 5 : 4; // shaded right edge
      s.set(x0 + dx, y, idx);
    }
  }
  s.vary(r);
  return s.toTexture(PAL_LUPINE, STEM_TRANS);
}

export function genHeather(seed: number = 9109): TextureData {
  const s = new Sprite();
  // a low tuft: several thin stems carrying rows of tiny bells
  const stems: Array<[number, number, number]> = [
    [3, 5, -1],
    [6, 3, 0],
    [9, 4, 1],
    [12, 7, 1],
  ];
  const r = new LCG(seed);
  for (const [x0, top0, lean] of stems) {
    const x = x0 + r.nextInt(-1, 1);
    const top = top0 + r.nextInt(0, 2);
    for (let y = 15; y >= top; y--) {
      const t = (15 - y) / (15 - top);
      const sx = x + Math.round(lean * t * t * 2);
      s.set(sx, y, y > 12 ? 0 : 1);
      if (y < 13 && y >= top) {
        // blossoms along the upper part of each stem
        if ((y - top) % 2 === 0) {
          s.set(sx - 1, y, 6);
          s.set(sx + 1, y, 5);
        }
        if ((y - top) % 2 === 1) s.set(sx, y, 7);
      }
    }
  }
  s.set(5, 14, 2);
  s.set(10, 14, 2);
  return s.toTexture(PAL_HEATHER, STEM_TRANS);
}

// ---- sugar reeds -----------------------------------------------------------------------------

export function genSugarReeds(seed: number = 9110): TextureData {
  const s = new Sprite();
  // Three jointed stalks of different heights; nodes every 5 rows, a leaf at every other node.
  const r = new LCG(seed);
  const stalks: Array<[number, number]> = [
    [2, r.nextInt(0, 2)],
    [7, r.nextInt(0, 1)],
    [12, r.nextInt(2, 4)],
  ];
  for (const [x, top] of stalks) {
    for (let y = top; y <= 15; y++) {
      const node = (y - top) % 5 === 4;
      s.set(x, y, node ? 4 : 3);
      s.set(x + 1, y, node ? 2 : 2);
      s.set(x + 2, y, node ? 1 : 0);
    }
  }
  // drooping leaves at the top of each stalk
  const leafAt = (x: number, y: number, dir: -1 | 1): void => {
    s.set(x + dir, y, 3);
    s.set(x + 2 * dir, y + 1, 2);
    s.set(x + 3 * dir, y + 2, 1);
    s.set(x + dir, y + 1, 2);
  };
  const [t0, t1, t2] = stalks.map(([, top]) => top) as [number, number, number];
  leafAt(2, t0 + 3, -1);
  leafAt(4, t0 + 5, 1);
  leafAt(7, t1 + 4, -1);
  leafAt(9, t1 + 2, 1);
  leafAt(12, t2 + 4, -1);
  leafAt(14, t2 + 6, 1);
  if (r.nextFloat() < 0.5) s.vary(r);
  return s.toTexture(PAL_REEDS, PAL_REEDS[5]!);
}

// ---- mushrooms -------------------------------------------------------------------------------
// Palette: 0..3 cap ramp, 4..7 stem ramp (dark → light), 8 = transparent.

function mushroom(palette: RGBA[], spots: boolean, seed: number): TextureData {
  const s = new Sprite();
  const r = new LCG(seed);
  const mush = (cx: number, capY: number, rx: number, ry: number, stemH: number): void => {
    // stem: two pixels wide, lit on the left, from under the cap down to the ground
    const y0 = Math.round(capY + ry * 0.6);
    const y1 = Math.min(15, y0 + stemH - 1);
    for (let y = y0; y <= y1; y++) {
      s.set(cx, y, y === y1 ? 4 : 6);
      s.set(cx + 1, y, y === y1 ? 4 : 5);
    }
    // cap: a lit dome with a shaded rim along its lower edge
    s.blob(cx + 0.5, capY, rx, ry, 3, 2, 1);
    for (let x = Math.ceil(cx + 0.5 - rx); x <= Math.floor(cx + 0.5 + rx); x++) {
      s.set(x, Math.round(capY + ry * 0.7), x > cx + 0.5 ? 0 : 1);
    }
    if (spots) {
      s.set(Math.round(cx - 1), Math.round(capY - 1), 7);
      s.set(Math.round(cx - 2), Math.round(capY - 1), 6);
      s.set(Math.round(cx + 2), Math.round(capY), 6);
      s.set(Math.round(cx + 1), Math.round(capY - 2), 7);
    }
  };
  mush(4 + r.nextInt(0, 1), 6 + r.nextInt(0, 1), 3.9 - r.nextInt(0, 1) * 0.5, 2.5, 8);
  mush(10 + r.nextInt(0, 1), 11 + r.nextInt(-1, 0), 2.7 + r.nextInt(0, 1) * 0.4, 1.8, 4);
  return s.toTexture(palette, palette[8]!);
}

export function genBrownMushroom(seed: number = 9111): TextureData {
  return mushroom(PAL_BROWN_MUSHROOM, false, seed);
}

export function genRedMushroom(seed: number = 9112): TextureData {
  return mushroom(PAL_RED_MUSHROOM, true, seed);
}

// ---- cactus ----------------------------------------------------------------------------------

export function genCactusSide(seed: number = 9113): TextureData {
  // Vertical ribs, period 4 across so the tile repeats seamlessly: a 2 px dark groove, then a
  // lit and a mid rib pixel. Pale spines sit on the lit pixel every 4 rows, offset between
  // neighbouring ribs, and a dark notch marks the mid pixel between them.
  const data = createEmptyTexture();
  const r = new LCG(seed);
  const phase = (seed + r.nextInt(0, 3)) & 3;
  const notch = r.nextInt(0, 1) * 2;
  const ribs = [1, 3, 2, 1];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let idx = ribs[x % 4]!;
      const rib = x >> 2;
      if (x % 4 === 1 && (y + rib * 2 + phase) % 4 === 0)
        idx = 4; // spine
      else if (x % 4 === 2 && (y + rib * 2 + notch + phase) % 4 === 2) idx = 0; // notch
      setPixel(data, x, y, PAL_CACTUS[idx]!);
    }
  }
  return data;
}

export function genCactusTop(seed: number = 9114): TextureData {
  // Dark rim all round (so it also tiles), a lighter inset and a four-armed rib pattern.
  const data = createEmptyTexture();
  const phase = new LCG(seed).nextInt(0, 3);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const edge = Math.min(x, 15 - x, y, 15 - y);
      let idx = edge === 0 ? 0 : edge === 1 ? 1 : 2;
      if (edge >= 2) {
        const dx = Math.abs(x - 7.5);
        const dy = Math.abs(y - 7.5);
        if (dx < 1.1 || dy < 1.1) idx = 3;
        if (dx < 1.1 && dy < 1.1) idx = 2;
        if (edge >= 4 && (x + y + phase) % 4 === 0 && dx > 1.1 && dy > 1.1) idx = 4;
      }
      setPixel(data, x, y, PAL_CACTUS[idx]!);
    }
  }
  return data;
}

// ---- pumpkin ---------------------------------------------------------------------------------

export function genPumpkinSide(seed: number = 9115): TextureData {
  // Four ribs per tile (period 4): groove, shadow, body, highlight; rim rows are a shade darker.
  const data = createEmptyTexture();
  const shine = new LCG(seed).nextInt(3, 8);
  const ribs = [0, 3, 2, 0]; // grooves are 2 px wide, so opposite tile edges match
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let idx = ribs[x % 4]!;
      if (y === 0 || y === 15) idx = Math.max(0, idx - 1);
      else if (y === 1 || y === 14) idx = Math.min(4, idx + (x % 4 === 1 ? 1 : 0));
      if (x % 4 === 1 && (y === shine || y === shine + 1 || y === ((shine + 6) % 14) + 1)) idx = 4; // shine
      setPixel(data, x, y, PAL_PUMPKIN[idx]!);
    }
  }
  return data;
}

export function genPumpkinTop(seed: number = 9116): TextureData {
  // Ribs radiate from a short green stem in the middle; the rim is uniform so the tile wraps.
  const data = createEmptyTexture();
  const lean = new LCG(seed).nextInt(0, 1);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const edge = Math.min(x, 15 - x, y, 15 - y);
      const dx = x - 7.5;
      const dy = y - 7.5;
      let idx = edge === 0 ? 0 : 2;
      if (edge >= 1) {
        const diag = Math.abs(Math.abs(dx) - Math.abs(dy)) < 0.8;
        const axis = Math.abs(dx) < 0.8 || Math.abs(dy) < 0.8;
        if (diag || axis) idx = 1;
        else if (dx + dy < 0) idx = 3;
      }
      if (Math.abs(dx) < 1.6 && Math.abs(dy) < 1.6) idx = 5; // stem
      if (lean === 1 && dx > 1.6 && dx < 2.6 && Math.abs(dy) < 0.8) idx = 5; // curled stem tip
      if (dx > -1.6 && dx < 0.2 && dy > -1.6 && dy < 0.2) idx = 6; // lit stem corner
      setPixel(data, x, y, PAL_PUMPKIN[idx]!);
    }
  }
  return data;
}

// ---- mossy cobblestone ---------------------------------------------------------------------

export function genMossyCobblestone(seed: number = 5678): TextureData {
  const data = genCobblestone(56789);
  const lcg = new LCG(seed);
  // Moss grows in clusters of 4-7 pixels that wrap across the tile edges, thicker on the stones'
  // upper-left sides: a light tip, a mid body, a dark root.
  for (let c = 0; c < 7; c++) {
    const cx = lcg.nextInt(0, 15);
    const cy = lcg.nextInt(0, 15);
    const size = lcg.nextInt(4, 7);
    let px = cx;
    let py = cy;
    for (let i = 0; i < size; i++) {
      const idx = i === 0 ? 7 : i < 3 ? 6 : 5; // light tip, mid body, dark root
      setPixel(data, ((px % 16) + 16) % 16, ((py % 16) + 16) % 16, PAL_MOSSY[idx]!);
      px += lcg.nextInt(0, 1);
      py += lcg.nextInt(-1, 1);
    }
  }
  return data;
}

// ---- packed ice ------------------------------------------------------------------------------

export function genPackedIce(seed: number = 8765): TextureData {
  // Frozen facets: 7 wrap-aware cells, each shaded from a light top-left edge to a dark
  // bottom-right one, divided by thin darker frost lines.
  const data = createEmptyTexture();
  const lcg = new LCG(seed);
  const cells = Array.from({ length: 7 }, () => [lcg.nextInt(0, 15), lcg.nextInt(0, 15)]);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let best = 99;
      let second = 99;
      let bi = 0;
      for (let i = 0; i < cells.length; i++) {
        let dx = Math.abs(x - cells[i]![0]!);
        if (dx > 8) dx = 16 - dx;
        let dy = Math.abs(y - cells[i]![1]!);
        if (dy > 8) dy = 16 - dy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < best) {
          second = best;
          best = d;
          bi = i;
        } else if (d < second) {
          second = d;
        }
      }
      let idx: number;
      if (second - best < 0.9) {
        idx = 0;
      } else {
        let rx = x - cells[bi]![0]!;
        let ry = y - cells[bi]![1]!;
        if (rx > 8) rx -= 16;
        if (rx < -8) rx += 16;
        if (ry > 8) ry -= 16;
        if (ry < -8) ry += 16;
        idx = rx + ry < -2 ? 4 : rx + ry < 1 ? 3 : rx + ry < 4 ? 2 : 1;
      }
      setPixel(data, x, y, PAL_PACKED_ICE[idx]!);
    }
  }
  return data;
}
