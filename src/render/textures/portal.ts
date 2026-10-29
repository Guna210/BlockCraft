import { LCG, createEmptyTexture, hexToRgb, setPixel, type TextureData } from './noise';

/** Deep violet shadows through cyan to a pale glow (hue-shifted: cooler and darker at the bottom). */
export const PAL_PORTAL = ['#24104a', '#46238a', '#7448d0', '#3aa8d4', '#8eeaff', '#e4fbff'].map(
  (h) => hexToRgb(h),
);

/**
 * Wrap-seamless interleaved swirl bands of the portal surface, used by its item icon. The surface in
 * the world is drawn by the animated portal shader (src/render/portal.ts).
 */
export function genPortal(seed = 32020): TextureData {
  const tile = createEmptyTexture();
  const rng = new LCG(seed);
  const phaseU = rng.nextInt(0, 15) / 16;
  const phaseV = rng.nextInt(0, 15) / 16;
  const tau = Math.PI * 2;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const u = x / 16;
      const v = y / 16;
      // Both terms have period 16 in x and y, so the bands continue across every edge.
      const w =
        Math.sin(tau * (u + v + 0.22 * Math.sin(tau * (v + phaseV)))) +
        Math.sin(tau * (u - v + 0.22 * Math.sin(tau * (u + phaseU))));
      const level = Math.max(0, Math.min(PAL_PORTAL.length - 1, Math.floor(((w + 2) / 4) * 6)));
      setPixel(tile, x, y, PAL_PORTAL[level]!);
    }
  }
  return tile;
}
