import { wallTorchOffset } from './wall-torch';
/** M05b revision of decisions/M02b-vertex-format.md: two unsigned words per vertex. */
export const VERTEX_LAYOUT = {
  tileMask: 4095,
  uShift: 12,
  vShift: 17,
  uvMask: 31,
  greenShift: 22,
  blueShift: 26,
  halfYShift: 30,
  wallInsetShift: 31,
} as const;

/**
 * Shape vertices (stairs, fences, doors, trapdoors) are flagged by both of word1's top bits being
 * set together with a word0 top nibble of 8..15. Fluid vertices also set both word1 bits, but their
 * nibble is 4 or 5, and no other vertex has both bits. Shapes give up the tint nibble and the UV
 * fields for a sub-block offset of the vertex in sixteenths:
 *   word0: block x/y/z (bits 0-14, as usual) | normal | ao | sky | blockR | 8 + offset bits 0-2 (28-31)
 *   word1: tile (10 bits) | offset bits 3-14 (bits 10-21) | blockG | blockB | flags
 * offset = x | y << 5 | z << 10, each 0..16. The shader derives the UVs from the offset and the
 * normal, so a box shows the matching part of its tile.
 */
export const SHAPE_VERTEX = {
  tileMask: 1023,
  offsetShift: 10,
  flags: 3,
  flagShift: 30,
} as const;

export function isShapeVertex(word0: number, word1: number): boolean {
  return word1 >>> SHAPE_VERTEX.flagShift === SHAPE_VERTEX.flags && word0 >>> 28 >= 8;
}

/** Tile-local UV of a point `s` (0..1 on each axis) on the face with this normal index. */
export function shapeFaceUV(
  normalIndex: number,
  sx: number,
  sy: number,
  sz: number,
): [number, number] {
  switch (normalIndex) {
    case 0:
      return [1 - sz, 1 - sy];
    case 1:
      return [sz, 1 - sy];
    case 2:
      return [sx, 1 - sz];
    case 3:
      return [sx, sz];
    case 4:
      return [sx, 1 - sy];
    default:
      return [1 - sx, 1 - sy];
  }
}

export function packShapeVertex(
  target: Uint32Array,
  offset: number,
  bx: number,
  by: number,
  bz: number,
  sx: number,
  sy: number,
  sz: number,
  normalIndex: number,
  ao: number,
  skyLight: number,
  blockR: number,
  blockG: number,
  blockB: number,
  tileIndex: number,
): void {
  const s = (sx & 31) | ((sy & 31) << 5) | ((sz & 31) << 10);
  target[offset] =
    (bx & 31) |
    ((by & 31) << 5) |
    ((bz & 31) << 10) |
    ((normalIndex & 7) << 15) |
    ((ao & 3) << 18) |
    ((skyLight & 15) << 20) |
    ((blockR & 15) << 24) |
    ((8 | (s & 7)) << 28);
  target[offset + 1] =
    ((tileIndex & SHAPE_VERTEX.tileMask) |
      ((s >>> 3) << SHAPE_VERTEX.offsetShift) |
      ((blockG & 15) << VERTEX_LAYOUT.greenShift) |
      ((blockB & 15) << VERTEX_LAYOUT.blueShift) |
      (SHAPE_VERTEX.flags << SHAPE_VERTEX.flagShift)) >>>
    0;
}

export function vertexHasBlockLight(word0: number, word1: number): boolean {
  return ((word0 >>> 24) & 15) !== 0 || ((word1 >>> VERTEX_LAYOUT.greenShift) & 255) !== 0;
}

function shapeOffset(word0: number, word1: number): number {
  return ((word0 >>> 28) & 7) | (((word1 >>> SHAPE_VERTEX.offsetShift) & 4095) << 3);
}

