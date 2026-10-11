import { AO_STEP, lightBrightness } from '../render/light-curve';

export const FACE_NORMAL_STRIDES = [1, -1, 18, -18, 324, -324] as const;
const U_STRIDES = [324, 324, 1, 1, 1, 1] as const;
const V_STRIDES = [18, 18, 324, 324, 18, 18] as const;
const CORNER_SIGNS = [
  [-1, -1, 1, -1, 1, 1, -1, 1],
  [1, -1, -1, -1, -1, 1, 1, 1],
  [-1, 1, 1, 1, 1, -1, -1, -1],
  [-1, -1, 1, -1, 1, 1, -1, 1],
  [-1, -1, 1, -1, 1, 1, -1, 1],
  [1, -1, -1, -1, -1, 1, 1, 1],
] as const;

const SAMPLE_LIGHT = new Uint32Array(9);
const SAMPLE_OPAQUE = new Uint8Array(9);

export function ambientOcclusion(side1: boolean, side2: boolean, corner: boolean): number {
  return side1 && side2 ? 3 : Number(side1) + Number(side2) + Number(corner);
}

/** Four outward samples, excluding opaque cells and the hidden corner behind two opaque sides. */
export function sampleFaceCorners(
  blocks: Uint16Array,
  light: Uint16Array | undefined,
  opaque: Uint8Array,
  ownIndex: number,
  face: number,
  noAO: boolean,
  target: Uint32Array,
  offset: number,
): void {
  const outward = ownIndex + FACE_NORMAL_STRIDES[face]!;
  const signs = CORNER_SIGNS[face]!;
  const u = U_STRIDES[face]!;
  const v = V_STRIDES[face]!;
  const centre = light ? light[outward]! : 0xf000;
  let uniform = true;
  // The four corners share a nine-cell stencil. Decode each cell once into byte lanes;
  // four summed levels fit each lane without carrying into the adjacent channel.
  for (let j = 0; j < 9; j++) {
    const index = outward + ((j % 3) - 1) * u + (Math.floor(j / 3) - 1) * v;
    const blocked = opaque[blocks[index]!] === 1;
    const value = light ? light[index]! : 0xf000;
    SAMPLE_OPAQUE[j] = Number(blocked);
    SAMPLE_LIGHT[j] = blocked
      ? 0
      : (value >>> 12) |
        (((value >>> 8) & 15) << 8) |
        (((value >>> 4) & 15) << 16) |
        ((value & 15) << 24);
    uniform &&= !blocked && value === centre;
  }
  if (uniform) {
    const tuple =
      (centre >>> 12) |
      (((centre >>> 8) & 15) << 4) |
      (((centre >>> 4) & 15) << 8) |
      ((centre & 15) << 12);
    target.fill(tuple, offset, offset + 4);
    return;
  }
  for (let c = 0; c < 4; c++) {
    const side1 = 4 + signs[c * 2]!;
    const side2 = 4 + signs[c * 2 + 1]! * 3;
    const corner = side1 + side2 - 4;
    const blocked1 = SAMPLE_OPAQUE[side1] === 1;
    const blocked2 = SAMPLE_OPAQUE[side2] === 1;
    const blockedCorner = SAMPLE_OPAQUE[corner] === 1;
    const dropCorner = blocked1 && blocked2;
    const sum =
      SAMPLE_LIGHT[4]! +
      SAMPLE_LIGHT[side1]! +
      SAMPLE_LIGHT[side2]! +
      (dropCorner ? 0 : SAMPLE_LIGHT[corner]!);
    const count = Math.max(
      1,
      4 -
        SAMPLE_OPAQUE[4]! -
        Number(blocked1) -
        Number(blocked2) -
        Number(dropCorner || blockedCorner),
    );
    const ao = noAO ? 0 : ambientOcclusion(blocked1, blocked2, blockedCorner);
    target[offset + c] =
      Math.round((sum & 255) / count) |
      (Math.round(((sum >>> 8) & 255) / count) << 4) |
      (Math.round(((sum >>> 16) & 255) / count) << 8) |
      (Math.round((sum >>> 24) / count) << 12) |
      (ao << 16);
  }
}

/** A larger greedy quad can preserve all original samples only when its corners are uniform. */
export function canMergeCorners(corners: Uint32Array, a: number, b: number): boolean {
  const value = corners[a]!;
  for (let c = 0; c < 4; c++)
    if (corners[a + c] !== value || corners[b + c] !== value) return false;
  return true;
}

function cornerBrightness(tuple: number): number {
  const light = Math.max(tuple & 15, (tuple >>> 4) & 15, (tuple >>> 8) & 15, (tuple >>> 12) & 15);
  return lightBrightness(light) * (1 - AO_STEP * (tuple >>> 16));
}

/** Connect the brighter diagonal; a tie keeps the stable original winding. */
export function shouldFlipQuad(corners: ArrayLike<number>, offset = 0): boolean {
  return (
    cornerBrightness(corners[offset]!) + cornerBrightness(corners[offset + 2]!) <
    cornerBrightness(corners[offset + 1]!) + cornerBrightness(corners[offset + 3]!)
  );
}
