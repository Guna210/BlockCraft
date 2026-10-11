import { expect, test } from 'vitest';
import {
  canonicalQuadVertices,
  normalizeSharedQuads,
  quadIndices,
} from '../../src/render/shared-quads';
import type { MeshBucketData } from '../../src/mesh/greedy';

// Clockwise/counterclockwise winding and either AO diagonal must survive vertex reordering.
test.each([
  [0, 1, 2, 0, 2, 3],
  [0, 2, 1, 0, 3, 2],
  [0, 1, 3, 1, 2, 3],
  [0, 3, 1, 1, 3, 2],
])('shared quad indices preserve both oriented triangles: %j', (...indices: number[]) => {
  const vertices = new Uint32Array([10, 11, 20, 21, 30, 31, 40, 41]);
  const bucket = {
    vertices,
    indices: new Uint32Array(indices),
    quadCount: 1,
    vertexCount: 4,
  } as MeshBucketData;
  const canonical = canonicalQuadVertices(bucket);
  const triangles = (v: Uint32Array, idx: Uint32Array) => {
    const result: string[] = [];
    for (let t = 0; t < idx.length; t += 3) {
      const words = Array.from(idx.subarray(t, t + 3), (i) => `${v[i * 2]},${v[i * 2 + 1]}`);
      result.push(
        [0, 1, 2].map((r) => [...words.slice(r), ...words.slice(0, r)].join(';')).sort()[0]!,
      );
    }
    return result.sort();
  };
  expect(triangles(canonical, quadIndices(1))).toEqual(triangles(vertices, bucket.indices));
  expect(canonical.byteLength).toBe(4 * 8);
});

test('worker normalization preserves indexed geometry and makes upload reuse the transferred words', () => {
  const bucket: MeshBucketData = {
    vertices: new Uint32Array([10, 11, 20, 21, 30, 31, 40, 41]),
    indices: new Uint32Array([0, 3, 1, 1, 3, 2]),
    quadCount: 1,
    vertexCount: 4,
  };
  const expected = canonicalQuadVertices(bucket);
  normalizeSharedQuads(bucket);
  expect(bucket.vertices).toEqual(expected);
  expect(bucket.indices).toEqual(quadIndices(1));
  expect(bucket.vertexCount).toBe(4);
  const transferred = structuredClone(bucket, {
    transfer: [bucket.vertices.buffer, bucket.indices.buffer],
  });
  expect(canonicalQuadVertices(transferred)).toBe(transferred.vertices);
  normalizeSharedQuads(transferred);
  expect(Array.from(transferred.vertices)).toEqual(Array.from(expected));
});
