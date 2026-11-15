import { ALL_FACE_CONNECTIONS, faceConnectionBit } from '../mesh/visibility';

// An incoming face maps directly to the faces that component can exit through.
const exitsByMask = new Uint8Array(32768 * 6);
for (let mask = 0; mask <= ALL_FACE_CONNECTIONS; mask++) {
  for (let entry = 0; entry < 6; entry++) {
    let exits = 0;
    for (let direction = 0; direction < 6; direction++)
      if (mask & faceConnectionBit(entry, direction)) exits |= 1 << direction;
    exitsByMask[mask * 6 + entry] = exits;
  }
}

/** Reusable bounded traversal; masks < 0 represent sections whose data is not ready. */
export class CaveCuller {
  readonly visible: Uint8Array;
  private readonly stamps: Uint32Array;
  private readonly entries: Uint8Array;
  private readonly queue: Uint32Array;
  private generation = 0;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly depth: number,
  ) {
    const cells = width * height * depth;
    this.visible = new Uint8Array(cells);
    this.stamps = new Uint32Array(cells);
    this.entries = new Uint8Array(cells);
    this.queue = new Uint32Array(cells);
  }

  traverse(masks: Int32Array, inFrustum: Uint8Array, start: number): void {
    this.visible.fill(0);
    if (start < 0 || start >= this.visible.length) return;
    this.generation = (this.generation + 1) >>> 0;
    if (!this.generation) {
      this.stamps.fill(0);
      this.generation = 1;
    }
    let head = 0;
    let tail = 0;
    const startX = start % this.width;
    const startY = Math.floor(start / this.width) % this.height;
    const startZ = Math.floor(start / (this.width * this.height));
    this.visible[start] = 1;
    // The camera may be anywhere inside its section, so it can leave through any face.
    for (let direction = 0; direction < 6; direction++) {
      const next = this.neighbour(start, direction);
      if (next < 0 || !inFrustum[next]) continue;
      if (this.stamps[next] !== this.generation) {
        this.stamps[next] = this.generation;
        this.entries[next] = 0;
        this.queue[tail++] = next;
      }
      this.entries[next] = this.entries[next]! | (1 << (direction ^ 1));
    }
    while (head < tail) {
      const cell = this.queue[head++]!;
      const x = cell % this.width;
      const y = Math.floor(cell / this.width) % this.height;
      const z = Math.floor(cell / (this.width * this.height));
      this.visible[cell] = 1;
      const mask = masks[cell]! < 0 ? ALL_FACE_CONNECTIONS : masks[cell]!;
      // Monotonic paths to a cell all have the same length. Every predecessor is processed before
      // this cell, so its incoming faces can be combined before computing exits once.
      let exits = mask === ALL_FACE_CONNECTIONS ? 63 : 0;
      if (mask !== ALL_FACE_CONNECTIONS) {
        const entries = this.entries[cell]!;
        for (let entry = 0; entry < 6; entry++)
          if (entries & (1 << entry)) exits |= exitsByMask[mask * 6 + entry]!;
      }
      if (x < startX) exits &= ~(1 << 0);
      if (x > startX) exits &= ~(1 << 1);
      if (y < startY) exits &= ~(1 << 2);
      if (y > startY) exits &= ~(1 << 3);
      if (z < startZ) exits &= ~(1 << 4);
      if (z > startZ) exits &= ~(1 << 5);
      for (let direction = 0; direction < 6; direction++) {
        if (!(exits & (1 << direction))) continue;
        if (
          (direction === 0 && x === this.width - 1) ||
          (direction === 1 && x === 0) ||
          (direction === 2 && y === this.height - 1) ||
          (direction === 3 && y === 0) ||
          (direction === 4 && z === this.depth - 1) ||
          (direction === 5 && z === 0)
        )
          continue;
        const next =
          cell +
          (direction === 0
            ? 1
            : direction === 1
              ? -1
              : direction === 2
                ? this.width
                : direction === 3
                  ? -this.width
                  : direction === 4
                    ? this.width * this.height
                    : -this.width * this.height);
        if (!inFrustum[next]) continue;
        if (this.stamps[next] !== this.generation) {
          this.stamps[next] = this.generation;
          this.entries[next] = 0;
          this.queue[tail++] = next;
        }
        const entryBit = 1 << (direction ^ 1);
        this.entries[next] = this.entries[next]! | entryBit;
      }
    }
  }

  private neighbour(cell: number, direction: number): number {
    const x = cell % this.width;
    const y = Math.floor(cell / this.width) % this.height;
    const z = Math.floor(cell / (this.width * this.height));
    if (
      (direction === 0 && x === this.width - 1) ||
      (direction === 1 && x === 0) ||
      (direction === 2 && y === this.height - 1) ||
      (direction === 3 && y === 0) ||
      (direction === 4 && z === this.depth - 1) ||
      (direction === 5 && z === 0)
    )
      return -1;
    return (
      cell +
      (direction === 0
        ? 1
        : direction === 1
          ? -1
          : direction === 2
            ? this.width
            : direction === 3
              ? -this.width
              : direction === 4
                ? this.width * this.height
                : -this.width * this.height)
    );
  }
}
