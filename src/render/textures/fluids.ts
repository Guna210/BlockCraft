// src/render/textures/fluids.ts
import { createEmptyTexture, TextureData, PeriodicNoise, setPixel, hexToRgb } from './noise';

export const PAL_WATER = ['#12345e', '#194572', '#245987', '#3c719b', '#6696b9'].map((h) => {
  const color = hexToRgb(h);
  color[3] = 92;
  return color;
});
const PAL_LAVA_CRUST = ['#2a0d06', '#4a1709'].map((h) => hexToRgb(h));
const PAL_LAVA_MOLTEN = ['#b8360b', '#e45f10', '#f7931c', '#ffd24a'].map((h) => hexToRgb(h));
export const PAL_LAVA = [...PAL_LAVA_CRUST, ...PAL_LAVA_MOLTEN];

// Water: animated 32 frames, seamless loop
export function genWaterFrames(): TextureData[] {
  const frames: TextureData[] = [];
  for (let f = 0; f < 32; f++) {
    const data = createEmptyTexture();
    const phase = (f / 32) * Math.PI * 2;
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const nx = ((x + 0.5) / 16) * Math.PI * 2;
        const ny = ((y + 0.5) / 16) * Math.PI * 2;
        // Broad dark water with short, gently bent ripple crests; no noise blobs.
        const base =
          Math.cos(nx) * Math.cos(ny) * Math.cos(phase) +
          Math.sin(phase) * (0.2 + Math.cos(nx) * 0.25);
        const crest = Math.sin(Math.cos(ny) * 3 + 0.45 * Math.cos(nx) + phase);
        const envelope = Math.cos(nx) * Math.cos(phase);
        let idx = base > 0.55 ? 2 : base < -0.35 ? 0 : 1;
        if (crest > 0.96 && envelope > 0.2) idx = 3;
        if (crest > 0.995 && envelope > 0.65) idx = 4;
        setPixel(data, x, y, PAL_WATER[idx]!);
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
