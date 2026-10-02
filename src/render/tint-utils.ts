/**
 * Calculates the 16x16 column tint map texel coordinates (tx, tz) in [0..15]
 * for the block that owns a given face.
 *
 * Used by shader sampling in FS_CHUNK (src/render/chunk-renderer.ts).
 *
 * @param worldPos - 3D world space position on the face
 * @param normal - 3D face normal vector
 * @returns [tx, tz] integer texel coordinates in range 0..15
 */
export function tintTexelForFace(
  worldPos: [number, number, number] | readonly [number, number, number],
  normal: [number, number, number] | readonly [number, number, number],
): [number, number] {
  const bx = Math.floor(worldPos[0] - 0.5 * normal[0]);
  const bz = Math.floor(worldPos[2] - 0.5 * normal[2]);
  const tx = ((bx % 16) + 16) % 16;
  const tz = ((bz % 16) + 16) % 16;
  return [tx, tz];
}
