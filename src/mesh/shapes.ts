// Multi-box block models: stairs, fences, doors and trapdoors. Each box draws its six faces,
// except a face that lies on the block's boundary against a full opaque neighbour, or one that is
// completely covered by another box of the same state. Positions are sixteenths of a block (see
// SHAPE_VERTEX in vertex.ts); UVs are derived from them, so a box shows the matching part of its
// tile. Faces on the block boundary take smooth light and ambient occlusion from the neighbouring
// cells like cube faces do; faces inside the block take the block's own light.
import { CORNER_SIGNS, U_STRIDES, V_STRIDES, FACE_NORMAL_STRIDES, sampleFaceCorners } from './ao';
import { SLAB_CORNERS } from './models';
import { packShapeVertex } from './vertex';

/** Value of `MeshLookupTables.modelKind` for every state that owns boxes. */
export const MODEL_SHAPE = 12;

export interface ShapeTables {
  isOpaqueCube: Uint8Array;
  tileIndices: Uint16Array;
  /** Index of the state's first box in `shapeBoxes` (six floats per box). */
  shapeStart: Uint32Array;
  shapeCount: Uint8Array;
  shapeBoxes: Float32Array;
}

/** Most quads one block can emit: a fence with four arms (9 boxes * 6 faces). */
export const MAX_SHAPE_QUADS_PER_BLOCK = 54;

const EPS = 1e-4;
const AXIS_OF_U = [2, 2, 0, 0, 0, 0] as const;
const AXIS_OF_V = [1, 1, 2, 2, 1, 1] as const;
const NORMAL_AXIS = [0, 0, 1, 1, 2, 2] as const;
const sampled = new Uint32Array(4);

function covered(
  boxes: Float32Array,
  start: number,
  count: number,
  self: number,
  f: number,
): boolean {
  const a = (start + self) * 6;
  const axis = NORMAL_AXIS[f]!;
  const positive = f % 2 === 0;
  const plane = boxes[a + axis + (positive ? 3 : 0)]!;
  const u = AXIS_OF_U[f]!,
    v = AXIS_OF_V[f]!;
  for (let other = 0; other < count; other++) {
    if (other === self) continue;
    const b = (start + other) * 6;
    // The other box must end exactly where this face starts, with its own face looking back at it.
    if (Math.abs(boxes[b + axis + (positive ? 0 : 3)]! - plane) > EPS) continue;
    if (
      boxes[b + u]! <= boxes[a + u]! + EPS &&
      boxes[b + u + 3]! >= boxes[a + u + 3]! - EPS &&
      boxes[b + v]! <= boxes[a + v]! + EPS &&
      boxes[b + v + 3]! >= boxes[a + v + 3]! - EPS
    )
      return true;
  }
  return false;
}

/**
 * Appends the visible faces of one block's boxes and returns the number of quads written.
 * `index` is the block's position in the padded 18^3 section; (bx, by, bz) its section-local corner.
 */
export function emitShapeBlock(
  tables: ShapeTables,
  state: number,
  blocks: Uint16Array,
  light: Uint16Array | undefined,
  index: number,
  bx: number,
  by: number,
  bz: number,
  vertices: Uint32Array,
  vertexOffset: number,
  indices: Uint32Array,
  indexOffset: number,
): number {
  const start = tables.shapeStart[state]!;
  const count = tables.shapeCount[state]!;
  const boxes = tables.shapeBoxes;
  const own = light ? light[index]! : 0xf000;
  let quads = 0;
  for (let n = 0; n < count; n++) {
    const o = (start + n) * 6;
    for (let f = 0; f < 6; f++) {
      const axis = NORMAL_AXIS[f]!;
      const positive = f % 2 === 0;
      const plane = boxes[o + axis + (positive ? 3 : 0)]!;
      const boundary = positive ? plane >= 1 - EPS : plane <= EPS;
      if (boundary && tables.isOpaqueCube[blocks[index + FACE_NORMAL_STRIDES[f]!]!] === 1) continue;
      if (covered(boxes, start, count, n, f)) continue;
      if (boundary)
        sampleFaceCorners(blocks, light, tables.isOpaqueCube, index, f, false, sampled, 0);
      const tile = tables.tileIndices[state * 6 + f]!;
      const u = AXIS_OF_U[f]!,
        v = AXIS_OF_V[f]!;
      for (let c = 0; c < 4; c++) {
        const corner = SLAB_CORNERS[f]![c]!;
        const p0 = Math.round((corner[0] ? boxes[o + 3]! : boxes[o]!) * 16);
        const p1 = Math.round((corner[1] ? boxes[o + 4]! : boxes[o + 1]!) * 16);
        const p2 = Math.round((corner[2] ? boxes[o + 5]! : boxes[o + 2]!) * 16);
        let sky = own >>> 12,
          r = (own >>> 8) & 15,
          g = (own >>> 4) & 15,
          b = own & 15,
          ao = 0;
        if (boundary) {
          const pos = [p0, p1, p2];
          const tu = pos[u]! / 16,
            tv = pos[v]! / 16;
          const signs = CORNER_SIGNS[f]!;
          let fs = 0,
            fr = 0,
            fg = 0,
            fb = 0,
            fa = 0;
          for (let k = 0; k < 4; k++) {
            const w = (signs[k * 2]! > 0 ? tu : 1 - tu) * (signs[k * 2 + 1]! > 0 ? tv : 1 - tv);
            const t = sampled[k]!;
            fs += w * (t & 15);
            fr += w * ((t >>> 4) & 15);
            fg += w * ((t >>> 8) & 15);
            fb += w * ((t >>> 12) & 15);
            fa += w * (t >>> 16);
          }
          sky = Math.round(fs);
          r = Math.round(fr);
          g = Math.round(fg);
          b = Math.round(fb);
          ao = Math.round(fa);
        }
        packShapeVertex(
          vertices,
          vertexOffset + c * 2,
          bx,
          by,
          bz,
          p0,
          p1,
          p2,
          f,
          ao,
          sky,
          r,
          g,
          b,
          tile,
        );
      }
      const base = vertexOffset / 2;
      indices[indexOffset] = base;
      indices[indexOffset + 1] = base + 1;
      indices[indexOffset + 2] = base + 2;
      indices[indexOffset + 3] = base;
      indices[indexOffset + 4] = base + 2;
      indices[indexOffset + 5] = base + 3;
      vertexOffset += 8;
      indexOffset += 6;
      quads++;
    }
  }
  return quads;
}

// Re-exported so the mesher can size and test against the same strides.
export { U_STRIDES, V_STRIDES };
