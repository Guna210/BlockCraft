import type { MeshLookupTables, BucketScratch } from './greedy';
import { packVertex } from './vertex';
import { sampleFaceCorners, FACE_NORMAL_STRIDES } from './ao';

/** Four touching cells use identical world corners, including across section boundaries. */
export function fluidCornerHeight(
  blocks: Uint16Array,
  tables: MeshLookupTables,
  index: number,
  kind: number,
): number {
  let sum = 0,
    count = 0;
  for (const offset of [0, -1, -324, -325]) {
    const i = index + offset;
    const state = blocks[i]!;
    if (tables.fluidKind?.[state] === kind) {
      if (tables.fluidKind[blocks[i + 18]!] === kind || tables.fluidFalling![state]) return 64;
      const height = tables.fluidHeight![state]!;
      const weight = height >= 56 ? 4 : 1;
      sum += height * weight;
      count += weight;
    } else if (!tables.isOpaqueCube[state]) count++;
  }
  return Math.round(sum / Math.max(1, count));
}

const FACES = [
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
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ],
  [
    [1, 0, 0],
    [0, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
  ],
];
const corners = new Uint32Array(4);

export function emitFluidBlocks(
  blocks: Uint16Array,
  tables: MeshLookupTables,
  light: Uint16Array | undefined,
  opaque: BucketScratch,
  translucent: BucketScratch,
): void {
  if (!tables.fluidKind) return;
  for (let z = 0; z < 16; z++)
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const index = x + 1 + (y + 1) * 18 + (z + 1) * 324;
        const state = blocks[index]!;
        const kind = tables.fluidKind[state]!;
        if (!kind) continue;
        const heights = [0, 1, 324, 325].map((o) =>
          fluidCornerHeight(blocks, tables, index + o, kind),
        );
        const dx = heights[0]! + heights[2]! - heights[1]! - heights[3]!;
        const dz = heights[0]! + heights[1]! - heights[2]! - heights[3]!;
        const flow = tables.fluidFalling![state]
          ? 9
          : Math.hypot(dx, dz) > 1
            ? 1 + ((Math.round((Math.atan2(dz, dx) * 4) / Math.PI) + 8) % 8)
            : 0;
        const scratch = kind === 1 ? translucent : opaque;
        for (let face = 0; face < 6; face++) {
          const neighbor = blocks[index + FACE_NORMAL_STRIDES[face]!]!;
          if (tables.isOpaqueCube[neighbor] || tables.fluidKind[neighbor] === kind) continue;
          sampleFaceCorners(blocks, light, tables.isOpaqueCube, index, face, true, corners, 0);
          const base = scratch.vertOffset / 2;
          for (let v = 0; v < 4; v++) {
            const [vx, vy, vz] = FACES[face]![v]! as [number, number, number];
            const h = vy ? heights[vx + vz * 2]! : 0;
            const posY = y + vy;
            const lightCorner = face < 2 ? [0, 3, 2, 1][v]! : v;
            const c = corners[lightCorner]!;
            packVertex(
              x + vx,
              Math.floor(posY),
              z + vz,
              face,
              c >>> 16,
              c & 15,
              (c >>> 4) & 15,
              kind + 3,
              tables.tileIndices[state * 6 + face]!,
              0,
              0,
              scratch.vertices,
              scratch.vertOffset,
              (c >>> 8) & 15,
              (c >>> 12) & 15,
            );
            // Fluid payload: top depression /64 (6 bits), flow octant (4), unit UV corner (2).
            scratch.vertices[scratch.vertOffset + 1] =
              (scratch.vertices[scratch.vertOffset + 1]! & 0x3fc00fff) |
              (((vy ? 64 - h : 0) % 64) << 12) |
              (flow << 18) |
              ((face === 0 || face === 1 ? vz : vx) << 30) |
              ((face === 2 || face === 3 ? vz : 1 - vy) << 31);
            scratch.vertOffset += 2;
          }
          for (const v of [0, 1, 2, 0, 2, 3]) scratch.indices[scratch.indexOffset++] = base + v;
          scratch.quadCount++;
        }
      }
}
