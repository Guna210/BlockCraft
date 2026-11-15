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

/** Connectivity of non-opaque cells in the core of an 18-cubed padded section. */
export function sectionVisibility(blocks: Uint16Array, opaque: Uint8Array): number {
  let solidCount = 0;
  let cellIndex = 0;
  visited.fill(0);
  for (let z = 1; z <= 16; z++) {
    for (let y = 1; y <= 16; y++) {
      for (let x = 1; x <= 16; x++) {
        if (opaque[blocks[x + y * 18 + z * 324]!] !== 0) {
          visited[cellIndex >>> 5] = visited[cellIndex >>> 5]! | (1 << (cellIndex & 31));
          solidCount++;
        }
        cellIndex++;
      }
    }
  }
  if (solidCount === 0) return ALL_FACE_CONNECTIONS;
  if (solidCount === 4096) return 0;
  let result = 0;
  for (let start = 0; start < 4096; start++) {
    const word = start >>> 5;
    const bit = 1 << (start & 31);
    if ((visited[word]! & bit) !== 0) continue;
    let size = 0;
    let faces = 0;
    stack[size++] = start;
    visited[word] = visited[word]! | bit;
    while (size) {
      const cell = stack[--size]!;
      const cx = cell & 15;
      const cy = (cell >>> 4) & 15;
      const cz = cell >>> 8;
      if (cx === 15) faces |= 1;
      if (cx === 0) faces |= 2;
      if (cy === 15) faces |= 4;
      if (cy === 0) faces |= 8;
      if (cz === 15) faces |= 16;
      if (cz === 0) faces |= 32;
      for (let direction = 0; direction < 6; direction++) {
        if (
          (direction === 0 && cx === 15) ||
          (direction === 1 && cx === 0) ||
          (direction === 2 && cy === 15) ||
          (direction === 3 && cy === 0) ||
          (direction === 4 && cz === 15) ||
          (direction === 5 && cz === 0)
        )
          continue;
        const next =
          cell +
          (direction === 0
            ? 1
            : direction === 1
              ? -1
              : direction === 2
                ? 16
                : direction === 3
                  ? -16
                  : direction === 4
                    ? 256
                    : -256);
        const nextWord = next >>> 5;
        const nextBit = 1 << (next & 31);
        if ((visited[nextWord]! & nextBit) !== 0) continue;
        visited[nextWord] = visited[nextWord]! | nextBit;
        stack[size++] = next;
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
