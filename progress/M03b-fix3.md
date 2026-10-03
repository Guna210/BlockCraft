# M03b-fix3 — Seed-dependent origin, land spawn and createWorld race

Status: verified
Depends on: M03b, M03c-fix2 (`src/gen/terrain-height.ts`)
Full verify (this session): typecheck ✓ · lint ✓ (0 errors, 2 existing `no-explicit-any` warnings in files this task does not touch) · placeholders ✓ · unit 139 passed (28 files) · e2e 21 passed (0 flaky, 0 skipped) · console errors 0

This is an owner-sanctioned fix task that is not in SPEC.md Appendix E. It touches `src/gen/terrain.ts`, `src/gen/terrain-height.ts` (the offset only) and `src/world/world-manager.ts` (items 2 and 3 only), adds `src/world/spawn.ts`, and adds tests. It does not touch `src/gen/surface.ts`, `caves.ts`, `noise.ts`, `src/workers/`, `m03c.spec.ts`, `m03d.spec.ts` or the harness.

## Items owned

- [x] 1. Seed offset → `src/gen/terrain.ts`, mirrored in `src/gen/terrain-height.ts`
- [x] 2. Land spawn → `src/world/spawn.ts` (`findSpawnPoint`), called from `createWorld`
- [x] 3. createWorld race → world epoch token in `src/world/world-manager.ts`
- [x] 4a. Unit, 24 seeds: continentalness and biome at (0,0) differ → `tests/unit/seed-origin.test.ts` › "continentalness and biome at (0,0) differ between seeds"
- [x] 4b. Unit, 4 seeds: `worldHash` of (0,0)-(64,64) and of a 64×64 region at (2000,2000) differ → `tests/unit/seed-origin.test.ts` › "worldHash of (0,0)-(64,64) and of a 64x64 region at (2000,2000) differs between 4 seeds"
- [x] 4c. e2e spawn test strengthened, standard seed and `blockcraft-alt-seed-7` → `tests/e2e/m03.spec.ts` › "default world spawns the camera on dry land above sea level (<seed>)"
- [x] 4d. e2e race, 14.4 s alone (limit 60 s) → `tests/e2e/m03b-fix3.spec.ts`
- [x] Extra: `findSpawnPoint` unit tests (nearest-land brute force on three real worlds, fluid and sea-level exclusion, fallback, determinism) → `tests/unit/spawn.test.ts`

## Before / after on master

I stashed the three `src/` edits (the new test files stayed) and ran the tests against master code.

| Test | On master | With the fix |
| --- | --- | --- |
| 4a continentalness/biome at (0,0) | **fails**: `expected 1 to be greater than or equal to 20` (all 24 seeds give continentalness exactly 0) | passes |
| 4b worldHash differs between 4 seeds | **passes on master** (see below) | passes |
| 4c spawn, standard seed | **fails**: camera y = 60.82, not > 64 | passes |
| 4c spawn, `blockcraft-alt-seed-7` | **fails**: camera y = 60.82, not > 64 (same y as the standard seed: both origins sit in the river) | passes |
| 4d race | **fails**: `B after a superseded createWorld(A) is 3d473c26, a fresh B is ec7a9fed` | passes |

Item 4 asked me to confirm that a, b and d fail on master. **b does not fail on master.** The two seeds' 64×64 regions differ everywhere except the single lattice point (0,0), so their hashes differ on master too. I kept test b as asked because it is a valid guard, but it is not evidence of the origin bug; test a is. I did not contrive a different assertion to make b fail.

## Item 1 — offset

- Every terrain-shape noise sample in `terrain.ts` is taken at `(wx + offX, wz + offZ)`: continentalness, erosion, peaks, river base noise and both river-warp noises, the 3D density noise and the Foundation Stone noise. The x/z offsets come from `hash2(deriveSeed(stageSeed, 'origin_offset_x' | '_z'), …)`: about ±100 000 blocks, plus a fractional part in [0.125, 0.875), so they are never integers. `noise.ts`, amplitudes, splines and thresholds are unchanged.
- The y coordinate of the 3D density noise is not offset: y is the same for every seed, and the lattice point (0,0,0) is at y = 0, below the sampled band (y ≥ 5).
- `terrain.ts` exports `getTerrainOrigin(terrainStageSeed, out)`. `terrain-height.ts` calls it and applies the same offset to its river and 3D-density samples. `tests/unit/surface-seam.test.ts` (`sampleTerrainTopY` equals the real shape-stage top block exactly) passes unchanged.
- `biomes.ts` already offset its temperature and humidity noise by a seed-derived value (integer, ±10 000); I did not touch it.
- Every existing proportion, river-shape, overhang, agreement and biome-coverage test passes unchanged. No bound was out of range, so nothing was retuned.
- Result at the origin over 24 seeds (`origin-probe-seed-0…23`): biomes at (0,0) are deep_ocean ×6, swampland ×4, pine_taiga ×4, plains ×2, birch_grove ×2, frozen_ocean ×2, ocean ×2 and savanna, frost_peaks (one each), instead of `river` in 24/24 on master.

## Item 2 — spawn

