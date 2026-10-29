import { createEmptyTexture, LCG, setPixel, type RGBA, type TextureData } from './noise';

const CLEAR: RGBA = [0, 0, 0, 0];

/** Blackened iron cage bars with a dull ember glint, open between the bars. */
export const PAL_SPAWNER: RGBA[] = [
  CLEAR,
  [22, 20, 28, 255],
  [38, 36, 48, 255],
  [62, 60, 76, 255],
  [96, 94, 112, 255],
  [140, 92, 70, 255],
];

/** Pale silk strands over a fully clear background. */
export const PAL_SILKMESH: RGBA[] = [
  CLEAR,
  [150, 148, 160, 255],
  [196, 196, 204, 255],
  [236, 236, 240, 255],
];

/** Weathered oak ties under two dark iron rails. */
export const PAL_DECORATIVE_RAIL: RGBA[] = [
  CLEAR,
  [69, 49, 31, 255],
  [91, 66, 42, 255],
  [115, 85, 55, 255],
  [52, 54, 60, 255],
  [98, 102, 110, 255],
  [150, 154, 160, 255],
];

function clear(texture: TextureData): void {
  for (let i = 0; i < 256; i++) texture[i * 4 + 3] = 0;
}

/**
 * Spawner cage: a grid of iron bars every 4 pixels (so it tiles seamlessly) with bright riveted
 * joints, darker lower bar segments and a few ember-hot glints, open between the bars so the
 * spinning creature shows through.
 */
export function genSpawner(seed = 0): TextureData {
  const texture = createEmptyTexture();
  clear(texture);
  const rng = new LCG(seed);
  const [, darkest, dark, mid, light, ember] = PAL_SPAWNER as [RGBA, RGBA, RGBA, RGBA, RGBA, RGBA];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const barX = x % 4 === 1;
      const barY = y % 4 === 1;
      if (barX && barY) setPixel(texture, x, y, light);
      else if (barX) setPixel(texture, x, y, y % 4 === 3 ? darkest : y % 4 === 2 ? mid : dark);
      else if (barY)
        setPixel(texture, x, y, x % 4 === 2 ? mid : rng.nextFloat() < 0.12 ? ember : dark);
    }
  }
  return texture;
}

function strand(
  texture: TextureData,
  from: readonly [number, number],
  to: readonly [number, number],
  color: RGBA,
): void {
  const steps = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
  for (let s = 0; s <= steps; s++) {
    const t = steps === 0 ? 0 : s / steps;
    setPixel(
      texture,
      Math.round(from[0] + (to[0] - from[0]) * t),
      Math.round(from[1] + (to[1] - from[1]) * t),
      color,
    );
  }
}

/**
 * Silkmesh: radial strands from an off-centre knot crossed by two irregular rings, brighter
 * toward the top-left. Drawn as a cross model, so the clear background is most of the tile.
 */
export function genSilkmesh(seed = 0): TextureData {
  const texture = createEmptyTexture();
  clear(texture);
  const rng = new LCG(seed);
  const [, shadow, base, glint] = PAL_SILKMESH as [RGBA, RGBA, RGBA, RGBA];
  const cx = 7;
  const cy = 7;
  const spokes: Array<readonly [number, number]> = [
    [0, 0],
    [7, 0],
    [15, 1],
    [15, 8],
    [14, 15],
    [6, 15],
    [0, 13],
    [0, 6],
  ];
  for (const end of spokes) strand(texture, [cx, cy], end, end[0] + end[1] < 15 ? base : shadow);
  for (const radius of [3, 6]) {
    let prev: [number, number] | null = null;
    for (let i = 0; i <= spokes.length; i++) {
      const end = spokes[i % spokes.length]!;
      const dx = end[0] - cx;
      const dy = end[1] - cy;
      const len = Math.max(1, Math.hypot(dx, dy));
      const sag = rng.nextFloat() < 0.5 ? 0 : 1;
      const point: [number, number] = [
        Math.round(cx + (dx / len) * (radius + sag)),
        Math.round(cy + (dy / len) * (radius + sag)),
      ];
      if (prev) strand(texture, prev, point, radius === 3 ? base : shadow);
      prev = point;
    }
  }
  setPixel(texture, cx, cy, glint);
  setPixel(texture, cx - 1, cy, glint);
  setPixel(texture, cx, cy - 1, glint);
  setPixel(texture, 2, 2, glint);
  setPixel(texture, 3, 3, glint);
  return texture;
}

/**
 * Decorative rail seen from above: four wooden ties with a lit top edge and a dark lower
 * edge, under two iron rails with a highlight stripe. `axis` 'z' runs the rails up the tile.
 */
export function genDecorativeRail(axis: 'x' | 'z', seed = 0): TextureData {
  const texture = createEmptyTexture();
  clear(texture);
  const rng = new LCG(seed);
  const [, tieDark, tie, tieLight, railDark, rail, railLight] = PAL_DECORATIVE_RAIL as [
    RGBA,
    RGBA,
    RGBA,
    RGBA,
    RGBA,
    RGBA,
    RGBA,
  ];
  const put = (u: number, v: number, color: RGBA): void => {
    if (axis === 'z') setPixel(texture, u, v, color);
    else setPixel(texture, v, u, color);
  };
  for (const start of [1, 5, 9, 13]) {
    for (let u = 1; u < 15; u++) {
      put(u, start, tieLight);
      put(u, start + 1, rng.nextFloat() < 0.2 ? tieDark : tie);
      put(u, start + 2, tieDark);
    }
  }
  for (let v = 0; v < 16; v++) {
    for (const u of [3, 11]) {
      put(u, v, railLight);
      put(u + 1, v, rail);
      put(u + 2, v, railDark);
    }
  }
  return texture;
}
