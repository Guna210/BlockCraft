import { LCG, createEmptyTexture, setPixel, type RGBA, type TextureData } from './noise';

export const PAL_SUN: RGBA[] = [
  [0, 0, 0, 0],
  [214, 118, 24, 255],
  [242, 168, 44, 255],
  [255, 214, 82, 255],
  [255, 248, 210, 255],
];

export const PAL_MOON: RGBA[] = [
  [0, 0, 0, 0],
  [36, 44, 68, 255],
  [62, 74, 108, 255],
  [132, 148, 182, 255],
  [196, 210, 234, 255],
  [238, 245, 255, 255],
];

function isInCelestialDisc(x: number, y: number): boolean {
  if (x < 2 || x > 13 || y < 2 || y > 13) return false;
  const cx = x <= 7 ? 2 - x : x - 13;
  const cy = y <= 7 ? 2 - y : y - 13;
  const cornerDist = Math.abs(cx) + Math.abs(cy);
  return cornerDist >= 2;
}

/**
 * Generates the 16x16 procedural sun billboard texture (ART.md compliant).
 * Keeps a 1px transparent outer border so seamless wrap-edge checks remain 0.
 */
export function genSun(seed = 12001): TextureData {
  const tile = createEmptyTexture();
  const rng = new LCG(seed);

  for (let y = 2; y <= 13; y++) {
    for (let x = 2; x <= 13; x++) {
      if (!isInCelestialDisc(x, y)) continue;
      const dx = x - 7.5;
      const dy = y - 7.5;
      const r2 = dx * dx + dy * dy;
      const upperLeft = x + y <= 14;

      let color: RGBA;
      if (r2 <= 8.5) {
        color = upperLeft || r2 <= 4.5 ? PAL_SUN[4]! : PAL_SUN[3]!;
      } else if (r2 >= 20.0) {
        color = upperLeft ? PAL_SUN[2]! : PAL_SUN[1]!;
      } else {
        color = upperLeft ? PAL_SUN[3]! : PAL_SUN[2]!;
      }
      setPixel(tile, x, y, color);
    }
  }

  // Cardinal corona tabs inside 1..14 (leaving 0 and 15 transparent)
  for (const c of [7, 8]) {
    setPixel(tile, c, 1, PAL_SUN[3]!);
    setPixel(tile, c, 14, PAL_SUN[1]!);
    setPixel(tile, 1, c, PAL_SUN[3]!);
    setPixel(tile, 14, c, PAL_SUN[1]!);
  }

  // Seed-driven solar granule cluster inside the core
  for (let i = 0; i < 3; i++) {
    const gx = rng.nextInt(5, 9);
    const gy = rng.nextInt(5, 9);
    const shade = rng.nextInt(0, 1) === 0 ? PAL_SUN[3]! : PAL_SUN[4]!;
    setPixel(tile, gx, gy, shade);
    setPixel(tile, gx + 1, gy, shade);
  }

  return tile;
}

function isMoonPixelLit(phase: number, x: number, y: number): boolean {
  const p = ((phase % 8) + 8) % 8;
  const dy = Math.abs(y - 7.5);
  const arch = dy >= 3.5 ? 1 : 0;
  switch (p) {
    case 0: // Full moon
      return true;
    case 1: // Waning gibbous (left 3/4 lit)
      return x <= 11 - arch;
    case 2: // Third quarter (left half lit)
      return x <= 7;
    case 3: // Waning crescent (left sliver lit)
      return x <= 4 + (dy < 2.5 ? 1 : 0);
    case 4: // New moon (earthshine disc with upper-left limb glint)
      return (x === 4 && y === 2) || (x === 3 && y === 3) || (x === 2 && y === 4);
    case 5: // Waxing crescent (right sliver lit)
      return x >= 11 - (dy < 2.5 ? 1 : 0);
    case 6: // First quarter (right half lit)
      return x >= 8;
    case 7: // Waxing gibbous (right 3/4 lit)
      return x >= 4 + arch;
    default:
      return true;
  }
}

const CRATER_MASK: ReadonlyArray<readonly [number, number]> = [
  [5, 5],
  [6, 5],
  [5, 6],
  [9, 6],
  [10, 6],
  [9, 7],
  [6, 9],
  [7, 9],
  [7, 10],
  [10, 10],
];

/**
 * Generates one of the 8 lunar phase textures (0 = full, 4 = new, etc.).
 */
export function genMoonPhase(phase: number, seed = 12010): TextureData {
  const tile = createEmptyTexture();
  const rng = new LCG(seed + phase * 131);
  const craterSet = new Set<string>();
  for (const [cx, cy] of CRATER_MASK) {
    craterSet.add(`${cx},${cy}`);
  }
  // Seed-driven secondary mare detail
  const extraX = rng.nextInt(4, 10);
  const extraY = rng.nextInt(4, 10);
  craterSet.add(`${extraX},${extraY}`);
  craterSet.add(`${extraX + 1},${extraY}`);

  for (let y = 2; y <= 13; y++) {
    for (let x = 2; x <= 13; x++) {
      if (!isInCelestialDisc(x, y)) continue;
      const lit = isMoonPixelLit(phase, x, y);
      const isCrater = craterSet.has(`${x},${y}`);
      const isRim =
        !isInCelestialDisc(x - 1, y) ||
        !isInCelestialDisc(x + 1, y) ||
        !isInCelestialDisc(x, y - 1) ||
        !isInCelestialDisc(x, y + 1);
      const upperLeft = x + y <= 14;

      let color: RGBA;
      if (lit) {
        if (isRim && upperLeft) {
          color = PAL_MOON[5]!;
        } else if (isCrater) {
          color = PAL_MOON[3]!;
        } else {
          color = PAL_MOON[4]!;
        }
      } else {
        color = isCrater || !upperLeft ? PAL_MOON[1]! : PAL_MOON[2]!;
      }

      setPixel(tile, x, y, color);
    }
  }

  // Ensure lower-right limb of full moon has dark slate edge for crisp silhouette contrast
  if (((phase % 8) + 8) % 8 === 0) {
    setPixel(tile, 12, 11, PAL_MOON[1]!);
    setPixel(tile, 11, 12, PAL_MOON[1]!);
  }

  return tile;
}

export const genMoon0 = (seed = 12010): TextureData => genMoonPhase(0, seed);
export const genMoon1 = (seed = 12010): TextureData => genMoonPhase(1, seed);
export const genMoon2 = (seed = 12010): TextureData => genMoonPhase(2, seed);
export const genMoon3 = (seed = 12010): TextureData => genMoonPhase(3, seed);
export const genMoon4 = (seed = 12010): TextureData => genMoonPhase(4, seed);
export const genMoon5 = (seed = 12010): TextureData => genMoonPhase(5, seed);
export const genMoon6 = (seed = 12010): TextureData => genMoonPhase(6, seed);
export const genMoon7 = (seed = 12010): TextureData => genMoonPhase(7, seed);
