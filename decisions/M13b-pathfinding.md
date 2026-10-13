# M13b — A* pathfinding

## Architectural decisions

1. **Pure module architecture:**
   - Implemented in `src/entity/ai/pathfinding.ts` as a pure simulation module.
   - Zero imports from rendering, WebGL, or DOM packages.
   - Functions over a lightweight `WorldQuery` interface (`getBlockStateId`, `classify?`, `version?`).
   - Supplies `WorldAdapter` adapting the game `World` object without altering existing `src/world/` or rendering files. Automatically hooks into `world.onBlockEdited` to increment the version counter on live block edits. Out-of-bounds y coordinates (`y < 0 || y >= 320`) and unloaded chunk columns (`!world.hasColumn(cx, cz)`) are classified as `solid`.
   - Unit tests run over fast, zero-dependency in-memory test grids (`InMemoryGrid`) as well as real `World` instances.

2. **Node classification & door hook:**
   - Blocks are categorized into four fundamental traversal classes: `passable`, `solid`, `water`, and `forbidden`.
   - `passable`: air, non-colliding models (`cross`, `tall_grass`), torches, ladders, and vines.
   - `solid`: full cubes, stone, dirt, wood, leaves, slabs, and closed doors.
   - `water`: swimmable fluid with a higher traversal cost (`COST_WATER = 2.0`).
   - `forbidden`: environmental hazards that entities must never traverse (`lava`, `cactus`, `fire`).
   - `DefaultBlockClassifier` initializes its cache before the door check, preventing redundant registry lookup retries. Door predicate hook (`isDoorPassable` and `isDoorBlock`) allows external AI to open or bypass doors when authorized.

3. **3D voxel movement graph:**
   - 4-directional horizontal movement (North, South, East, West).
   - 1-block step up (jump) enabled when destination has solid floor and head clearance above the entity's current position allows jumping (`(x, y + height, z)` is occupiable).
   - Drop transitions permitted for drops of 1, 2, or 3 blocks onto solid ground or water. Drops of 4 or more blocks are strictly forbidden (cliff avoidance).
   - Swimming transitions support horizontal swimming, vertical swimming (swim up and swim down), entering water, and climbing onto adjacent land or 1-block elevated banks.
   - Entity size parameterized by height (1 or 2 blocks). Clearance checks verify all voxels from feet to head are free of solid and forbidden blocks.

4. **Admissible heuristic & isolated search contexts:**
   - Admissible Manhattan heuristic: $h = (|x - gx| + |z - gz|) \times \text{COST\_WALK}$. Since every move covers at most 1 horizontal block and costs $\ge 1.0$, $h$ is strictly admissible and monotonic, guaranteeing optimality without reopening closed nodes.
   - Isolated `SearchContext` instances: each concurrent `PathSearch` acquires its own context equipped with a `NodePool`, `MinHeap`, `CoordMap`, and typed scratch buffers (`neighborsBufferX`, etc.). Contexts are returned to `contextPool` upon search completion or disposal, safely supporting concurrent interleaved searches without cross-contamination.
   - True zero-allocation per node expansion: movement delta offsets are hoisted to module-level constants (`DIR_DX`, `DIR_DZ`) and neighbor evaluation writes directly into pre-allocated typed arrays on the context. No objects or arrays are created during node expansion.

5. **Path cache:**
   - Path search results are cached using a composite key: `${start}:${goal}:${height}`.
   - Entries store path geometry, search status, cost, and the world version counter.
   - Cache returns defensive copies of path arrays to prevent caller mutations from corrupting stored entries.
   - Cache entries are automatically invalidated whenever `world.version` differs from the cached version.

6. **Incremental per-tick search budget & node limits:**
   - Exposes `createSearch(start, goal, options)` returning a `PathSearch` object.
   - `step(maxNodesPerTick)` runs up to the requested expansion budget (default 2,000 nodes) and returns `'pending'`, `'success'`, `'unreachable'`, or `'limit'`.
   - When a search terminates due to exhausting the node-pool capacity or caller-specified node budget, it returns `'limit'` and is not cached as `'unreachable'`.
   - Synchronous `findPath(start, goal, options)` executes the search loop to completion for tests and synchronous needs.

7. **Verification & Dijkstra reference optimality:**
   - 50 deterministic seeded 3D test mazes featuring jumps, drops, deep pits, water pools, hazard blocks, and low ceilings.
   - Every maze verifies that the A* path cost equals the cost found by an independent Dijkstra reference search (using an independent priority queue over the identical movement graph and move rules).
   - Automated checks verify that paths never enter forbidden blocks, never drop $> 3$ blocks, and respect head clearance.
   - Mean solve time is verified to be $< 2$ ms for paths $\le 32$ blocks.