- `findSpawnPoint(world, radiusChunks)` (`src/world/spawn.ts`) walks square rings (Chebyshev distance 0, 1, 2, …) around (0,0) over the already generated columns. A column qualifies when its top block (highest non-air block, fluids included) is above y = 64 and is not water or lava. In the first ring with a qualifying column, the one with the smallest x² + z² wins, ties going to the earlier cell in ring order. The camera goes to `(x + 0.5, top + 1.82, z + 0.5)`.
- Fallback: if no generated column qualifies, the highest top block of any generated column is used (fluid tops included). **The fallback did not trigger for any of the 27 seeds I probed** (standard, alt, gamma and the 24 origin seeds). It is covered by a hand-built unit test.
- It scans only sections that are not all air; the slowest search over the 27 seeds was 11.9 ms.
- Flat worlds still spawn at (0.5, 80, 0.5).

Spawn positions (standard seed and two others, computed in-process on the main thread; the e2e tests assert the same rule through the real worker path):

| Seed | Spawn (x, y, z) | Top block | Biome at spawn | Biome at (0,0) |
| --- | --- | --- | --- | --- |
| `blockcraft-test-seed-42` | (0.5, 70.82, 1.5) | stone (y 69) | meadow | meadow |
| `blockcraft-alt-seed-7` | (0.5, 73.82, 0.5) | snow (y 72) | snowy_tundra | snowy_tundra |
| `probe-seed-gamma` | (6.5, 66.82, 6.5) | snow (y 65) | snowy_tundra | frozen_ocean |

(0,0) on the standard seed has h = 64 with a stone top and is not above sea level, so the spawn moves one block to (0,1). The stone top on a meadow column comes from the surface stage's steep-slope rule, which this task does not touch.

## Item 3 — race

- `WorldManager.worldEpoch` is bumped whenever `this.world` is replaced (`createWorld` and `resetWorldToEmpty`). `createWorld` and `meshRadius` capture the world, seed, type and epoch at the start. Generation results, the light result, the camera/spawn update and mesh uploads are dropped when the epoch no longer matches, and the later steps of a superseded `createWorld` are skipped. A superseded `createWorld` resolves quietly; it does not throw.
- Light and mesh results had the same problem (mesh uploads and the `pendingTerrainPromises` map of a superseded call could land in the new world), so they are guarded too.
- Race probe (A = standard seed not awaited, B = `blockcraft-alt-seed-7` 300 ms later), master: B hash `3d473c26` vs fresh B `ec7a9fed`. With the fix the two are equal. "Fresh B" is generated on the main thread into an empty world, which `m03.spec.ts` already proves equal to worker generation.

## New worldHash

`worldHash(0, 0, 64, 64)`, standard seed, full default pipeline: **`e6927151`**. Old → new: `9cb9466b` → `e6927151` (the M03c-fix2 value). No test pins this hash (the tests compare runs and worker counts against each other), so no pin changed.

## m03 e2e durations

Seconds, Playwright list reporter, default 2 workers, each spec run alone on the final code (`m03.spec.ts` has 3 tests running two at a time, so the first two overlapped).

| Test | Time |
| --- | --- |
| `worldHash of region (0,0)-(64,64) is identical for worker counts 1, 2 and 4, on a repeat run, and matches main-thread generation` (unchanged) | 57.8 |
| `default world spawns the camera on dry land above sea level (blockcraft-test-seed-42)` | 58.7 |
| `default world spawns the camera on dry land above sea level (blockcraft-alt-seed-7)` | 23.1 |
| `m03b-fix3.spec.ts` race test (alone) | 14.4 |

On master code the two spawn tests took 55.6 s (standard) and 39.8 s (alt) before failing, and the race test 41.1 s. The old single spawn test took 47.4 s in M03b-fix2's notes. All are inside the 180 s limit; I split the spawn test per seed instead of looping inside one test so that no test pays for two `createWorld` calls.

## Screenshots (docs/screenshots/M03b-fix3/)

- none (this task has no Visual Review).

## Known limitations

- A spawn away from the origin moves the camera-centred initial mesh with it (`meshRadius` centres on the camera chunk). The furthest spawn I saw was (−37.5, 21.5) and (0.5, −35.5), up to 3 chunks from the origin, so up to a 3-column strip beyond the radius-4 lit area is generated and meshed by `createWorld`. Those columns have no light data from the initial `LightWorkerPool` job. M05b/M04a should light by streaming rather than by this one region job.
- `tests/unit/biomes.test.ts` rewrites `docs/screenshots/M03c/m03c-biome-map.png` and `m03c-grass-tint-map.png` on every unit run, so they now differ from the committed copies (the world changed). I did not commit them: they belong to M03c. Owner decision: regenerate and commit them if you want the committed maps to show the new terrain.
- Aborted `createWorld` calls still occupy the generation worker queue until their (discarded) jobs finish, because `GenWorkerPool` has no cancellation (M04a's stale-job cancellation).

## Notes for dependent tasks

- Anything that samples terrain noise by hand must add the origin: `getTerrainOrigin(terrainStageSeed, out)` from `src/gen/terrain.ts`. `sampleTerrainClimate`, `generateTerrainShape` and `sampleTerrainTopY` already do.
- `findSpawnPoint` is the single place that decides the spawn; M11b (respawn at world spawn) should call it instead of using `getHeight(0, 0)`.
- Any new asynchronous result that writes into `WorldManager.world` must capture `worldEpoch` before the request and drop the result when it changed.
