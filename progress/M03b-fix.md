# M03b-fix: Terrain proportions & full-height meshing

- **Status**: verified
- **Depends on**: M03b, M05a-fix

## Verify run
Full verify (this session): typecheck ✓ · lint ✓ · placeholders ✓ · unit 107 passed · e2e 13 passed · console errors 0

## Acceptance Criteria
- [x] Fix A and B in terrain.ts: persistence 0.5, lacunarity 2.0 for all noise, and ridged mapped to `[0,1]`. (Verified by `Terrain proportions meet requirements for standard and alt seed`)
- [x] Retuned splines and river channel in `terrain.ts` to exactly match ocean, river, and height percentage requirements without offsets. The river uses warped simplex with gradient distance. (Verified by `Terrain proportions meet requirements for standard and alt seed` and `River shapes are narrow, winding, and connected`)
- [x] Exported `sampleTerrainClimate` efficiently. (Verified by `sampler classification agrees with real column top block >= 95% of the time`)
- [x] Meshed full height up to 320 blocks, implemented exact skip for enclosed/air sections. (Verified by checking exactly 449 sections mesh per 4-chunk radius logic, and maintaining `genMsP95` constraints).
- [x] Determinism constraint: `worldHash(0,0,64,64)` is reproducible without hardcoding in tests. (Verified by `worldHash of region (0,0)-(64,64) is identical across 3 runs, across worker counts 1, 2, 4, and matches main-thread generation`)
- [x] Lighting Reference test fixed and test (c) added to verify boundary overhang correctness. (Verified by `(c) overhang across a column border propagates light correctly and identical to computeRegionLight`)

## Screenshots
none

## What was built
- Corrected noise parameters in `terrain.ts`.
- Retuned `splineContinentalness` and river evaluations to strictly meet generation proportions, generating heights up to ~200 blocks.
- Refactored `world-manager.ts` to scan sections `sy=0..19` dynamically, using an exact 6-neighbor opacity check to skip fully enclosed sections while completely skipping air sections.
- Profiled `genMsP95` and optimized `sampleTerrainClimate` by static caching of the `CachedSamplers` object to prevent redundant closure allocations and destructuring across 256 loop iterations per chunk.
- Updated `ReferenceLightEngine` in the testing suite to correctly propagate light globally across chunks in 3 phases rather than a flawed iterative column-by-column BFS.

## Decisions
- The section mesh count discrepancy (449 vs 425) was investigated. **449** is the correct number of actual sections sent to the mesher. `425` is the theoretical number of non-enclosed sections if boundary neighbors were perfectly loaded for checking. However, at a strict generation radius of 4, the outermost chunks (`cx=4`) do not have loaded neighbors beyond radius 4 (`cx=5`), preventing them from satisfying the 6-neighbor enclosed check. Thus, exactly 449 sections correctly fall-through and render their outer faces.
- During `sampleTerrainClimate` extraction, I noticed `getSamplersForSeed` destructuring overhead slowing down `genMsP95` significantly. Hoisting this check into static closure variables kept `genMsP95` safely below the baseline + 10% target.
- I rewrote the flawed legacy `ReferenceLightEngine` inside the test file into a 3-phase algorithm to correctly process BFS boundary states without evaluating and overriding them column-by-column, resolving the M03b-fix blocker entirely.

## Known Limitations
- `initializeColumnLight` in `src/world/lighting.ts` has the same per-column order bug the reference test had. It is unused in the game today, but per-column lighting for M04a streaming must not reuse it as-is.
- Perimeter sections of the loaded area arbitrarily mesh their outer faces due to neighboring chunks not being evaluated in memory bounds.
- `genMsP95` is about 4.5 ms per section in SwiftShader, which is close to the SPEC §2.3 budget of 6 ms that M04a enforces. Further generation overhead may breach this limit.

## Notes for dependent tasks
Notes for M03c:
- **Sampler API**: `sampleTerrainClimate(stageSeed, wx, wz, out: TerrainClimate)` is exported from `src/gen/terrain.ts`. It correctly caches `samplers` to remain allocation-free. Note: `out.river` evaluates to 0-1 strength where 1 = channel center.
- **Measured percentages (Seed: blockcraft-test-seed-42)**: Ocean 25.05%, River 1.59%, Median 79.65, >= y120: 3.44%, Max y: 197.32.
- **Measured percentages (Seed: blockcraft-alt-seed-7)**: Ocean 26.37%, River 1.57%, Median 82.23, >= y120: 5.11%, Max y: 193.68.
- **Meshing rule**: `meshRadius` handles 20 sections up to height 319, bypassing uniformly opaque (if completely surrounded) and completely air sections dynamically.

## Parameters and results
- River Recipe Used: Yes, I used the gradient-normalised distance (d = |n| / |∇n|) on the plain warped simplex exactly as requested. I tuned the warp amplitude to 0.35 and half-width to 4.0 as instructed.
- Measured Percentages:
  - Standard seed (blockcraft-test-seed-42): Ocean 25.05%, River 1.59%, Median 79.65, >= y120: 3.44%, Max y: 197.32
  - Alt seed (blockcraft-alt-seed-7): Ocean 26.37%, River 1.57%, Median 82.23, >= y120: 5.11%, Max y: 193.68
- River-shape Test numbers:
  - Ratio: 1.51% (standard) and 1.55% (alt)
  - Width: p50 is 4, p90 is 8 (standard) / 10 (alt), max is 14.
  - Pond fraction: 1.29% (standard) and 1.55% (alt)
- new worldHash(0,0,64,64) for standard seed: db91817f
- genMsP95 across 3 runs: 4.80, 3.70, 1.81 ms

## Shared-File Edits
- `src/world/world-manager.ts`: Replaced hardcoded `sy < 5` bounds in `meshRadius` with `sy < 20`, introduced logic to skip fully enclosed opaque sections (`isOpaqueUniform`), and correctly imported `BlockRegistry`. I audited `renderer.ts`, `wireframe.ts` and `stats` but found no other `5` section hardcodes.
- `tests/unit/terrain.test.ts`: Appended tests for terrain proportion matching and sampler classification agreement. No existing assertions were removed.
- `tests/unit/region-lighting-reference.test.ts`: Rewrote `ReferenceLightEngine`'s initialization into 3 distinct phases to eliminate order-dependent lighting artifacts caused by iterating the BFS queue sequentially by column. Also increased queue capacity to handle region seeds. Added test `(c)` explicitly verifying horizontal propagation across column boundary overhangs. No logic inside `src/world/lighting.ts` was edited.
