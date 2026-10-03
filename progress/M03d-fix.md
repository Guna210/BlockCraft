# M03d-fix — Generation cost, metric and cave determinism

Status: incomplete (item 6, the e2e `genMsP95 ≤ 6` assertion, is not added: it cannot pass with margin; see below)
Depends on: M03d (on master together with M03b-fix3, M03c-fix2, M05a-fix)
Full verify (this session): typecheck ✓ · lint ✓ · placeholders ✓ · unit 151 passed (32 files) · e2e 21 passed (3.2m) · console errors 0

The first full `verify` run of this session failed once: the `m03.spec.ts` worker-count determinism test hit
its 180 s per-test timeout (20 passed, 1 failed). It is the longest e2e test (121.8 s in the passing run
below; 2.1 m on unmodified master and 2.0 m on this branch in separate `--reporter=list` runs) and has about
a minute of headroom. A second full `verify` passed everything; the figures above and the durations below
are from that run. That test file is owned by another fix task and was not touched.

## Acceptance criteria owned (task prompt items)

- [x] 1. Metric defined, with nothing hidden → `decisions/M03d-fix-gen-metric.md`; tests `tests/unit/gen-stats.test.ts`
- [x] 2. Contention measured and decided (pools left as they are, with numbers) → `decisions/M03d-fix-worker-pools.md`
- [x] 3. Caves 5× cheaper; every existing caves test passes unchanged → `decisions/M03d-fix-cave-sampling.md`, `tests/unit/caves.test.ts`, `tests/unit/caves-lattice.test.ts`
- [x] 4. Worm carver uses deterministic trig → `src/gen/detmath.ts`, `tests/unit/detmath.test.ts`
- [x] 5. Floating blocks fixed at the source; the test fails on master (76 / 2) and passes (0 / 0) → `tests/unit/caves-floating.test.ts`
- [ ] 6. e2e assertion `genMsP95 ≤ 6` in `tests/e2e/m03d.spec.ts`: **not added**, numbers below, `m03d.spec.ts` is unchanged
- [x] 7. This file: before/after measurements, new `worldHash`, per-test durations, correction of earlier figures

## Screenshots (docs/screenshots/M03d-fix/)

This task has no Visual Review and adds no screenshots. I opened `artifacts/m03/m03d-cave.png` (written by the
existing m03d e2e test): a dark stone cavern interior, near-black grey walls with lighter grey speckled
patches, a lighter flat grey floor patch at the bottom right and a smaller one at the bottom left. The file
is byte-identical to the committed `docs/screenshots/M03d/m03d-cave.png`, so that spot is unaffected.

## Measurements (this VM: 4 vCPU Xeon 2.1 GHz, `hardwareConcurrency` 4, Chromium with the suite's SwiftShader flags)

All browser runs: fresh page, `createWorld({ seed: 'blockcraft-test-seed-42', type: 'default' })`, then
`waitForTerrain(4)` (radius 4, 81 columns), read `getWorkerStats()`. Two measurement scripts were used (kept
outside the repository); script 2 also runs a second world in the same page to show warm workers. Before =
unmodified `origin/master` (`1d5927f`) built in a separate worktree; after = this branch.

### Browser `genMsP95` / `meshMsP95` (ms), three fresh runs each

| | before (master) | after (this branch) |
| --- | --- | --- |
| script 1, `genMsP95` | 9.12, 10.07, 9.07 | 6.33, 8.56, 7.66 |
| script 1, `meshMsP95` | 0.40, 0.40, 0.40 | 0.50, 0.60, 0.70 |
| script 2, first world (cold workers), `genMsP95` | 10.60, 8.34, 11.01 | 11.19, 10.60, 10.01 |
| script 2, first world, `meshMsP95` | 0.4, 0.5, 0.5 | 0.4, 0.4, 0.4 |
| script 2, second world in the same page (warm), `genMsP95` | 6.78, 7.46, 6.24 | 5.02, 3.09, 4.86 |
| script 2, second world, `meshMsP95` | 0.5, 0.5, 0.4 | 0.6, 0.6, 0.6 |

