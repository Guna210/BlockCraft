// src/render/textures/wood-extra.ts
// M03f: rainwood and acacia logs and leaves. Log sides are built from periodic bark structures
// (the period divides 16, so the tile repeats without a seam); log tops use growth rings inside
// a bark ring; leaves are neutral clusters that the renderer multiplies by the biome foliage tint
// (tint index 2), with transparent gaps for the cutout pass (ART.md §3).
import { createEmptyTexture, TextureData, LCG, setPixel, fillSolid, hexToRgb, RGBA } from './noise';

const pal = (hexes: string[]): RGBA[] => hexes.map((h) => hexToRgb(h));

// Rainwood: a tall rainforest hardwood, dark reddish bark with deep furrows and red-brown heartwood.
export const PAL_RAINWOOD_BARK = pal(['#1c0f0a', '#3a1f14', '#5c3322', '#8c5a3c']);
export const PAL_RAINWOOD_WOOD = pal(['#7a2f1c', '#9c4a2a', '#b8683a', '#d68f52']);

// Acacia: grey-brown plated bark and orange heartwood.
export const PAL_ACACIA_BARK = pal(['#2a2622', '#4f453c', '#6f6254', '#8d7e6c']);
export const PAL_ACACIA_WOOD = pal(['#a8582a', '#c97a3c', '#e0974c', '#f2b866']);

// Neutral leaf ramps (tinted at draw time) plus a transparent colour with a mid-grey RGB.
export const PAL_RAINWOOD_LEAVES: RGBA[] = [
  ...pal(['#1e1e1e', '#3c3c3c', '#606060', '#8c8c8c', '#bcbcbc']),
  hexToRgb('#606060', 0),
];
export const PAL_ACACIA_LEAVES: RGBA[] = [
  ...pal(['#2c2c2c', '#505050', '#787878', '#a2a2a2', '#d0d0d0']),
  hexToRgb('#787878', 0),
];

function hashInt(a: number, b: number): number {
  let h = Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

// ---- logs ------------------------------------------------------------------------------------

function genLogTop(woodPal: RGBA[], barkPal: RGBA[], ringStep: number, seed: number): TextureData {
  const data = createEmptyTexture();
  const lcg = new LCG(seed);
  const phase = lcg.nextFloat() * ringStep; // where the rings sit between the pith and the bark
  const pith = lcg.nextInt(0, 3); // a seeded pith: a 2x2 core, or a core with one extra pixel
  const scar = lcg.nextInt(0, 7); // one lighter growth mark on the bark ring
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const edge = Math.min(x, 15 - x, y, 15 - y);
      const dx = x - 7.5;
      const dy = y - 7.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      let col: RGBA;
      if (edge === 0) col = x === scar + 4 && y === 0 ? barkPal[2]! : barkPal[1]!;
      else if (edge === 1 && dist > 6.4) col = barkPal[2]!;
      else if (dist < 1.6 || (pith > 0 && x === 6 + (pith & 1) * 3 && y === 6 + (pith >> 1) * 3))
        col = woodPal[0]!;
      else if (Math.abs(((dist + phase) % ringStep) - ringStep / 2) < 0.55) col = woodPal[1]!;
      else col = dx + dy < 0 && dist > 2 ? woodPal[3]! : woodPal[2]!;
      setPixel(data, x, y, col);
    }
  }
  return data;
}

export function genRainwoodLogTop(seed: number = 7001): TextureData {
  return genLogTop(PAL_RAINWOOD_WOOD, PAL_RAINWOOD_BARK, 3.0, seed);
}

export function genAcaciaLogTop(seed: number = 7002): TextureData {
  return genLogTop(PAL_ACACIA_WOOD, PAL_ACACIA_BARK, 2.6, seed);
}

