import { BlockRegistry } from '../../world/blocks/registry';

export type NodeClassification = 'passable' | 'solid' | 'water' | 'forbidden';

export type BlockPos = [number, number, number];

export interface BlockClassifier {
  /**
   * Classify the block state at (x, y, z).
   */
  classify(stateId: number, x: number, y: number, z: number): NodeClassification;

  /**
   * Optional door predicate hook: returns true when a door at (x, y, z) is passable.
   */
  isDoorPassable?: (x: number, y: number, z: number, stateId: number) => boolean;
}

export interface WorldQuery {
  /**
   * Returns block state ID or voxel identifier at integer coordinates (x, y, z).
   */
  getBlockStateId(x: number, y: number, z: number): number;

  /**
   * Optional direct classification method if provided by the world or grid.
   */
  classify?(x: number, y: number, z: number): NodeClassification;

  /**
   * Optional world-edit version counter used to invalidate path caches.
   */
  readonly version?: number;
}

/**
 * Default block classifier using block definitions and properties.
 */
export class DefaultBlockClassifier implements BlockClassifier {
  private cache: Uint8Array | null = null;
  private cacheInitialized = false;
  public isDoorPassable?: (x: number, y: number, z: number, stateId: number) => boolean;
  public isDoorBlock?: (stateId: number) => boolean;

  constructor(
    isDoorPassable?: (x: number, y: number, z: number, stateId: number) => boolean,
    isDoorBlock?: (stateId: number) => boolean,
  ) {
    this.isDoorPassable = isDoorPassable;
    this.isDoorBlock = isDoorBlock;
  }

  setDoorPredicate(
    predicate?: (x: number, y: number, z: number, stateId: number) => boolean,
  ): void {
    this.isDoorPassable = predicate;
  }

  private initCache(): void {
    if (this.cacheInitialized) return;
    this.cacheInitialized = true;
    try {
      const registry = BlockRegistry.getInstance();
      const maxId = registry.getMaxStateId();
      const table = new Uint8Array(maxId + 1);

      for (const id of registry.getAllStateIds()) {
        const state = registry.getResolvedState(id);
        if (!state) continue;
        const bId = state.blockId;
        const model = state.definition.model;

        if (bId === 'air') {
          table[id] = 0; // passable
        } else if (bId === 'water') {
          table[id] = 2; // water
        } else if (bId === 'lava' || bId === 'cactus' || bId === 'fire') {
          table[id] = 3; // forbidden
        } else if (
          bId === 'torch' ||
          bId === 'wall_torch' ||
          bId === 'ladder' ||
          bId === 'vine' ||
          model === 'cross'
        ) {
          table[id] = 0; // passable
        } else if (bId.includes('door')) {
          table[id] = 4; // door
        } else {
          table[id] = 1; // solid
        }
      }
      this.cache = table;
    } catch {
      // In test environments where BlockRegistry might not be loaded
    }
  }

  classify(stateId: number, x: number, y: number, z: number): NodeClassification {
    if (stateId === 0) return 'passable';

    if (!this.cacheInitialized) {
      this.initCache();
    }

    // Check if this block is identified as a door
    const isDoor =
      (this.isDoorBlock && this.isDoorBlock(stateId)) ||
      (this.cache !== null && stateId < this.cache.length && this.cache[stateId] === 4);

    if (isDoor) {
      if (this.isDoorPassable && this.isDoorPassable(x, y, z, stateId)) {
        return 'passable';
      }
      return 'solid';
    }

    if (this.cache !== null && stateId < this.cache.length) {
      const code = this.cache[stateId]!;
      if (code === 0) return 'passable';
      if (code === 1) return 'solid';
      if (code === 2) return 'water';
      if (code === 3) return 'forbidden';
    }

    return 'solid';
  }
}

export interface WorldLike {
  getBlockStateId(x: number, y: number, z: number): number;
  hasColumn?(cx: number, cz: number): boolean;
  onBlockEdited?: (x: number, y: number, z: number, state: number) => void;
}

/**
 * Adapter over the game World object conforming to WorldQuery.
 */
export class WorldAdapter implements WorldQuery {
  private _version: number = 0;

