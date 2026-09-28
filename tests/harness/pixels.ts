import { PNG } from 'pngjs';

/** Convert sRGB (0-255) to linear RGB (0.0-1.0) */
function sRgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** Convert RGB to XYZ */
function rgbToXyz(r: number, g: number, b: number): [number, number, number] {
  const lr = sRgbToLinear(r);
  const lg = sRgbToLinear(g);
  const lb = sRgbToLinear(b);

  const x = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375;
  const y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175;
  const z = lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041;
  return [x * 100, y * 100, z * 100];
}

/** Convert XYZ to CIELAB */
function xyzToLab(x: number, y: number, z: number): [number, number, number] {
  // D65 reference white
  const xn = 95.047;
  const yn = 100.0;
  const zn = 108.883;

  function f(t: number): number {
    return t > 0.008856 ? Math.pow(t, 1 / 3) : 7.787 * t + 16 / 116;
  }

  const fx = f(x / xn);
  const fy = f(y / yn);
  const fz = f(z / zn);

  const l = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const b = 200 * (fy - fz);

  return [l, a, b];
}

/** Calculate Delta E (CIE76) */
function deltaE(lab1: [number, number, number], lab2: [number, number, number]): number {
  return Math.sqrt(
    Math.pow(lab1[0] - lab2[0], 2) +
      Math.pow(lab1[1] - lab2[1], 2) +
      Math.pow(lab1[2] - lab2[2], 2),
  );
}

export function assertNotBlank(png: PNG) {
  const totalPixels = png.width * png.height;
  if (totalPixels === 0) return;

  // Let's use the first pixel as our "one color" to check against initially.
  // Actually, wait, a blank canvas could be *any* color.
  // We can just find the mode color (or just check against the first pixel,
  // if it's >98% one color, the first pixel is very likely that color, or we can just pick a few random pixels).
  // Let's count how many pixels match the color at (0,0).
  // If not >98%, we might need to check the most frequent color.
  // To be safe and simple, let's tally exact RGB colors, find the most frequent, and see if it's >98% within dE 3.

  const colorCounts = new Map<number, number>();
  let maxCount = 0;
  let dominantColor = 0;

  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i] ?? 0;
    const g = png.data[i + 1] ?? 0;
    const b = png.data[i + 2] ?? 0;
    const rgb = (r << 16) | (g << 8) | b;
    const count = (colorCounts.get(rgb) || 0) + 1;
    colorCounts.set(rgb, count);
    if (count > maxCount) {
      maxCount = count;
      dominantColor = rgb;
    }
  }

  const domR = (dominantColor >> 16) & 0xff;
  const domG = (dominantColor >> 8) & 0xff;
  const domB = dominantColor & 0xff;
  const domLab = xyzToLab(...rgbToXyz(domR, domG, domB));

  let closePixels = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i] ?? 0;
    const g = png.data[i + 1] ?? 0;
    const b = png.data[i + 2] ?? 0;
    const lab = xyzToLab(...rgbToXyz(r, g, b));
    if (deltaE(domLab, lab) <= 3) {
      closePixels++;
    }
  }

  const fraction = closePixels / totalPixels;
  if (fraction > 0.98) {
    throw new Error(
      `assertNotBlank failed: ${Math.round(fraction * 100)}% of pixels are blank color`,
    );
  }
}

export function assertNoMissingTexture(png: PNG) {
  const totalPixels = png.width * png.height;
  if (totalPixels === 0) return;

  let missingPixels = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i] ?? 0;
    const g = png.data[i + 1] ?? 0;
    const b = png.data[i + 2] ?? 0;

    // RGB distance to #FF00FF (255, 0, 255)
    const dist = Math.sqrt(Math.pow(r - 255, 2) + Math.pow(g - 0, 2) + Math.pow(b - 255, 2));
    if (dist <= 30) {
      missingPixels++;
    }
  }

  const fraction = missingPixels / totalPixels;
  if (fraction > 0.0005) {
    // > 0.05%
    throw new Error(
      `assertNoMissingTexture failed: ${Math.round(fraction * 10000) / 100}% of pixels are missing texture color (#FF00FF)`,
    );
  }
}

function getLuminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function assertColorVariance(png: PNG, minStdDev: number) {
  const totalPixels = png.width * png.height;
  if (totalPixels === 0) return;

  let sum = 0;
  let sumSq = 0;

  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i] ?? 0;
    const g = png.data[i + 1] ?? 0;
    const b = png.data[i + 2] ?? 0;
    const lum = getLuminance(r, g, b);
    sum += lum;
    sumSq += lum * lum;
  }

  const mean = sum / totalPixels;
  const variance = sumSq / totalPixels - mean * mean;
  const stdDev = Math.sqrt(variance);

  if (stdDev < minStdDev) {
    throw new Error(
      `assertColorVariance failed: stdDev ${stdDev.toFixed(2)} is less than minStdDev ${minStdDev}`,
    );
  }
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function regionMeanColor(png: PNG, rect: Rect): [number, number, number] {
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let count = 0;

  const startX = Math.max(0, rect.x);
  const startY = Math.max(0, rect.y);
  const endX = Math.min(png.width, rect.x + rect.width);
  const endY = Math.min(png.height, rect.y + rect.height);

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const i = (y * png.width + x) * 4;
      rSum += png.data[i] ?? 0;
      gSum += png.data[i + 1] ?? 0;
      bSum += png.data[i + 2] ?? 0;
      count++;
    }
  }

  if (count === 0) return [0, 0, 0];
  return [rSum / count, gSum / count, bSum / count];
}

function rgbToHue(r: number, g: number, b: number): number {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;

  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  let h = 0;

  if (max !== min) {
    const d = max - min;
    switch (max) {
      case rNorm:
        h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0);
        break;
      case gNorm:
        h = (bNorm - rNorm) / d + 2;
        break;
      case bNorm:
        h = (rNorm - gNorm) / d + 4;
        break;
    }
    h /= 6;
  }
  return h * 360;
}

export function assertHueInRange(
  png: PNG,
  rect: Rect,
  range: [number, number],
  minFraction: number,
) {
  const startX = Math.max(0, rect.x);
  const startY = Math.max(0, rect.y);
  const endX = Math.min(png.width, rect.x + rect.width);
  const endY = Math.min(png.height, rect.y + rect.height);

  let matchCount = 0;
  let totalCount = 0;

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const i = (y * png.width + x) * 4;
      const r = png.data[i] ?? 0;
      const g = png.data[i + 1] ?? 0;
      const b = png.data[i + 2] ?? 0;
      const hue = rgbToHue(r, g, b);

      let inRange: boolean;
      if (range[0] <= range[1]) {
        inRange = hue >= range[0] && hue <= range[1];
      } else {
        // Handle hue wrap-around
        inRange = hue >= range[0] || hue <= range[1];
      }

      if (inRange) {
        matchCount++;
      }
      totalCount++;
    }
  }

  if (totalCount === 0) return;

  const fraction = matchCount / totalCount;
  if (fraction < minFraction) {
    throw new Error(
      `assertHueInRange failed: ${Math.round(fraction * 100)}% of pixels in range, expected at least ${Math.round(minFraction * 100)}%`,
    );
  }
}

export function diffFraction(pngA: PNG, pngB: PNG): number {
  if (pngA.width !== pngB.width || pngA.height !== pngB.height) {
    throw new Error('Images must have the same dimensions to diff');
  }

  let diffCount = 0;
  const totalPixels = pngA.width * pngA.height;

  for (let i = 0; i < pngA.data.length; i += 4) {
    if (
      pngA.data[i] !== pngB.data[i] ||
      pngA.data[i + 1] !== pngB.data[i + 1] ||
      pngA.data[i + 2] !== pngB.data[i + 2]
    ) {
      diffCount++;
    }
  }

  return diffCount / totalPixels;
}
