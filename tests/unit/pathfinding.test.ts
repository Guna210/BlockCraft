import { describe, it, expect } from 'vitest';
import {
  Pathfinder,
  WorldAdapter,
  DefaultBlockClassifier,
  type WorldQuery,
  type NodeClassification,
  type BlockPos,
  type PathOptions,
} from '../../src/entity/ai/pathfinding';
import { PRNG } from '../../src/engine/rng';

/**
 * In-memory 3D grid implementing WorldQuery for unit tests.
 */
class InMemoryGrid implements WorldQuery {
  private grid = new Map<string, NodeClassification>();
  public version: number = 0;

  constructor(
    public readonly width: number,
    public readonly height: number,
    public readonly depth: number,
  ) {}

  set(x: number, y: number, z: number, c: NodeClassification): void {
    this.grid.set(`${x},${y},${z}`, c);
  }

  get(x: number, y: number, z: number): NodeClassification {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height || z < 0 || z >= this.depth) {
      return 'solid';
    }
    return this.grid.get(`${x},${y},${z}`) ?? 'passable';
  }

  getBlockStateId(x: number, y: number, z: number): number {
    const c = this.get(x, y, z);
    if (c === 'solid') return 1;
    if (c === 'water') return 2;
    if (c === 'forbidden') return 3;
    return 0; // passable / air
  }

  classify(x: number, y: number, z: number): NodeClassification {
    return this.get(x, y, z);
  }
}

/**
 * Independent Dijkstra reference search on the exact movement graph.
 * Used to verify the optimality of A*.
 */