  constructor(
    public readonly world: WorldLike,
    public readonly classifier: BlockClassifier = new DefaultBlockClassifier(),
  ) {
    this.subscribeWorldEdits();
  }

  private subscribeWorldEdits(): void {
    if (!this.world) return;
    let chained = this.world.onBlockEdited;
    try {
      Object.defineProperty(this.world, 'onBlockEdited', {
        configurable: true,
        enumerable: true,
        get: () => {
          return (x: number, y: number, z: number, state: number) => {
            this._version++;
            chained?.(x, y, z, state);
          };
        },
        set: (newCb) => {
          chained = newCb;
        },
      });
    } catch {
      const prev = this.world.onBlockEdited;
      this.world.onBlockEdited = (x: number, y: number, z: number, state: number) => {
        this._version++;
        prev?.(x, y, z, state);
      };
    }
  }

  getBlockStateId(x: number, y: number, z: number): number {
    return this.world.getBlockStateId(x, y, z);
  }

  classify(x: number, y: number, z: number): NodeClassification {
    if (y < 0 || y >= 320) {
      return 'solid';
    }
    if (this.world.hasColumn && !this.world.hasColumn(Math.floor(x / 16), Math.floor(z / 16))) {
      return 'solid';
    }
    const stateId = this.world.getBlockStateId(x, y, z);
    return this.classifier.classify(stateId, x, y, z);
  }

  get version(): number {
    return this._version;
  }

  invalidate(): void {
    this._version++;
  }
}

export interface PathOptions {
  /**
   * Entity height in blocks: 1 or 2 (default 2).
   */
  height?: 1 | 2;

  /**
   * Maximum node expansions for synchronous searches (default 10,000).
   */
  maxNodes?: number;
}

export type SearchStatus = 'pending' | 'success' | 'unreachable' | 'limit';

export interface PathResult {
  status: 'success' | 'unreachable' | 'limit';
  path: BlockPos[] | null;
  cost: number;
  nodesExpanded: number;
}

export interface PathSearch {
  readonly status: SearchStatus;
  readonly path: BlockPos[] | null;
  readonly cost: number;
  readonly nodesExpanded: number;
  step(maxNodes?: number): SearchStatus;
  dispose?(): void;
}

interface CacheEntry {
  path: BlockPos[] | null;
  status: 'success' | 'unreachable';
  cost: number;
  worldVersion: number;
}

const COST_WALK = 1.0;
const COST_JUMP = 1.5;
const COST_DROP_1 = 1.0;
const COST_DROP_2 = 1.1;
const COST_DROP_3 = 1.2;
const COST_WATER = 2.0;
const COST_WATER_EXIT = 1.5;
const COST_WATER_EXIT_JUMP = 2.0;

const DIR_DX = new Int32Array([1, -1, 0, 0]);
const DIR_DZ = new Int32Array([0, 0, 1, -1]);

const POOL_CAPACITY = 32768;
const HASH_TABLE_CAPACITY = 65536;
const HASH_MASK = HASH_TABLE_CAPACITY - 1;

/**
 * Pre-allocated pool of node structures avoiding GC pressure during search.
 */
class NodePool {
  readonly x = new Int32Array(POOL_CAPACITY);
  readonly y = new Int16Array(POOL_CAPACITY);
  readonly z = new Int32Array(POOL_CAPACITY);

  readonly g = new Float64Array(POOL_CAPACITY);
  readonly f = new Float64Array(POOL_CAPACITY);
  readonly h = new Float64Array(POOL_CAPACITY);

  readonly parent = new Int32Array(POOL_CAPACITY);
  readonly closed = new Uint8Array(POOL_CAPACITY);
  readonly heapIdx = new Int32Array(POOL_CAPACITY);

  size = 0;

  reset(): void {
    this.size = 0;
  }

  allocate(x: number, y: number, z: number, g: number, h: number, parent: number): number {
    if (this.size >= POOL_CAPACITY) {
      return -1;
    }
    const idx = this.size++;
    this.x[idx] = x;
    this.y[idx] = y;
    this.z[idx] = z;
    this.g[idx] = g;
    this.h[idx] = h;
    this.f[idx] = g + h;
    this.parent[idx] = parent;
    this.closed[idx] = 0;
    this.heapIdx[idx] = -1;
    return idx;
  }
}

