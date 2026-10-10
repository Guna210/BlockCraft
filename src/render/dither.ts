/**
 * Ordered dithering for the chunk fade-in (decisions/M04b-fade-and-memory.md). The 4x4 Bayer matrix
 * is the single source of the threshold table: the fragment shader gets it through `bayerGlsl()`, and
 * the unit tests check the same values the shader uses.
 */

/** Bayer 4x4 index matrix, row-major. Each cell is a distinct value from 0 to 15. */
export const BAYER_4X4: readonly number[] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * Threshold of the pixel at (x, y), in (0, 1). A fragment is drawn when the column's fade is above
 * its threshold, so a fade of k/16 keeps exactly k of the 16 pixels of every 4x4 block.
 */
export function bayerThreshold(x: number, y: number): number {
  return (BAYER_4X4[(y & 3) * 4 + (x & 3)]! + 0.5) / 16;
}

/** The threshold table as a GLSL ES 3.00 array initialiser, for the chunk fragment shader. */
export function bayerGlsl(): string {
  return `float[16](${BAYER_4X4.map((v) => ((v + 0.5) / 16).toFixed(6)).join(', ')})`;
}
