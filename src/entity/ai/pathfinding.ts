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

    // Check if this block is identified as a door
    const isDoor =
      (this.isDoorBlock && this.isDoorBlock(stateId)) ||
      (this.cache && stateId < this.cache.length && this.cache[stateId] === 4);

    if (isDoor) {
      if (this.isDoorPassable && this.isDoorPassable(x, y, z, stateId)) {
        return 'passable';
      }
      return 'solid';
    }

    if (!this.cache) {
      this.initCache();
    }

    if (this.cache && stateId < this.cache.length) {
      const code = this.cache[stateId]!;
      if (code === 0) return 'passable';
      if (code === 1) return 'solid';
      if (code === 2) return 'water';
      if (code === 3) return 'forbidden';
    }

    return 'solid';
  }
}

/**
 * Adapter over the game World object conforming to WorldQuery.
 */
export class WorldAdapter implements WorldQuery {
  private _version: number = 0;

  constructor(
    public readonly world: { getBlockStateId(x: number, y: number, z: number): number },
    public readonly classifier: BlockClassifier = new DefaultBlockClassifier(),
  ) {}

  getBlockStateId(x: number, y: number, z: number): number {
    return this.world.getBlockStateId(x, y, z);
  }

  classify(x: number, y: number, z: number): NodeClassification {
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

export type SearchStatus = 'pending' | 'success' | 'unreachable';

export interface PathResult {
  status: 'success' | 'unreachable';
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
      throw new Error(`NodePool capacity exceeded (${POOL_CAPACITY})`);
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
 * 3D A* Pathfinding implementation for voxel grid.
 */
export class Pathfinder {
  private readonly pool = new NodePool();
  private readonly heap = new MinHeap(this.pool);
  private readonly coordMap = new CoordMap();

  private readonly cache = new Map<string, CacheEntry>();
  private readonly maxCacheEntries = 500;

  constructor(
    public readonly world: WorldQuery,
    public readonly classifier?: BlockClassifier,
  ) {}

  clearCache(): void {
    this.cache.clear();
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
      search.step(maxNodes);
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
      return {
        status: cached.status,
        path: cached.path,
        cost: cached.cost,
        nodesExpanded: 0,
        step: () => cached.status,
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

    // Initialize search
    this.pool.reset();
    this.heap.reset();
    this.coordMap.reset();

    const h0 = this.heuristic(sx, sy, sz, gx, gy, gz);
    const startNodeIdx = this.pool.allocate(sx, sy, sz, 0, h0, -1);
    this.heap.push(startNodeIdx);
    this.coordMap.set(sx, sy, sz, startNodeIdx);

    let status: SearchStatus = 'pending';
    let path: BlockPos[] | null = null;
    let cost = 0;
    let nodesExpanded = 0;

    const neighborsBufferX = new Int32Array(16);
    const neighborsBufferY = new Int16Array(16);
    const neighborsBufferZ = new Int32Array(16);
    const neighborsCost = new Float64Array(16);

    const step = (maxNodes: number = 2000): SearchStatus => {
      if (status !== 'pending') return status;

      let remainingBudget = maxNodes;

      while (this.heap.size > 0 && remainingBudget > 0 && this.pool.size < POOL_CAPACITY - 16) {
        remainingBudget--;
        const currentIdx = this.heap.pop();
        if (currentIdx < 0) break;

        // Skip if already closed
        if (this.pool.closed[currentIdx] === 1) continue;
        this.pool.closed[currentIdx] = 1;
        nodesExpanded++;

        const cx = this.pool.x[currentIdx]!;
        const cy = this.pool.y[currentIdx]!;
        const cz = this.pool.z[currentIdx]!;
        const currentG = this.pool.g[currentIdx]!;

        // Check if goal reached
        if (cx === gx && cy === gy && cz === gz) {
          status = 'success';
          cost = currentG;
          path = this.reconstructPath(currentIdx);
          this.storeInCache(cacheKey, path, 'success', cost, currentVersion);
          return 'success';
        }

        // Expand neighbors
        const neighborCount = this.getNeighbors(
          cx,
          cy,
          cz,
          height,
          neighborsBufferX,
          neighborsBufferY,
          neighborsBufferZ,
          neighborsCost,
        );

        for (let i = 0; i < neighborCount; i++) {
          const nx = neighborsBufferX[i]!;
          const ny = neighborsBufferY[i]!;
          const nz = neighborsBufferZ[i]!;
          const edgeCost = neighborsCost[i]!;

          const tentativeG = currentG + edgeCost;
          let neighborIdx = this.coordMap.get(nx, ny, nz);

          if (neighborIdx >= 0) {
            if (this.pool.closed[neighborIdx] === 1) continue;
            if (tentativeG < this.pool.g[neighborIdx]!) {
              this.pool.g[neighborIdx] = tentativeG;
              this.pool.f[neighborIdx] = tentativeG + this.pool.h[neighborIdx]!;
              this.pool.parent[neighborIdx] = currentIdx;
              if (this.pool.heapIdx[neighborIdx]! >= 0) {
                this.heap.decreaseKey(neighborIdx);
              } else {
                this.heap.push(neighborIdx);
              }
            }
          } else {
            // New unvisited node
            if (this.pool.size >= POOL_CAPACITY) break;
            const nh = this.heuristic(nx, ny, nz, gx, gy, gz);
            neighborIdx = this.pool.allocate(nx, ny, nz, tentativeG, nh, currentIdx);
            this.coordMap.set(nx, ny, nz, neighborIdx);
            this.heap.push(neighborIdx);
          }
        }
      }

      if ((this.heap.size === 0 || this.pool.size >= POOL_CAPACITY - 16) && status === 'pending') {
        status = 'unreachable';
        path = null;
        this.storeInCache(cacheKey, null, 'unreachable', 0, currentVersion);
        return 'unreachable';
      }

      return 'pending';
    };

    return {
      get status() {
        return status;
      },
      get path() {
        return path;
      },
      get cost() {
        return cost;
      },
      get nodesExpanded() {
        return nodesExpanded;
      },
      step,
    };
  }

  private createInstantSearch(
    status: 'success' | 'unreachable',
    path: BlockPos[] | null,
    cost: number,
  ): PathSearch {
    return {
      status,
      path,
      cost,
      nodesExpanded: 0,
      step: () => status,
    };
  }

  private reconstructPath(endNodeIdx: number): BlockPos[] {
    const coords: BlockPos[] = [];
    let curr = endNodeIdx;
    while (curr >= 0) {
      coords.push([this.pool.x[curr]!, this.pool.y[curr]!, this.pool.z[curr]!]);
      curr = this.pool.parent[curr]!;
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
    this.cache.set(key, { path, status, cost, worldVersion });
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
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      for (let i = 0; i < 4; i++) {
        const [dx, dz] = dirs[i]!;
        const nx = x + dx!;
        const nz = z + dz!;

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

    // On solid land
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];

    for (let i = 0; i < 4; i++) {
      const [dx, dz] = dirs[i]!;
      const nx = x + dx!;
      const nz = z + dz!;

      // Case A: 1-block step up (jump)
      // Check head clearance at current position to initiate jump
      if (this.isOccupiable(x, y + height, z, 1)) {
        if (this.classify(nx, y, nz) === 'solid' && this.isOccupiable(nx, y + 1, nz, height)) {
          outX[count] = nx;
          outY[count] = y + 1;
          outZ[count] = nz;
          outCost[count] = COST_JUMP;
          count++;
          // A block that is solid at y cannot also be flat walk or drop
          continue;
        }
      }

      // Case B: Same level move
      if (this.isOccupiable(nx, y, nz, height)) {
        const targetFeet = this.classify(nx, y, nz);

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