/**
 * Binary min-heap for priority queue operations with decrease-key support.
 */
class MinHeap {
  readonly indices = new Int32Array(POOL_CAPACITY);
  size = 0;

  constructor(private readonly pool: NodePool) {}

  reset(): void {
    this.size = 0;
  }

  push(nodeIdx: number): void {
    const i = this.size++;
    this.indices[i] = nodeIdx;
    this.pool.heapIdx[nodeIdx] = i;
    this.siftUp(i);
  }

  pop(): number {
    if (this.size === 0) return -1;
    const top = this.indices[0]!;
    this.pool.heapIdx[top] = -1;
    this.size--;
    if (this.size > 0) {
      const last = this.indices[this.size]!;
      this.indices[0] = last;
      this.pool.heapIdx[last] = 0;
      this.siftDown(0);
    }
    return top;
  }

  decreaseKey(nodeIdx: number): void {
    const pos = this.pool.heapIdx[nodeIdx];
    if (pos !== undefined && pos >= 0) {
      this.siftUp(pos);
    }
  }

  private siftUp(i: number): void {
    const idx = this.indices[i]!;
    const fVal = this.pool.f[idx]!;
    const hVal = this.pool.h[idx]!;

    while (i > 0) {
      const parent = (i - 1) >> 1;
      const parentIdx = this.indices[parent]!;
      const parentF = this.pool.f[parentIdx]!;
      const parentH = this.pool.h[parentIdx]!;

      // Compare f, tie-break on smaller h (closer to goal)
      if (fVal < parentF || (fVal === parentF && hVal < parentH)) {
        this.indices[i] = parentIdx;
        this.pool.heapIdx[parentIdx] = i;
        i = parent;
      } else {
        break;
      }
    }
    this.indices[i] = idx;
    this.pool.heapIdx[idx] = i;
  }

  private siftDown(i: number): void {
    const idx = this.indices[i]!;
    const fVal = this.pool.f[idx]!;
    const hVal = this.pool.h[idx]!;
    const half = this.size >> 1;

    while (i < half) {
      let left = (i << 1) + 1;
      const right = left + 1;
      let childIdx = this.indices[left]!;
      let childF = this.pool.f[childIdx]!;
      let childH = this.pool.h[childIdx]!;

      if (right < this.size) {
        const rightIdx = this.indices[right]!;
        const rightF = this.pool.f[rightIdx]!;
        const rightH = this.pool.h[rightIdx]!;
        if (rightF < childF || (rightF === childF && rightH < childH)) {
          left = right;
          childIdx = rightIdx;
          childF = rightF;
          childH = rightH;
        }
      }

      if (childF < fVal || (childF === fVal && childH < hVal)) {
        this.indices[i] = childIdx;
        this.pool.heapIdx[childIdx] = i;
        i = left;
      } else {
        break;
      }
    }
    this.indices[i] = idx;
    this.pool.heapIdx[idx] = i;
  }
}

/**
 * Open-addressing hash table mapping (x, y, z) to node pool index.
 */
class CoordMap {
  readonly tableX = new Int32Array(HASH_TABLE_CAPACITY);
  readonly tableY = new Int16Array(HASH_TABLE_CAPACITY);
  readonly tableZ = new Int32Array(HASH_TABLE_CAPACITY);
  readonly tableNodeIdx = new Int32Array(HASH_TABLE_CAPACITY);
  readonly tableRunId = new Int32Array(HASH_TABLE_CAPACITY);

  currentRunId = 1;

  reset(): void {
    this.currentRunId++;
    if (this.currentRunId === 0x7fffffff) {
      this.tableRunId.fill(0);
      this.currentRunId = 1;
    }
  }

  get(x: number, y: number, z: number): number {
    let slot = ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) & HASH_MASK;
    const runId = this.currentRunId;

