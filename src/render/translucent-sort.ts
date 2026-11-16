import { writeVertexPosition } from '../mesh/vertex';

export const TRANSLUCENT_NEAR_DISTANCE = 48;
export const TRANSLUCENT_SORT_STEP = 0.5;

/** Scratch for repeated quad sorts of one uploaded bucket. */
export class TranslucentSorter {
  private readonly order: Uint32Array;
  private readonly distances: Float64Array;
  private readonly indices: Uint32Array;
  private readonly compare = (a: number, b: number) =>
    this.distances[b]! - this.distances[a]! || a - b;

  constructor(private readonly centers: Float32Array) {
    const count = centers.length / 3;
    this.order = new Uint32Array(count);
    this.distances = new Float64Array(count);
    this.indices = new Uint32Array(count * 6);
  }

  sort(camera: ArrayLike<number>, base: number): Uint32Array {
    for (let q = 0; q < this.order.length; q++) {
      this.order[q] = q;
      this.distances[q] =
        (this.centers[q * 3]! - camera[0]!) ** 2 +
        (this.centers[q * 3 + 1]! - camera[1]!) ** 2 +
        (this.centers[q * 3 + 2]! - camera[2]!) ** 2;
    }
    // In-place heap sort avoids allocating a temporary ordering array while the camera moves.
    for (let root = Math.floor(this.order.length / 2) - 1; root >= 0; root--)
      this.sift(root, this.order.length);
    for (let end = this.order.length - 1; end > 0; end--) {
      const first = this.order[0]!;
      this.order[0] = this.order[end]!;
      this.order[end] = first;
      this.sift(0, end);
    }
    for (let i = 0; i < this.order.length; i++) {
      const vertex = base + this.order[i]! * 4,
        offset = i * 6;
      this.indices[offset] = vertex;
      this.indices[offset + 1] = vertex + 1;
      this.indices[offset + 2] = vertex + 2;
      this.indices[offset + 3] = vertex;
      this.indices[offset + 4] = vertex + 2;
      this.indices[offset + 5] = vertex + 3;
    }
    return this.indices;
  }

  private sift(start: number, length: number): void {
    let root = start;
    for (;;) {
      const left = root * 2 + 1;
      if (left >= length) return;
      let largest = left;
      if (left + 1 < length && this.compare(this.order[left + 1]!, this.order[left]!) > 0)
        largest = left + 1;
      if (this.compare(this.order[largest]!, this.order[root]!) <= 0) return;
      const value = this.order[root]!;
      this.order[root] = this.order[largest]!;
      this.order[largest] = value;
      root = largest;
    }
  }
}
export function distanceSquared(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return (a[0]! - b[0]!) ** 2 + (a[1]! - b[1]!) ** 2 + (a[2]! - b[2]!) ** 2;
}
export function quadCenters(vertices: Uint32Array): Float32Array {
  const quadCount = vertices.length / 8;
  const centers = new Float32Array(quadCount * 3);
  const position = new Float64Array(3);
  for (let q = 0; q < quadCount; q++) {
    const base = q * 8;
    writeVertexPosition(vertices[base]!, vertices[base + 1]!, position);
    const x = position[0]!,
      y = position[1]!,
      z = position[2]!;
    writeVertexPosition(vertices[base + 4]!, vertices[base + 5]!, position);
    centers[q * 3] = (x + position[0]!) * 0.5;
    centers[q * 3 + 1] = (y + position[1]!) * 0.5;
    centers[q * 3 + 2] = (z + position[2]!) * 0.5;
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
