// A 5×7 bitmap font drawn by code. Each glyph is seven rows of five bits, written as text.
const GLYPHS: Record<string, string> = {
  A: '01110 10001 10001 11111 10001 10001 10001',
  B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110',
  D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 10000 11110 10000 10000 11111',
  F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111',
  H: '10001 10001 10001 11111 10001 10001 10001',
  I: '01110 00100 00100 00100 00100 00100 01110',
  J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001',
  L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001',
  N: '10001 11001 10101 10011 10001 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110',
  P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101',
  R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110',
  T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110',
  V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 10101 01010',
  X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100',
  Z: '11111 00001 00010 00100 01000 10000 11111',
  '0': '01110 10001 10011 10101 11001 10001 01110',
  '1': '00100 01100 00100 00100 00100 00100 01110',
  '2': '01110 10001 00001 00010 00100 01000 11111',
  '3': '11110 00001 00001 01110 00001 00001 11110',
  '4': '00010 00110 01010 10010 11111 00010 00010',
  '5': '11111 10000 11110 00001 00001 10001 01110',
  '6': '00110 01000 10000 11110 10001 10001 01110',
  '7': '11111 00001 00010 00100 01000 01000 01000',
  '8': '01110 10001 10001 01110 10001 10001 01110',
  '9': '01110 10001 10001 01111 00001 00010 01100',
  '-': '00000 00000 00000 11111 00000 00000 00000',
  '.': '00000 00000 00000 00000 00000 01100 01100',
  '/': '00001 00010 00100 01000 10000 00000 00000',
  ':': '00000 01100 01100 00000 01100 01100 00000',
  "'": '00100 00100 01000 00000 00000 00000 00000',
  '!': '00100 00100 00100 00100 00100 00000 00100',
  '?': '01110 10001 00001 00010 00100 00000 00100',
  ',': '00000 00000 00000 00000 01100 00100 01000',
  '&': '01100 10010 10100 01000 10101 10010 01101',
  '+': '00000 00100 00100 11111 00100 00100 00000',
  '(': '00010 00100 01000 01000 01000 00100 00010',
  ')': '01000 00100 00010 00010 00010 00100 01000',
  ' ': '00000 00000 00000 00000 00000 00000 00000',
};

export const GLYPH_WIDTH = 5;
export const GLYPH_HEIGHT = 7;
/** Horizontal advance of one character, in font pixels. */
export const GLYPH_ADVANCE = 6;

const rows = new Map<string, number[]>();
for (const [char, text] of Object.entries(GLYPHS))
  rows.set(
    char,
    text.split(' ').map((row) => parseInt(row, 2)),
  );

/** Upper-cases an item id for display: `iron_helmet` → `IRON HELMET`. */
export function displayName(id: string): string {
  return id.replace(/_/g, ' ').toUpperCase();
}

/** Adds an optional affix before the item name for inventory and container tooltips. */
export function displayItemStackName(id: string, affix?: string): string {
  return (affix ? affix.toUpperCase() + ' ' : '') + displayName(id);
}

/** The seven row bitmasks of `char` (a space when the font has no such glyph). */
export function glyphRows(char: string): readonly number[] {
  return rows.get(char.toUpperCase()) ?? rows.get(' ')!;
}

export function hasGlyph(char: string): boolean {
  return rows.has(char.toUpperCase());
}

export function textWidth(text: string): number {
  return text.length === 0 ? 0 : text.length * GLYPH_ADVANCE - 1;
}

/** Draws text with its top-left corner at (x, y) in canvas pixels; `scale` is canvas pixels per font pixel. */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: string,
  shadow?: string,
): void {
  for (const [dx, dy, fill] of shadow
    ? ([
        [1, 1, shadow],
        [0, 0, color],
      ] as const)
    : ([[0, 0, color]] as const)) {
    ctx.fillStyle = fill;
    for (let i = 0; i < text.length; i++) {
      const glyph = rows.get(text[i]!.toUpperCase()) ?? rows.get(' ')!;
      for (let row = 0; row < GLYPH_HEIGHT; row++) {
        const bits = glyph[row]!;
        for (let col = 0; col < GLYPH_WIDTH; col++)
          if (bits & (1 << (GLYPH_WIDTH - 1 - col)))
            ctx.fillRect(
              x + (i * GLYPH_ADVANCE + col + dx) * scale,
              y + (row + dy) * scale,
              scale,
              scale,
            );
      }
    }
  }
}
