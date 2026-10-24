import { createEmptyTexture, hexToRgb, setPixel } from './noise';

/** A chipped ash-stone splinter with a short red seam; hand-drawn clusters, lit top-left. */
export const CINDER_SHARD_PALETTE = [
  '#30333f',
  '#656a76',
  '#969a9b',
  '#cfcdc1',
  '#b32321',
  '#ff5740',
].map((hex) => hexToRgb(hex));
export function genCinderShard(seed = 42): Uint8Array {
  const data = createEmptyTexture();
  const spans = [
    [8, 8],
    [7, 9],
    [6, 9],
    [5, 10],
    [5, 10],
    [4, 11],
    [4, 10],
    [5, 10],
    [5, 9],
    [6, 9],
    [6, 8],
    [7, 8],
  ];
  spans.forEach(([lo, hi], row) => {
    for (let x = lo!; x <= hi!; x++) {
      const shade = x === lo ? 3 : x === hi || row === spans.length - 1 ? 0 : x <= lo! + 1 ? 2 : 1;
      setPixel(data, x, row + 2, CINDER_SHARD_PALETTE[shade]!);
    }
  });
  // Four coherent seam shapes vary its position and the height of its stepped bend.
  const variant = (seed >>> 0) % 4;
  const crack = 7 + (variant & 1);
  const bend = 8 + (variant >> 1);
  for (let y = 6; y <= 10; y++) {
    const x = crack - (y >= bend ? 1 : 0);
    setPixel(data, x, y, CINDER_SHARD_PALETTE[4]!);
    if (y === 6 || y === 7) setPixel(data, x - 1, y, CINDER_SHARD_PALETTE[5]!);
  }
  return data;
}
