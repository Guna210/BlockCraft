import type { PNG } from 'pngjs';

/** The sky: the clear colour of main.ts, hsl(200, 100 %, 70 %). Fog does not exist until M12a. */
export const SKY_RGB = [102, 204, 255] as const;
export const SKY_TOLERANCE = 16;

/**
 * Largest enclosed sky area a frame may have. Gaps between leaves are smaller; one missing 16x16 chunk
 * at about 190 blocks is roughly 10x60 pixels, 600 in all (decisions/M04b-fade-and-memory.md).
 */
export const MAX_HOLE_PIXELS = 64;

export interface SkyHoleReport {
  /** Sky-coloured pixels in the whole frame. */
  skyPixels: number;
  /** Sky pixels connected (4-neighbour) to a sky pixel of the top row: open sky. */
  openSky: number;
  /** Sky pixels not connected to the top row: enclosed by terrain, so they are holes. */
  enclosedPixels: number;
  /** Size of the largest 4-connected component of enclosed sky. */
  largestEnclosed: number;
}

/** Whether pixel (x, y) of `png` has the sky colour. */
export function isSkyPixel(png: PNG, x: number, y: number): boolean {
  const i = (y * png.width + x) * 4;
  const dr = png.data[i]! - SKY_RGB[0];
  const dg = png.data[i + 1]! - SKY_RGB[1];
  const db = png.data[i + 2]! - SKY_RGB[2];
  return dr * dr + dg * dg + db * db <= SKY_TOLERANCE * SKY_TOLERANCE;
}

/**
 * Classifies the sky of a frame. A flood fill (4-connected) from the sky pixels of the top row gives the
 * open sky, which includes the view past the edge of the loaded terrain. Sky the fill does not reach is
 * enclosed by terrain; its largest 4-connected component is the largest hole.
 */
export function findSkyHoles(png: PNG): SkyHoleReport {
  const w = png.width;
  const h = png.height;
  const sky = new Uint8Array(w * h);
  let skyPixels = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isSkyPixel(png, x, y)) {
        sky[y * w + x] = 1;
        skyPixels++;
      }
    }
  }

  // Open sky: flood fill from the sky pixels of the top row.
  const open = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  for (let x = 0; x < w; x++) {
    if (sky[x]) {
      open[x] = 1;
      queue[tail++] = x;
    }
  }
  let openSky = 0;
  while (head < tail) {
    const p = queue[head++]!;
    openSky++;
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0 && sky[p - 1] && !open[p - 1]) {
      open[p - 1] = 1;
      queue[tail++] = p - 1;
    }
    if (x < w - 1 && sky[p + 1] && !open[p + 1]) {
      open[p + 1] = 1;
      queue[tail++] = p + 1;
    }
    if (y > 0 && sky[p - w] && !open[p - w]) {
      open[p - w] = 1;
      queue[tail++] = p - w;
    }
    if (y < h - 1 && sky[p + w] && !open[p + w]) {
      open[p + w] = 1;
      queue[tail++] = p + w;
    }
  }

  // Enclosed sky: the remaining sky pixels. Largest 4-connected component among them.
  const seen = new Uint8Array(w * h);
  let enclosedPixels = 0;
  let largestEnclosed = 0;
  for (let start = 0; start < w * h; start++) {
    if (!sky[start] || open[start] || seen[start]) continue;
    let size = 0;
    head = 0;
    tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    while (head < tail) {
      const p = queue[head++]!;
      size++;
      const x = p % w;
      const y = (p - x) / w;
      if (x > 0 && sky[p - 1] && !open[p - 1] && !seen[p - 1]) {
        seen[p - 1] = 1;
        queue[tail++] = p - 1;
      }
      if (x < w - 1 && sky[p + 1] && !open[p + 1] && !seen[p + 1]) {
        seen[p + 1] = 1;
        queue[tail++] = p + 1;
      }
      if (y > 0 && sky[p - w] && !open[p - w] && !seen[p - w]) {
        seen[p - w] = 1;
        queue[tail++] = p - w;
      }
      if (y < h - 1 && sky[p + w] && !open[p + w] && !seen[p + w]) {
        seen[p + w] = 1;
        queue[tail++] = p + w;
      }
    }
    enclosedPixels += size;
    if (size > largestEnclosed) largestEnclosed = size;
  }

  return { skyPixels, openSky, enclosedPixels, largestEnclosed };
}
