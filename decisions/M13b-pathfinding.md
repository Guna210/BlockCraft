# M13b — A* pathfinding

## Architectural decisions

1. **Pure module architecture:**
   - Implemented in `src/entity/ai/pathfinding.ts` as a pure simulation module.
   - Zero imports from rendering, WebGL, or DOM packages.
   - Functions over a lightweight `WorldQuery` interface (`getBlockStateId`, `classify?`, `version?`).
   - Supplies `WorldAdapter` adapting the game `World` object without altering existing `src/world/` or rendering files.
   - Unit tests run over fast, zero-dependency in-memory test grids (`InMemoryGrid`).

2. **Node classification & door hook:**
   - Blocks are categorized into four fundamental traversal classes: `passable`, `solid`, `water`, and `forbidden`.
   - `passable`: air, non-colliding models (`cross`), torches, ladders, and vines.
   - `solid`: full cubes, stone, dirt, wood, and closed doors.
   - `water`: swimmable fluid with a higher traversal cost (`COST_WATER = 2.0`).
   - `forbidden`: environmental hazards that entities must never traverse (`lava`, `cactus`, `fire`).
   - Door predicate hook (`isDoorPassable` and `isDoorBlock`) exposed in `BlockClassifier` and `DefaultBlockClassifier`. Door blocks are treated as passable when the predicate permits, and solid otherwise. No door block definitions are added to `data/blocks/` before their respective milestones.

3. **3D voxel movement graph:**
   - 4-directional horizontal movement (North, South, East, West).
   - 1-block step up (jump) enabled when destination has solid floor and head clearance above the entity's current position allows jumping (`(x, y + height, z)` is occupiable).
   - Drop transitions permitted for drops of 1, 2, or 3 blocks onto solid ground or water. Drops of 4 or more blocks are strictly forbidden (cliff avoidance).
   - Swimming transitions support horizontal swimming, vertical swimming (swim up and swim down), entering water, and climbing onto adjacent land or 1-block elevated banks.
   - Entity size parameterized by height (1 or 2 blocks). Clearance checks verify all voxels from feet to head are free of solid and forbidden blocks.

4. **Admissible heuristic & pooled binary heap:**
   - Admissible Manhattan heuristic: $h = (|x - gx| + |z - gz|) \times \text{COST\_WALK}$. Since every move covers at most 1 horizontal block and costs $\ge 1.0$, $h$ is strictly admissible and monotonic, guaranteeing optimality without reopening closed nodes.
   - Binary min-heap supporting $O(\log N)$ push, pop, and decrease-key operations via direct index tracking (`heapIdx`).
   - Zero-allocation search: all search state is maintained in pre-allocated TypedArrays (`NodePool` and `CoordMap` open-addressing hash table). Search iterations allocate zero heap objects, eliminating GC overhead during traversal.

5. **Path cache:**
   - Path search results are cached using a composite key: `${start}:${goal}:${height}`.
   - Entries store path geometry, search status, cost, and the world version counter.
   - Cache entries are automatically invalidated whenever `world.version` differs from the cached version.

6. **Incremental per-tick search budget:**
   - Exposes `createSearch(start, goal, options)` returning a `PathSearch` object.
   - `step(maxNodesPerTick)` runs up to the requested expansion budget (default 2,000 nodes) and returns `'pending'`, `'success'`, or `'unreachable'`.
   - Synchronous `findPath(start, goal, options)` executes the search loop to completion for tests and synchronous needs.

7. **Verification & Dijkstra reference optimality:**
   - 50 deterministic seeded 3D test mazes featuring jumps, drops, deep pits, water pools, hazard blocks, and low ceilings.
   - Every maze verifies that the A* path cost equals the cost found by an independent Dijkstra reference search with $h = 0$.
   - Automated checks verify that paths never enter forbidden blocks, never drop $> 3$ blocks, and respect head clearance.
   - Mean solve time is verified to be $< 2$ ms for paths $\le 32$ blocks.