export function writeVertexPosition(word0: number, word1: number, target: Float64Array): void {
  if (isShapeVertex(word0, word1)) {
    const s = shapeOffset(word0, word1);
    target[0] = (word0 & 31) + (s & 31) / 16;
    target[1] = ((word0 >>> 5) & 31) + ((s >>> 5) & 31) / 16;
    target[2] = ((word0 >>> 10) & 31) + ((s >>> 10) & 31) / 16;
    return;
  }
  const normal = (word0 >>> 15) & 7;
  const fluid = word0 >>> 28 === 4 || word0 >>> 28 === 5;
  const inset = fluid ? 0 : ((word1 >>> VERTEX_LAYOUT.wallInsetShift) & 1) / 32;
  const torch =
    normal >= 6
      ? wallTorchOffset(
          (word1 >>> VERTEX_LAYOUT.uShift) & 31,
          (word1 >>> VERTEX_LAYOUT.vShift) & 31,
          normal - 6,
          word0 >>> 28,
        )
      : null;
  target[0] = (word0 & 31) + (torch?.[0] ?? 0) + (normal === 0 ? inset : normal === 1 ? -inset : 0);
  target[1] =
    ((word0 >>> 5) & 31) +
    (torch?.[1] ?? 0) +
    (fluid ? -((word1 >>> 12) & 63) / 64 : ((word1 >>> VERTEX_LAYOUT.halfYShift) & 1) * 0.5);
  target[2] =
    ((word0 >>> 10) & 31) + (torch?.[2] ?? 0) + (normal === 4 ? inset : normal === 5 ? -inset : 0);
}

const decodedPosition = new Float64Array(3);

export function decodeVertex(word0: number, word1: number) {
  writeVertexPosition(word0, word1, decodedPosition);
  if (isShapeVertex(word0, word1)) {
    const normalIndex = (word0 >>> 15) & 7;
    const [u, v] = shapeFaceUV(
      normalIndex,
      decodedPosition[0]! - (word0 & 31),
      decodedPosition[1]! - ((word0 >>> 5) & 31),
      decodedPosition[2]! - ((word0 >>> 10) & 31),
    );
    return {
      x: decodedPosition[0]!,
      y: decodedPosition[1]!,
      z: decodedPosition[2]!,
      normalIndex,
      ao: (word0 >>> 18) & 3,
      skyLight: (word0 >>> 20) & 15,
      blockR: (word0 >>> 24) & 15,
      tintIndex: 0,
      tileIndex: word1 & SHAPE_VERTEX.tileMask,
      u,
      v,
      blockG: (word1 >>> VERTEX_LAYOUT.greenShift) & 15,
      blockB: (word1 >>> VERTEX_LAYOUT.blueShift) & 15,
    };
  }
  const fluid = word0 >>> 28 === 4 || word0 >>> 28 === 5;
  return {
    x: decodedPosition[0]!,
    y: decodedPosition[1]!,
    z: decodedPosition[2]!,
    normalIndex: (word0 >>> 15) & 7,
    ao: (word0 >>> 18) & 3,
    skyLight: (word0 >>> 20) & 15,
    blockR: (word0 >>> 24) & 15,
    tintIndex: word0 >>> 28,
    tileIndex: word1 & VERTEX_LAYOUT.tileMask,
    u: fluid ? (word1 >>> 30) & 1 : (word1 >>> VERTEX_LAYOUT.uShift) & VERTEX_LAYOUT.uvMask,
    v: fluid ? word1 >>> 31 : (word1 >>> VERTEX_LAYOUT.vShift) & VERTEX_LAYOUT.uvMask,
    blockG: (word1 >>> VERTEX_LAYOUT.greenShift) & 15,
    blockB: (word1 >>> VERTEX_LAYOUT.blueShift) & 15,
  };
}

export function packVertex(
  x: number,
  y: number,
  z: number,
  normalIndex: number,
  ao: number,
  skyLight: number,
  blockR: number,
  tintIndex: number,
  tileIndex: number,
  u: number,
  v: number,
  target: Uint32Array,
  offset: number,
  blockG = 0,
  blockB = 0,
): void {
  target[offset] =
    (x & 31) |
    ((y & 31) << 5) |
    ((z & 31) << 10) |
    ((normalIndex & 7) << 15) |
    ((ao & 3) << 18) |
    ((skyLight & 15) << 20) |
    ((blockR & 15) << 24) |
    ((tintIndex & 15) << 28);
  target[offset + 1] =
    (tileIndex & VERTEX_LAYOUT.tileMask) |
    ((u & VERTEX_LAYOUT.uvMask) << VERTEX_LAYOUT.uShift) |
    ((v & VERTEX_LAYOUT.uvMask) << VERTEX_LAYOUT.vShift) |
    ((blockG & 15) << VERTEX_LAYOUT.greenShift) |
    ((blockB & 15) << VERTEX_LAYOUT.blueShift) |
    (Number(y % 1 !== 0) << VERTEX_LAYOUT.halfYShift);
}
