# PERF-batch — Terrain draw batching

Status: incomplete — the ANGLE `outsideRenderPass queueSerial` warning remains in Verify.
Depends on: M22a, M22b, M22c
Historical full Verify: run 44899573773 on head 8f02add was green before the queueSerial review rounds. Master had 0 matches in the last 10 runs; earlier branch runs in this investigation had 57 and 65 matches.
Controlled experiments A-D are listed below. A reduced the count to 49 but did not clear the warning; B and C increased it, and D's render-call audit found no duplicate production terrain render. D Verify run 45046840628 failed on all four shards and the aggregate job.
Local final code checks (through C; D changed documentation only): typecheck and build passed; lint passed with 0 errors and 2 pre-existing `no-explicit-any` warnings; all 173 unit files / 1603 tests passed after `npm run build:server`. Focused tint-upload, perf-batch and M08b tests passed 17/17. Local e2e was not run; CI is the GPU-fixture evidence.
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
- m04:66 (+1 buffer/VAO/texture after the flight): terrain pages were not the cause (page counts stayed 1/1/1 over the flight; probe: buffers 27→31, vaos 23→27, textures 16→20 before the fix). The growth was `EntityRenderer` baking per-creature VAO/buffer/skin texture on first sight. With the small post-batching baseline that exceeds the ±10 % window. `EntityRenderer.warmUp()` now bakes every registered model once at init (called from `WorldManager`); lazy creation is unchanged for existing tests. Probe after the fix: buffers 43→43, vaos 39→39, textures 31→32 (32 <= 34.1). The three-texture draw-data ring and tint atlas never grew in the flight (64 rows, 512 slots) and any growth deletes the old texture. They are not deleted on teardown because `tests/unit/m08b-gpu.test.ts` requires exactly four textures to survive `clearAllMeshes`: the three draw-data ring textures and the tint atlas; at teardown they shrink back to their initial sizes.
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
| 45034508418 | 99569e6 | B: arena pre-draw staging copies | 272 | 241 | 224 | 375 | Warning remained; all four shards failed on fixture-recorded driver warnings |
| 45039393236 | 69f18de | C: fence-gated tint-atlas uploads | 277 | 259 | 208 | 402 | Warning remained; all four shards failed on fixture-recorded driver warnings |
| 45046840628 | 036c585 | D: render-call audit | 277 | 260 | 243 | 391 | Warning remained; all shards and aggregate failed; staging-copy GL warning also present |

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

### Final per-shard totals

Per-shard `queueSerial` totals: run 44906419565 = 57 (38 + 0 + 0 + 19); run 44911258811 = 65 (41 + 0 + 4 + 20); run 44915434533 = 57 (34 + 0 + 0 + 23); run 45026518265 / A = 49 (33 + 0 + 0 + 16); run 45034508418 / B = 1,112 (272 + 241 + 224 + 375); run 45039393236 / C = 1,146 (277 + 259 + 208 + 402); run 45046840628 / D = 1,171 (277 + 260 + 243 + 391). D's shard logs also contain 14,430 invalid `copyBufferSubData` warning lines. The M08b exact texture-count update is coupled to the draw-data ring and must be reverted if the ring is removed.