    while (this.tableRunId[slot] === runId) {
      if (this.tableX[slot] === x && this.tableY[slot] === y && this.tableZ[slot] === z) {
        return this.tableNodeIdx[slot]!;
      }
      slot = (slot + 1) & HASH_MASK;
    }
    return -1;
  }

  set(x: number, y: number, z: number, nodeIdx: number): void {
    let slot = ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) & HASH_MASK;
    const runId = this.currentRunId;

    while (this.tableRunId[slot] === runId) {
      if (this.tableX[slot] === x && this.tableY[slot] === y && this.tableZ[slot] === z) {
        this.tableNodeIdx[slot] = nodeIdx;
        return;
      }
      slot = (slot + 1) & HASH_MASK;
    }

    this.tableRunId[slot] = runId;
    this.tableX[slot] = x;
    this.tableY[slot] = y;
    this.tableZ[slot] = z;
    this.tableNodeIdx[slot] = nodeIdx;
  }
}

/**
 * Isolated context containing reusable search structures.
 */
class SearchContext {
  readonly pool = new NodePool();
  readonly heap = new MinHeap(this.pool);
  readonly coordMap = new CoordMap();

  readonly neighborsBufferX = new Int32Array(16);
  readonly neighborsBufferY = new Int16Array(16);
  readonly neighborsBufferZ = new Int32Array(16);
  readonly neighborsCost = new Float64Array(16);

  inUse = false;

  reset(): void {
    this.pool.reset();
    this.heap.reset();
    this.coordMap.reset();
  }
}

/**
 * 3D A* Pathfinding implementation for voxel grid.
 */
export class Pathfinder {
  private readonly contextPool: SearchContext[] = [new SearchContext()];
  private readonly cache = new Map<string, CacheEntry>();
  private readonly maxCacheEntries = 500;

  constructor(
    public readonly world: WorldQuery,
    public readonly classifier?: BlockClassifier,
  ) {}

  clearCache(): void {
    this.cache.clear();
  }

  private acquireContext(): SearchContext {
    for (let i = 0; i < this.contextPool.length; i++) {
      const ctx = this.contextPool[i]!;
      if (!ctx.inUse) {
        ctx.inUse = true;
        ctx.reset();
        return ctx;
      }
    }
    const ctx = new SearchContext();
    ctx.inUse = true;
    ctx.reset();
    this.contextPool.push(ctx);
    return ctx;
  }

  private releaseContext(ctx: SearchContext): void {
    ctx.inUse = false;
  }

  private classify(x: number, y: number, z: number): NodeClassification {
    if (this.world.classify) {
      return this.world.classify(x, y, z);
    }
    if (this.classifier) {
      const stateId = this.world.getBlockStateId(x, y, z);
      return this.classifier.classify(stateId, x, y, z);
    }
    return 'passable';
  }

  /**
   * Checks if an entity of the given height can occupy the column starting at (x, y, z).
   */
  private isOccupiable(x: number, y: number, z: number, height: number): boolean {
    for (let k = 0; k < height; k++) {
      const c = this.classify(x, y + k, z);
      if (c === 'solid' || c === 'forbidden') {
        return false;
      }
    }
    return true;
  }

  /**
   * Admissible heuristic: Manhattan distance.
   */
  private heuristic(x: number, y: number, z: number, gx: number, gy: number, gz: number): number {
    return (Math.abs(x - gx) + Math.abs(z - gz)) * COST_WALK;
  }

  /**
   * Synchronous pathfinding.
   */
  findPath(start: BlockPos, goal: BlockPos, options?: PathOptions): PathResult {
    const search = this.createSearch(start, goal, options);
    const maxNodes = options?.maxNodes ?? 10000;
    while (search.status === 'pending') {
      const budget = Math.max(1, maxNodes - search.nodesExpanded);
      search.step(budget);
      if (search.status === 'pending' && search.nodesExpanded >= maxNodes) {
        search.dispose?.();
        return {
          status: 'limit',
          path: null,
          cost: 0,
          nodesExpanded: search.nodesExpanded,
        };
      }
    }
    return {
      status: search.status,
      path: search.path,
      cost: search.cost,
      nodesExpanded: search.nodesExpanded,
    };
  }

