/** Node expansions per tick, shared by every flyer of one world. */
export const FLIGHT_NODE_BUDGET = 160;
/** Expansions one search may use before it gives up. */
export const FLIGHT_MAX_NODES = 2400;
/** Waypoints kept from a found path (the rest is re-planned on arrival). */
export const FLIGHT_MAX_PATH = 48;
/** Searches stay inside a cube this many blocks from the start in each direction. */
export const FLIGHT_RANGE = 20;
/** Searches waiting at once; later requests wait for a free slot. */
const QUEUE_CAPACITY = 16;
const SIDE = FLIGHT_RANGE * 2 + 1;
const CELLS = SIDE * SIDE * SIDE;
const HEAP_CAPACITY = FLIGHT_MAX_NODES * 6 + 8;
const NEIGHBOURS = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1] as const;

export type FlightStatus = 'idle' | 'pending' | 'ready' | 'failed';

/** One flyer's path: waypoints are cell coordinates, flown through cell centres. */
export class FlightPath {
  readonly cells = new Int32Array(FLIGHT_MAX_PATH * 3);
  length = 0;
  /** The next waypoint to fly to. */
  index = 0;
  status: FlightStatus = 'idle';
  /** The goal cell this path was planned toward. */
  goalX = 0;
  goalY = 0;
  goalZ = 0;
  /** Searches requested for this path, for tests. */
  plans = 0;
  /** Set while a request is queued or searching. */
  startX = 0;
  startY = 0;
  startZ = 0;

  clear(): void {
    this.length = 0;
    this.index = 0;
    this.status = 'idle';
  }
}

/** Free air for a flyer: true when the cell can be flown through. */
export type AirTest = (x: number, y: number, z: number) => boolean;

/**
 * Bounded, incremental A* over air voxels for flying mobs. Searches run from a queue under one
 * per-tick expansion budget, and every scratch structure (g-scores, parents, stamps and the heap) is
 * allocated once and reused, with generation stamps instead of clearing.
 */
export class FlightPathfinder {
  private readonly g = new Float32Array(CELLS);
  private readonly parent = new Int32Array(CELLS);
  private readonly seen = new Uint32Array(CELLS);
  private readonly closed = new Uint32Array(CELLS);
  private readonly heapCell = new Int32Array(HEAP_CAPACITY);
  private readonly heapF = new Float32Array(HEAP_CAPACITY);
  private heapSize = 0;
  private stamp = 0;
  private readonly queue: Array<FlightPath | null> = new Array<FlightPath | null>(
    QUEUE_CAPACITY,
  ).fill(null);
  private queueHead = 0;
  private queueSize = 0;
  private active: FlightPath | null = null;
  private expanded = 0;
  private best = 0;
  private bestH = Infinity;
  private lastTick = -1;
  /** Expansions done in the most recent tick. */
  lastExpansions = 0;
  /** Completed searches (found, partial or failed). */
  searches = 0;

  constructor(private readonly air: AirTest) {}

  /** Asks for a path from cell s to cell g; ignored while the path is already pending. */
  request(
    path: FlightPath,
    sx: number,
    sy: number,
    sz: number,
    gx: number,
    gy: number,
    gz: number,
  ) {
    if (path.status === 'pending') return;
    if (this.queueSize >= QUEUE_CAPACITY) return;
    path.status = 'pending';
    path.plans++;
    path.startX = sx;
    path.startY = sy;
    path.startZ = sz;
    path.goalX = gx;
    path.goalY = gy;
    path.goalZ = gz;
    this.queue[(this.queueHead + this.queueSize) % QUEUE_CAPACITY] = path;
    this.queueSize++;
  }

  /** Drops a queued or running request. */
  cancel(path: FlightPath): void {
    if (this.active === path) this.active = null;
    for (let i = 0; i < this.queueSize; i++) {
      const at = (this.queueHead + i) % QUEUE_CAPACITY;
      if (this.queue[at] === path) this.queue[at] = null;
    }
    if (path.status === 'pending') path.status = 'idle';
  }

  get pending(): number {
    return this.queueSize + (this.active ? 1 : 0);
  }

  /** Runs searches for at most FLIGHT_NODE_BUDGET expansions; once per `time` value. */
  tick(time: number): void {
    if (time === this.lastTick) return;
    this.lastTick = time;
    let budget = FLIGHT_NODE_BUDGET;
    this.lastExpansions = 0;
    while (budget > 0) {
      if (!this.active && !this.begin()) break;
      const used = this.step(budget);
      budget -= used;
      this.lastExpansions += used;
    }
  }

  private begin(): boolean {
    while (this.queueSize > 0) {
      const path = this.queue[this.queueHead];
      this.queue[this.queueHead] = null;
      this.queueHead = (this.queueHead + 1) % QUEUE_CAPACITY;
      this.queueSize--;
      if (!path || path.status !== 'pending') continue;
      this.active = path;
      this.stamp++;
      if (this.stamp === 0xffffffff) {
        this.seen.fill(0);
        this.closed.fill(0);
        this.stamp = 1;
      }
      this.heapSize = 0;
      this.expanded = 0;
      const start = this.index(0, 0, 0);
      this.seen[start] = this.stamp;
      this.g[start] = 0;
      this.parent[start] = -1;
      this.best = start;
      this.bestH = this.heuristic(path.startX, path.startY, path.startZ, path);
      this.push(start, this.bestH);
      return true;
    }
    return false;
  }

