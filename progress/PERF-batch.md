# PERF-batch — Terrain draw batching

Status: incomplete
Depends on: M22a, M22b, M22c
Full verify: PR CI run 44899573773 on head 8f02add (https://github.com/Guna210/BlockCraft/actions/runs/44899573773), all four shards and the aggregate `verify` job green. Unit: Tests 1595 passed (1595). Playwright per shard: 1/4 53 passed (0 flaky); 2/4 53 passed (0 flaky); 3/4 53 passed (0 flaky); 4/4 51 passed, 1 flaky (m22a-budgets.spec.ts:186 heap test, "outsideRenderPass queueSerial" driver message, passed on retry).
Local (this session, after the CI-fix commit): typecheck ✓ · lint ✓ (0 errors) · unit: the changed files (perf-batch, m08b-gpu, m13a-render, tint) 25 passed; full unit run only differed from CI on m21b-fix-containers (needs `dist-server`, environment). Local e2e is unusable in this container: every test fails at fixture teardown on the driver message "GPU stall due to ReadPixels" (also on m01 and on the untouched previous commit), and streaming-idle waits time out. m18a-menus:158, m04, m22 and perf-batch test bodies ran to their asserts; the GL resource counts for the m04 flight were checked with a temporary probe (below). m21c fails the same way on the previous commit locally.

## Acceptance criteria owned

- [x] Opaque+cutout submissions ≤ constant and RD16 ≈ RD8 → tests/e2e/perf-batch.spec.ts (CI measured RD8: 3, RD16: 12; translucent 1 / 75 reported separately; bound derived from counted pages, see decisions item 6)
- [x] Pixel identity at 3 viewpoints plus an ocean water viewpoint (14-18 translucent submissions vs 347 per-section), diff 0 (batched vs glcheck=draw on the same build; master baseline not used) → tests/e2e/perf-batch.spec.ts
- [x] Batch bucketing, draw-data layout, tint slots, fence quarantine, page growth → tests/unit/perf-batch.test.ts

## Screenshots (docs/screenshots/PERF-batch/)

- perf-batch-overworld-daytime.png: narrow rocky canyon, blue sky strip, water at bottom.
- perf-batch-underground-cave.png: stone and ore walls, lava at lower right.
- perf-batch-water-translucent.png: snowy ridge with an arch, blue sky, grass lower left; water is NOT clearly visible, so this viewpoint is weak for translucency.
- perf-batch-ocean-translucent.png: looking steeply down at a shoreline; sand, reeds and grass along the top and right edges, the seabed visible through the water surface and deepening to dark blue at lower left (water covers about 62 % of the frame; viewed).

## CI fixes (run 44764152550 on cb0e723)

- m18a-menus:158 (panorama teardown, glBuffers 20 vs 11): `clearAllMeshes()` now calls `TerrainArena.releaseAll()` on all three arenas, which deletes every page (buffers + VAO), quarantined range and pending fence without waiting. Pages are recreated lazily. Unit tests: "deletes a page that was emptied, quarantined, then signalled" and "releaseAll deletes every page, quarantined range and pending fence without waiting" (buffers 0, vaos 0 afterwards).
- m04:66 (+1 buffer/VAO/texture after the flight): terrain pages were not the cause (page counts stayed 1/1/1 over the flight; probe: buffers 27→31, vaos 23→27, textures 16→20 before the fix). The growth was `EntityRenderer` baking per-creature VAO/buffer/skin texture on first sight. With the small post-batching baseline that exceeds the ±10 % window. `EntityRenderer.warmUp()` now bakes every registered model once at init (called from `WorldManager`); lazy creation is unchanged for existing tests. Probe after the fix: buffers 43→43, vaos 39→39, textures 31→32 (32 <= 34.1). The draw-data texture and tint atlas never grew in the flight (64 rows, 512 slots) and any growth deletes the old texture. They are not deleted on teardown because `tests/unit/m08b-gpu.test.ts` requires two textures to survive `clearAllMeshes`; at teardown they shrink back to their initial sizes.
- m04:221 flaky driver message "Running out of reserved outsideRenderPass queueSerial": not reproduced locally. The same message also failed `m13h.spec.ts:142` (a visual test with no streaming) on retry-1 in CI run 44802846579, so it is not specific to the new upload pattern. Page and upload sizes unchanged. The A/B table below is unchanged because page sizes did not change.

## Review round 1 fixes

- Fence hole: an idle draw frame no longer advances completedDrawFrame while a fence is pending (unit test added).
- First terrain: cause was up-front per-page index data (index pattern build 29.7 ms + index uploads 41.0 / 52.4 / 29.6 ms for the opaque / translucent / cutout pages, about 150 ms in total; warmUp 10-18 ms; atlas and draw-data texture 0.1 ms each). Pages above 65,536 quads now fill their index buffer lazily in chunks of at most 32,768 quads. 5-run alternating A/B of createWorld in the same container: branch mean 3348 ms (range 3081-3711), master c7909b1 mean 3317 ms (range 3069-3649).
- Tint atlas 512 initial slots (matches the decision file) with a MAX_TEXTURE_SIZE guard; sorted translucent index reset deferred until quarantine is reclaimed; ocean translucency pixel test; test title reworded.
- "outsideRenderPass queueSerial": still seen in CI (1 of 4 shards this run, m22a heap test, passed on retry; m13h in the previous run). Not reproduced locally and not shown to be unrelated to the new page/upload pattern; master comparison is the reviewer's (0 of 10 runs). Open for the owner.

## What was built

Cross-column multi-draw keyed by (pass, lighting variant, arena page); per-frame RGBA32F draw-data texture (texelFetch at u_drawBase + gl_DrawID); shared 1024-px-wide 2D tint atlas (slot*2 grass, slot*2+1 foliage; slot 0 plains); arena free-range reuse with fenceSync quarantine; larger pages (1,048,576 / 524,288 / 262,144 quads for opaque / cutout / translucent).

## A/B (same container, SwiftShader)

| Case | Metric | Branch | Master |
|---|---|---|---|
| RD8 | submissions | 6 | 341 |
| RD8 | frame CPU p95 | 3.8 ms | 6.6 ms |
| RD8 | program switches / tex binds / VAO binds | 2 / 3 / 3 | 6 / 465 / 343 |
| RD8 | arena pages | 3 | 233 |
| RD32 LOD on | submissions | 22 | 750 |
| RD32 LOD on | frame CPU p95 | 8.1 ms | 12.3 ms |
| RD32 LOD on | switches / tex / VAO | 17 / 3 / 5 | 21 / 971 / 752 |
| RD32 LOD on | pages | 4 | 481 |
| RD32 LOD off | submissions | 417 | 6600 |
| RD32 LOD off | frame CPU p95 | 56.8 ms | 182.4 ms |
| RD32 LOD off | switches / tex / VAO | 393 / 3 / 31 | 395 / 8389 / 6602 |
| RD32 LOD off | pages | 10 | 2977 |

Upload p95 was 0.1 ms in all branch cases.

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
- Arena ranges are quarantined until the fence inserted at endDrawFrame signals; after lod.draw and drawPlayer the program and VAO caches must be reset.
- Stats: getBatchStats() and getRenderStats().drawSubmissions.

## Review round 2 (queueSerial) — status: NOT RESOLVED

- Mitigations pushed: (a) one shared `DrawFenceTimeline` fence per draw frame, oldest-fence-only polling, no polling in allocate/free; (c) adjacent streamed vertex chunks merged into one `bufferSubData` per upload batch; tint overflow fix (slot 0 untouched, unit-tested). Draw-data texture was already one `texSubImage2D` of used rows per frame.
- Per rAF frame, RD8 (before -> after): settled fenceSync 4 -> 2, clientWaitSync 12.4 -> 2, bufferSubData 30.5 -> 2, texSubImage2D 2.3 -> 1; flight fenceSync 3.09 -> 1.72, clientWaitSync 17.5 -> 1.72, bufferSubData 15.8 -> 6.3, texSubImage2D 1.95 -> 1.55; copyBufferSubData 0.
- CI "queueSerial" grep per shard log: run 44906419565 (a5db85b, fences only): shard1 38, shard2 0, shard3 0, shard4 19. Run 44911258811 (08483e6, fences + merged uploads): shard1 41, shard2 0, shard3 4, shard4 20. The message is still present, so these mitigations did not remove it; the success condition (2 clean runs) is not met. Not reproducible locally.

## Review round 3 (queueSerial experiments)

Experiment A is implemented on top of `e43befd`: the draw-data texture is a three-texture ring; writes avoid the previous two draw invocations; unchanged data skips `texSubImage2D`; and wireframe metadata is packed before the frame's only upload. The M08b teardown test now asserts exactly four retained textures (three ring textures plus the tint atlas).

| Run | Head | Experiment | Shard 1 | Shard 2 | Shard 3 | Shard 4 | Result |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| 44906419565 | a5db85b | Previous fence-only mitigation | 38 | 0 | 0 | 19 | Warning remained |
| 44911258811 | 08483e6 | Previous fence + merged-upload mitigation | 41 | 0 | 4 | 20 | Warning remained |
| 44915434533 | e43befd | Baseline before experiment A | 34 | 0 | 0 | 23 | Warning remained |
| 45026518265 | 04b4cbc | A: draw-data texture ring | 33 | 0 | 0 | 16 | Warning remained; shards 1 and 4 failed on fixture-recorded driver warning |
| Pending | pending | B: arena pre-draw staging copies | pending | pending | pending | pending | Not pushed |

Experiment A completed on 04b4ccbc4e1a19a58650853c2271ffa280907d1b in Verify run 45026518265. The grep counts were shard 1: 33, shard 2: 0, shard 3: 0, shard 4: 16 (49 total); shards 1 and 4 failed because the fixture recorded the driver warning. Experiment A did not clear the blocker.

Local B checks: typecheck passed; lint passed with 0 errors and the same 2 pre-existing `no-explicit-any` warnings; 172 unit files passed (1602 tests), after `npm run build:server`; the focused arena/M08b tests passed (22 tests). Local e2e was not run; CI is the evidence for the fixture's GPU behavior.

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

### Final per-shard totals

Per-shard `queueSerial` totals so far: run 44906419565 = 57 (38 + 0 + 0 + 19); run 44911258811 = 65 (41 + 0 + 4 + 20); run 44915434533 = 57 (34 + 0 + 0 + 23); run 45026518265 / experiment A = 49 (33 + 0 + 0 + 16). B and any later experiment runs remain pending. The M08b exact texture-count update is coupled to the draw-data ring and must be reverted if the ring is removed.
