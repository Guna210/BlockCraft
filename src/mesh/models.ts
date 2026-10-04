// Non-cube block models. A model emits its own vertices instead of going through the greedy
// merge, which only knows full cube faces. Everything here uses the packed vertex format of
// decisions/M02b-vertex-format.md unchanged: integer corner positions inside the section, a normal
// index, a tile index and quad-local UVs in block units.

/** Values of `MeshLookupTables.modelKind`. */
export const MODEL_CUBE = 0;
export const MODEL_CROSS = 1;

/**
 * Signature of `packVertex` in greedy.ts, passed in so that this module does not import the
 * mesher (which imports this module).
 */
export type PackVertexFn = (
  x: number,
  y: number,
  z: number,
  normalIndex: number,
  ao: number,
  skyLight: number,
  blockLight: number,
  tintIndex: number,
  tileIndex: number,
  u: number,
  v: number,
  target: Uint32Array,
  offset: number,
) => void;

/**
 * Cross model: two quads along the two diagonals of the block, corner to corner. Every corner is a
 * block corner, so positions stay integers. Each corner is [dx, dy, dz, u, v] relative to the
 * block's minimum corner, listed bottom-left, bottom-right, top-right, top-left as seen from the
 * side the quad is facing; v = 0 is the top of the tile (decisions/M02b-fix, side-face
 * orientation), so the sprite stands upright.
 */
export const CROSS_QUAD_CORNERS: ReadonlyArray<
  ReadonlyArray<readonly [number, number, number, number, number]>
> = [
  [
    [0, 0, 0, 0, 1],
    [1, 0, 1, 1, 1],
    [1, 1, 1, 1, 0],
    [0, 1, 0, 0, 0],
  ],
  [
    [1, 0, 0, 0, 1],
    [0, 0, 1, 1, 1],
    [0, 1, 1, 1, 0],
    [1, 1, 0, 0, 0],
  ],
];

/** Vertices, indices and visible quads one cross block adds to its bucket. */
export const CROSS_VERTICES_PER_BLOCK = 8;
export const CROSS_INDICES_PER_BLOCK = 24;
export const CROSS_QUADS_PER_BLOCK = 2;

/**
 * Plants take their lighting from the top face: the normal index is +Y for both quads, whichever
 * side is seen. (Index 2 in the vertex format: 0=+X, 1=-X, 2=+Y, 3=-Y, 4=+Z, 5=-Z.)
 */
export const CROSS_NORMAL_INDEX = 2;

/**
 * Appends the two quads of a cross block with block-local minimum corner (bx, by, bz).
 * Both windings are emitted for each quad (two triangles per winding, eight triangles per block),
 * so the plant is visible from both sides without any change to the GL culling state. The caller
 * advances its offsets by CROSS_VERTICES_PER_BLOCK * 2 words of vertex data and
 * CROSS_INDICES_PER_BLOCK indices.
 */
export function emitCrossBlock(
  pack: PackVertexFn,
  vertices: Uint32Array,
  vertWordOffset: number,
  indices: Uint32Array,
  indexOffset: number,
  bx: number,
  by: number,
  bz: number,
  tileIndex: number,
  tintIndex: number,
  ao: number,
  skyLight: number,
  blockLight: number,
): void {
  const vertBase = vertWordOffset / 2;
  let w = vertWordOffset;
  for (const quad of CROSS_QUAD_CORNERS) {
    for (const c of quad) {
      pack(
        bx + c[0],
        by + c[1],
        bz + c[2],
        CROSS_NORMAL_INDEX,
        ao,
        skyLight,
        blockLight,
        tintIndex,
        tileIndex,
        c[3],
        c[4],
        vertices,
        w,
      );
      w += 2;
    }
  }
  let i = indexOffset;
  for (let q = 0; q < 2; q++) {
    const a = vertBase + q * 4;
    // front winding
    indices[i++] = a;
    indices[i++] = a + 1;
    indices[i++] = a + 2;
    indices[i++] = a;
    indices[i++] = a + 2;
    indices[i++] = a + 3;
    // back winding
    indices[i++] = a;
    indices[i++] = a + 2;
    indices[i++] = a + 1;
    indices[i++] = a;
    indices[i++] = a + 3;
    indices[i++] = a + 2;
  }
}

/**
 * Concatenates two buckets that are drawn together (the cutout bucket and the model bucket of a
 * section) into one, offsetting the indices of the second by the vertices of the first.
 */
export function mergeMeshBuckets<
  T extends {
    vertices: Uint32Array;
    indices: Uint32Array;
    vertexCount: number;
    quadCount: number;
  },
>(a: T, b: T): T {
  if (b.quadCount === 0) return a;
  if (a.quadCount === 0) return b;
  const vertices = new Uint32Array(a.vertices.length + b.vertices.length);
  vertices.set(a.vertices, 0);
  vertices.set(b.vertices, a.vertices.length);
  const indices = new Uint32Array(a.indices.length + b.indices.length);
  indices.set(a.indices, 0);
  for (let i = 0; i < b.indices.length; i++) {
    indices[a.indices.length + i] = b.indices[i]! + a.vertexCount;
  }
  return {
    ...a,
    vertices,
    indices,
    vertexCount: a.vertexCount + b.vertexCount,
    quadCount: a.quadCount + b.quadCount,
  };
}