  private index(dx: number, dy: number, dz: number): number {
    return dx + FLIGHT_RANGE + (dy + FLIGHT_RANGE) * SIDE + (dz + FLIGHT_RANGE) * SIDE * SIDE;
  }

  private heuristic(x: number, y: number, z: number, path: FlightPath): number {
    return Math.hypot(path.goalX - x, path.goalY - y, path.goalZ - z);
  }

  /** Expands up to `budget` nodes of the active search; returns the expansions used. */
  private step(budget: number): number {
    const path = this.active!;
    let used = 0;
    while (used < budget) {
      if (this.heapSize === 0 || this.expanded >= FLIGHT_MAX_NODES) {
        // Exhausted or out of nodes: fly toward the closest cell reached, if it is any closer.
        this.finish(
          path,
          this.bestH < this.heuristic(path.startX, path.startY, path.startZ, path) - 1,
        );
        return used;
      }
      const cell = this.pop();
      if (this.closed[cell] === this.stamp) continue;
      this.closed[cell] = this.stamp;
      used++;
      this.expanded++;
      const lx = (cell % SIDE) - FLIGHT_RANGE;
      const ly = (Math.floor(cell / SIDE) % SIDE) - FLIGHT_RANGE;
      const lz = Math.floor(cell / (SIDE * SIDE)) - FLIGHT_RANGE;
      const x = path.startX + lx,
        y = path.startY + ly,
        z = path.startZ + lz;
      const h = this.heuristic(x, y, z, path);
      if (h < this.bestH) {
        this.bestH = h;
        this.best = cell;
      }
      if (x === path.goalX && y === path.goalY && z === path.goalZ) {
        this.finish(path, true);
        return used;
      }
      const g = this.g[cell]!;
      for (let n = 0; n < 18; n += 3) {
        const nx = lx + NEIGHBOURS[n]!,
          ny = ly + NEIGHBOURS[n + 1]!,
          nz = lz + NEIGHBOURS[n + 2]!;
        if (
          nx < -FLIGHT_RANGE ||
          nx > FLIGHT_RANGE ||
          ny < -FLIGHT_RANGE ||
          ny > FLIGHT_RANGE ||
          nz < -FLIGHT_RANGE ||
          nz > FLIGHT_RANGE
        )
          continue;
        const next = this.index(nx, ny, nz);
        if (this.closed[next] === this.stamp) continue;
        const ng = g + 1;
        if (this.seen[next] === this.stamp && this.g[next]! <= ng) continue;
        if (this.seen[next] !== this.stamp) {
          if (!this.air(path.startX + nx, path.startY + ny, path.startZ + nz)) {
            // Remember solid cells as closed so they are tested once per search.
            this.seen[next] = this.stamp;
            this.closed[next] = this.stamp;
            continue;
          }
        }
        this.seen[next] = this.stamp;
        this.g[next] = ng;
        this.parent[next] = cell;
        if (this.heapSize >= HEAP_CAPACITY) continue;
        this.push(
          next,
          ng + 1.2 * this.heuristic(path.startX + nx, path.startY + ny, path.startZ + nz, path),
        );
      }
    }
    return used;
  }

  /** Writes the waypoints from the start to the goal (or the best cell reached), simplified. */
  private finish(path: FlightPath, success: boolean): void {
    this.active = null;
    this.searches++;
    if (!success) {
      path.length = 0;
      path.index = 0;
      path.status = 'failed';
      return;
    }
    const goal = this.best;
    // Count the chain, then keep only its first FLIGHT_MAX_PATH cells nearest the start.
    let count = 0;
    for (let c = goal; c !== -1; c = this.parent[c]!) count++;
    const skip = Math.max(0, count - FLIGHT_MAX_PATH);
    let cell = goal;
    for (let i = 0; i < skip; i++) cell = this.parent[cell]!;
    const kept = count - skip;
    for (let i = kept - 1; i >= 0; i--) {
      path.cells[i * 3] = path.startX + (cell % SIDE) - FLIGHT_RANGE;
      path.cells[i * 3 + 1] = path.startY + (Math.floor(cell / SIDE) % SIDE) - FLIGHT_RANGE;
      path.cells[i * 3 + 2] = path.startZ + Math.floor(cell / (SIDE * SIDE)) - FLIGHT_RANGE;
      cell = this.parent[cell]!;
    }
    path.length = kept;
    path.index = kept > 1 ? 1 : 0;
    path.status = 'ready';
  }

  private push(cell: number, f: number): void {
    let i = this.heapSize++;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (this.heapF[up]! <= f) break;
      this.heapCell[i] = this.heapCell[up]!;
      this.heapF[i] = this.heapF[up]!;
      i = up;
    }
    this.heapCell[i] = cell;
    this.heapF[i] = f;
  }

  private pop(): number {
    const top = this.heapCell[0]!;
    const size = --this.heapSize;
    if (size > 0) {
      const cell = this.heapCell[size]!,
        f = this.heapF[size]!;
      let i = 0;
      for (;;) {
        let child = i * 2 + 1;
        if (child >= size) break;
        if (child + 1 < size && this.heapF[child + 1]! < this.heapF[child]!) child++;
        if (this.heapF[child]! >= f) break;
        this.heapCell[i] = this.heapCell[child]!;
        this.heapF[i] = this.heapF[child]!;
        i = child;
      }
      this.heapCell[i] = cell;
      this.heapF[i] = f;
    }
    return top;
  }
}