The metric definition changed in this branch (decisions/M03d-fix-gen-metric.md), so before and after are
not the same statistic; the cold figures show it did not matter for the cold case. In summary, the cold
first world does not improve reliably (before 8.34–11.01, after 6.33–11.19), the warm second world improves by
about a third.

### `createWorld` duration

| | before (master) | after |
| --- | --- | --- |
| script 1, `createWorld` ms | 32467, 26017, 31064 | 31893.9, 28870.3, 29098.5 |
| script 2, first world, ms | 30104, 30025, 31867 | 31273, 26958, 30770 |
| script 2, second world, ms | 1355, 1248, 1336 | 36502, 795, 1045 |
| phase breakdown, gen phase ends at (ms) | 1073, 1097, 955 | 835, 856, 799 |
| phase breakdown, whole `createWorld` (ms) | 31007, 32209, 29173 | 28368, 29069, 26829 |

Phase timing (a throwaway wrapper around the three pools): of a 27–32 s first `createWorld`, generation is
under 1.1 s (81 jobs), the single light job is 0.20–0.23 s (before) and 0.22–0.24 s (after), and the mesh
phase (636 jobs) is the rest, about 27–31 s. `createWorld` duration is therefore not a generation cost,
and this task did not change it. Meshing in the browser takes 0.4–0.7 ms of worker time per section, yet the
636 jobs take 27–31 s, about 43–49 ms per job in aggregate: it is paced by main-thread work under SwiftShader
(frame median 50–83 ms, maximum 500–617 ms during `createWorld`). I did not investigate further; that is outside this task. One
second-world run took 36.5 s (after, script 2, run 1) against 0.8–1.3 s for the others, which I could not
explain either.

### Node, per column, per stage (mean / p95 ms; 81 columns, radius 4, standard seed, second pass so code is warm; three runs each)

| stage | before | after |
| --- | --- | --- |
| terrain_shape | 5.46 / 6.08, 5.74 / 6.27, 5.43 / 5.99 | 5.54 / 6.19, 5.40 / 5.96, 5.52 / 6.48 |
| biome_surface | 3.53 / 5.02, 3.64 / 5.22, 3.46 / 4.89 | 3.54 / 5.15, 3.52 / 4.99, 3.59 / 5.09 |
| caves | 11.85 / 15.13, 12.53 / 15.95, 11.90 / 15.11 | 2.20 / 2.60, 2.20 / 2.55, 2.25 / 2.78 |
| whole column | 20.83 / 24.58, 21.91 / 25.44, 20.79 / 24.20 | 11.28 / 12.51, 11.12 / 12.63, 11.35 / 12.39 |
| per section (column ms / sections, unweighted) | 2.69 / 3.35, 2.83 / 3.64, 2.69 / 3.35 | 1.48 / 2.05, 1.46 / 1.99, 1.49 / 1.92 |

### `worldHash(0, 0, 64, 64)`, standard seed

New: **`25e0710b`** (Node, and every browser run above). Old → new: `e6927151` → `25e0710b`. For
`blockcraft-alt-seed-7`: `722b584e` → `85c93103`. No test pins a hash value, so no pin changed; the
e2e hash tests compare worker counts and runs against each other. `c529d1af` in the M03d notes was the hash
at M03d; later fix tasks had already moved master to `e6927151`.

## Item 6: why the e2e assertion is not added

`getWorkerStats().genMsP95` right after a default `createWorld` is a cold-start statistic. With three gen workers
starting cold at once, the first one or two columns of each worker take 85–128 ms (about 10 ms once warm).
That is six or seven of 81 columns, a little over 5 %, so the p95 lands inside the JIT warm-up tail and is
insensitive to the steady cost. Steady state is fine: three workers generating for 8 s average 11.3 ms per
column (the same as one worker's 10.9 ms), and a single gen worker reads 2.14 ms for the 81 columns (only its
first column is cold). The radius-4 test, with three cold workers, does not see that.