  /**
   * Incremental pathfinding search.
   */
  createSearch(start: BlockPos, goal: BlockPos, options?: PathOptions): PathSearch {
    const height = options?.height ?? 2;
    const [sx, sy, sz] = start;
    const [gx, gy, gz] = goal;

    // Check path cache
    const cacheKey = `${sx},${sy},${sz}:${gx},${gy},${gz}:${height}`;
    const currentVersion = this.world.version ?? 0;
    const cached = this.cache.get(cacheKey);

    if (cached && cached.worldVersion === currentVersion) {
      const pathCopy = cached.path ? cached.path.map((p) => [p[0], p[1], p[2]] as BlockPos) : null;
      return {
        status: cached.status,
        path: pathCopy,
        cost: cached.cost,
        nodesExpanded: 0,
        step: () => cached.status,
        dispose: () => {},
      };
    }

    // Validate start and goal occupiability
    if (!this.isOccupiable(sx, sy, sz, height) || !this.isOccupiable(gx, gy, gz, height)) {
      return this.createInstantSearch('unreachable', null, 0);
    }

    // Check standing/water condition for start and goal
    const startInWater = this.classify(sx, sy, sz) === 'water';
    if (!startInWater && this.classify(sx, sy - 1, sz) !== 'solid') {
      return this.createInstantSearch('unreachable', null, 0);
    }

    const goalInWater = this.classify(gx, gy, gz) === 'water';
    if (!goalInWater && this.classify(gx, gy - 1, gz) !== 'solid') {
      return this.createInstantSearch('unreachable', null, 0);
    }

    // Trivial path: start === goal
    if (sx === gx && sy === gy && sz === gz) {
      const instantPath: BlockPos[] = [[sx, sy, sz]];
      this.storeInCache(cacheKey, instantPath, 'success', 0, currentVersion);
      return this.createInstantSearch('success', instantPath, 0);
    }

    // Acquire isolated search context
    const ctx = this.acquireContext();

    const h0 = this.heuristic(sx, sy, sz, gx, gy, gz);
    const startNodeIdx = ctx.pool.allocate(sx, sy, sz, 0, h0, -1);
    if (startNodeIdx < 0) {
      this.releaseContext(ctx);
      return this.createInstantSearch('limit', null, 0);
    }
    ctx.heap.push(startNodeIdx);
    ctx.coordMap.set(sx, sy, sz, startNodeIdx);

    let status: SearchStatus = 'pending';
    let path: BlockPos[] | null = null;
    let cost = 0;
    let nodesExpanded = 0;

    const step = (maxNodes: number = 2000): SearchStatus => {
      if (status !== 'pending') return status;

      let remainingBudget = maxNodes;

      while (ctx.heap.size > 0 && remainingBudget > 0) {
        if (ctx.pool.size >= POOL_CAPACITY - 16) {
          status = 'limit';
          path = null;
          this.releaseContext(ctx);
          return 'limit';
        }

        remainingBudget--;
        const currentIdx = ctx.heap.pop();
        if (currentIdx < 0) break;

        // Skip if already closed
        if (ctx.pool.closed[currentIdx] === 1) continue;
        ctx.pool.closed[currentIdx] = 1;
        nodesExpanded++;

        const cx = ctx.pool.x[currentIdx]!;
        const cy = ctx.pool.y[currentIdx]!;
        const cz = ctx.pool.z[currentIdx]!;
        const currentG = ctx.pool.g[currentIdx]!;

        // Check if goal reached
        if (cx === gx && cy === gy && cz === gz) {
          status = 'success';
          cost = currentG;
          path = this.reconstructPath(ctx, currentIdx);
          this.storeInCache(cacheKey, path, 'success', cost, currentVersion);
          this.releaseContext(ctx);
          return 'success';
        }

        // Expand neighbors
        const neighborCount = this.getNeighbors(
          cx,
          cy,
          cz,
          height,
          ctx.neighborsBufferX,
          ctx.neighborsBufferY,
          ctx.neighborsBufferZ,
          ctx.neighborsCost,
        );

        for (let i = 0; i < neighborCount; i++) {
          const nx = ctx.neighborsBufferX[i]!;
          const ny = ctx.neighborsBufferY[i]!;
          const nz = ctx.neighborsBufferZ[i]!;
          const edgeCost = ctx.neighborsCost[i]!;

          const tentativeG = currentG + edgeCost;
          let neighborIdx = ctx.coordMap.get(nx, ny, nz);

          if (neighborIdx >= 0) {
            if (ctx.pool.closed[neighborIdx] === 1) continue;
            if (tentativeG < ctx.pool.g[neighborIdx]!) {
              ctx.pool.g[neighborIdx] = tentativeG;
              ctx.pool.f[neighborIdx] = tentativeG + ctx.pool.h[neighborIdx]!;
              ctx.pool.parent[neighborIdx] = currentIdx;
              if (ctx.pool.heapIdx[neighborIdx]! >= 0) {
                ctx.heap.decreaseKey(neighborIdx);
              } else {
                ctx.heap.push(neighborIdx);
              }
            }
          } else {
            // New unvisited node
            if (ctx.pool.size >= POOL_CAPACITY - 16) {
              status = 'limit';
              path = null;
              this.releaseContext(ctx);
              return 'limit';
            }
            const nh = this.heuristic(nx, ny, nz, gx, gy, gz);
            neighborIdx = ctx.pool.allocate(nx, ny, nz, tentativeG, nh, currentIdx);
            if (neighborIdx < 0) {
              status = 'limit';
              path = null;
              this.releaseContext(ctx);
              return 'limit';
            }
            ctx.coordMap.set(nx, ny, nz, neighborIdx);
            ctx.heap.push(neighborIdx);
          }
        }
      }

      if (ctx.heap.size === 0 && status === 'pending') {
        status = 'unreachable';
        path = null;
        this.storeInCache(cacheKey, null, 'unreachable', 0, currentVersion);
        this.releaseContext(ctx);
        return 'unreachable';
      }

      return 'pending';
    };

    const dispose = (): void => {
      if (status === 'pending') {
        this.releaseContext(ctx);
      }
    };

    return {
      get status() {
        return status;
      },
      get path() {
        return path ? path.map((p) => [p[0], p[1], p[2]] as BlockPos) : null;
      },
      get cost() {
        return cost;
      },
      get nodesExpanded() {
        return nodesExpanded;
      },
      step,
      dispose,
    };
  }

