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
  const strokes: ReadonlyArray<readonly [number, number, number, number]> = [
    [3, 3, 4, 0.2],
    [10, 6, 3, 1.5],
    [3, 9, 3, 2.9],
    [10, 12, 3, 4.3],
  ];
  return Array.from({ length: 32 }, (_, frame) => {
    const data = createEmptyTexture();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) setPixel(data, x, y, PAL_WATER[1]!);
    const angle = (frame / 32) * Math.PI * 2;
    strokes.forEach(([x, y, length, phase], stroke) => {
      const dx = Math.round(Math.sin(angle + phase) * 1.8);
      const dy = Math.round(Math.sin(angle * (stroke % 2 ? 3 : 2) + phase) * 0.8);
      // Short connected crests drift by only a few pixels. A cool lower edge gives depth.
      for (let pixel = 0; pixel < length; pixel++) {
        const px = x + dx + pixel,
          py = y + dy;
        setPixel(data, px, py + 1, PAL_WATER[0]!);
        const bright = stroke % 2 === 0 && pixel > 0 && pixel < length - 1;
        setPixel(data, px, py, PAL_WATER[bright ? 3 : 2]!);
      }
      if (Math.sin(angle + phase) > 0.8 && stroke % 2 === 0)
        setPixel(data, x + dx + 1, y + dy, PAL_WATER[4]!);
    });
    return data;
  });
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
