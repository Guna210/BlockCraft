// Non-cube block models. A model emits its own vertices instead of going through the greedy
// merge, which only knows full cube faces. Everything here uses the packed vertex format of
// the shared vertex layout: cube/cross corners stay integer, while slabs use its half-Y bit.
// Normals, tile indices and quad-local UVs retain their existing fields.

/** Values of `MeshLookupTables.modelKind`. */
export const MODEL_CUBE = 0;
export const MODEL_CROSS = 1;
export const MODEL_BOTTOM_SLAB = 2;
export const MODEL_TOP_SLAB = 3;
export const MODEL_WALL_NORTH = 4;
export const WALL_NORMALS = [5, 4, 0, 1] as const;

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
  blockG?: number,
  blockB?: number,
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
  blockG = 0,
  blockB = 0,
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
        blockG,
        blockB,
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

/** Six outward faces of a half-height stone slab, using the shared half-Y packed bit. */
const SLAB_CORNERS = [
  [
    [1, 0, 0],
    [1, 1, 0],
    [1, 1, 1],
    [1, 0, 1],
  ],
  [
    [0, 0, 1],
    [0, 1, 1],
    [0, 1, 0],
    [0, 0, 0],
  ],
  [
    [0, 1, 1],
    [1, 1, 1],
    [1, 1, 0],
    [0, 1, 0],
  ],
  [
    [0, 0, 0],
    [1, 0, 0],
    [1, 0, 1],
    [0, 0, 1],
  ],
  [
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
    [0, 0, 1],
  ],
  [
    [0, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [1, 0, 0],
  ],
] as const;
export function emitSlabBlock(
  pack: PackVertexFn,
  vertices: Uint32Array,
  wordOffset: number,
  indices: Uint32Array,
  indexOffset: number,
  x: number,
  y: number,
  z: number,
  top: boolean,
  tile: number,
  sky: number,
  r: number,
  g: number,
  b: number,
): void {
  for (let face = 0; face < 6; face++) {
    const base = wordOffset / 2 + face * 4;
    for (let c = 0; c < 4; c++) {
      const corner = SLAB_CORNERS[face]![c]!;
      pack(
        x + corner[0],
        y + corner[1] * 0.5 + (top ? 0.5 : 0),
        z + corner[2],
        face,
        0,
        sky,
        r,
        0,
        tile,
        c === 1 || c === 2 ? 1 : 0,
        c < 2 ? 1 : 0,
        vertices,
        wordOffset + face * 8 + c * 2,
        g,
        b,
      );
    }
    const out = indexOffset + face * 6;
    indices[out] = base;
    indices[out + 1] = base + 1;
    indices[out + 2] = base + 2;
    indices[out + 3] = base;
    indices[out + 4] = base + 2;
    indices[out + 5] = base + 3;
  }
}

/** Face attached 1/32 block in front of its wall, encoded with word1's last spare bit. */
export function emitWallBlock(
  pack: PackVertexFn,
  vertices: Uint32Array,
  wordOffset: number,
  indices: Uint32Array,
  indexOffset: number,
  x: number,
  y: number,
  z: number,
  facing: number,
  tile: number,
  tint: number,
  sky: number,
  r: number,
  g: number,
  b: number,
): void {
  const normal = WALL_NORMALS[facing]!;
  // Side-face UVs run left-to-right as viewed from the outward normal.
  const corners = SLAB_CORNERS[normal ^ 1]!;
  for (let side = 0; side < 2; side++) {
    const base = wordOffset / 2 + side * 4;
    for (let c = 0; c < 4; c++) {
      const source = side === 0 ? c : 3 - c;
      const corner = corners[source]!;
      const offset = wordOffset + side * 8 + c * 2;
      pack(
        x + corner[0],
        y + corner[1],
        z + corner[2],
        normal,
        0,
        sky,
        r,
        tint,
        tile,
        source < 2 ? 0 : 1,
        1 - corner[1],
        vertices,
        offset,
        g,
        b,
      );
      vertices[offset + 1] = vertices[offset + 1]! | 0x80000000;
    }
    const out = indexOffset + side * 6;
    indices.set([base, base + 1, base + 2, base, base + 2, base + 3], out);
  }
}