  private createInstantSearch(
    status: 'success' | 'unreachable' | 'limit',
    path: BlockPos[] | null,
    cost: number,
  ): PathSearch {
    const pathCopy = path ? path.map((p) => [p[0], p[1], p[2]] as BlockPos) : null;
    return {
      status,
      path: pathCopy,
      cost,
      nodesExpanded: 0,
      step: () => status,
      dispose: () => {},
    };
  }

  private reconstructPath(ctx: SearchContext, endNodeIdx: number): BlockPos[] {
    const coords: BlockPos[] = [];
    let curr = endNodeIdx;
    while (curr >= 0) {
      coords.push([ctx.pool.x[curr]!, ctx.pool.y[curr]!, ctx.pool.z[curr]!]);
      curr = ctx.pool.parent[curr]!;
    }
    coords.reverse();
    return coords;
  }

  private storeInCache(
    key: string,
    path: BlockPos[] | null,
    status: 'success' | 'unreachable',
    cost: number,
    worldVersion: number,
  ): void {
    if (this.cache.size >= this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    const pathCopy = path ? path.map((p) => [p[0], p[1], p[2]] as BlockPos) : null;
    this.cache.set(key, { path: pathCopy, status, cost, worldVersion });
  }

  /**
   * Populates neighborsBuffer with valid adjacent states.
   */
  private getNeighbors(
    x: number,
    y: number,
    z: number,
    height: number,
    outX: Int32Array,
    outY: Int16Array,
    outZ: Int32Array,
    outCost: Float64Array,
  ): number {
    let count = 0;
    const isWater = this.classify(x, y, z) === 'water';

    if (isWater) {
      // 1. Vertical movements in water
      // Swim up
      if (this.isOccupiable(x, y + 1, z, height)) {
        outX[count] = x;
        outY[count] = y + 1;
        outZ[count] = z;
        outCost[count] = COST_WATER;
        count++;
      }
      // Swim down
      const feetBelow = this.classify(x, y - 1, z);
      if (feetBelow === 'water') {
        outX[count] = x;
        outY[count] = y - 1;
        outZ[count] = z;
        outCost[count] = COST_WATER;
        count++;
      }

      // 2. Horizontal movements in water
      for (let i = 0; i < 4; i++) {
        const dx = DIR_DX[i]!;
        const dz = DIR_DZ[i]!;
        const nx = x + dx;
        const nz = z + dz;

        if (!this.isOccupiable(nx, y, nz, height)) continue;

        const targetFeet = this.classify(nx, y, nz);
        if (targetFeet === 'water') {
          // Swim horizontally
          outX[count] = nx;
          outY[count] = y;
          outZ[count] = nz;
          outCost[count] = COST_WATER;
          count++;
        } else if (targetFeet === 'passable') {
          // Exiting water onto solid ground
          if (this.classify(nx, y - 1, nz) === 'solid') {
            outX[count] = nx;
            outY[count] = y;
            outZ[count] = nz;
            outCost[count] = COST_WATER_EXIT;
            count++;
          }
        }

        // Stepping out of water up onto a 1-block higher bank
        if (
          this.classify(nx, y, nz) === 'solid' &&
          this.isOccupiable(nx, y + 1, nz, height) &&
          this.isOccupiable(x, y + height, z, 1)
        ) {
          outX[count] = nx;
          outY[count] = y + 1;
          outZ[count] = nz;
          outCost[count] = COST_WATER_EXIT_JUMP;
          count++;
        }
      }
      return count;
    }

    // Head clearance is shared by all four jump directions for this expansion.
    const canJump = this.isOccupiable(x, y + height, z, 1);
    // On solid land
    for (let i = 0; i < 4; i++) {
      const dx = DIR_DX[i]!;
      const dz = DIR_DZ[i]!;
      const nx = x + dx;
      const nz = z + dz;

      // Reuse the feet classification for jump, walking and water-entry checks.
      const targetFeet = this.classify(nx, y, nz);
      // Case A: 1-block step up (jump)
      if (canJump) {
        if (targetFeet === 'solid' && this.isOccupiable(nx, y + 1, nz, height)) {
          outX[count] = nx;
          outY[count] = y + 1;
          outZ[count] = nz;
          outCost[count] = COST_JUMP;
          count++;
          // A block that is solid at y cannot also be flat walk or drop
          continue;
        }
      }

      // Case B: Same level move. Feet are already checked; check the remaining body.
      if (
        targetFeet !== 'solid' &&
        targetFeet !== 'forbidden' &&
        this.isOccupiable(nx, y + 1, nz, height - 1)
      ) {
        // Stepping into water
        if (targetFeet === 'water') {
          outX[count] = nx;
          outY[count] = y;
          outZ[count] = nz;
          outCost[count] = COST_WATER;
          count++;
          continue;
        }

        // Flat walk on solid ground
        if (this.classify(nx, y - 1, nz) === 'solid') {
          outX[count] = nx;
          outY[count] = y;
          outZ[count] = nz;
          outCost[count] = COST_WALK;
          count++;
          continue;
        }

        // Case C: Drop down (1 to 3 blocks)
        // Entity steps into air at (nx, y, nz) and falls
        for (let drop = 1; drop <= 3; drop++) {
          const landY = y - drop;
          const landClass = this.classify(nx, landY, nz);

          // Cannot drop into solid or forbidden
          if (landClass === 'solid' || landClass === 'forbidden') {
            break;
          }

          if (landClass === 'water') {
            // Landed into water
            if (this.isOccupiable(nx, landY, nz, height)) {
              outX[count] = nx;
              outY[count] = landY;
              outZ[count] = nz;
              outCost[count] = COST_WATER + (drop - 1) * 0.1;
              count++;
            }
            break;
          }

          if (landClass === 'passable') {
            // Check if there is a solid floor under this landing level
            if (this.classify(nx, landY - 1, nz) === 'solid') {
              if (this.isOccupiable(nx, landY, nz, height)) {
                outX[count] = nx;
                outY[count] = landY;
                outZ[count] = nz;
                outCost[count] = drop === 1 ? COST_DROP_1 : drop === 2 ? COST_DROP_2 : COST_DROP_3;
                count++;
              }
              break;
            }
          }
        }
      }
    }

    return count;
  }
}
