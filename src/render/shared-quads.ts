import type { MeshBucketData } from '../mesh/greedy';

/** Reorder each indexed quad around its existing diagonal, without changing either triangle. */
export function canonicalQuadVertices(bucket: MeshBucketData): Uint32Array {
  if (bucket.canonicalQuads) return bucket.vertices;
  const vertices = new Uint32Array(bucket.quadCount * 8);
  for (let q = 0; q < bucket.quadCount; q++) {
    const offset = q * 6;
    const a = bucket.indices[offset]!;
    const b = bucket.indices[offset + 1]!;
    const c = bucket.indices[offset + 2]!;
    const d = bucket.indices[offset + 3]!;
    const e = bucket.indices[offset + 4]!;
    const f = bucket.indices[offset + 5]!;
    // Keep the same triangle order without a closure and growing array per quad.
    let first: number, second: number, third: number;
    const sharedA = a === d || a === e || a === f;
    if (sharedA && (c === d || c === e || c === f)) {
      first = a;
      second = b;
      third = c;
    } else if (sharedA && (b === d || b === e || b === f)) {
      first = b;
      second = c;
      third = a;
    } else {
      first = c;
      second = a;
      third = b;
    }
    const fourth = d !== a && d !== b && d !== c ? d : e !== a && e !== b && e !== c ? e : f;
    const out = q * 8;
    vertices[out] = bucket.vertices[first * 2]!;
    vertices[out + 1] = bucket.vertices[first * 2 + 1]!;
    vertices[out + 2] = bucket.vertices[second * 2]!;
    vertices[out + 3] = bucket.vertices[second * 2 + 1]!;
    vertices[out + 4] = bucket.vertices[third * 2]!;
    vertices[out + 5] = bucket.vertices[third * 2 + 1]!;
    vertices[out + 6] = bucket.vertices[fourth * 2]!;
    vertices[out + 7] = bucket.vertices[fourth * 2 + 1]!;
  }
  return vertices;
}

export function quadIndices(quads: number): Uint32Array {
  const indices = new Uint32Array(quads * 6);
  for (let q = 0; q < quads; q++) {
    const b = q * 4;
    const out = q * 6;
    indices[out] = b;
    indices[out + 1] = b + 1;
    indices[out + 2] = b + 2;
    indices[out + 3] = b;
    indices[out + 4] = b + 2;
    indices[out + 5] = b + 3;
  }
  return indices;
}

/** Normalize once in the worker so uploads pass the transferred buffer straight to WebGL. */
export function normalizeSharedQuads(bucket: MeshBucketData): void {
  if (bucket.canonicalQuads) return;
  // Model quads carry both windings; the emitted index pairs are the authoritative draw count.
  bucket.quadCount = bucket.indices.length / 6;
  bucket.vertices = canonicalQuadVertices(bucket);
  bucket.vertexCount = bucket.quadCount * 4;
  bucket.indices = quadIndices(bucket.quadCount);
  bucket.canonicalQuads = true;
}