function dijkstraFindPath(
  grid: InMemoryGrid,
  start: BlockPos,
  goal: BlockPos,
  options?: PathOptions,
): { status: 'success' | 'unreachable'; cost: number; path: BlockPos[] | null } {
  const height = options?.height ?? 2;
  const [sx, sy, sz] = start;
  const [gx, gy, gz] = goal;

  const isOccupiable = (x: number, y: number, z: number, h: number): boolean => {
    for (let k = 0; k < h; k++) {
      const c = grid.classify(x, y + k, z);
      if (c === 'solid' || c === 'forbidden') return false;
    }
    return true;
  };

  const isStandingOrWater = (x: number, y: number, z: number): boolean => {
    const atFeet = grid.classify(x, y, z);
    if (atFeet === 'water') return true;
    return grid.classify(x, y - 1, z) === 'solid';
  };

  if (!isOccupiable(sx, sy, sz, height) || !isStandingOrWater(sx, sy, sz)) {
    return { status: 'unreachable', cost: 0, path: null };
  }
  if (!isOccupiable(gx, gy, gz, height) || !isStandingOrWater(gx, gy, gz)) {
    return { status: 'unreachable', cost: 0, path: null };
  }

  if (sx === gx && sy === gy && sz === gz) {
    return { status: 'success', cost: 0, path: [[sx, sy, sz]] };
  }

  interface QNode {
    x: number;
    y: number;
    z: number;
    cost: number;
    parent?: QNode;
  }

  const queue: QNode[] = [{ x: sx, y: sy, z: sz, cost: 0 }];
  const bestCost = new Map<string, number>();
  bestCost.set(`${sx},${sy},${sz}`, 0);

  const getNeighbors = (curr: QNode): Array<{ x: number; y: number; z: number; cost: number }> => {
    const res: Array<{ x: number; y: number; z: number; cost: number }> = [];
    const isWater = grid.classify(curr.x, curr.y, curr.z) === 'water';

    if (isWater) {
      // Swim up
      if (isOccupiable(curr.x, curr.y + 1, curr.z, height)) {
        res.push({ x: curr.x, y: curr.y + 1, z: curr.z, cost: 2.0 });
      }
      // Swim down
      if (grid.classify(curr.x, curr.y - 1, curr.z) === 'water') {
        res.push({ x: curr.x, y: curr.y - 1, z: curr.z, cost: 2.0 });
      }
      // Horizontal in water
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      for (const [dx, dz] of dirs) {
        const nx = curr.x + dx!;
        const nz = curr.z + dz!;
        if (!isOccupiable(nx, curr.y, nz, height)) continue;

        const targetFeet = grid.classify(nx, curr.y, nz);
        if (targetFeet === 'water') {
          res.push({ x: nx, y: curr.y, z: nz, cost: 2.0 });
        } else if (targetFeet === 'passable' && grid.classify(nx, curr.y - 1, nz) === 'solid') {
          res.push({ x: nx, y: curr.y, z: nz, cost: 1.5 });
        }

        // Exit water onto 1-block higher bank
        if (
          grid.classify(nx, curr.y, nz) === 'solid' &&
          isOccupiable(nx, curr.y + 1, nz, height) &&
          isOccupiable(curr.x, curr.y + height, curr.z, 1)
        ) {
          res.push({ x: nx, y: curr.y + 1, z: nz, cost: 2.0 });
        }
      }
      return res;
    }

    // On land
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dz] of dirs) {
      const nx = curr.x + dx!;
      const nz = curr.z + dz!;

      // Jump 1 block
      if (isOccupiable(curr.x, curr.y + height, curr.z, 1)) {
        if (grid.classify(nx, curr.y, nz) === 'solid' && isOccupiable(nx, curr.y + 1, nz, height)) {
          res.push({ x: nx, y: curr.y + 1, z: nz, cost: 1.5 });
          continue;
        }
      }

      if (isOccupiable(nx, curr.y, nz, height)) {
        const targetFeet = grid.classify(nx, curr.y, nz);
        if (targetFeet === 'water') {
          res.push({ x: nx, y: curr.y, z: nz, cost: 2.0 });
          continue;
        }
        if (grid.classify(nx, curr.y - 1, nz) === 'solid') {
          res.push({ x: nx, y: curr.y, z: nz, cost: 1.0 });
          continue;
        }

        // Drops 1..3
        for (let drop = 1; drop <= 3; drop++) {
          const landY = curr.y - drop;
          const landClass = grid.classify(nx, landY, nz);
          if (landClass === 'solid' || landClass === 'forbidden') break;
          if (landClass === 'water') {
            if (isOccupiable(nx, landY, nz, height)) {
              res.push({ x: nx, y: landY, z: nz, cost: 2.0 + (drop - 1) * 0.1 });
            }
            break;
          }
          if (landClass === 'passable' && grid.classify(nx, landY - 1, nz) === 'solid') {
            if (isOccupiable(nx, landY, nz, height)) {
              const c = drop === 1 ? 1.0 : drop === 2 ? 1.1 : 1.2;
              res.push({ x: nx, y: landY, z: nz, cost: c });
            }
            break;
          }
        }
      }
    }
    return res;
  };

  while (queue.length > 0) {
    // Pop minimum cost node
    let minIdx = 0;
    for (let i = 1; i < queue.length; i++) {
      if (queue[i]!.cost < queue[minIdx]!.cost) minIdx = i;
    }
    const curr = queue.splice(minIdx, 1)[0]!;

    if (curr.x === gx && curr.y === gy && curr.z === gz) {
      const path: BlockPos[] = [];
      let step: QNode | undefined = curr;
      while (step) {
        path.push([step.x, step.y, step.z]);
        step = step.parent;
      }
      path.reverse();
      return { status: 'success', cost: curr.cost, path };
    }

    const currentKey = `${curr.x},${curr.y},${curr.z}`;
    if (curr.cost > (bestCost.get(currentKey) ?? Infinity)) continue;

    for (const nb of getNeighbors(curr)) {
      const nbKey = `${nb.x},${nb.y},${nb.z}`;
      const newCost = curr.cost + nb.cost;
      if (newCost < (bestCost.get(nbKey) ?? Infinity)) {
        bestCost.set(nbKey, newCost);
        queue.push({
          x: nb.x,
          y: nb.y,
          z: nb.z,
          cost: newCost,
          parent: curr,
        });
      }
    }
  }

  return { status: 'unreachable', cost: 0, path: null };
}

/**
 * Procedurally generates a deterministic 3D test maze.
 */
