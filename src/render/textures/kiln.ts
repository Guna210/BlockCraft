import {
  createEmptyTexture,
  fillSolid,
  hexToRgb,
  LCG,
  setPixel,
  type RGBA,
  type TextureData,
} from './noise';
import { PAL_STONE } from './terrain';

export const PAL_KILN_FRONT: RGBA[] = [
  ...PAL_STONE,
  hexToRgb('#18181b'),
  hexToRgb('#26262b'),
  hexToRgb('#36363d'),
];

export const PAL_KILN_FRONT_LIT: RGBA[] = [
  ...PAL_STONE,
  hexToRgb('#261614'),
  hexToRgb('#8f1d07'),
  hexToRgb('#d4420c'),
  hexToRgb('#f58814'),
  hexToRgb('#ffd738'),
];

export const PAL_KILN_TOP: RGBA[] = [...PAL_STONE, hexToRgb('#18181b'), hexToRgb('#26262b')];

export const PAL_KILN_SIDE: RGBA[] = [...PAL_STONE];
export const PAL_KILN_BOTTOM: RGBA[] = [...PAL_STONE];

function genStoneBase(seed: number): TextureData {
  const data = createEmptyTexture();
  const lcg = new LCG(seed);
  fillSolid(data, PAL_STONE[1]!);

  for (let i = 0; i < 8; i++) {
    const cx = lcg.nextInt(0, 15);
    const cy = lcg.nextInt(0, 15);
    const color = PAL_STONE[lcg.nextInt(0, PAL_STONE.length - 1)]!;

    const clusterSize = lcg.nextInt(3, 8);
    let px = cx;
    let py = cy;
    for (let j = 0; j < clusterSize; j++) {
      setPixel(data, (px + 16) % 16, (py + 16) % 16, color);
      px += lcg.nextInt(-1, 1);
      py += lcg.nextInt(-1, 1);
    }
  }

  for (let i = 0; i < 3; i++) {
    const cx = lcg.nextInt(0, 15);
    const cy = lcg.nextInt(0, 15);
    const color = PAL_STONE[0]!;
    const dx = lcg.nextInt(-1, 1);
    const dy = lcg.nextInt(1, 2);
    setPixel(data, cx, cy, color);
    setPixel(data, (cx + dx + 16) % 16, (cy + dy + 16) % 16, color);
  }

  return data;
}

/** Unlit kiln front face with an arched stone opening and dark charcoal chamber. */
export function genKilnFront(seed = 52181): TextureData {
  const data = genStoneBase(seed);

  // Arched opening border highlight (top-left) and shadow (bottom-right)
  const highlight = PAL_STONE[3]!;
  const shadow = PAL_STONE[0]!;

  // Arch top rim (y = 6)
  for (let x = 5; x <= 10; x++) setPixel(data, x, 6, highlight);
  // Sides
  for (let y = 7; y <= 13; y++) {
    setPixel(data, 3, y, highlight);
    setPixel(data, 12, y, shadow);
  }
  // Bottom sill
  for (let x = 3; x <= 12; x++) setPixel(data, x, 14, shadow);

  // Cavity interior
  const dark0 = PAL_KILN_FRONT[5]!; // #18181b
  const dark1 = PAL_KILN_FRONT[6]!; // #26262b
  const ash = PAL_KILN_FRONT[7]!; // #36363d

  // Arch top curve (y = 7)
  for (let x = 5; x <= 10; x++) setPixel(data, x, 7, dark0);
  // Main chamber (y = 8..13, x = 4..11)
  for (let y = 8; y <= 13; y++) {
    for (let x = 4; x <= 11; x++) {
      if (y === 13) {
        setPixel(data, x, y, (x & 1) === 0 ? ash : dark1);
      } else if (y === 12) {
        setPixel(data, x, y, x % 3 === 0 ? ash : dark0);
      } else if (x === 4 || y === 8) {
        setPixel(data, x, y, dark0);
      } else {
        setPixel(data, x, y, dark1);
      }
    }
  }

  return data;
}

/** Lit kiln front face with glowing fire and bright hot coals visible in the arched opening. */
export function genKilnFrontLit(seed = 52182): TextureData {
  const data = genStoneBase(seed);

  const highlight = PAL_STONE[3]!;
  const shadow = PAL_STONE[0]!;

  for (let x = 5; x <= 10; x++) setPixel(data, x, 6, highlight);
  for (let y = 7; y <= 13; y++) {
    setPixel(data, 3, y, highlight);
    setPixel(data, 12, y, shadow);
  }
  for (let x = 3; x <= 12; x++) setPixel(data, x, 14, shadow);

  const smoke = PAL_KILN_FRONT_LIT[5]!; // #261614
  const ember = PAL_KILN_FRONT_LIT[6]!; // #8f1d07
  const flameRed = PAL_KILN_FRONT_LIT[7]!; // #d4420c
  const flameOrange = PAL_KILN_FRONT_LIT[8]!; // #f58814
  const flameYellow = PAL_KILN_FRONT_LIT[9]!; // #ffd738

  // Arch top smoke (y = 7)
  for (let x = 5; x <= 10; x++) setPixel(data, x, 7, smoke);

  // Flaming interior
  for (let y = 8; y <= 13; y++) {
    for (let x = 4; x <= 11; x++) {
      if (y === 8) {
        setPixel(data, x, y, x >= 6 && x <= 9 ? ember : smoke);
      } else if (y === 9) {
        setPixel(data, x, y, x >= 6 && x <= 8 ? flameOrange : flameRed);
      } else if (y === 10 || y === 11) {
        if (x >= 6 && x <= 9) {
          setPixel(data, x, y, x === 7 || x === 8 ? flameYellow : flameOrange);
        } else {
          setPixel(data, x, y, flameRed);
        }
      } else if (y === 12) {
        setPixel(data, x, y, x >= 6 && x <= 9 ? flameYellow : flameOrange);
      } else {
        // Bottom coals (y = 13)
        setPixel(data, x, y, (x & 1) === 0 ? flameRed : ember);
      }
    }
  }

  return data;
}

/** Kiln top face with circular flue / exhaust vent. */
export function genKilnTop(seed = 52183): TextureData {
  const data = genStoneBase(seed);

  const holeDark = PAL_KILN_TOP[5]!;
  const holeMid = PAL_KILN_TOP[6]!;
  const rimLight = PAL_STONE[3]!;
  const rimDark = PAL_STONE[0]!;

  // Circular vent rim
  for (let y = 5; y <= 10; y++) {
    for (let x = 5; x <= 10; x++) {
      const dx = x - 7.5;
      const dy = y - 7.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= 2.2) {
        setPixel(data, x, y, d < 1.2 ? holeDark : holeMid);
      } else if (d <= 3.2) {
        setPixel(data, x, y, dx + dy < 0 ? rimLight : rimDark);
      }
    }
  }

  return data;
}

/** Kiln side face with masonry bands. */
export function genKilnSide(seed = 52184): TextureData {
  const data = genStoneBase(seed);
  // Add subtle horizontal brick mortar seams at y = 5 and y = 10
  for (let x = 0; x < 16; x++) {
    if (x % 3 !== 0) {
      setPixel(data, x, 5, PAL_STONE[0]!);
      setPixel(data, x, 10, PAL_STONE[0]!);
    }
  }
  return data;
}

/** Kiln bottom face. */
export function genKilnBottom(seed = 52185): TextureData {
  return genStoneBase(seed);
}