export function genRainwoodLogSide(seed: number = 7003): TextureData {
  // Deep furrows with a lighter buttress ridge, period 8 across and down. The first and last
  // column of the 8 px period are the same dark furrow, so the tile wraps without a seam. Short
  // horizontal fissure marks and a knot scar sit at seeded rows, away from the furrows.
  const data = createEmptyTexture();
  const lcg = new LCG(seed);
  const knotX = 2 + lcg.nextInt(0, 2);
  const knotY = lcg.nextInt(0, 7);
  const markY = (knotY + 4) % 8;
  const across = [0, 3, 2, 2, 1, 2, 1, 0];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const bx = x % 8;
      let idx = across[bx]!;
      const ky = y % 8;
      if (ky === knotY && (bx === knotX || bx === knotX + 1))
        idx = 0; // knot scar
      else if (ky === (knotY + 7) % 8 && bx === knotX)
        idx = 3; // lit rim above the scar
      else if (ky === markY && (bx === 2 || bx === 3 || bx === 5))
        idx = 1; // fissure
      else if (ky === (markY + 1) % 8 && bx === 3) idx = 2;
      setPixel(data, x, y, PAL_RAINWOOD_BARK[idx]!);
    }
  }
  return data;
}

export function genAcaciaLogSide(seed: number = 7004): TextureData {
  // Plates of bark, 8 px wide and 8 px tall, staggered by half a plate between the two plate
  // columns. Deep dark fissures run along every plate edge (so opposite tile edges match), and
  // each plate is lit from its upper-left.
  const data = createEmptyTexture();
  for (let x = 0; x < 16; x++) {
    const col = x >> 3;
    const px = x & 7;
    for (let y = 0; y < 16; y++) {
      const sy = (y + col * 4) % 16;
      const py = sy & 7;
      const plate = hashInt(col + seed, sy >> 3) % 3; // 3 plate tones
      const tone = 1 + plate; // 1..3
      let idx = tone;
      if (py === 0 || py === 7 || px === 0 || px === 7)
        idx = 0; // fissure
      else if (py === 1 || px === 1)
        idx = Math.min(3, tone + 1); // lit edge
      else if (py === 6 || px === 6)
        idx = Math.max(1, tone - 1); // shaded edge
      else if (px === 3 + (hashInt(col, sy >> 3) & 1) && py > 1 && py < 6)
        idx = Math.max(1, tone - 1); // flaking streak
      setPixel(data, x, y, PAL_ACACIA_BARK[idx]!);
    }
  }
  return data;
}

// ---- leaves ----------------------------------------------------------------------------------

/**
 * Wrap-aware clusters of leaves around jittered centres. A pixel is a gap where two clusters
 * meet or where it is further than `reach` from every centre; the rest is shaded from the lit
 * top-left of its cluster to the shaded bottom-right.
 */
function genLeaves(
  palette: RGBA[],
  seed: number,
  count: number,
  reach: number,
  seam: number,
): TextureData {
  const data = createEmptyTexture();
  fillSolid(data, palette[5]!);
  const lcg = new LCG(seed);
  const cx: number[] = [];
  const cy: number[] = [];
  for (let i = 0; i < count; i++) {
    // jittered grid so the clusters spread over the tile
    const gx = i % Math.ceil(Math.sqrt(count));
    const gy = Math.floor(i / Math.ceil(Math.sqrt(count)));
    const cell = 16 / Math.ceil(Math.sqrt(count));
    cx.push(Math.floor(gx * cell + lcg.nextFloat() * cell));
    cy.push(Math.floor(gy * cell + lcg.nextFloat() * cell));
  }
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let best = 99;
      let second = 99;
      let bi = 0;
      for (let i = 0; i < count; i++) {
        let dx = Math.abs(x - cx[i]!);
        if (dx > 8) dx = 16 - dx;
        let dy = Math.abs(y - cy[i]!);
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
      if (best > reach || second - best < seam) continue; // gap
      let rx = x - cx[bi]!;
      let ry = y - cy[bi]!;
      if (rx > 8) rx -= 16;
      if (rx < -8) rx += 16;
      if (ry > 8) ry -= 16;
      if (ry < -8) ry += 16;
      const light = rx + ry;
      const idx = light < -2.2 ? 4 : light < -0.4 ? 3 : light < 1.6 ? 2 : light < 3.2 ? 1 : 0;
      setPixel(data, x, y, palette[idx]!);
    }
  }
  return data;
}

export function genRainwoodLeaves(seed: number = 7101): TextureData {
  return genLeaves(PAL_RAINWOOD_LEAVES, seed, 6, 99, 0.6);
}

export function genAcaciaLeaves(seed: number = 7202): TextureData {
  return genLeaves(PAL_ACACIA_LEAVES, seed, 12, 99, 0.4);
}
