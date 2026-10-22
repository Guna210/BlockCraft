import { GLYPH_HEIGHT, GLYPH_WIDTH, glyphRows } from './pixel-font';

/**
 * The "BLOCKCRAFT" logo, drawn by code as extruded block letters (ART.md: limited, hue-shifted
 * palette lit from the top-left; no font file). Every pixel of a letter is a 4×4 stone block with a
 * dithered face; blocks with open sky above wear a grass cap, and the letters cast a two-pixel
 * extrusion down and to the right.
 */

export const LOGO_TEXT = 'BLOCKCRAFT';
/** UI pixels per letter pixel. */
export const LOGO_CELL = 4;
/** Depth of the extrusion in UI pixels. */
export const LOGO_DEPTH = 3;

/** The logo's declared palette, dark → light per ramp (ART.md §1.1: at most 12 colours). */
export const LOGO_PALETTE = {
  outline: '#15121f',
  extrudeDark: '#262338',
  extrude: '#3a3d5a',
  stoneDark: '#585c66',
  stone: '#767a7f',
  stoneMid: '#8b8f94',
  stoneLight: '#b3b5ae',
  grassDark: '#3f6b24',
  grass: '#63a038',
  grassLight: '#a6d862',
} as const;

export interface LogoImage {
  width: number;
  height: number;
  /** RGBA, row-major, transparent where nothing is drawn. */
  data: Uint8ClampedArray<ArrayBuffer>;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const ADVANCE = GLYPH_WIDTH + 1;

/** Letter-pixel grid of the whole word: true where a block stands. */
function letterGrid(): { cols: number; rows: number; at: (c: number, r: number) => boolean } {
  const cols = LOGO_TEXT.length * ADVANCE - 1;
  const rows = GLYPH_HEIGHT;
  const cells = new Uint8Array(cols * rows);
  [...LOGO_TEXT].forEach((char, index) => {
    const glyph = glyphRows(char);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < GLYPH_WIDTH; c++)
        if (glyph[r]! & (1 << (GLYPH_WIDTH - 1 - c))) cells[r * cols + index * ADVANCE + c] = 1;
  });
  return {
    cols,
    rows,
    at: (c, r) => c >= 0 && r >= 0 && c < cols && r < rows && cells[r * cols + c] === 1,
  };
}

/** Renders the logo into an RGBA buffer, one buffer pixel per UI pixel. */
export function renderLogo(): LogoImage {
  const grid = letterGrid();
  // One pixel of outline all round, plus the extrusion on the bottom-right.
  const width = grid.cols * LOGO_CELL + LOGO_DEPTH + 2;
  const height = grid.rows * LOGO_CELL + LOGO_DEPTH + 2;
  const data = new Uint8ClampedArray(width * height * 4);
  const colour = new Array<string | null>(width * height).fill(null);
  const put = (x: number, y: number, hex: string) => {
    if (x >= 0 && y >= 0 && x < width && y < height) colour[y * width + x] = hex;
  };
  const P = LOGO_PALETTE;

  // 1. Extrusion: each block's silhouette repeated 1..DEPTH pixels down-right, darker further back.
  for (let d = LOGO_DEPTH; d >= 1; d--)
    for (let r = 0; r < grid.rows; r++)
      for (let c = 0; c < grid.cols; c++) {
        if (!grid.at(c, r)) continue;
        for (let y = 0; y < LOGO_CELL; y++)
          for (let x = 0; x < LOGO_CELL; x++)
            put(
              1 + c * LOGO_CELL + x + d,
              1 + r * LOGO_CELL + y + d,
              d === LOGO_DEPTH ? P.extrudeDark : P.extrude,
            );
      }

  // 2. Block faces: top-left bevel, bottom-right shade, checker-dithered face, grass caps.
  for (let r = 0; r < grid.rows; r++)
    for (let c = 0; c < grid.cols; c++) {
      if (!grid.at(c, r)) continue;
      const ox = 1 + c * LOGO_CELL;
      const oy = 1 + r * LOGO_CELL;
      const open = {
        up: !grid.at(c, r - 1),
        left: !grid.at(c - 1, r),
        down: !grid.at(c, r + 1),
        right: !grid.at(c + 1, r),
      };
      for (let y = 0; y < LOGO_CELL; y++)
        for (let x = 0; x < LOGO_CELL; x++) {
          // Two stone tones in a 2×2 checker, offset per block so joints read as separate stones.
          let hex: string = ((x + y + c + r) & 1) === 0 ? P.stoneMid : P.stone;
          if ((y === 0 && open.up) || (x === 0 && open.left)) hex = P.stoneLight;
          if ((y === LOGO_CELL - 1 && open.down) || (x === LOGO_CELL - 1 && open.right))
            hex = P.stoneDark;
          if (open.up) {
            // Grass cap: bright top row, mid row, and a ragged dark fringe hanging below.
            if (y === 0) hex = x === LOGO_CELL - 1 && open.right ? P.grass : P.grassLight;
            else if (y === 1) hex = P.grass;
            else if (y === 2 && ((x + c) & 1) === 0) hex = P.grassDark;
          }
          put(ox + x, oy + y, hex);
        }
    }

  // 3. Outline: every empty pixel touching a drawn one becomes the outline colour.
  const filled = colour.map((value) => value !== null);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (filled[y * width + x]) continue;
      const near = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dy]) => {
        const nx = x + dx!;
        const ny = y + dy!;
        return nx >= 0 && ny >= 0 && nx < width && ny < height && filled[ny * width + nx];
      });
      if (near) colour[y * width + x] = P.outline;
    }

  for (let i = 0; i < colour.length; i++) {
    const hex = colour[i];
    if (!hex) continue;
    const [red, green, blue] = rgb(hex);
    data[i * 4] = red;
    data[i * 4 + 1] = green;
    data[i * 4 + 2] = blue;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}
