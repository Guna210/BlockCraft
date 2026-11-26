# PERF-batch — Terrain draw batching

Status: verified

Full verify: PR CI [45708396150](https://github.com/Guna210/BlockCraft/actions/runs/45708396150) · typecheck, lint, placeholders and 1,603 unit tests passed · browser shards 53 / 53 / 53 / 52 passed (one shard 4 retry) · queueSerial 0 / 0 / 0 / 0. The reviewer confirmed the head rerun passed.

## Acceptance criteria owned

- [x] Opaque+cutout submissions ≤ constant and RD16 ≈ RD8 → tests/e2e/perf-batch.spec.ts (CI measured RD8: 3, RD16: 12; translucent 1 / 75 reported separately; bound derived from counted pages, see decisions item 6)
- [x] Pixel identity at 3 viewpoints plus an ocean water viewpoint (14-18 translucent submissions vs 347 per-section), diff 0 (batched vs glcheck=draw on the same build; master baseline not used) → tests/e2e/perf-batch.spec.ts
- [x] Batch bucketing, draw-data layout, tint slots, four-frame quarantine, page growth → tests/unit/perf-batch.test.ts

## Screenshots (docs/screenshots/PERF-batch/)

- perf-batch-overworld-daytime.png: narrow rocky canyon, blue sky strip, water at bottom.
- perf-batch-underground-cave.png: stone and ore walls, lava at lower right.
- perf-batch-water-translucent.png: snowy ridge with an arch, blue sky, grass lower left; water is NOT clearly visible, so this viewpoint is weak for translucency.
- perf-batch-ocean-translucent.png: looking steeply down at a shoreline; sand, reeds and grass along the top and right edges, the seabed visible through the water surface and deepening to dark blue at lower left (water covers about 62 % of the frame; viewed).

## CI fixes (run 44764152550 on cb0e723)

- m18a-menus:158 (panorama teardown, glBuffers 20 vs 11): `clearAllMeshes()` calls `TerrainArena.releaseAll()` on all three arenas, deleting every page (buffers + VAO) and dropping quarantined ranges. Pages are recreated lazily. Unit tests cover deletion after four completed frames and `releaseAll` of every page and quarantined range (buffers 0, VAOs 0 afterwards).
- m04:66 (+1 buffer/VAO/texture after the flight): terrain pages were not the cause (page counts stayed 1/1/1 over the flight; probe: buffers 27→31, vaos 23→27, textures 16→20 before the fix). The growth was `EntityRenderer` baking per-creature VAO/buffer/skin texture on first sight. With the small post-batching baseline that exceeds the ±10 % window. `EntityRenderer.warmUp()` now bakes every registered model once at init (called from `WorldManager`); lazy creation is unchanged for existing tests. Probe after the fix: buffers 43→43, vaos 39→39, textures 31→32 (32 <= 34.1). The three-texture draw-data ring and tint atlas never grew in the flight (64 rows, 512 slots) and any growth deletes the old texture. They are not deleted on teardown because `tests/unit/m08b-gpu.test.ts` requires exactly four textures to survive `clearAllMeshes`: the three draw-data ring textures and the tint atlas; at teardown they shrink back to their initial sizes.
- m04:221 flaky driver message "Running out of reserved outsideRenderPass queueSerial": not reproduced locally. The same message also failed `m13h.spec.ts:142` (a visual test with no streaming) on retry-1 in CI run 44802846579, so it is not specific to the new upload pattern. Page and upload sizes unchanged. The A/B table below is unchanged because page sizes did not change.

## Review round 1 fixes

- Historical fence hole, superseded by F: under the fence rule, an idle frame could not advance completion while a prior fence was pending. The frame-count rule counts idle render frames when they do not draw the freed range.
- First terrain: cause was up-front per-page index data (index pattern build 29.7 ms + index uploads 41.0 / 52.4 / 29.6 ms for the opaque / translucent / cutout pages, about 150 ms in total; warmUp 10-18 ms; atlas and draw-data texture 0.1 ms each). Pages above 65,536 quads now fill their index buffer lazily in chunks of at most 32,768 quads. 5-run alternating A/B of createWorld in the same container: branch mean 3348 ms (range 3081-3711), master c7909b1 mean 3317 ms (range 3069-3649).
- Tint atlas 512 initial slots (matches the decision file) with a MAX_TEXTURE_SIZE guard; sorted translucent index reset deferred until quarantine is reclaimed; ocean translucency pixel test; test title reworded.
- "outsideRenderPass queueSerial": still seen in CI (1 of 4 shards this run, m22a heap test, passed on retry; m13h in the previous run). Not reproduced locally and not shown to be unrelated to the new page/upload pattern; master comparison is the reviewer's (0 of 10 runs). Open for the owner.

## What was built

Cross-column multi-draw keyed by (pass, lighting variant, arena page); three-texture ring of per-frame RGBA32F draw-data textures; shared 2D tint atlas; arena reuse with F's four-draw-frame quarantine. G prepares streamed/edit arena data, lazy index fills, tint and draw-data texture updates, translucent sorting writes, LOD uploads, and wireframe indices before the frame's first clear or draw. A debug-only counter reports terrain GPU writes after that boundary. E's temporary 65,536-quad page sizes were reverted; B/C staging changes remain reverted; D's audit added no runtime work.

## SwiftShader A/B after terrain quarantine and upload reordering

| LOD off, settled | e43befd submissions | F submissions | e43befd CPU / upload p95 (ms) | F CPU / upload p95 (ms) |
|---|---:|---:|---|---|
| RD8 | 6 | 6 | 5.2 / 0.2 | 7.7 / 0.1 |
| RD32 | 351 | 351 | 54.8 / <0.1 | 55.0 / 0.1 |

After the G loading fix, CI measured 6 total submissions at RD8 and 88 at RD16. M22a flight measured 11.9 ms CPU and 5.6 ms upload p95. The flight and settled samples use different workloads.

## Decisions

decisions/PERF-batch-terrain.md

## Known limitations

- Translucent submissions and program switches still scale with sorted runs (RD32 LOD off: 396 translucent, 393 switches).
- Pixel baseline is the glcheck=draw path, not master.
- Container-only failures listed by the owner are left to CI.
- `perf-batch.spec.ts:56` flaked once in CI run 44802846579 (RD16 12 vs fixed limit 11). With owner approval its bound is now derived from the counted pages (4 x (opaque+cutout pages) + ceil(drawCalls/4096)) with page caps (RD8 <= 4, RD16 <= 6), `submissions x 50 <= drawCalls` and RD16 drawCalls > 2x RD8 (decisions/PERF-batch-terrain.md item 6).
- `EntityRenderer.warmUp()`: 10.8 ms for 23 models, 23 buffers + 23 VAOs + 23 textures, run once at init (see decisions file).

## Notes for dependent tasks

- Draw-data texture: width 1024, unit 2, two RGBA32F texels per draw (see src/render/terrain-batcher.ts, drawDataTexelCoords).
- Tint atlas on unit 1; slots are freed with columns.
- Arena ranges become reusable after four completed draw frames since their last use; idle frames count when no draw references that range. After lod.draw and drawPlayer the program and VAO caches must be reset.
- Stats: getBatchStats() and getRenderStats().drawSubmissions.

## Review round 2 (queueSerial) (historical)

- Mitigations pushed: (a) one shared `DrawFenceTimeline` fence per draw frame, oldest-fence-only polling, no polling in allocate/free; (c) adjacent streamed vertex chunks merged into one `bufferSubData` per upload batch; tint overflow fix (slot 0 untouched, unit-tested). Draw-data texture was already one `texSubImage2D` of used rows per frame.
- Per rAF frame, RD8 (before -> after): settled fenceSync 4 -> 2, clientWaitSync 12.4 -> 2, bufferSubData 30.5 -> 2, texSubImage2D 2.3 -> 1; flight fenceSync 3.09 -> 1.72, clientWaitSync 17.5 -> 1.72, bufferSubData 15.8 -> 6.3, texSubImage2D 1.95 -> 1.55; copyBufferSubData 0.
- CI "queueSerial" grep per shard log: run 44906419565 (a5db85b, fences only): shard1 38, shard2 0, shard3 0, shard4 19. Run 44911258811 (08483e6, fences + merged uploads): shard1 41, shard2 0, shard3 4, shard4 20. The message is still present, so these mitigations did not remove it; the success condition (2 clean runs) is not met. Not reproducible locally.

## Review round 3 (queueSerial experiments)

Experiment A is implemented on top of `e43befd`: the draw-data texture is a three-texture ring; writes avoid the previous two draw invocations; unchanged data skips `texSubImage2D`; and wireframe metadata is packed before the frame's only upload. The M08b teardown test now asserts exactly four retained textures (three ring textures plus the tint atlas).

Experiment A completed on 04b4ccbc4e1a19a58650853c2271ffa280907d1b in Verify run 45026518265. The grep counts were shard 1: 33, shard 2: 0, shard 3: 0, shard 4: 16 (49 total); shards 1 and 4 failed because the fixture recorded the driver warning. Experiment A did not clear the blocker.

Experiment B completed on `99569e6781702b26bd6416bca5ae64947df746f0` in Verify run 45034508418. The grep counts were shard 1: 272, shard 2: 241, shard 3: 224, shard 4: 375 (1,112 total); all four shards failed because the fixture recorded the driver warning. Experiment B did not clear the blocker.

Experiment C completed on `69f18def147c34b9210b6f402d4b24c5eb4ba7dd` in Verify run 45039393236. The grep counts were shard 1: 277, shard 2: 259, shard 3: 208, shard 4: 402 (1,146 total); all four shards failed because the fixture recorded the driver warning. Experiment C did not clear the blocker.

Experiment D source audit: `main.ts` schedules one `render` callback per `requestAnimationFrame`, and `WorldManager.render()` has one production callsite for `ChunkRenderer.render()`. The debug `FencedErrorDrain.endFrame()` also inserts a fence once per callback, so a prototype count above one `fenceSync` per frame does not imply duplicate terrain rendering. Verify run 45046840628 on `036c585` recorded 277 / 260 / 243 / 391 `queueSerial` lines (1,171 total); all four shards and the aggregate failed on fixture-recorded errors. Its logs also contain 14,430 `copyBufferSubData: Cannot copy into an element buffer destination from a non-element buffer source` warning lines across the shards.

Local B checks: typecheck passed; lint passed with 0 errors and the same 2 pre-existing `no-explicit-any` warnings; 172 unit files passed (1602 tests), after `npm run build:server`; the focused arena/M08b tests passed (22 tests). Local e2e was not run; CI is the evidence for the fixture's GPU behavior.

Local C checks: typecheck passed; lint passed with 0 errors and the same 2 pre-existing warnings; `npm run build` passed; 173 unit files passed (1603 tests), including the new tint-upload staging test. Local e2e was not run.

### SwiftShader A/B measurements (LOD off)

Same local Playwright/Chromium SwiftShader probe on `e43befd` and B: seed `blockcraft-test-seed-42`, creative default world, elevated camera, and a 10-second sample window after streaming settled. Frame counts varied between runs, so both B samples are retained.

| RD | Head | Frames | Submissions | Frame CPU p95 | Upload p95 |
| ---: | --- | ---: | ---: | ---: | ---: |
| 8 | `e43befd` | 13 | 6 | 5.2 ms | 0.2 ms |
| 8 | B, sample 1 | 59 | 6 | 4.0 ms | 0.1 ms |
| 8 | B, sample 2 | 63 | 6 | 4.4 ms | 0.1 ms |
| 32 | `e43befd` | 18 | 351 | 54.8 ms | 0.0 ms |
| 32 | B, sample 1 | 18 | 351 | 59.8 ms | 0.1 ms |
| 32 | B, sample 2 | 15 | 351 | 48.6 ms | 0.1 ms |

RD32's short software-renderer samples make its p95 noisy; the two B runs bracket the `e43befd` result. The 0.0 ms upload value is below the timer's 0.1 ms resolution.

## Review round 4 — B/C reverts and page-size E

Commit `fd99cc1a9b935e5e0418035fe79cbf40953a255b` reverts B and C's runtime changes and removes their staging tests. It restores the A runtime tree: the three-texture draw-data ring and its exact M08b `toBe(4)` assertion remain. D's render-call audit is retained in documentation only; it introduced no runtime work. The A-only revert validation was Verify run 45056603376: 37 / 0 / 0 / 22 queueSerial lines (59 total), with fixture-recorded queueSerial e2e failures and no invalid copyBufferSubData warnings.

Commit `0c17d50d41f09491d0584e1115d8765e4e2e0e7c` is experiment E. Its only code change is setting both initial and maximum page sizes to 65,536 quads for each arena. The RD8 <= 4 and RD16 <= 6 page caps in `perf-batch.spec.ts` are unchanged.

E Verify run 45062912539 failed: shard counts were 38 / 0 / 0 / 18 (56 total). Shard 1 had 4 failed e2e tests due to fixture-recorded queueSerial warnings; its typecheck, lint, placeholder and unit checks passed (171 files / 1,601 tests). Shard 4 had 3 failed attempts of the scaling test and 49 passed; shards 2 and 3 passed. The logs contain no invalid copyBufferSubData warnings or other WebGL warning types. The scaling test fails its existing RD16 opaque+cutout submission limit of 32 first (93–95 measured), so the page-cap assertions are not reached. The measured opaque+cutout page totals are 15 at RD8 and 50 at RD16, over the unchanged caps of 4 and 6; the owner decides whether those caps should change.

### E CI scaling measurements

| RD | Opaque+cutout submissions | Translucent submissions | Opaque / cutout / translucent pages | All arena pages | Total draw submissions |
|---:|---:|---:|---:|---:|---:|
| 8 | 18 | 1 | 13 / 2 / 1 | 16 | 21 |
| 16 | 93–95 across three attempts | 75 | 40 / 10 / 1 | 51 | 170–172 |

The four pixel-identity outputs on shard 4 remained at `diffPerDraw: 0`, including the water view (14 translucent submissions vs 347 per-section submissions). The earlier first-terrain parity results remain recorded in review round 1.

### E SwiftShader comparison (LOD off)

Same seed/camera, settled scene, 10-second sample windows; E data came from a temporary local metric-only probe at commit `0c17d50`.

| RD | Head | Frames | Submissions | Frame CPU p95 | Upload p95 |
|---:|---|---:|---:|---:|---:|
| 8 | `e43befd` | 13 | 6 | 5.2 ms | 0.2 ms |
| 8 | E | 10 | 21 | 9.9 ms | 0.1 ms |
| 32 | `e43befd` | 18 | 351 | 54.8 ms | 0.0 ms |
| 32 | E | 13 | 691 | 58.2 ms | 0.2 ms |

The RD32 SwiftShader samples are short and noisy; 0.0 ms upload is below the timer's 0.1 ms resolution.

### Experiments A–G and final per-shard totals

| Experiment / validation | Commit | Verify run | Shard 1 / 2 / 3 / 4 | Total | Result |
|---|---|---:|---:|---:|---|
| A draw-data ring | `04b4cbc` | 45026518265 | 33 / 0 / 0 / 16 | 49 | QueueSerial remained |
| B arena staging (reverted) | `99569e6` | 45034508418 | 272 / 241 / 224 / 375 | 1,112 | Invalid element-buffer copies |
| C tint staging (reverted) | `69f18de` | 45039393236 | 277 / 259 / 208 / 402 | 1,146 | Reverted with B |
| D docs-only render-call audit | `036c585` | 45046840628 | 277 / 260 / 243 / 391 | 1,171 | No duplicate terrain render; its logs contained 14,430 invalid copyBufferSubData warnings from the contaminated B path |
| B/C revert; A-only validation | `fd99cc1` | 45056603376 | 37 / 0 / 0 / 22 | 59 | QueueSerial remained; no copyBufferSubData warnings |
| E 65,536-quad pages (reverted) | `0c17d50` | 45062912539 | 38 / 0 / 0 / 18 | 56 | QueueSerial and scaling limit remained |
| F four-frame terrain quarantine | `820f0b1` | 45131052066; 45138816097 | 0 / 0 / 0 / 0; 4 / 0 / 0 / 0 | 0; 4 | m04:221 failed all attempts, m04:277 passed on retry |
| G pre-draw terrain upload phase | `ed697bd` | 45156849018 | 0 (partial) / 0 / 0 / 0 | 0 observed | Shard 1 cancelled at 90m. Shard 4 had 4 failed and 2 flaky menu checks. |
| G repeat, same runtime | `a28c38f` (docs) | 45171125451 | 0 (partial) / 0 / 0 / 0 | 0 observed | Shard 1 cancelled at 90m. Shard 4 had 3 failed and 2 flaky menu checks. |
| G loading fix | `7ab0603` | [45708396150](https://github.com/Guna210/BlockCraft/actions/runs/45708396150) (attempt 1) | 0 / 0 / 0 / 0 | 0 | All four shards passed. M21c passed on retry. |

Earlier branch runs: 44906419565 = 57 (38 / 0 / 0 / 19); 44911258811 = 65 (41 / 0 / 4 / 20); 44915434533 = 57 (34 / 0 / 0 / 23). Both G runs had partial shard 1 logs. Acceptance requires two green, complete Verify runs on one code commit.

## Review round 5 — E revert and experiment F

Commit `fa456e120b733236ceb664bc4e6c227d4b21689b` reverts E's six page-size changes and restores the prior opaque, cutout and translucent capacities. Experiment F is commit `820f0b177b3395fc3b47ebe10a278e36772cd404`, based on that revert. It removes `DrawFenceTimeline` and all terrain-path sync calls. Each allocation records its last drawn arena frame; freed ranges and empty pages wait until four completed draw frames have passed since their last draw. Idle calls to `beginDrawFrame` / `endDrawFrame` advance the age when they did not reference the range. The draw-data texture ring (A) and exact M08b `toBe(4)` assertion remain. B/C runtime changes remain reverted; D remains a documentation-only audit.

### F local SwiftShader measurements (LOD off)

Temporary metric-only Playwright probe, same seed and elevated pose, settled scene, 10-second samples. It avoided screenshot/readback work and passed the fixture with zero GL errors.

| RD | `fenceSync` / animation frames | Opaque+cutout submissions | Translucent submissions | Total draw submissions | Frame CPU p95 | Upload p95 |
|---:|---:|---:|---:|---:|---:|---:|
| 8 | 10 / 10 | 3 | 1 | 6 | 7.7 ms | 0.1 ms |
| 16 | 18 / 18 | 11 | 75 | 88 | 37.2 ms | 0.1 ms |
| 32 | 17 / 17 | 19 | 330 | 351 | 55.0 ms | 0.1 ms |

The sampled `fenceSync` rate is one call per frame, from the debug `FencedErrorDrain`; the terrain arena contributes none. LOD was off at all three distances. The RD8 and RD32 values are close to the prior `e43befd` local probe (6 total submissions / 5.2 ms CPU p95 / 0.2 ms upload p95 at RD8; 351 / 54.8 ms / below 0.1 ms at RD32), subject to short SwiftShader samples.

### F Verify results

Verify run `45131052066` on F head `820f0b177b3395fc3b47ebe10a278e36772cd404` completed successfully. Per-shard `queueSerial` grep counts were 0 / 0 / 0 / 0. No other WebGL warning/error, `INVALID_OPERATION`, `copyBufferSubData`, console error, page error or failed request was present. Shards 1–4 passed 53 / 53 / 53 / 52 e2e tests; shard 1 also passed typecheck, lint, placeholders and 1,600 unit tests.

| RD | Opaque+cutout submissions | Translucent submissions | Total submissions | Opaque / cutout / translucent pages |
|---:|---:|---:|---:|---:|
| 8 | 3 | 1 | 6 | 1 / 1 / 1 |
| 16 | 11 | 75 | 88 | 2 / 2 / 1 |

Pixel identity remained exact in all four CI viewpoints (`diffPerDraw: 0`); the ocean view measured 62.0% water coverage and 16 translucent submissions versus 347 per-draw submissions. The repeat F run `45138816097` on docs commit `53db13f` used the same F code as `820f0b1`: shard counts were 4 / 0 / 0 / 0. `m04:221` failed all three attempts; `m04:277` flaked once at 67 px vs 64. F therefore did not satisfy the two-clean-run criterion.

E revert commit `fa456e1` restored the prior page capacities as a separate commit before F. No Verify run was started on the revert-only tree; F is tested on top of it. Run 45131052066 completed successfully on F's exact head `820f0b177b3395fc3b47ebe10a278e36772cd404` (PR merge commit `d045529ad119c0bbb9bfdb777ca43cee9ce1bb15`). The `queueSerial` grep counts were 0 / 0 / 0 / 0; the logs had no WebGL warnings/errors, `INVALID_OPERATION`, `copyBufferSubData`, console errors, page errors, or failed requests. E2E totals were 53 / 53 / 53 / 52 passed on shards 1–4, and shard 1 also passed typecheck, lint, placeholders and all 1,600 unit tests.

CI scaling at RD8 measured 3 opaque+cutout and 1 translucent submission (6 total), with pages 1 / 1 / 1. RD16 measured 11 opaque+cutout and 75 translucent submissions (88 total), with pages 2 / 2 / 1. All four pixel-identity views had `diffPerDraw: 0`; the ocean view measured a 62.0% water share and 16 translucent submissions versus 347 per-draw submissions.

The repeat F run `45138816097` on docs commit `53db13f` used the same F code as `820f0b1`: shard counts were 4 / 0 / 0 / 0. `m04:221` failed all three attempts and `m04:277` flaked once at 67 px vs 64. F therefore did not satisfy the two-clean-run criterion.

## Review round 6 — experiment G: pre-draw terrain upload phase

Commit `ed697bd638b6c232835239d2ef6e094af57fa3f4` moves terrain uploads before the frame's first clear or draw. `WorldManager.prepareFrame` handles streamed and edit mesh uploads and prepares culling/sort state; `ChunkRenderer.prepareFrame` writes sorted translucent indices and the draw-data texture and prepares wireframe indices; tint-atlas and lazy arena/index writes occur during that same upload phase. Streaming pump slices defer GPU uploads until this phase, including create-world and wait-for-terrain barriers. The draw-data ring and F frame-count quarantine remain unchanged. No page sizes, page caps, budgets, pixel tests or fixture thresholds changed.

The debug-only `terrainGpuWritesAfterFirstDraw` counter is exposed in render stats, and `terrainGpuWritesAfterFirstDrawMax` is included in frame stats for flight logs. The render-pass boundary is the first clear or draw. In Verify run `45156849018`, the RD8 settled and RD16 scaling values were 0; M22a's sampled-window maximum was 0 (frame CPU p95 9.8 ms, upload p95 5.9 ms). The shard-1 M04 flight sample also recorded a maximum of 0. RD8 measured 3 opaque+cutout and 1 translucent submission (6 total), with 3 pages (1/1/1); RD16 measured 11 + 75 submissions (88 total), with 5 pages (2/2/1). All four pixel-identity views remained exact (`diffPerDraw: 0`). Both G runs reached the 90-minute limit on shard 1 after repeated e2e timeouts. Shards 2 and 3 passed in both runs.

| Verify | Shard 4 failed | Shard 4 flaky | Shard 4 passed |
|---|---|---|---:|
| [45156849018](https://github.com/Guna210/BlockCraft/actions/runs/45156849018) | M18a:97,138 and M18b:28,92 | M18a:115,158 | 46 |
| [45171125451](https://github.com/Guna210/BlockCraft/actions/runs/45171125451) | M18a:138 and M18b:28,92 | M18a:97,158 | 47 |

### G loading fix

Master lets a pinned region finish uploading while animation callbacks are suspended. The M02c and M03 tests exercise this contract by holding the frame loop before awaiting terrain. G deferred these transfers to an animation callback, so the waiter could stall indefinitely.

Every animation frame now drains terrain uploads before clearing or drawing, including during loading and menu presentation. When a region waiter is pending, the streamer can start the upcoming frame's upload phase in bounded timer slices. Each slice flushes staged vertex writes before the waiter resumes. Only animation or presentation frames advance arena quarantine and draw-data ring bookkeeping. The draw-data texture, sorted indices and wireframe data for the visible list are prepared before the draw that consumes them. Edit results use the same pre-draw transfer phase.

A local SwiftShader probe read the buffers after a flat-world `waitForTerrain(2)` resolved. All 25 nonempty sections had their GPU allocations, with 0 pending uploads and no unflushed vertex ranges. One sampled bucket had nonzero vertex data and its first six indices were `0,1,2,0,2,3`. Both WebGL and the render stats reported 0 GL errors. A placement worker result ready on frame 12 appeared in the replacement mesh on frame 13. A break result ready on frame 13 appeared on frame 14. Both draws recorded 0 late writes. A separate sample took two frames from input to mesh replacement for each action, including worker time.

The preliminary local 47-test group passed 39 tests, including M02b-fix grass sides and the M02c suspended-frame case. M02 wireframe reported an invalid element-buffer binding. All seven M18 menu checks timed out waiting for the world-list canvas to hide, and its accessible label reported `Light block data missing` at a column coordinate. These were startup errors before entry into the world.

G also ran camera-driven streamer and LOD planning while `initialLoadCount` was positive. During world startup the camera could still point at the outgoing panorama (column −4,−14). Its plan could free spawn columns before the lighting worker consumed their block data. The fix restores master's loading guard on camera-driven planning. Pinned generation and uploads still run. The wireframe fix first binds each new line index buffer to `ELEMENT_ARRAY_BUFFER` on the default VAO so WebGL accepts it as an element buffer during the draw.

The corrected M18a/M18b and M02 wireframe run passed all 9 tests. M07 edit verification passed. Typecheck, lint and placeholders passed with two existing lint warnings. The full local unit suite passed all 1,603 tests across 172 files. MILESTONE=M22 ran all 12 browser tests. Eleven passed. M22a flight reported frame CPU p95 of 26.4 ms (budget 22 ms) and upload p95 of 10.3 ms (budget 8 ms), with 0 late writes. The local flight sampled 39 frames.

Verify [45708396150](https://github.com/Guna210/BlockCraft/actions/runs/45708396150) attempt 1 passed on `7ab0603`. All four shard jobs and the aggregate succeeded, with 0 / 0 / 0 / 0 `queueSerial` lines. Shards 1–3 each passed 53 browser tests. Shard 4 passed 51 on their first attempt and M21c multiplayer block replication on retry (500 ms timeout). All four batching views had zero differing pixels. RD8 and RD16 measured 3 + 1 and 11 + 75 opaque/cutout + translucent submissions, on 1/1/1 and 2/2/1 pages. The late-write counter was 0 at RD8 settled and its maximum over M22a flight was 0. Flight CPU/upload p95 were 11.9/5.6 ms and first terrain appeared at 2,271 ms.

Full local Verify on the fix completed with 206 passing browser tests and five failures. The 211-test log contained zero `queueSerial` lines. All M02/M02b-fix, M03, M18a/M18b and PERF-batch cases passed. M07 recorded a break on frame 48 and the replacement mesh on frame 49. M04:66 measured a 54.6 ms maximum streaming task against 50 ms. M17b:278 reported missing light input at column (47,44) after teleporting. The lighting snapshot looks up columns across timer yields, a path also present on master. M21b multiplayer vitals and M21c block replication timed out. M22a:143 exceeded the local flight budgets (36.2 ms frame CPU p95 and 9.9 ms upload p95 across 59 frames). Its maximum late-write count was 0.

In a serial retry of the five local failures, M17b, M21b and M22a passed. M22a flight measured 18.2 ms frame CPU p95 and 6.2 ms upload p95 over 48 frames, with zero late writes. M04:66 failed its 50 ms worst-frame limit at 53.5 ms. M21c failed its remote-player movement check. The retry log also contained zero `queueSerial` lines.
