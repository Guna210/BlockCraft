export const LIGHT_MIN_BRIGHTNESS = 0.04;
export const LIGHT_BRIGHTNESS_RANGE = 0.96;
export const AO_UNOCCLUDED = 1;
export const AO_STEP = 0.22;

export function lightBrightness(level: number): number {
  return LIGHT_MIN_BRIGHTNESS + (LIGHT_BRIGHTNESS_RANGE * level) / 15;
}

export function tintOffset(level: number, tint: number): number {
  const inverse =
    ((lightBrightness(level) * tint - LIGHT_MIN_BRIGHTNESS) * 15) / LIGHT_BRIGHTNESS_RANGE;
  return Math.round(level - inverse);
}

export const EMITTER_TINTS: Readonly<Record<string, readonly [number, number, number]>> = {
  torch: [1, 0.8, 0.55],
  kiln: [1, 0.75, 0.4],
  lumite_ore: [0.45, 0.85, 1],
  lumite_block: [0.45, 0.85, 1],
  portal: [0.65, 0.5, 1],
  lava: [1, 0.45, 0.15],
};
