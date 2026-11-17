/** The face order matches the mesh normals: +X, -X, +Y, -Y, +Z, -Z. */
export const ALL_FACE_CONNECTIONS = 0x7fff;

/** Masks for streamer-skipped uniform sections; -1 remains reserved for missing results. */
export function trivialVisibilityMasks(sections: Int8Array): Int32Array {
  const masks = new Int32Array(sections.length);
  for (let i = 0; i < sections.length; i++)
    masks[i] = sections[i] === 0 ? ALL_FACE_CONNECTIONS : sections[i] === 1 ? 0 : -1;
  return masks;
}

export function faceConnectionBit(a: number, b: number): number {
  if (a === b) return 0;
  if (a > b) {
    const swap = a;
    a = b;
    b = swap;
  }
  return 1 << ((a * (11 - a)) / 2 + b - a - 1);
}

// Each worker processes mesh jobs serially, so this scratch belongs to the worker, not a job.
const visited = new Uint32Array(128);
const stack = new Uint16Array(4096);
const NO_CELL = 0xffff;
const cellFaces = new Uint8Array(4096);
const cellNeighbors = new Uint16Array(4096 * 6).fill(NO_CELL);
const paddedBlockIndices = new Uint16Array(4096);
const boundaryCells = new Uint16Array(6 * 16 * 16);
let boundaryCellCount = 0;
for (let z = 0; z < 16; z++) {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const cell = x + y * 16 + z * 256;
      paddedBlockIndices[cell] = x + 1 + (y + 1) * 18 + (z + 1) * 324;
      const neighbors = cell * 6;
      if (x === 15) cellFaces[cell] = cellFaces[cell]! | 1;
      else cellNeighbors[neighbors] = cell + 1;
      if (x === 0) cellFaces[cell] = cellFaces[cell]! | 2;
      else cellNeighbors[neighbors + 1] = cell - 1;
      if (y === 15) cellFaces[cell] = cellFaces[cell]! | 4;
      else cellNeighbors[neighbors + 2] = cell + 16;
      if (y === 0) cellFaces[cell] = cellFaces[cell]! | 8;
      else cellNeighbors[neighbors + 3] = cell - 16;
      if (z === 15) cellFaces[cell] = cellFaces[cell]! | 16;
      else cellNeighbors[neighbors + 4] = cell + 256;
      if (z === 0) cellFaces[cell] = cellFaces[cell]! | 32;
      else cellNeighbors[neighbors + 5] = cell - 256;
      if (cellFaces[cell]) boundaryCells[boundaryCellCount++] = cell;
    }
  }
}

/** Connectivity of non-opaque cells in the core of an 18-cubed padded section. */
export function sectionVisibility(blocks: Uint16Array, opaque: Uint8Array): number {
  visited.fill(0);
  let result = 0;
  for (let boundary = 0; boundary < boundaryCellCount; boundary++) {
    const start = boundaryCells[boundary]!;
    const word = start >>> 5;
    const bit = 1 << (start & 31);
    if ((visited[word]! & bit) !== 0) continue;
    if (opaque[blocks[paddedBlockIndices[start]!]!] !== 0) {
      visited[word] = visited[word]! | bit;
      continue;
    }
    let size = 1;
    let faces = 0;
    stack[0] = start;
    visited[word] = visited[word]! | bit;
    while (size) {
      const cell = stack[--size]!;
      faces |= cellFaces[cell]!;
      // Once one open component touches every face, all 15 connections are known. Stop here
      // instead of visiting the rest of a large open component in a mostly hollow section.
      if (faces === 63) return ALL_FACE_CONNECTIONS;
      const neighborOffset = cell * 6;
      for (let direction = 0; direction < 6; direction++) {
        const next = cellNeighbors[neighborOffset + direction]!;
        if (next === NO_CELL) continue;
        const nextWord = next >>> 5;
        const nextBit = 1 << (next & 31);
        if ((visited[nextWord]! & nextBit) !== 0) continue;
        visited[nextWord] = visited[nextWord]! | nextBit;
        if (opaque[blocks[paddedBlockIndices[next]!]!] === 0) stack[size++] = next;
      }
    }
    for (let a = 0; a < 6; a++) {
      if (!(faces & (1 << a))) continue;
      for (let b = a + 1; b < 6; b++) if (faces & (1 << b)) result |= faceConnectionBit(a, b);
    }
    if (result === ALL_FACE_CONNECTIONS) return result;
  }
  return result;
}
