// src/render/textures/fluids.ts
import { createEmptyTexture, TextureData, PeriodicNoise, setPixel, hexToRgb } from './noise';

export const PAL_WATER = ['#1f4f94', '#2b5fa8', '#3a73c0', '#4c88d4', '#8ec0f0'].map((h) =>
  hexToRgb(h),
);
const PAL_LAVA_CRUST = ['#2a0d06', '#4a1709'].map((h) => hexToRgb(h));
const PAL_LAVA_MOLTEN = ['#b8360b', '#e45f10', '#f7931c', '#ffd24a'].map((h) => hexToRgb(h));
export const PAL_LAVA = [...PAL_LAVA_CRUST, ...PAL_LAVA_MOLTEN];

// Water: animated 32 frames, seamless loop
export function genWaterFrames(): TextureData[] {
  const frames: TextureData[] = [];
  const noise = new PeriodicNoise(771);

  for (let f = 0; f < 32; f++) {
    const data = createEmptyTexture();
    const t = f / 32;
    const angle = t * Math.PI * 2;

    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        // Spatial torus mapping for seamless edges
        const nx = (x / 16) * Math.PI * 2;
        const ny = (y / 16) * Math.PI * 2;

        const sx = Math.cos(nx) * 1.5;
        const sy = Math.sin(nx) * 1.5;
        const tx = Math.cos(ny) * 1.5;
        const ty = Math.sin(ny) * 1.5;

        // Temporal mapping
        const u = Math.cos(angle) * 1.0;
        const w = Math.sin(angle) * 1.0;

        const v1 = noise.noise3D(sx + u, sy + w, tx);
        const v2 = noise.noise3D(tx - u, ty - w, sx);
        const v = (v1 + v2) / 2;

        let idx = Math.floor(((v + 1) / 2) * PAL_WATER.length);
        idx = Math.max(0, Math.min(PAL_WATER.length - 1, idx));

        // Light ripple lines
        if (v > 0.3) idx = PAL_WATER.length - 1;
        else if (v > 0.15) idx = PAL_WATER.length - 2;

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
  const noise = new PeriodicNoise(772);

  for (let f = 0; f < 32; f++) {
    const data = createEmptyTexture();
    const t = f / 32;
    const angle = t * Math.PI * 2;

    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const nx = (x / 16) * Math.PI * 2;
        const ny = (y / 16) * Math.PI * 2;

        const sx = Math.cos(nx) * 1.5;
        const sy = Math.sin(nx) * 1.5;
        const tx = Math.cos(ny) * 1.5;
        const ty = Math.sin(ny) * 1.5;

        const u = Math.cos(angle) * 1.0;
        const w = Math.sin(angle) * 1.0;

        const v1 = noise.noise3D(sx - u, sy + w, tx);
        const v2 = noise.noise3D(tx + u, ty - w, sx);
        const v = (v1 + v2) / 2;

        let idx = Math.floor(((v + 1) / 2) * PAL_LAVA.length);
        idx = Math.max(0, Math.min(PAL_LAVA.length - 1, idx));

        setPixel(data, x, y, PAL_LAVA[idx]!);
      }
    }
    frames.push(data);
  }
  return frames;
}
