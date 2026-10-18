import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import {
  MAX_HOLE_PIXELS,
  NOON_SKY_RADIUS,
  SKY_RGB,
  findSkyHoles,
  isSkyPixel,
} from '../e2e/helpers/sky-holes';

import { textureGenerators } from '../../src/render/textures';
import { BIOME_DEFINITIONS } from '../../src/gen/biomes';
import { GLSL_SKY_ATMOSPHERE } from '../../src/render/sky';

const NOON_SKY = [132, 212, 255] as const;

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
  it('matches noon sky and rejects terrain, legacy clear colour and darkened fog', () => {
    const png = frame(4, 4);
    paint(png, 0, 0, 1, 1, NOON_SKY);
    paint(png, 1, 0, 1, 1, [72, 168, 248]); // noon zenith
    paint(png, 2, 0, 1, 1, [132, 212, 255]); // noon horizon
    paint(png, 3, 0, 1, 1, [125, 201, 242]); // historical darkened horizon fog (sky * 0.95)
    expect(isSkyPixel(png, 0, 0)).toBe(true);
    expect(isSkyPixel(png, 1, 0)).toBe(true);
    expect(isSkyPixel(png, 2, 0)).toBe(true);
    expect(isSkyPixel(png, 3, 0)).toBe(false);
    expect(isSkyPixel(png, 0, 1)).toBe(false);
    paint(png, 0, 0, 1, 1, SKY_RGB);
    expect(isSkyPixel(png, 0, 0)).toBe(false);
  });
});

describe('sky holes: noon curve regression', () => {
  const png = frame(1, 1);
  function classified(rgb: readonly [number, number, number]): boolean {
    paint(png, 0, 0, 1, 1, rgb);
    return isSkyPixel(png, 0, 0);
  }

  it('matches the actual noon horizon-to-zenith curve including framebuffer rounding', () => {
    // Guard the mirrored endpoints and easing against drift in the sky pass.
    expect(GLSL_SKY_ATMOSPHERE).toContain('h * (2.0 - h)');
    expect(GLSL_SKY_ATMOSPHERE).toContain('132.0 / 255.0, 212.0 / 255.0, 1.0');
    expect(GLSL_SKY_ATMOSPHERE).toContain('72.0 / 255.0, 168.0 / 255.0, 248.0 / 255.0');
    for (let step = 0; step <= 100; step++) {
      const h = step / 100;
      const t = h * (2 - h);
      expect(
        classified([Math.round(132 - 60 * t), Math.round(212 - 44 * t), Math.round(255 - 7 * t)]),
      ).toBe(true);
    }
  });

  it('rejects packed ice at fog 0, snow at fog 0.54 and a blue flower', () => {
    for (const rgb of [
      [133, 189, 246],
      [135, 196, 245],
      [123, 164, 252],
    ] as const) {
      expect(classified(rgb), String(rgb)).toBe(false);
    }
  });

  it('rejects every generated block colour across lighting, biome tints and fog 0–0.6', () => {
    const tints: readonly (readonly [number, number, number])[] = [
      [255, 255, 255],
      ...Object.values(BIOME_DEFINITIONS).flatMap((b) => [b.grassTint, b.foliageTint]),
      // Water currently has its blue tint baked into its generated frames.
    ];
    const collisions: string[] = [];
    let closest = Infinity;
    let closestCase = '';
    for (const [name, generator] of Object.entries(textureGenerators)) {
      if (name === 'sun' || name.startsWith('moon_')) continue;
      for (const seed of [0, 42, 12006]) {
        const generated = generator(seed);
        const frames = Array.isArray(generated) ? generated : [generated];
        const colours = new Map<string, [number, number, number]>();
        for (const texture of frames) {
          for (let i = 0; i < texture.length; i += 4) {
            // Ignore transparent cutout texels, which do not draw terrain.
            if (texture[i + 3] === 0 && name !== 'grass_side') continue;
            const rgb: [number, number, number] = [texture[i]!, texture[i + 1]!, texture[i + 2]!];
            colours.set(String(rgb), rgb);
          }
        }
        for (const rgb of colours.values()) {
          for (const light of [0.2, 0.6, 1.0]) {
            for (const tint of tints) {
              // Sample the entire sky curve, including below-horizon fog colour.
              for (const h of [0, 0.25, 0.5, 0.75, 1]) {
                const t = h * (2 - h);
                const sky = [132 - 60 * t, 212 - 44 * t, 255 - 7 * t];
                for (let step = 0; step <= 60; step++) {
                  const fog = step / 100;
                  const blended = rgb.map((c, channel) =>
                    Math.round(
                      ((c * light * tint[channel]!) / 255) * (1 - fog) + sky[channel]! * fog,
                    ),
                  ) as [number, number, number];
                  const [r, g, b] = blended;
                  const projection = Math.max(
                    0,
                    Math.min(1, (-60 * (r - 132) - 44 * (g - 212) - 7 * (b - 255)) / 5585),
                  );
                  const distance = Math.hypot(
                    r - 132 + 60 * projection,
                    g - 212 + 44 * projection,
                    b - 255 + 7 * projection,
                  );
                  if (distance < closest) {
                    closest = distance;
                    closestCase = `${name}: ${rgb}, light=${light}, tint=${tint}, h=${h}, fog=${fog} -> ${blended}`;
                  }
                  if (classified(blended))
                    collisions.push(
                      `${name}: ${rgb}, light=${light}, tint=${tint}, h=${h}, fog=${fog} -> ${blended}`,
                    );
                }
              }
            }
          }
        }
      }
    }
    console.log(
      'm12a-fix closest terrain',
      JSON.stringify({
        closest,
        closestCase,
        radius: NOON_SKY_RADIUS,
        margin: closest - NOON_SKY_RADIUS,
      }),
    );
    expect(closest - NOON_SKY_RADIUS).toBeGreaterThanOrEqual(2);
    expect(collisions.slice(0, 20)).toEqual([]);
    expect(collisions).toHaveLength(0);
  });
});