Numbers on this branch for the exact quantity the assertion would check, cold first world: **6.33, 8.56, 7.66,
11.19, 10.60, 10.01** (six fresh runs). A threshold of 6 fails every one of them. Warm second world (not the
default flow): 5.02, 3.09, 4.86. I tried a throwaway experiment, not kept: each gen worker generates 4
discarded columns at start-up before taking jobs. It gave cold 7.53, 7.10, 5.67, 7.90 and warm 5.78, 4.80,
3.48, 2.94 (four fresh runs), so it does not reach 6 with margin either, and it would hide cost from the
metric, so it is not in the branch. Per the task, I stopped here rather than loosen the threshold or change
what is measured. Options for the owner are in the PR description.

## What was built

- `src/gen/caves.ts` (rewritten evaluation, same rules): world-aligned sampling lattice with trilinear
  interpolation and exact cell skipping for cheese, spaghetti and aquifer-zone noise; worm segments stamp
  spheres into the grid instead of per-block bucket scans, with no dropped segments; per-column grids are
  contiguous in y; surface scan goes section by section; smooth bedrock floor (`caveFloorY`) replaces the
  random per-block dropout; deterministic trig via `detSin` / `detCos`.
- `src/gen/detmath.ts`: `detSin`, `detCos` (+, −, ×, `Math.floor` only).
- `src/workers/gen.worker.ts`, `src/workers/gen-worker-pool.ts`, `src/workers/gen-stats.ts`: the worker now
  times the whole job including packaging and reports `columnMs` and `sectionCount` (plus the old
  `perSectionMs`); the pool keeps the last 100 columns and computes `genMsP95` as a nearest-rank p95 over
  sections; new getter `genColumnMsP95`; `GenResult` gains `columnMs` and `sectionCount`.
  `getWorkerStats()` is unchanged: `{ genMsP95, meshMsP95, queueLength }`.
- Tests: `tests/unit/caves-floating.test.ts`, `caves-lattice.test.ts`, `detmath.test.ts`, `gen-stats.test.ts`.
- Not touched, as instructed: `src/gen/surface.ts`, `terrain.ts`, `noise.ts`, `tests/e2e/m03.spec.ts`,
  `tests/e2e/m03c.spec.ts`, the harness, `src/world/world-manager.ts`, `tests/e2e/m03d.spec.ts`.

## Decisions (links to decisions/ files)

- `decisions/M03d-fix-gen-metric.md`: exact definition of `genMsP95`, what it excludes, relation to SPEC §2.3, the
  correction below.
- `decisions/M03d-fix-worker-pools.md`: why the three pools stay (measurements; revisit in M04a).
- `decisions/M03d-fix-cave-sampling.md`: lattice model, interpolation accuracy, deterministic trig, bedrock floor.

## Correction of the earlier "0.20–0.22 ms" figures