function generateMaze(
  seed: number,
  width: number = 20,
  height: number = 10,
  depth: number = 20,
): { grid: InMemoryGrid; start: BlockPos; goal: BlockPos } {
  const rng = new PRNG(seed);
  const grid = new InMemoryGrid(width, height, depth);

  // Fill base floor at y = 0
  for (let x = 0; x < width; x++) {
    for (let z = 0; z < depth; z++) {
      grid.set(x, 0, z, 'solid');
    }
  }

  // Generate varied terrain: steps, terraces, hills, water pools
  for (let x = 1; x < width - 1; x++) {
    for (let z = 1; z < depth - 1; z++) {
      const r = rng.next();
      if (r < 0.25) {
        // Step up
        grid.set(x, 1, z, 'solid');
      } else if (r < 0.4) {
        // 2-step hill
        grid.set(x, 1, z, 'solid');
        grid.set(x, 2, z, 'solid');
      } else if (r < 0.5) {
        // Water pool at y=1
        grid.set(x, 1, z, 'water');
      } else if (r < 0.58) {
        // Deep water pool at y=1, y=2
        grid.set(x, 1, z, 'water');
        grid.set(x, 2, z, 'water');
      } else if (r < 0.65) {
        // Forbidden hazard (lava/cactus)
        grid.set(x, 1, z, 'forbidden');
      } else if (r < 0.72) {
        // Tall wall (creates corridors/mazes)
        for (let y = 1; y <= 5; y++) {
          grid.set(x, y, z, 'solid');
        }
      }
    }
  }

  // Create occasional cliffs (drop >= 4 blocks)
  for (let x = 4; x < 7; x++) {
    for (let z = 4; z < 7; z++) {
      for (let y = 1; y <= 5; y++) {
        grid.set(x, y, z, 'solid');
      }
    }
  }

  // Ensure clear landing/start points
  const sx = 1;
  const sz = 1;
  const sy = 1; // On base floor y=0
  grid.set(sx, sy - 1, sz, 'solid');
  grid.set(sx, sy, sz, 'passable');
  grid.set(sx, sy + 1, sz, 'passable');
  grid.set(sx, sy + 2, sz, 'passable');

  const gx = width - 2;
  const gz = depth - 2;
  let gy = 1;
  if (grid.get(gx, 2, gz) === 'solid') gy = 3;
  else if (grid.get(gx, 1, gz) === 'solid') gy = 2;

  // Make sure goal is not forbidden or suffocated
  grid.set(gx, gy - 1, gz, 'solid');
  grid.set(gx, gy, gz, 'passable');
  grid.set(gx, gy + 1, gz, 'passable');

  return { grid, start: [sx, sy, sz], goal: [gx, gy, gz] };
}