describe('sky holes: what counts as a hole', () => {
  it('a frame of open sky above terrain has no hole', () => {
    const png = frame(60, 100);
    paint(png, 0, 0, 60, 20, NOON_SKY);
    const r = findSkyHoles(png);
    expect(r.skyPixels).toBe(60 * 20);
    expect(r.openSky).toBe(60 * 20);
    expect(r.enclosedPixels).toBe(0);
    expect(r.largestEnclosed).toBe(0);
  });

  it('an enclosed sky patch of 10 by 60 pixels fails the limit', () => {
    const png = frame(60, 100);
    paint(png, 0, 0, 60, 10, NOON_SKY); // open sky above
    paint(png, 20, 30, 10, 60, NOON_SKY); // a missing chunk: terrain all round it, none touching the top
    // Make sure the enclosed patch is really enclosed: terrain above it, too.
    paint(png, 20, 10, 10, 20, TERRAIN);
    const r = findSkyHoles(png);
    expect(r.enclosedPixels).toBe(600);
    expect(r.largestEnclosed).toBe(600);
    expect(r.largestEnclosed).toBeGreaterThan(MAX_HOLE_PIXELS);
  });

  it('an open notch of 10 by 60 pixels that touches the top row passes', () => {
    const png = frame(60, 100);
    paint(png, 20, 0, 10, 60, NOON_SKY); // sky coming in from the top row, down into the terrain
    const r = findSkyHoles(png);
    expect(r.openSky).toBe(600);
    expect(r.enclosedPixels).toBe(0);
    expect(r.largestEnclosed).toBeLessThanOrEqual(MAX_HOLE_PIXELS);
  });

  it('a small hole of 8 by 8 pixels, the size of gaps between leaves, passes', () => {
    const png = frame(40, 40);
    paint(png, 0, 0, 40, 4, NOON_SKY);
    paint(png, 10, 20, 8, 8, NOON_SKY);
    const r = findSkyHoles(png);
    expect(r.enclosedPixels).toBe(64);
    expect(r.largestEnclosed).toBeLessThanOrEqual(MAX_HOLE_PIXELS);
  });

  it('a sky region that reaches the top row through a narrow column is open, however it bends', () => {
    const png = frame(60, 100);
    paint(png, 0, 0, 1, 1, NOON_SKY); // one pixel in the top row
    paint(png, 0, 1, 40, 1, NOON_SKY); // a long bent path away from it
    paint(png, 39, 2, 1, 40, NOON_SKY);
    const r = findSkyHoles(png);
    expect(r.enclosedPixels).toBe(0);
    expect(r.openSky).toBe(1 + 40 + 40);
  });

  it('sky that touches the left edge but not the top row is enclosed (only the top row opens a region)', () => {
    const png = frame(60, 100);
    paint(png, 0, 30, 10, 20, NOON_SKY);
    const r = findSkyHoles(png);
    expect(r.largestEnclosed).toBe(200);
  });

  it('pixels that only touch diagonally are separate holes', () => {
    const png = frame(10, 10);
    paint(png, 4, 4, 1, 1, NOON_SKY);
    paint(png, 5, 5, 1, 1, NOON_SKY);
    const r = findSkyHoles(png);
    expect(r.enclosedPixels).toBe(2);
    expect(r.largestEnclosed).toBe(1);
  });

  it('reports the largest of several holes, and the total of all of them', () => {
    const png = frame(60, 100);
    paint(png, 2, 20, 3, 3, NOON_SKY); // 9 pixels
    paint(png, 20, 40, 10, 12, NOON_SKY); // 120 pixels
    paint(png, 45, 60, 4, 4, NOON_SKY); // 16 pixels
    const r = findSkyHoles(png);
    expect(r.enclosedPixels).toBe(9 + 120 + 16);
    expect(r.largestEnclosed).toBe(120);
  });
});