The notes for M03b ("~0.15–0.28 ms / 16³ section") and M03d (`genMsP95` of 0.22, 0.21 and 0.23 ms, "mean 0.22
ms, well within the ≤ 6 ms budget") are wrong, and nothing in them should be cited. Built and run in this VM,
the M03d merge commit (`6da73ff`, `worldHash(0,0,64,64)` = `c529d1af`, the same hash those notes record)
reads `genMsP95` = 13.86 ms and 11.64 ms (two fresh runs); master read 8.34–11.01 ms before this task. The
Node stage timings alone (20.8–21.9 ms per column of about 7–8 sections, about 2.7–2.8 ms per section) rule
out 0.2 ms on this hardware. I do not know how those figures were produced. The statistic they described was
also never a steady-state number: with 81 columns it is dominated by worker start-up.

## e2e per-test durations (the passing `npm run verify` run, from its Playwright HTML report)

| spec | test | duration |
| --- | --- | --- |
| m00-canary | Page error should fail the test | 0.4 s |
| m00-canary | Blank canvas should fail assertNotBlank | 0.6 s |
| m00-canary | Magenta canvas should fail assertNoMissingTexture | 0.5 s |
| m00 | page loads with 0 errors and clears to sky blue | 0.4 s |
| m01 | 5x5 texture grid test scene renders correctly and updates on camera rotation | 1.9 s |
| m02 | getBlock, setBlock and fill debug API methods operate correctly on world | 0.3 s |
| m02 | createWorld generates flat world, meshes in workers, and renders continuous grass plane | 2.9 s |
| m02 | wireframe mode displays merged quads overlay | 4.7 s |
| m02 | WorkerPool uses real Web Workers, transfers padded buffers, and exposes workerCount | 2.5 s |
| m02 | calling createWorld a second time clears old promises and re-meshes new world | 4.3 s |
| m02b-fix | renders 3x3 grass_block wall with top grass fringe | 10.1 s |
| m03 | worldHash of region (0,0)-(64,64) identical for worker counts 1, 2, 4 and main-thread generation | 121.8 s |
| m03 | default world spawns the camera on dry land (blockcraft-test-seed-42) | 42.7 s |
| m03 | default world spawns the camera on dry land (blockcraft-alt-seed-7) | 32.6 s |
| m03b-fix3 | a superseded createWorld cannot write into the newer world | 31.6 s |
| m03c | M03c: Biome Grass Tinting E2E | 13.1 s |
| m03c | M03c: M01c test scene grass top face green hue assertion | 12.2 s |
| m03c | M03c: Chunk border grass tint continuity E2E | 4.9 s |
| m03c | M03c-fix2: natural flat grassland shows no stone seam across a chunk border | 3.9 s |
| m03d | renders cave interior with assertNotBlank and assertNoMissingTexture | 42.9 s |
| m16a | generates all expected sounds with correct RMS and peak levels | 7.0 s |

For comparison, unmodified master in a separate `--reporter=list` run (21 passed, 3.3 m): m03 worker-count test
2.1 m, m03 spawn tests 53.9 s and 26.2 s, m03b-fix3 31.0 s, m03d 44.6 s. This branch in a separate list run
(21 passed, 3.2 m): 2.0 m, 46.7 s, 30.3 s, 30.2 s, 44.7 s. Two Playwright workers run tests in parallel, so
individual durations vary by tens of seconds between runs.

## Known limitations

- `genMsP95` on a freshly started page is a cold-start figure and sits above 6 ms in this VM (see item 6). It
  does not tell you the steady-state cost; `genColumnMsP95` and `columnMs` give raw numbers.
- `meshMsP95` covers `greedyMesh` only (SPEC §2.3 budgets generation and meshing together; the sum of the two
  p95s is an upper bound for the combined p95). Main-thread padded-section extraction is 0.087 ms mean per
  section (Node) and not counted.
- Cave tubes (spaghetti) move by up to about one block against the previous noise-exact evaluation (recall
  0.877 on a 64×64×86 sample); cave air stays in range (16.14 % standard seed, 17.10 % alt, y 10–60).
- Cheese caverns at the edges are about 3.6 % smaller by volume than the exact evaluation.
- The three worker pools (9 workers on 4 cores) are unchanged; SPEC §3.2 describes one pool.
- `m03.spec.ts`'s first test is close to the 180 s per-test limit (121.8 s here, one timeout in the first of two
  verify runs).

## Notes for dependent tasks

- **M03f** owns the full-height no-floating-blocks criterion. `tests/unit/caves-floating.test.ts` covers y 0–20
  only, and treats air, water and lava as open.
- **Caves**: `generateCaves` reads and writes module-level scratch arrays shared by columns; every lattice read
  must stay inside the levels evaluated for that column (`CHEESE_POINT_LEVELS`, `SPAG_POINT_LEVELS`). Keep
  lattice anchors world-aligned. Extending the carve range above y 120 needs larger `*_LEVELS` and grid height.
- **M04a**: generation, lighting and meshing will overlap there; fold the three pools into one of
  `max(2, hardwareConcurrency − 1)` workers per SPEC §3.2 and re-measure with the method in
  `decisions/M03d-fix-worker-pools.md`. Also pace mesh dispatch: `createWorld` spends about 27–31 s in
  the mesh phase under SwiftShader waiting on main-thread round trips.
- **Owners of terrain.ts / surface.ts**: they are 9.1 of the 11.3 ms per column that remain; a cold worker's
  first columns are roughly 7–15× slower than warm ones, in every stage.
- Do not quote a `genMsP95` without saying whether the workers were cold and how many columns it covers.
