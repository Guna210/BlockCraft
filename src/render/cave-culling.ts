import { ALL_FACE_CONNECTIONS, faceConnectionBit } from '../mesh/visibility';

const NOT_READY_MASK = 0xffff;

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
  private readonly visibleSnapshot: Uint8Array;
  private readonly stamps: Uint32Array;
  private readonly entries: Uint8Array;
  private readonly edges: Uint8Array;
  private readonly offsets: Int32Array;
  private readonly queue: Int32Array;
  private generation = 0;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly depth: number,
  ) {
    const cells = width * height * depth;
    this.visibleSnapshot = new Uint8Array(cells);
    this.stamps = new Uint32Array(cells);
    this.entries = new Uint8Array(cells);
    this.edges = new Uint8Array(cells);
    this.offsets = new Int32Array([1, -1, width, -width, width * height, -width * height]);
    this.queue = new Int32Array(cells);
    for (let z = 0; z < depth; z++)
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          let edges = 0;
          if (x === width - 1) edges |= 1 << 0;
          if (x === 0) edges |= 1 << 1;
          if (y === height - 1) edges |= 1 << 2;
          if (y === 0) edges |= 1 << 3;
          if (z === depth - 1) edges |= 1 << 4;
          if (z === 0) edges |= 1 << 5;
          this.edges[z * width * height + y * width + x] = edges;
        }
  }

  traverse(
    masks: ArrayLike<number>,
    inFrustum: Uint8Array,
    start: number,
    allOpen = false,
    frustumIndices?: Int32Array,
    frustumCount = 0,
  ): void {
    this.generation = (this.generation + 1) >>> 0;
    if (!this.generation) {
      this.stamps.fill(0);
      this.generation = 1;
    }
    if (start < 0 || start >= this.stamps.length) return;
    if (allOpen) {
      if (frustumIndices) {
        for (let i = 0; i < frustumCount; i++) this.stamps[frustumIndices[i]!] = this.generation;
      } else {
        for (let i = 0; i < inFrustum.length; i++)
          if (inFrustum[i]) this.stamps[i] = this.generation;
      }
      return;
    }
    const planeSize = this.width * this.height;
    const startX = start % this.width;
    const startY = Math.floor(start / this.width) % this.height;
    const startZ = Math.floor(start / planeSize);
    let head = 0;
    let tail = 0;
    this.stamps[start] = this.generation;
    this.entries[start] = 0;
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
      const rawMask = masks[cell]!;
      const mask = rawMask < 0 || rawMask === NOT_READY_MASK ? ALL_FACE_CONNECTIONS : rawMask;
      // Monotonic paths to a cell all have the same length. Every predecessor is processed before
      // this cell, so its incoming faces can be combined before computing exits once.
      let exits = mask === ALL_FACE_CONNECTIONS ? 63 : 0;
      if (mask !== ALL_FACE_CONNECTIONS) {
        const entries = this.entries[cell]!;
        for (let entry = 0; entry < 6; entry++)
          if (entries & (1 << entry)) exits |= exitsByMask[mask * 6 + entry]!;
      }
      const x = cell % this.width;
      const y = Math.floor(cell / this.width) % this.height;
      const z = Math.floor(cell / planeSize);
      const dx = x - startX;
      const dy = y - startY;
      const dz = z - startZ;
      const taken =
        (dx > 0 ? 1 : dx < 0 ? 2 : 0) |
        (dy > 0 ? 4 : dy < 0 ? 8 : 0) |
        (dz > 0 ? 16 : dz < 0 ? 32 : 0);
      if (taken & (1 << 0)) exits &= ~(1 << 1);
      if (taken & (1 << 1)) exits &= ~(1 << 0);
      if (taken & (1 << 2)) exits &= ~(1 << 3);
      if (taken & (1 << 3)) exits &= ~(1 << 2);
      if (taken & (1 << 4)) exits &= ~(1 << 5);
      if (taken & (1 << 5)) exits &= ~(1 << 4);
      for (let direction = 0; direction < 6; direction++) {
        if (!(exits & (1 << direction))) continue;
        if (this.edges[cell]! & (1 << direction)) continue;
        const next = cell + this.offsets[direction]!;
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

  isVisible(cell: number): boolean {
    return cell >= 0 && cell < this.stamps.length && this.stamps[cell] === this.generation;
  }

  /** Materializes a view for tests and diagnostics; the renderer uses isVisible without clearing a grid. */
  get visible(): Uint8Array {
    this.visibleSnapshot.fill(0);
    for (let i = 0; i < this.stamps.length; i++)
      this.visibleSnapshot[i] = this.stamps[i] === this.generation ? 1 : 0;
    return this.visibleSnapshot;
  }

  private neighbour(cell: number, direction: number): number {
    return this.edges[cell]! & (1 << direction) ? -1 : cell + this.offsets[direction]!;
  }
}
