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
    const shared = (v: number) => v === d || v === e || v === f;
    const order =
      shared(a) && shared(c) ? [a, b, c] : shared(b) && shared(a) ? [b, c, a] : [c, a, b];
    order.push(d !== a && d !== b && d !== c ? d : e !== a && e !== b && e !== c ? e : f);
    for (let i = 0; i < 4; i++) {
      vertices[q * 8 + i * 2] = bucket.vertices[order[i]! * 2]!;
      vertices[q * 8 + i * 2 + 1] = bucket.vertices[order[i]! * 2 + 1]!;
    }
  }
  return vertices;
}

export function quadIndices(quads: number): Uint32Array {
  const indices = new Uint32Array(quads * 6);
  for (let q = 0; q < quads; q++) {
    const b = q * 4;
    indices.set([b, b + 1, b + 2, b, b + 2, b + 3], q * 6);
  }
  return indices;
}

/** Normalize once in the worker so uploads pass the transferred buffer straight to WebGL. */
export function normalizeSharedQuads(bucket: MeshBucketData): void {
  if (bucket.canonicalQuads) return;
  bucket.vertices = canonicalQuadVertices(bucket);
  bucket.vertexCount = bucket.quadCount * 4;
  bucket.indices = quadIndices(bucket.quadCount);
  bucket.canonicalQuads = true;
}