describe('M13b: A* pathfinding (voxel grid)', () => {
  it('solves 50 deterministic seeded test mazes with cost matching Dijkstra reference', () => {
    let testedCount = 0;
    let successCount = 0;

    for (let mazeIdx = 0; mazeIdx < 50; mazeIdx++) {
      const seed = 1000 + mazeIdx * 37;
      const { grid, start, goal } = generateMaze(seed, 16, 8, 16);
      const pathfinder = new Pathfinder(grid);

      const aStarResult = pathfinder.findPath(start, goal, { height: 2 });
      const dijkstraResult = dijkstraFindPath(grid, start, goal, { height: 2 });

      expect(aStarResult.status).toBe(dijkstraResult.status);

      if (aStarResult.status === 'success' && dijkstraResult.status === 'success') {
        successCount++;
        // Cost must match Dijkstra reference (optimality)
        expect(Math.abs(aStarResult.cost - dijkstraResult.cost)).toBeLessThan(1e-5);

        // Path must exist and start/end correctly
        const path = aStarResult.path!;
        expect(path.length).toBeGreaterThan(0);
        expect(path[0]).toEqual(start);
        expect(path[path.length - 1]).toEqual(goal);

        // Verify every node and transition in path
        for (let i = 0; i < path.length; i++) {
          const [px, py, pz] = path[i]!;

          // Paths never enter forbidden blocks (for height 2, neither feet nor head)
          expect(grid.classify(px, py, pz)).not.toBe('forbidden');
          expect(grid.classify(px, py + 1, pz)).not.toBe('forbidden');

          // Transitions between consecutive steps
          if (i > 0) {
            const [, prevY] = path[i - 1]!;
            const drop = prevY - py;
            // Never drop more than 3 blocks (cliff avoidance)
            expect(drop).toBeLessThanOrEqual(3);
          }
        }
      } else {
        expect(aStarResult.path).toBeNull();
        expect(dijkstraResult.path).toBeNull();
      }

      testedCount++;
    }

    expect(testedCount).toBe(50);
    // Across 50 mazes, at least several must be reachable
    expect(successCount).toBeGreaterThan(15);
  });

  it('achieves mean solve time < 2 ms for paths <= 32 blocks', () => {
    // Generate mazes with paths <= 32 blocks
    const pathsToBenchmark: Array<{ grid: InMemoryGrid; start: BlockPos; goal: BlockPos }> = [];

    for (let i = 0; i < 60; i++) {
      const { grid, start, goal } = generateMaze(2000 + i * 19, 14, 6, 14);
      const pf = new Pathfinder(grid);
      const res = pf.findPath(start, goal, { height: 2 });
      if (res.status === 'success' && res.path && res.path.length <= 32) {
        pathsToBenchmark.push({ grid, start, goal });
      }
      if (pathsToBenchmark.length >= 25) break;
    }

    expect(pathsToBenchmark.length).toBeGreaterThanOrEqual(15);

    // Warm-up JIT
    for (const testCase of pathsToBenchmark) {
      const pf = new Pathfinder(testCase.grid);
      pf.findPath(testCase.start, testCase.goal, { height: 2 });
    }

    // Benchmark solve time only
    let totalTimeMs = 0;
    let measuredSolves = 0;

    for (const testCase of pathsToBenchmark) {
      const pf = new Pathfinder(testCase.grid);
      const t0 = performance.now();
      const res = pf.findPath(testCase.start, testCase.goal, { height: 2 });
      const t1 = performance.now();

      expect(res.status).toBe('success');
      totalTimeMs += t1 - t0;
      measuredSolves++;
    }

    const meanSolveTimeMs = totalTimeMs / measuredSolves;
    expect(meanSolveTimeMs).toBeLessThan(2.0);
  });

  describe('Path Cache', () => {
    it('returns cached path on repeated lookup without expanding nodes', () => {
      const grid = new InMemoryGrid(10, 6, 10);
      for (let x = 0; x < 10; x++) {
        for (let z = 0; z < 10; z++) {
          grid.set(x, 0, z, 'solid');
        }
      }
      const pf = new Pathfinder(grid);

      const start: BlockPos = [1, 1, 1];
      const goal: BlockPos = [8, 1, 8];

      const res1 = pf.findPath(start, goal, { height: 2 });
      expect(res1.status).toBe('success');
      expect(res1.nodesExpanded).toBeGreaterThan(0);

      const res2 = pf.findPath(start, goal, { height: 2 });
      expect(res2.status).toBe('success');
      expect(res2.nodesExpanded).toBe(0); // Served from cache!
      expect(res2.path).toEqual(res1.path);
    });

    it('invalidates cache when world version counter changes', () => {
      const grid = new InMemoryGrid(10, 6, 10);
      for (let x = 0; x < 10; x++) {
        for (let z = 0; z < 10; z++) {
          grid.set(x, 0, z, 'solid');
        }
      }
      const pf = new Pathfinder(grid);

      const start: BlockPos = [1, 1, 1];
      const goal: BlockPos = [8, 1, 8];

      pf.findPath(start, goal, { height: 2 });

      // Change world version counter
      grid.version = 1;

      const res = pf.findPath(start, goal, { height: 2 });
      expect(res.status).toBe('success');
      expect(res.nodesExpanded).toBeGreaterThan(0); // Re-computed!
    });

    it('differentiates cache key by entity height', () => {
      const grid = new InMemoryGrid(10, 6, 10);
      for (let x = 0; x < 10; x++) {
        for (let z = 0; z < 10; z++) {
          grid.set(x, 0, z, 'solid');
        }
      }
      const pf = new Pathfinder(grid);

      const start: BlockPos = [1, 1, 1];
      const goal: BlockPos = [8, 1, 8];

      // Height 2
      const resH2 = pf.findPath(start, goal, { height: 2 });
      expect(resH2.status).toBe('success');

      // Height 1 should not use Height 2 cache
      const resH1 = pf.findPath(start, goal, { height: 1 });
      expect(resH1.status).toBe('success');
      expect(resH1.nodesExpanded).toBeGreaterThan(0);
    });
  });

  describe('Per-Tick Budget API', () => {
    it('returns pending until finished and respects maxNodesPerTick', () => {
      const grid = new InMemoryGrid(20, 6, 20);
      for (let x = 0; x < 20; x++) {
        for (let z = 0; z < 20; z++) {
          grid.set(x, 0, z, 'solid');
        }
      }
      const pf = new Pathfinder(grid);

      const start: BlockPos = [1, 1, 1];
      const goal: BlockPos = [18, 1, 18];

      const search = pf.createSearch(start, goal, { height: 2 });
      expect(search.status).toBe('pending');

      // Step with small budget of 5 nodes
      let steps = 0;
      while (search.status === 'pending') {
        const status = search.step(5);
        expect(['pending', 'success', 'unreachable']).toContain(status);
        steps++;
        if (steps > 500) break;
      }

      expect(search.status).toBe('success');
      expect(steps).toBeGreaterThan(1); // Required multiple ticks
      expect(search.path).toBeDefined();
      expect(search.path![0]).toEqual(start);
      expect(search.path![search.path!.length - 1]).toEqual(goal);
    });
  });

  describe('Entity Height & Clearance', () => {
    it('allows 1-high entity to traverse low tunnel while 2-high entity is blocked', () => {
      const grid = new InMemoryGrid(10, 6, 10);
      // Floor at y=0
      for (let x = 0; x < 10; x++) {
        for (let z = 0; z < 10; z++) {
          grid.set(x, 0, z, 'solid');
        }
      }

      // Wall at x=5, with only a 1-high opening at (5, 1, 5)
      for (let y = 1; y < 6; y++) {
        for (let z = 0; z < 10; z++) {
          grid.set(5, y, z, 'solid');
        }
      }
      // Opening: passable at y=1, but ceiling solid at y=2
      grid.set(5, 1, 5, 'passable');
      grid.set(5, 2, 5, 'solid');

      const pf = new Pathfinder(grid);
      const start: BlockPos = [2, 1, 5];
      const goal: BlockPos = [8, 1, 5];

      // Height 1 entity should find a path through the tunnel
      const resH1 = pf.findPath(start, goal, { height: 1 });
      expect(resH1.status).toBe('success');
      expect(resH1.path).toContainEqual([5, 1, 5]);

      // Height 2 entity cannot fit through and is unreachable
      const resH2 = pf.findPath(start, goal, { height: 2 });
      expect(resH2.status).toBe('unreachable');
      expect(resH2.path).toBeNull();
    });

    it('blocks jump when ceiling above player head does not have clearance', () => {
      const grid = new InMemoryGrid(8, 6, 8);
      // Base floor at y=0
      for (let x = 0; x < 8; x++) {
        for (let z = 0; z < 8; z++) {
          grid.set(x, 0, z, 'solid');
        }
      }
      // Raised step at x=4, y=1
      for (let z = 0; z < 8; z++) {
        grid.set(4, 1, z, 'solid');
      }

      // Place ceiling covering the jump line at x=3, y=3
      for (let z = 0; z < 8; z++) {
        grid.set(3, 3, z, 'solid');
      }

      const pf = new Pathfinder(grid);
      const start: BlockPos = [3, 1, 3];
      const goal: BlockPos = [4, 2, 3];

      // Height 2 entity cannot jump with ceiling at y=3
      const resBlocked = pf.findPath(start, goal, { height: 2 });
      expect(resBlocked.status).toBe('unreachable');

      // Remove ceiling at y=3
      for (let z = 0; z < 8; z++) {
        grid.set(3, 3, z, 'passable');
      }
      pf.clearCache();

      const resAllowed = pf.findPath(start, goal, { height: 2 });
      expect(resAllowed.status).toBe('success');
    });
  });

  describe('Door Predicate Hook', () => {
    it('treats door as solid when predicate returns false, and passable when true', () => {
      let doorOpen = false;
      const classifier = new DefaultBlockClassifier(
        (_x, _y, _z, stateId) => stateId === 99 && doorOpen,
        (stateId) => stateId === 99,
      );

      const fakeWorld = {
        getBlockStateId(x: number, y: number, z: number): number {
          if (x < 0 || x > 10 || z < 0 || z > 10) return 1; // outer boundary wall
          if (y === 0) return 1; // solid floor
          if (x === 5) {
            if (z === 5 && (y === 1 || y === 2)) return 99; // door block
            if (y >= 1 && y <= 3) return 1; // solid wall
          }
          return 0; // air
        },
      };

      const adapter = new WorldAdapter(fakeWorld, classifier);
      const pf = new Pathfinder(adapter);

      const start: BlockPos = [4, 1, 5];
      const goal: BlockPos = [6, 1, 5];

      // Door closed -> door is solid, cannot pass wall
      doorOpen = false;
      pf.clearCache();
      const resClosed = pf.findPath(start, goal, { height: 2 });
      expect(resClosed.status).toBe('unreachable');

      // Door open -> door is passable, path walks through door
      doorOpen = true;
      pf.clearCache();
      const resOpen = pf.findPath(start, goal, { height: 2 });
      expect(resOpen.status).toBe('success');
      expect(resOpen.path).toContainEqual([5, 1, 5]);
    });
  });
});
