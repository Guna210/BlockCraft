import { SHAPE_VERTEX, packShapeVertex } from './vertex';
import type { MeshLookupTables } from './greedy';

type Quad = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

function writeQuad(
  vertices: Uint32Array,
  vertexOffset: number,
  indices: Uint32Array,
  indexOffset: number,
  blockX: number,
  blockY: number,
  blockZ: number,
  quad: Quad,
  tile: number,
  light: number,
): void {
  for (let corner = 0; corner < 4; corner++) {
    const [x, y, z] = quad[corner]!;
    packShapeVertex(
      vertices,
      vertexOffset + corner * 2,
      blockX,
      blockY,
      blockZ,
      x,
      y,
      z,
      2,
      0,
      light >>> 12,
      (light >>> 8) & 15,
      (light >>> 4) & 15,
      light & 15,
      tile & SHAPE_VERTEX.tileMask,
    );
  }
  const base = vertexOffset / 2;
  for (let n = 0; n < 6; n++) indices[indexOffset + n] = base + [0, 1, 2, 0, 2, 3][n]!;
}

function isTrace(state: number, tables: MeshLookupTables): boolean {
  return tables.modelKind[state] === 13;
}

/** Trace neighbours are sampled from the padded mesh input, so connection geometry is never saved. */
export function emitCopperTrace(
  tables: MeshLookupTables,
  blocks: Uint16Array,
  light: Uint16Array | undefined,
  state: number,
  index: number,
  bx: number,
  by: number,
  bz: number,
  vertices: Uint32Array,
  vertexOffset: number,
  indices: Uint32Array,
  indexOffset: number,
): number {
  const tile = tables.tileIndices[state * 6 + 2]!;
  const ownLight = light ? light[index]! : 0xf000;
  const quads: Quad[] = [
    [
      [5, 1, 5],
      [11, 1, 5],
      [11, 1, 11],
      [5, 1, 11],
    ],
  ];
  const horizontalStrides = [1, -1, 18 * 18, -(18 * 18)] as const;
  const directions = [
    { axis: 'x', edge: 16, start: 8, end: 16 },
    { axis: 'x', edge: 0, start: 0, end: 8 },
    { axis: 'z', edge: 16, start: 8, end: 16 },
    { axis: 'z', edge: 0, start: 0, end: 8 },
  ] as const;

  for (let direction = 0; direction < directions.length; direction++) {
    const descriptor = directions[direction]!;
    const horizontalStride = horizontalStrides[direction]!;
    const neighbor = blocks[index + horizontalStride]!;
    let rise = false;
    let descend = false;
    if (!isTrace(neighbor, tables)) {
      rise = isTrace(blocks[index + horizontalStride + 18]!, tables);
      descend = !rise && isTrace(blocks[index + horizontalStride - 18]!, tables);
    }
    if (!isTrace(neighbor, tables) && !rise && !descend) continue;

    if (descriptor.axis === 'x') {
      const x0 = descriptor.start;
      const x1 = descriptor.end;
      const y0 = rise ? (descriptor.edge === 16 ? 1 : 17) : 1;
      const y1 = rise ? (descriptor.edge === 16 ? 17 : 1) : 1;
      quads.push([
        [x0, y0, 6],
        [x1, y1, 6],
        [x1, y1, 10],
        [x0, y0, 10],
      ]);
    } else {
      const z0 = descriptor.start;
      const z1 = descriptor.end;
      const y0 = rise ? (descriptor.edge === 16 ? 1 : 17) : 1;
      const y1 = rise ? (descriptor.edge === 16 ? 17 : 1) : 1;
      quads.push([
        [6, y0, z0],
        [10, y0, z0],
        [10, y1, z1],
        [6, y1, z1],
      ]);
    }
  }

  for (let n = 0; n < quads.length; n++)
    writeQuad(
      vertices,
      vertexOffset + n * 8,
      indices,
      indexOffset + n * 6,
      bx,
      by,
      bz,
      quads[n]!,
      tile,
      ownLight,
    );
  return quads.length;
}

/** Tripwire strands are thin, horizontal crossed quads rendered from the current block model. */
export function emitTripwire(
  state: number,
  tables: MeshLookupTables,
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
  const tile = tables.tileIndices[state * 6 + 2]!;
  const ownLight = light ? light[index]! : 0xf000;
  const quads: Quad[] = [
    [
      [0, 8, 7],
      [16, 8, 7],
      [16, 8, 9],
      [0, 8, 9],
    ],
    [
      [7, 8, 0],
      [9, 8, 0],
      [9, 8, 16],
      [7, 8, 16],
    ],
  ];
  for (let n = 0; n < quads.length; n++)
    writeQuad(
      vertices,
      vertexOffset + n * 8,
      indices,
      indexOffset + n * 6,
      bx,
      by,
      bz,
      quads[n]!,
      tile,
      ownLight,
    );
  return quads.length;
}
