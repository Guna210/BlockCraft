import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { MAX_HOLE_PIXELS, SKY_RGB, findSkyHoles, isSkyPixel } from '../e2e/helpers/sky-holes';

const TERRAIN = [60, 120, 40] as const;

/** A frame filled with terrain colour. */
function frame(width: number, height: number): PNG {
  const png = new PNG({ width, height });
  paint(png, 0, 0, width, height, TERRAIN);
  return png;
}

/** Fills the rectangle [x, x+w) x [y, y+h) with one colour. */
function paint(
  png: PNG,
  x: number,
  y: number,
  w: number,
  h: number,
  rgb: readonly [number, number, number],
): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const i = (yy * png.width + xx) * 4;
      png.data[i] = rgb[0];
      png.data[i + 1] = rgb[1];
      png.data[i + 2] = rgb[2];
      png.data[i + 3] = 255;
    }
  }
}

describe('sky holes: the sky colour', () => {
  it('matches the clear colour and not terrain', () => {
    const png = frame(4, 4);
    paint(png, 0, 0, 1, 1, SKY_RGB);
    expect(isSkyPixel(png, 0, 0)).toBe(true);
    expect(isSkyPixel(png, 1, 0)).toBe(false);
  });
});

describe('sky holes: what counts as a hole', () => {
  it('a frame of open sky above terrain has no hole', () => {
    const png = frame(60, 100);
    paint(png, 0, 0, 60, 20, SKY_RGB);
    const r = findSkyHoles(png);
    expect(r.skyPixels).toBe(60 * 20);
    expect(r.openSky).toBe(60 * 20);
    expect(r.enclosedPixels).toBe(0);
    expect(r.largestEnclosed).toBe(0);
  });

  it('an enclosed sky patch of 10 by 60 pixels fails the limit', () => {
    const png = frame(60, 100);
    paint(png, 0, 0, 60, 10, SKY_RGB); // open sky above
    paint(png, 20, 30, 10, 60, SKY_RGB); // a missing chunk: terrain all round it, none touching the top
    // Make sure the enclosed patch is really enclosed: terrain above it, too.
    paint(png, 20, 10, 10, 20, TERRAIN);
    const r = findSkyHoles(png);
    expect(r.enclosedPixels).toBe(600);
    expect(r.largestEnclosed).toBe(600);
    expect(r.largestEnclosed).toBeGreaterThan(MAX_HOLE_PIXELS);
  });

  it('an open notch of 10 by 60 pixels that touches the top row passes', () => {
    const png = frame(60, 100);
    paint(png, 20, 0, 10, 60, SKY_RGB); // sky coming in from the top row, down into the terrain
    const r = findSkyHoles(png);
    expect(r.openSky).toBe(600);
    expect(r.enclosedPixels).toBe(0);
    expect(r.largestEnclosed).toBeLessThanOrEqual(MAX_HOLE_PIXELS);
  });

  it('a small hole of 8 by 8 pixels, the size of gaps between leaves, passes', () => {
    const png = frame(40, 40);
    paint(png, 0, 0, 40, 4, SKY_RGB);
    paint(png, 10, 20, 8, 8, SKY_RGB);
    const r = findSkyHoles(png);
    expect(r.enclosedPixels).toBe(64);
    expect(r.largestEnclosed).toBeLessThanOrEqual(MAX_HOLE_PIXELS);
  });

  it('a sky region that reaches the top row through a narrow column is open, however it bends', () => {
    const png = frame(60, 100);
    paint(png, 0, 0, 1, 1, SKY_RGB); // one pixel in the top row
    paint(png, 0, 1, 40, 1, SKY_RGB); // a long bent path away from it
    paint(png, 39, 2, 1, 40, SKY_RGB);
    const r = findSkyHoles(png);
    expect(r.enclosedPixels).toBe(0);
    expect(r.openSky).toBe(1 + 40 + 40);
  });

  it('sky that touches the left edge but not the top row is enclosed (only the top row opens a region)', () => {
    const png = frame(60, 100);
    paint(png, 0, 30, 10, 20, SKY_RGB);
    const r = findSkyHoles(png);
    expect(r.largestEnclosed).toBe(200);
  });

  it('pixels that only touch diagonally are separate holes', () => {
    const png = frame(10, 10);
    paint(png, 4, 4, 1, 1, SKY_RGB);
    paint(png, 5, 5, 1, 1, SKY_RGB);
    const r = findSkyHoles(png);
    expect(r.enclosedPixels).toBe(2);
    expect(r.largestEnclosed).toBe(1);
  });

  it('reports the largest of several holes, and the total of all of them', () => {
    const png = frame(60, 100);
    paint(png, 2, 20, 3, 3, SKY_RGB); // 9 pixels
    paint(png, 20, 40, 10, 12, SKY_RGB); // 120 pixels
    paint(png, 45, 60, 4, 4, SKY_RGB); // 16 pixels
    const r = findSkyHoles(png);
    expect(r.enclosedPixels).toBe(9 + 120 + 16);
    expect(r.largestEnclosed).toBe(120);
  });
});
