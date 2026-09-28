// src/render/textures/wood.ts
import {
  createEmptyTexture,
  TextureData,
  LCG,
  setPixel,
  fillSolid,
  RGB,
  RGBA,
  hexToRgb,
} from './noise';

const PAL_OAK_BARK = ['#1f140d', '#45311f', '#5b422a', '#7e5b3a'].map((h) => hexToRgb(h));
const PAL_OAK_WOOD = ['#6e5230', '#8a6a3f', '#a5824f', '#bf9a62'].map((h) => hexToRgb(h));

const PAL_BIRCH_BARK = ['#2b2a28', '#4a4843', '#b9b5aa', '#d8d5cc', '#eeede6'].map((h) =>
  hexToRgb(h),
);
const PAL_BIRCH_WOOD = ['#a88f5f', '#c2aa76', '#d6c08b', '#e6d3a2'].map((h) => hexToRgb(h));

const PAL_PINE_BARK = ['#110a06', '#35231a', '#4a3224', '#6c4c37'].map((h) => hexToRgb(h));
const PAL_PINE_WOOD = ['#472c14', '#6f4c2e', '#855d39', '#ae7b4b'].map((h) => hexToRgb(h));

const PAL_LEAVES = ['#24481a', '#2f5e22', '#3f7a2c', '#55983a', '#6fb14a'].map((h) => hexToRgb(h));
const PAL_LEAVES_TRANS = hexToRgb('#000000', 0);

function genLogSide(barkPal: RGBA[], seed: number, style: 'oak' | 'birch' | 'pine'): TextureData {
  const data = createEmptyTexture();
  const lcg = new LCG(seed);
  fillSolid(data, barkPal[barkPal.length > 4 ? 3 : 2]!);

  if (style === 'birch') {
    for (let i = 0; i < 20; i++) {
      const x = lcg.nextInt(0, 15);
      const y = lcg.nextInt(0, 15);
      const w = lcg.nextInt(2, 4);
      const markCol = lcg.nextFloat() < 0.5 ? barkPal[0]! : barkPal[1]!;
      for (let dx = 0; dx < w; dx++) {
        setPixel(data, (x + dx) % 16, y, markCol);
      }
    }
  } else {
    for (let x = 0; x < 16; x += lcg.nextInt(2, 4)) {
      const w = lcg.nextInt(1, 2);
      for (let y = 0; y < 16; y++) {
        for (let dx = 0; dx < w; dx++) {
          let shadeIdx = 1;
          if (dx === 0) shadeIdx = 3;
          else if (dx === w - 1) shadeIdx = 0;
          setPixel(data, (x + dx) % 16, y, barkPal[shadeIdx]!);
        }
      }
    }
  }

  return data;
}

function genLogTop(woodPal: RGBA[], barkPal: RGBA[], seed: number): TextureData {
  const data = createEmptyTexture();
  fillSolid(data, woodPal[2]!);

  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (x === 0 || x === 15 || y === 0 || y === 15) {
        setPixel(data, x, y, barkPal[1]!);
      } else if ((x === 1 || x === 14) && (y === 1 || y === 14)) {
        setPixel(data, x, y, barkPal[1]!);
      }
    }
  }

  for (let r = 2; r < 6; r += 2) {
    for (let y = 2; y < 14; y++) {
      for (let x = 2; x < 14; x++) {
        const dx = x - 7.5;
        const dy = y - 7.5;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (Math.abs(dist - r) < 0.5) {
          setPixel(data, x, y, woodPal[1]!);
        }
      }
    }
  }

  setPixel(data, 7, 7, woodPal[0]!);
  setPixel(data, 8, 7, woodPal[0]!);
  setPixel(data, 7, 8, woodPal[0]!);
  setPixel(data, 8, 8, woodPal[0]!);

  return data;
}

export function genOakLogTop(): TextureData {
  return genLogTop(PAL_OAK_WOOD, PAL_OAK_BARK, 111);
}
export function genOakLogSide(): TextureData {
  return genLogSide(PAL_OAK_BARK, 112, 'oak');
}
export function genBirchLogTop(): TextureData {
  return genLogTop(PAL_BIRCH_WOOD, PAL_BIRCH_BARK, 221);
}
export function genBirchLogSide(): TextureData {
  return genLogSide(PAL_BIRCH_BARK, 222, 'birch');
}
export function genPineLogTop(): TextureData {
  return genLogTop(PAL_PINE_WOOD, PAL_PINE_BARK, 331);
}
export function genPineLogSide(): TextureData {
  return genLogSide(PAL_PINE_BARK, 332, 'pine');
}

function genPlanks(woodPal: RGBA[], seed: number): TextureData {
  const data = createEmptyTexture();
  const lcg = new LCG(seed);
  fillSolid(data, woodPal[2]!);

  for (let row = 0; row < 4; row++) {
    const yBase = row * 4;
    const seamX = lcg.nextInt(4, 12);

    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 16; x++) {
        const isSeamY = y === 0;
        const isSeamX = x === seamX;

        if (isSeamY || isSeamX) {
          setPixel(data, x, yBase + y, woodPal[0]!);
        } else if (y === 1 || x === seamX + 1) {
          setPixel(data, x, yBase + y, woodPal[3]!);
        } else {
          if (lcg.nextFloat() < 0.1) {
            setPixel(data, x, yBase + y, woodPal[1]!);
          }
        }
      }
    }
  }
  return data;
}

export function genOakPlanks(): TextureData {
  return genPlanks(PAL_OAK_WOOD, 441);
}
export function genBirchPlanks(): TextureData {
  return genPlanks(PAL_BIRCH_WOOD, 442);
}
export function genPinePlanks(): TextureData {
  return genPlanks(PAL_PINE_WOOD, 443);
}

function genLeaves(baseSeed: number): TextureData {
  const data = createEmptyTexture();
  const lcg = new LCG(baseSeed);
  fillSolid(data, PAL_LEAVES_TRANS);

  for (let i = 0; i < 25; i++) {
    const cx = lcg.nextInt(0, 15);
    const cy = lcg.nextInt(0, 15);
    const size = lcg.nextInt(2, 4);

    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        if ((dx === 0 && dy === 0) || (dx === size - 1 && dy === size - 1)) continue;

        let col = PAL_LEAVES[2]!;
        if (dx === 1 && dy === 0) col = PAL_LEAVES[4]!;
        else if (dx === size - 2 && dy === size - 1) col = PAL_LEAVES[0]!;

        setPixel(data, (cx + dx) % 16, (cy + dy) % 16, col);
      }
    }
  }
  return data;
}

export function genOakLeaves(): TextureData {
  return genLeaves(551);
}
export function genBirchLeaves(): TextureData {
  return genLeaves(552);
}
export function genPineLeaves(): TextureData {
  return genLeaves(553);
}
