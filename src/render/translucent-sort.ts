import { writeVertexPosition } from '../mesh/vertex';

export const TRANSLUCENT_NEAR_DISTANCE = 48;
export const TRANSLUCENT_SORT_STEP = 0.5;
export function distanceSquared(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return (a[0]! - b[0]!) ** 2 + (a[1]! - b[1]!) ** 2 + (a[2]! - b[2]!) ** 2;
}
export function quadCenters(vertices: Uint32Array): Float32Array {
  const centers = new Float32Array((vertices.length / 8) * 3);
  const position = new Float64Array(3);
  for (let q = 0; q < vertices.length / 8; q++)
    for (let v = 0; v < 4; v++) {
      writeVertexPosition(vertices[q * 8 + v * 2]!, vertices[q * 8 + v * 2 + 1]!, position);
      centers[q * 3] = centers[q * 3]! + position[0]! / 4;
      centers[q * 3 + 1] = centers[q * 3 + 1]! + position[1]! / 4;
      centers[q * 3 + 2] = centers[q * 3 + 2]! + position[2]! / 4;
    }
  return centers;
}
export function sortedQuadIndices(centers: Float32Array, camera: ArrayLike<number>): Uint32Array {
  const count = centers.length / 3;
  const order = new Uint32Array(count);
  const distances = new Float64Array(count);
  for (let q = 0; q < count; q++) {
    order[q] = q;
    distances[q] =
      (centers[q * 3]! - camera[0]!) ** 2 +
      (centers[q * 3 + 1]! - camera[1]!) ** 2 +
      (centers[q * 3 + 2]! - camera[2]!) ** 2;
  }
  order.sort((a, b) => distances[b]! - distances[a]! || a - b);
  const indices = new Uint32Array(count * 6);
  for (let i = 0; i < count; i++) {
    const base = order[i]! * 4,
      offset = i * 6;
    indices[offset] = base;
    indices[offset + 1] = base + 1;
    indices[offset + 2] = base + 2;
    indices[offset + 3] = base;
    indices[offset + 4] = base + 2;
    indices[offset + 5] = base + 3;
  }
  return indices;
}
