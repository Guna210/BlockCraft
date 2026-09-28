// src/render/textures/fluids.ts
import { createEmptyTexture, TextureData, SimpleNoise, setPixel, hexToRgb } from './noise';

const PAL_WATER = ['#1f4f94', '#2b5fa8', '#3a73c0', '#4c88d4', '#8ec0f0'].map((h) => hexToRgb(h));
const PAL_LAVA_CRUST = ['#2a0d06', '#4a1709'].map((h) => hexToRgb(h));
const PAL_LAVA_MOLTEN = ['#b8360b', '#e45f10', '#f7931c', '#ffd24a'].map((h) => hexToRgb(h));
const PAL_LAVA = [...PAL_LAVA_CRUST, ...PAL_LAVA_MOLTEN];

// Water: animated 32 frames, seamless loop
export function genWaterFrames(): TextureData[] {
  const frames: TextureData[] = [];
  const noise = new SimpleNoise(771);

  for (let f = 0; f < 32; f++) {
    const data = createEmptyTexture();
    const t = f / 32;

    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const driftX = t * 16;
        const driftY = t * 16;
        const v1 = noise.noise2D((x - driftX) * 0.1, (y + driftY) * 0.1);
        const v2 = noise.noise2D((x - driftX + 16) * 0.1, (y + driftY - 16) * 0.1);
        const v = v1 * (1 - t) + v2 * t;

        let idx = Math.floor(((v + 1) / 2) * PAL_WATER.length);
        idx = Math.max(0, Math.min(PAL_WATER.length - 1, idx));

        setPixel(data, x, y, PAL_WATER[idx]!);
      }
    }
    frames.push(data);
  }
  return frames;
}

// Lava: animated 32 frames, seamless loop
export function genLavaFrames(): TextureData[] {
  const frames: TextureData[] = [];
  const noise = new SimpleNoise(772);

  for (let f = 0; f < 32; f++) {
    const data = createEmptyTexture();
    const t = f / 32;

    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const v1 = noise.noise2D((x - t * 16) * 0.1, (y + t * 16) * 0.1);
        const v2 = noise.noise2D((x - (t - 1) * 16) * 0.1, (y + (t - 1) * 16) * 0.1);
        const v = v1 * (1 - t) + v2 * t;

        let idx = Math.floor(((v + 1) / 2) * PAL_LAVA.length);
        idx = Math.max(0, Math.min(PAL_LAVA.length - 1, idx));

        setPixel(data, x, y, PAL_LAVA[idx]!);
      }
    }
    frames.push(data);
  }
  return frames;
}
