// src/render/textures/ores.ts
import { TextureData, LCG, setPixel, RGBA, hexToRgb } from './noise';
import { genStone } from './terrain';

export const PAL_COAL = ['#18181b', '#2a2a30', '#44444c'].map((h) => hexToRgb(h));
export const PAL_COPPER = ['#8a4b2a', '#b4683a', '#d8874a', '#4f9a86', '#7cc7b0'].map((h) =>
  hexToRgb(h),
); // Includes patina
export const PAL_IRON = ['#8f735f', '#b89a86', '#d9bea8', '#f0dccb'].map((h) => hexToRgb(h));
export const PAL_GOLD = ['#9c6f12', '#c7951f', '#f0c43a', '#fff08a'].map((h) => hexToRgb(h));
export const PAL_LUMITE = ['#155f70', '#1f8fa6', '#37c8e0', '#9ff4ff'].map((h) => hexToRgb(h));
export const PAL_SKYSHARD = ['#3f1f6b', '#5a2d91', '#8a4fd1', '#c69bff'].map((h) => hexToRgb(h));

function genOre(
  orePal: RGBA[],
  seed: number,
  style: 'nugget' | 'crystal' | 'patina' = 'nugget',
): TextureData {
  const data = genStone();
  const lcg = new LCG(seed);

  // 3-5 ore nuggets
  const numNuggets = lcg.nextInt(3, 5);
  for (let i = 0; i < numNuggets; i++) {
    const cx = lcg.nextInt(1, 13);
    const cy = lcg.nextInt(1, 13);

    // Cluster shape 2x2 to 3x3
    const sizeW = lcg.nextInt(2, 3);
    const sizeH = lcg.nextInt(2, 3);

    for (let dy = 0; dy < sizeH; dy++) {
      for (let dx = 0; dx < sizeW; dx++) {
        // Skip some corners to make it irregular
        if (lcg.nextFloat() < 0.2) continue;

        let colIdx = 1; // Mid tone

        if (style === 'crystal') {
          if (dx === sizeW - 1)
            colIdx = 3; // Bright edge
          else if (dy === sizeH - 1) colIdx = 0; // Dark base
        } else if (style === 'patina') {
          colIdx = lcg.nextInt(0, 2);
          if (lcg.nextFloat() < 0.3) colIdx = lcg.nextInt(3, 4); // Teal patina
        } else {
          if (dx === 0 && dy === 0)
            colIdx = orePal.length - 1; // Highlight
          else if (dx === sizeW - 1 && dy === sizeH - 1) colIdx = 0; // Shadow
        }

        // Clamp colIdx
        colIdx = Math.min(Math.max(colIdx, 0), orePal.length - 1);

        setPixel(data, cx + dx, cy + dy, orePal[colIdx]!);
      }
    }
  }

  return data;
}

export function genCoalOre(seed: number = 661): TextureData {
  return genOre(PAL_COAL, seed);
}
export function genCopperOre(seed: number = 662): TextureData {
  return genOre(PAL_COPPER, seed, 'patina');
}
export function genIronOre(seed: number = 663): TextureData {
  return genOre(PAL_IRON, seed);
}
export function genGoldOre(seed: number = 664): TextureData {
  return genOre(PAL_GOLD, seed);
}
export function genLumiteOre(seed: number = 665): TextureData {
  return genOre(PAL_LUMITE, seed);
}
export function genSkyshardOre(seed: number = 666): TextureData {
  return genOre(PAL_SKYSHARD, seed, 'crystal');
}
