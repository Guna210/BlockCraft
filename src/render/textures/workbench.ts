import {
  createEmptyTexture,
  fillSolid,
  hexToRgb,
  setPixel,
  type RGBA,
  type TextureData,
} from './noise';

export const PAL_WORKBENCH: RGBA[] = [
  hexToRgb('#38251a'),
  hexToRgb('#573822'),
  hexToRgb('#79502e'),
  hexToRgb('#a06f3d'),
  hexToRgb('#c28b4e'),
  hexToRgb('#e0b66a'),
];

/** Warm, scored work surface with a small inlaid square cutting guide. */
export function genWorkbenchTop(seed = 8101): TextureData {
  const data = createEmptyTexture();
  fillSolid(data, PAL_WORKBENCH[2]!);
  const phase = seed & 7;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let color = PAL_WORKBENCH[2]!;
      if (y === 1 || y === 2) color = PAL_WORKBENCH[4]!;
      else if (y === 13 || y === 14) color = PAL_WORKBENCH[1]!;
      else if (y % 4 === 0) color = PAL_WORKBENCH[1]!;
      else if ((x + phase) % 8 === 0 && (y % 4 === 2 || y % 4 === 3)) color = PAL_WORKBENCH[3]!;
      if (x === 1 || x === 2) color = PAL_WORKBENCH[4]!;
      else if (x === 13 || x === 14) color = PAL_WORKBENCH[1]!;
      if (x >= 5 && x <= 10 && y >= 5 && y <= 10) {
        const bx = (x - 5) >> 1;
        const by = (y - 5) >> 1;
        color = (bx + by) % 2 === 0 ? PAL_WORKBENCH[3]! : PAL_WORKBENCH[1]!;
      }
      if (x === 0 || x === 15 || y === 0 || y === 15) color = PAL_WORKBENCH[2]!;
      setPixel(data, x, y, color);
    }
  }
  return data;
}

/** Four broad side boards with dark joints and top-left edge highlights. */
export function genWorkbenchSide(seed = 8102): TextureData {
  const data = createEmptyTexture();
  fillSolid(data, PAL_WORKBENCH[2]!);
  const offset = seed & 3;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let color = PAL_WORKBENCH[2]!;
      if (x === 0 || x === 15 || y === 0 || y === 15) color = PAL_WORKBENCH[0]!;
      else if (y === 1 || y === 14) color = PAL_WORKBENCH[4]!;
      else if ((x + offset) % 8 === 0) color = PAL_WORKBENCH[1]!;
      else if ((x + offset) % 8 === 1) color = PAL_WORKBENCH[3]!;
      else if (y % 5 === 2 && (x % 4 === 1 || x % 4 === 2)) color = PAL_WORKBENCH[4]!;
      setPixel(data, x, y, color);
    }
  }
  return data;
}
