# M05a-fix — Fast region lighting

Status: verified
Depends on: M05a
Full verify (this session): typecheck ✓ · lint ✓ · placeholders ✓ · unit 103 passed · e2e 13 passed · console errors 0

## Acceptance criteria owned

- None (Fix task for M05a performance regression).

## What was built

- `src/world/lighting.ts`: Implemented `computeRegionLight` algorithm executing bulk region lighting in one pass over flat typed arrays (`opacityGrid`, `skyGrid`, `blockGrid`). Performs vertical sky pass, selective queue seeding (seeding only beam borders and light emitters), region sky BFS, and region block BFS without Map/string lookups, World calls, or per-cell object allocations.
- `src/world/lighting.ts`: Updated `LightStorage` section keys and `LightEngine` heightmaps to use arithmetic numeric keys (`getSectionKey(cx, sy, cz)`), eliminating string allocations and map formatting overhead during lighting operations.
- `src/world/world.ts`: Cached `getColumn` lookups and added `getStateHashBytes` precomputed byte arrays in `BlockRegistry` for fast `worldHash` calculation.
- `src/world/padded.ts`: Optimized `buildPaddedSection` to pre-fetch neighbor columns once per section rather than querying column maps 5,832 times per section.
- `src/workers/light.worker.ts`: Updated light worker to directly invoke `computeRegionLight` on flat transferable section buffers and return numeric section key transfers.
- `src/world/world-manager.ts`: Removed `[M05a Light Timing]` console.log and integrated numeric key transfers from worker light responses.
- `tests/unit/region-lighting-reference.test.ts`: Added reference implementation test suite containing a copy of master's `initializeColumnLight` algorithm, verifying 100% cell-by-cell equivalence between new region lighting and reference on (a) standard seed radius-2 region and (b) seeded random block data (air, stone, glass, leaves, water, lava).
- `tests/unit/light-keys.test.ts`: Added unit test confirming arithmetic numeric section keys are unique, collision-free across all `|cx|, |cz| <= 1024` and `sy` in `0..19`, sampled near `±32767`, and throw on out-of-range inputs.

## Performance Measurements

All measurements taken in Node/Playwright environment in this session:

- **Region Lighting Time (radius 4, standard seed, in Node):**
  - Before: **41172.56 ms** (measured directly in `origin/master` worktree using master's actual per-column algorithm)
  - After: **374.55 ms** (109.9× speedup; target ≥ 15×)

- **`tests/e2e/m03.spec.ts` Execution Time (`npx playwright test tests/e2e/m03.spec.ts --reporter=list`):**
  - Before: **timed out at 180 s**
  - After: **1.4m** (individual test runs completed in ~1.4 min)

- **Lighting Unit Tests Wall Time (`tests/unit/lighting.test.ts`):**
  - Before: **89.10 s** (measured on master worktree)
  - After: **34.61 s** (`tests/unit/lighting.test.ts` alone took 34.61 s; 50.22 s for all 3 lighting test files combined)

## Decisions

- **Arithmetic numeric section keys:** `LightStorage.getSectionKey(cx, sy, cz)` encodes `cx`, `cz`, and `sy` using the exact arithmetic formula `((cx + 32768) * 65536 + (cz + 32768)) * 32 + sy` (exact up to $2^{53}$ in JS numbers, supporting $|cx|, |cz| \le 32767$), avoiding string allocations and bitwise 32-bit overflow. Throws an explicit `Error` if coordinates exceed range.

## Known limitations

- **`tests/e2e/m03.spec.ts` Total Time:** `tests/e2e/m03.spec.ts` takes ~1.4m (~84 s total suite execution time across 2 test files/workers), above the local 60 s target. The time breakdown per `createWorld({ seed: 'blockcraft-test-seed-42', type: 'default' })` call is:
  - Generation (`GenWorkerPool`): ~2.5 s (81 columns in workers)
  - Lighting (`LightWorkerPool`): ~0.37 s (region lighting in worker)
  - Meshing & Extraction (`WorkerPool` + `buildPaddedSection`): ~6.0 s (405 section meshes extracted on main thread & meshed in workers)
  - `worldHash`: ~0.2 s (hashing 65×65×320 blocks)
  The runtime is dominated by meshing (405 sections per world load) and terrain generation across the 9 `createWorld` calls in `m03.spec.ts` (3 worker counts × 3 runs each). Main-thread time during meshing is spent in `buildPaddedSection` extraction (~1.2 s main-thread work per world load) and WebGL buffer upload (~0.3 s), while the remaining ~4.5 s is worker CPU meshing time across the worker pool.

## Notes for dependent tasks

- Region light results returned by `LightWorkerPool` transfer flat section light buffers keyed by numeric section key `key`.
- `World.getColumn` / `hasColumn` now cache the last column looked up (`lastCX`, `lastCZ`, `lastCol`); M04a (unloading) must reset that cache whenever a column is removed.
