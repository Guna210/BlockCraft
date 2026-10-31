import { createEmptyTexture, fillSolid, LCG, setPixel, type RGBA, type TextureData } from './noise';

/** Cool shadows shift toward warm mineral/fungal highlights; all shapes wrap at tile edges. */
export const HOLLOWDEEP_PALETTES: Record<string, RGBA[]> = {
  duskrock: [
    [25, 20, 43, 255],
    [46, 37, 63, 255],
    [71, 61, 83, 255],
    [105, 95, 111, 255],
    [143, 130, 140, 255],
  ],
  driftstone: [
    [38, 43, 67, 255],
    [65, 74, 94, 255],
    [96, 111, 126, 255],
    [136, 153, 159, 255],
    [182, 194, 185, 255],
  ],
  glowcap_stem: [
    [38, 24, 57, 255],
    [67, 46, 83, 255],
    [103, 78, 115, 255],
    [148, 121, 153, 255],
    [194, 176, 187, 255],
  ],
  glowcap: [
    [20, 51, 65, 255],
    [28, 88, 94, 255],
    [49, 132, 125, 255],
    [100, 184, 150, 255],
    [190, 234, 185, 255],
  ],
  glowcap_gills: [
    [30, 43, 69, 255],
    [50, 83, 105, 255],
    [79, 129, 139, 255],
    [137, 183, 175, 255],
    [203, 234, 207, 255],
  ],
  veilroot: [
    [0, 0, 0, 0],
    [23, 40, 51, 255],
    [40, 79, 78, 255],
    [74, 130, 108, 255],
    [150, 200, 148, 255],
  ],
  voidglass: [
    [41, 22, 73, 65],
    [75, 44, 117, 95],
    [131, 85, 170, 150],
    [218, 180, 232, 210],
    [245, 223, 244, 230],
  ],
  emberite: [
    [39, 21, 40, 255],
    [79, 37, 47, 255],
    [136, 66, 50, 255],
    [198, 112, 62, 255],
    [247, 188, 98, 255],
  ],
};

function put(tile: TextureData, x: number, y: number, palette: RGBA[], shade: number): void {
  setPixel(tile, ((x % 16) + 16) % 16, ((y % 16) + 16) % 16, palette[shade]!);
}

/** Overlapping irregular stone plates, lit above-left, with two short branching cracks. */
function stone(name: string, seed: number, layered: boolean): TextureData {
  const tile = createEmptyTexture();
  const palette = HOLLOWDEEP_PALETTES[name]!;
  fillSolid(tile, palette[1]!);
  const rng = new LCG(seed);
  for (let i = 0; i < 13; i++) {
    const x = rng.nextInt(0, 15);
    const y = rng.nextInt(0, 15);
    const w = rng.nextInt(3, 7);
    const h = layered ? 3 : rng.nextInt(3, 6);
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++) {
        if ((dx === 0 || dx === w - 1) && (dy === 0 || dy === h - 1)) continue;
        put(
          tile,
          x + dx,
          y + dy,
          palette,
          dy === 0 ? 4 : dx === 0 ? 3 : dy === h - 1 || dx === w - 1 ? 0 : 2,
        );
      }
  }
  for (let i = 0; i < 2; i++) {
    const x = rng.nextInt(0, 15);
    const y = rng.nextInt(0, 15);
    for (let k = 0; k < 4; k++) put(tile, x + k, y + (k >> 1), palette, 0);
  }
  return tile;
}

/** Fungal ribbing, scalloped cap plates and parallel gills have distinct silhouettes. */
function fungus(name: string, seed: number): TextureData {
  const tile = createEmptyTexture();
  const palette = HOLLOWDEEP_PALETTES[name]!;
  fillSolid(tile, palette[1]!);
  const rng = new LCG(seed);
  if (name === 'glowcap') {
    for (let i = 0; i < 12; i++) {
      const x = rng.nextInt(0, 15);
      const y = rng.nextInt(0, 15);
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          if (dx * dx + dy * dy * 2 > 10) continue;
          put(tile, x + dx, y + dy, palette, dy < -1 ? 4 : dx < -1 ? 3 : dy > 1 ? 0 : 2);
        }
    }
  } else {
    const offset = rng.nextInt(0, 3);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const u = (Math.min(x, 15 - x) + (name === 'glowcap_gills' ? y : 0) + offset) & 3;
        put(tile, x, y, palette, [4, 3, 1, 0][u]!);
      }
    // Short attached fibres at deliberate intervals, rather than random pixel noise.
    for (let y = 2; y < 16; y += 7)
      for (let x = 2; x < 16; x += 8) {
        put(tile, x, y, palette, 2);
        put(tile, x, y + 1, palette, 2);
      }
  }
  return tile;
}

function veilroot(seed = 0): TextureData {
  const tile = createEmptyTexture();
  const p = HOLLOWDEEP_PALETTES.veilroot!;
  const offset = new LCG(seed).nextInt(0, 1);
  for (let y = 0; y < 16; y++) {
    const x = 7 + offset + (y >= 4 && y < 12 ? 1 : 0);
    put(tile, x, y, p, 2);
    if (y >= 2 && y < 13 && y % 4 < 2)
      for (let k = 1; k <= 3; k++) {
        const side = y & 4 ? 1 : -1;
        put(tile, x + side * k, y, p, y % 4 === 0 ? 4 : 1);
        put(tile, x + side * k, y + 1, p, 3);
      }
  }
  return tile;
}

/** Sparse diagonal crystal facets, with mostly transparent violet interior. */
function voidglass(seed = 0): TextureData {
  const tile = createEmptyTexture();
  const p = HOLLOWDEEP_PALETTES.voidglass!;
  fillSolid(tile, p[0]!);
  const offset = new LCG(seed).nextInt(0, 15);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const facet = (x + y + offset) & 15;
      if (facet < 2) put(tile, x, y, p, facet === 0 ? 3 : 1);
      if (((x - y + 32) & 15) === 3) put(tile, x, y, p, 2);
      if (facet === 0 && y % 8 < 2) put(tile, x, y, p, 4);
    }
  return tile;
}

export const hollowdeepTextureGenerators: Record<string, (seed?: number) => TextureData> = {
  duskrock: (seed = 0) => stone('duskrock', seed, false),
  driftstone: (seed = 0) => stone('driftstone', seed, true),
  emberite: (seed = 0) => stone('emberite', seed, false),
  glowcap_stem: (seed = 0) => fungus('glowcap_stem', seed),
  glowcap: (seed = 0) => fungus('glowcap', seed),
  glowcap_gills: (seed = 0) => fungus('glowcap_gills', seed),
  veilroot,
  voidglass,
};
