import {
  createEmptyTexture,
  fillSolid,
  hexToRgb,
  LCG,
  setPixel,
  type RGBA,
  type TextureData,
} from './noise';

export const STAINED_GLASS_COLORS = [
  'red',
  'orange',
  'yellow',
  'green',
  'cyan',
  'blue',
  'purple',
  'pink',
] as const;
export type StainedGlassColor = (typeof STAINED_GLASS_COLORS)[number];

// Per colour: dark frame, pane tint, deeper streak shade. Hues shift cooler in the shade.
const RAMPS: Record<StainedGlassColor, [string, string, string]> = {
  red: ['#7a1a2e', '#d83a4a', '#a8243d'],
  orange: ['#8a3a12', '#f08a2a', '#c4601c'],
  yellow: ['#8a6a12', '#f2d23a', '#c9a022'],
  green: ['#1e5a2a', '#46b858', '#2e8a40'],
  cyan: ['#145a6a', '#38c8d8', '#22929f'],
  blue: ['#1c2e82', '#3a62e0', '#2a46b0'],
  purple: ['#4a1a78', '#9a52d8', '#7234a8'],
  pink: ['#8a1e5a', '#f06aae', '#c4408a'],
};

const STAINED_FRAME_ALPHA = 215;
const STAINED_PANE_ALPHA = 120;
const STAINED_SHADE_ALPHA = 150;
const STAINED_GLINT_ALPHA = 205;

/** Palette of one stained glass tile: frame, pane, deeper shade and a white glint. */
export function stainedGlassPalette(color: StainedGlassColor) {
  const [frame, pane, shade] = RAMPS[color];
  return [
    hexToRgb(frame, STAINED_FRAME_ALPHA),
    hexToRgb(pane, STAINED_PANE_ALPHA),
    hexToRgb(shade, STAINED_SHADE_ALPHA),
    hexToRgb('#ffffff', STAINED_GLINT_ALPHA),
  ];
}

/**
 * A tinted translucent pane in a darker frame. Two diagonal glint streaks run top-left to
 * bottom-right with a deeper shade pixel beside each (light from the top-left); the seed places
 * the streaks, so each colour of one seed family differs only by palette.
 */
export function genStainedGlass(color: StainedGlassColor, seed = 5150): TextureData {
  const [frame, pane, shade, glint] = stainedGlassPalette(color) as [RGBA, RGBA, RGBA, RGBA];
  const rng = new LCG(seed);
  const data = createEmptyTexture();
  fillSolid(data, pane);
  for (let i = 0; i < 16; i++) {
    setPixel(data, i, 0, frame);
    setPixel(data, i, 15, frame);
    setPixel(data, 0, i, frame);
    setPixel(data, 15, i, frame);
  }
  // First streak in the upper-left half, second in the lower-right half.
  const streaks: Array<[number, number, number]> = [
    [rng.nextInt(2, 5), rng.nextInt(2, 5), rng.nextInt(3, 5)],
    [rng.nextInt(8, 10), rng.nextInt(8, 10), rng.nextInt(2, 4)],
  ];
  for (const [x, y, length] of streaks)
    for (let i = 0; i < length; i++) {
      setPixel(data, x + i, y + i, glint);
      setPixel(data, x + i + 1, y + i, shade);
    }
  return data;
}
