// src/render/textures/ores.ts
import { TextureData, LCG, setPixel, RGB } from './noise';
import { genStone } from './terrain';

function genOre(baseOreColor: RGB, seed: number): TextureData {
  const data = genStone();
  const lcg = new LCG(seed);

  // draw ore flecks
  const numFlecks = lcg.nextInt(6, 10);
  for (let i = 0; i < numFlecks; i++) {
    const cx = lcg.nextInt(1, 14);
    const cy = lcg.nextInt(1, 14);

    // Draw 2x2 or 1x1 fleck
    const size = lcg.nextFloat() > 0.5 ? 2 : 1;
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const offset = lcg.nextInt(-10, 20);
        const color: RGB = [
          baseOreColor[0]! + offset,
          baseOreColor[1]! + offset,
          baseOreColor[2]! + offset,
        ];
        setPixel(data, cx + dx, cy + dy, color);
      }
    }
  }

  return data;
}

export function genCoalOre(): TextureData {
  return genOre([30, 30, 30], 661);
}
export function genCopperOre(): TextureData {
  return genOre([200, 115, 70], 662);
}
export function genIronOre(): TextureData {
  return genOre([210, 190, 170], 663);
}
export function genGoldOre(): TextureData {
  return genOre([255, 215, 0], 664);
}
export function genLumiteOre(): TextureData {
  return genOre([100, 255, 200], 665);
}
export function genSkyshardOre(): TextureData {
  return genOre([180, 220, 255], 666);
}
