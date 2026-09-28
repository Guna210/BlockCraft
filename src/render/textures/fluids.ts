// src/render/textures/fluids.ts
import { createEmptyTexture, TextureData, SimpleNoise, RGB, setPixel } from './noise';

// Water: animated 32 frames
export function genWaterFrames(): TextureData[] {
  const frames: TextureData[] = [];
  const noise = new SimpleNoise(771);
  const baseColor: RGB = [40, 100, 200];

  for (let f = 0; f < 32; f++) {
    const data = createEmptyTexture();
    const timeOffset = f * 0.1;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const n = noise.noise2D(x * 0.2 + timeOffset, y * 0.2 + timeOffset);
        const offset = Math.floor(n * 20);
        setPixel(data, x, y, [
          baseColor[0]! + offset,
          baseColor[1]! + offset,
          baseColor[2]! + offset,
          200,
        ]);
      }
    }
    frames.push(data);
  }
  return frames;
}

// Lava: animated 32 frames
export function genLavaFrames(): TextureData[] {
  const frames: TextureData[] = [];
  const noise = new SimpleNoise(772);
  const baseColor: RGB = [220, 80, 20];

  for (let f = 0; f < 32; f++) {
    const data = createEmptyTexture();
    const timeOffset = f * 0.05;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const n = noise.noise2D(x * 0.15 - timeOffset, y * 0.15 + timeOffset);
        const offset = Math.floor(n * 30);
        // Lava ranges from red to bright yellow
        let r = baseColor[0]! + offset;
        let g = baseColor[1]! + offset * 1.5;
        let b = baseColor[2]!;
        r = Math.min(255, Math.max(0, r));
        g = Math.min(255, Math.max(0, g));
        b = Math.min(255, Math.max(0, b));

        setPixel(data, x, y, [r, g, b, 255]);
      }
    }
    frames.push(data);
  }
  return frames;
}
