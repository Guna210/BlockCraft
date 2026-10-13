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

export function vertexHasBlockLight(word0: number, word1: number): boolean {
  return ((word0 >>> 24) & 15) !== 0 || ((word1 >>> VERTEX_LAYOUT.greenShift) & 255) !== 0;
}

export function decodeVertex(word0: number, word1: number) {
  const normal = (word0 >>> 15) & 7;
  const inset = ((word1 >>> VERTEX_LAYOUT.wallInsetShift) & 1) / 32;
  const torch =
    normal >= 6
      ? wallTorchOffset(
          (word1 >>> VERTEX_LAYOUT.uShift) & 31,
          (word1 >>> VERTEX_LAYOUT.vShift) & 31,
          normal - 6,
          word0 >>> 28,
        )
      : null;
  return {
    x: (word0 & 31) + (torch?.[0] ?? 0) + (normal === 0 ? inset : normal === 1 ? -inset : 0),
    y: ((word0 >>> 5) & 31) + (torch?.[1] ?? 0) + ((word1 >>> VERTEX_LAYOUT.halfYShift) & 1) * 0.5,
    z:
      ((word0 >>> 10) & 31) +
      (torch?.[2] ?? 0) +
      (normal === 4 ? inset : normal === 5 ? -inset : 0),
    normalIndex: (word0 >>> 15) & 7,
    ao: (word0 >>> 18) & 3,
    skyLight: (word0 >>> 20) & 15,
    blockR: (word0 >>> 24) & 15,
    tintIndex: word0 >>> 28,
    tileIndex: word1 & VERTEX_LAYOUT.tileMask,
    u: (word1 >>> VERTEX_LAYOUT.uShift) & VERTEX_LAYOUT.uvMask,
    v: (word1 >>> VERTEX_LAYOUT.vShift) & VERTEX_LAYOUT.uvMask,
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
