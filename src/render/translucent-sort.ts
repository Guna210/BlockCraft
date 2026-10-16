import { decodeVertex } from '../mesh/vertex';

export const TRANSLUCENT_NEAR_DISTANCE = 48;
export const TRANSLUCENT_SORT_STEP = 0.5;
export function distanceSquared(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return (a[0]! - b[0]!) ** 2 + (a[1]! - b[1]!) ** 2 + (a[2]! - b[2]!) ** 2;
}
export function quadCenters(vertices: Uint32Array): Float32Array {
  const centers = new Float32Array((vertices.length / 8) * 3);
  for (let q = 0; q < vertices.length / 8; q++)
    for (let v = 0; v < 4; v++) {
      const p = decodeVertex(vertices[q * 8 + v * 2]!, vertices[q * 8 + v * 2 + 1]!);
      centers[q * 3] = centers[q * 3]! + p.x / 4;
      centers[q * 3 + 1] = centers[q * 3 + 1]! + p.y / 4;
      centers[q * 3 + 2] = centers[q * 3 + 2]! + p.z / 4;
    }
  return centers;
}
export function sortedQuadIndices(centers: Float32Array, camera: ArrayLike<number>): Uint32Array {
  const order = Array.from({ length: centers.length / 3 }, (_, q) => q);
  const distance = (q: number) =>
    (centers[q * 3]! - camera[0]!) ** 2 +
    (centers[q * 3 + 1]! - camera[1]!) ** 2 +
    (centers[q * 3 + 2]! - camera[2]!) ** 2;
  order.sort((a, b) => distance(b) - distance(a) || a - b);
  const indices = new Uint32Array(order.length * 6);
  order.forEach((q, i) =>
    indices.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], i * 6),
  );
  return indices;
}
