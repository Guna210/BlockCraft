import { LCG, TextureData } from './noise';

/**
 * Palette for Ice: cool crystalline cyan-blue tones with distinct highlight glints.
 * Luminance delta: 238.6 - 156.1 = 82.5 >= 60.
 */
export const PAL_ICE: [number, number, number, number][] = [
  [108, 166, 200, 175], // 0: dark crack edge / shadow (#6ca6c8)
  [130, 186, 220, 150], // 1: deep ice blue (#82badc)
  [158, 206, 235, 140], // 2: mid ice blue (#9eceeb)
  [186, 226, 245, 135], // 3: pale ice blue (#bae2f5)
  [223, 242, 251, 190], // 4: frost glint highlight (#dff2fb)
];

/**
 * Palette for Snow Layer side:
 * Derived from snow palette with lower half transparent.
 */
export const PAL_SNOW_LAYER_SIDE: [number, number, number, number][] = [
  [0, 0, 0, 0], // 0: transparent bottom space
  [200, 214, 229, 255], // 1: snow shadow (#c8d6e5)
  [220, 230, 242, 255], // 2: snow mid (#dce6f2)
  [238, 244, 250, 255], // 3: snow light (#eef4fa)
  [255, 255, 255, 255], // 4: snow pure highlight (#ffffff)
];

/**
 * Palette for Fire:
 * Based on ART.md lava/fire flame ramp.
 * Luminance delta: 243 - 21 = 222 >= 60.
 */
export const PAL_FIRE: [number, number, number, number][] = [
  [0, 0, 0, 0], // 0: transparent background
  [42, 13, 6, 255], // 1: ember base (#2a0d06)
  [184, 54, 11, 255], // 2: deep flame red-orange (#b8360b)
  [228, 95, 16, 255], // 3: vibrant orange (#e45f10)
  [247, 147, 28, 255], // 4: warm amber (#f7931c)
  [255, 210, 74, 255], // 5: core yellow (#ffd24a)
  [255, 245, 180, 255], // 6: tip white-yellow (#fff5b4)
];

/**
 * Procedural Ice texture generator (16x16, deterministic).
 */
export function genIce(seed = 42): TextureData {
  const rng = new LCG(seed);
  const data = new Uint8Array(16 * 16 * 4);

  // 1. Fill base texture with mid ice tones
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const idx = (y * 16 + x) * 4;
      const roll = rng.nextFloat();
      const col = roll < 0.25 ? PAL_ICE[1]! : roll < 0.75 ? PAL_ICE[2]! : PAL_ICE[3]!;
      data[idx] = col[0];
      data[idx + 1] = col[1];
      data[idx + 2] = col[2];
      data[idx + 3] = col[3];
    }
  }

  // 2. Draw 2 subtle crystalline fracture lines across the tile
  const drawLine = (x0: number, y0: number, x1: number, y1: number) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= steps; i++) {
      const t = i / (steps || 1);
      const px = Math.floor(x0 + (x1 - x0) * t) & 15;
      const py = Math.floor(y0 + (y1 - y0) * t) & 15;
      const idx = (py * 16 + px) * 4;
      // Dark crack line
      data[idx] = PAL_ICE[0]![0];
      data[idx + 1] = PAL_ICE[0]![1];
      data[idx + 2] = PAL_ICE[0]![2];
      data[idx + 3] = PAL_ICE[0]![3];

      // Top-left highlight glint neighbor
      const hx = (px - 1 + 16) & 15;
      const hy = (py - 1 + 16) & 15;
      const hidx = (hy * 16 + hx) * 4;
      data[hidx] = PAL_ICE[4]![0];
      data[hidx + 1] = PAL_ICE[4]![1];
      data[hidx + 2] = PAL_ICE[4]![2];
      data[hidx + 3] = PAL_ICE[4]![3];
    }
  };

  drawLine(2, 3, 13, 11);
  drawLine(9, 1, 4, 14);

  return data;
}

/**
 * Procedural Snow Layer side texture generator (16x16, deterministic).
 * Upper 8 rows are snow, lower 8 rows are transparent for the slab model.
 */
export function genSnowLayerSide(seed = 42): TextureData {
  const rng = new LCG(seed);
  const data = new Uint8Array(16 * 16 * 4);

  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const idx = (y * 16 + x) * 4;
      if (y >= 8) {
        // Lower half transparent for bottom slab
        const trans = PAL_SNOW_LAYER_SIDE[0]!;
        data[idx] = trans[0];
        data[idx + 1] = trans[1];
        data[idx + 2] = trans[2];
        data[idx + 3] = trans[3];
      } else {
        // Upper half has gentle snow shading
        const roll = rng.nextFloat();
        const col =
          y === 0
            ? PAL_SNOW_LAYER_SIDE[4]!
            : roll < 0.25
              ? PAL_SNOW_LAYER_SIDE[1]!
              : roll < 0.75
                ? PAL_SNOW_LAYER_SIDE[2]!
                : PAL_SNOW_LAYER_SIDE[3]!;
        data[idx] = col[0];
        data[idx + 1] = col[1];
        data[idx + 2] = col[2];
        data[idx + 3] = col[3];
      }
    }
  }

  return data;
}

/**
 * Procedural Fire texture generator (16x16, deterministic).
 */
export function genFire(seed = 42): TextureData {
  const rng = new LCG(seed);
  const data = new Uint8Array(16 * 16 * 4);

  // Initialize to transparent
  for (let i = 0; i < 16 * 16 * 4; i += 4) {
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
    data[i + 3] = 0;
  }

  // Draw 3 flickering flame tongues reaching upward
  const setPixel = (x: number, y: number, color: [number, number, number, number]) => {
    if (x < 0 || x >= 16 || y < 0 || y >= 16) return;
    const idx = (y * 16 + x) * 4;
    data[idx] = color[0];
    data[idx + 1] = color[1];
    data[idx + 2] = color[2];
    data[idx + 3] = color[3];
  };

  // Base rows y = 12..15
  for (let y = 12; y < 16; y++) {
    for (let x = 1; x < 15; x++) {
      const col = y === 15 ? PAL_FIRE[1]! : rng.nextFloat() < 0.5 ? PAL_FIRE[2]! : PAL_FIRE[3]!;
      setPixel(x, y, col);
    }
  }

  // Flame tongues centers around x = 4, x = 8, x = 12
  const tongues = [
    { cx: 4, top: 4 + rng.nextInt(0, 2) },
    { cx: 8, top: 2 + rng.nextInt(0, 2) },
    { cx: 12, top: 5 + rng.nextInt(0, 2) },
  ];

  for (const { cx, top } of tongues) {
    for (let y = top; y < 14; y++) {
      const halfWidth = Math.max(1, Math.round(((14 - y) / (14 - top)) * 2.2));
      for (let dx = -halfWidth; dx <= halfWidth; dx++) {
        const dist = Math.abs(dx);
        let col: [number, number, number, number];
        if (dist === 0) {
          col = y < top + 2 ? PAL_FIRE[6]! : y < top + 5 ? PAL_FIRE[5]! : PAL_FIRE[4]!;
        } else if (dist === 1) {
          col = y < top + 4 ? PAL_FIRE[4]! : PAL_FIRE[3]!;
        } else {
          col = PAL_FIRE[2]!;
        }
        setPixel(cx + dx, y, col);
      }
    }
  }

  return data;
}
