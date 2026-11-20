# PERF-batch — Terrain draw batching

Status: verified
Depends on: M22a, M22b, M22c
Full verify: PR CI run on head 9b01bd0 (https://github.com/Guna210/BlockCraft/actions/runs/44802846579), all four shards and the aggregate `verify` job green. Unit: Test Files 170 passed (170), Tests 1591 passed (1591). Playwright per shard: 1/4 53 passed (0 flaky); 2/4 53 passed (0 flaky); 3/4 51 passed, 1 flaky (m13h.spec.ts:142, passed on retry); 4/4 51 passed, 1 flaky (perf-batch.spec.ts:56, passed on retry).
Local (this session, after the CI-fix commit): typecheck ✓ · lint ✓ (0 errors) · unit: the changed files (perf-batch, m08b-gpu, m13a-render, tint) 25 passed; full unit run only differed from CI on m21b-fix-containers (needs `dist-server`, environment). Local e2e is unusable in this container: every test fails at fixture teardown on the driver message "GPU stall due to ReadPixels" (also on m01 and on the untouched previous commit), and streaming-idle waits time out. m18a-menus:158, m04, m22 and perf-batch test bodies ran to their asserts; the GL resource counts for the m04 flight were checked with a temporary probe (below). m21c fails the same way on the previous commit locally.

## Acceptance criteria owned

- [x] Opaque+cutout submissions ≤ constant and RD16 ≈ RD8 → tests/e2e/perf-batch.spec.ts (RD8: 3, RD16: 11; translucent 1 / 75 reported separately)
- [x] Pixel identity at 3 viewpoints, diff 0 (batched vs glcheck=draw on the same build; master baseline not used) → tests/e2e/perf-batch.spec.ts
- [x] Batch bucketing, draw-data layout, tint slots, fence quarantine, page growth → tests/unit/perf-batch.test.ts

## Screenshots (docs/screenshots/PERF-batch/)

- perf-batch-overworld-daytime.png: narrow rocky canyon, blue sky strip, water at bottom.
- perf-batch-underground-cave.png: stone and ore walls, lava at lower right.
- perf-batch-water-translucent.png: snowy ridge with an arch, blue sky, grass lower left; water is NOT clearly visible, so this viewpoint is weak for translucency.

## CI fixes (run 44764152550 on cb0e723)

- m18a-menus:158 (panorama teardown, glBuffers 20 vs 11): `clearAllMeshes()` now calls `TerrainArena.releaseAll()` on all three arenas, which deletes every page (buffers + VAO), quarantined range and pending fence without waiting. Pages are recreated lazily. Unit tests: "deletes a page that was emptied, quarantined, then signalled" and "releaseAll deletes every page, quarantined range and pending fence without waiting" (buffers 0, vaos 0 afterwards).
- m04:66 (+1 buffer/VAO/texture after the flight): terrain pages were not the cause (page counts stayed 1/1/1 over the flight; probe: buffers 27→31, vaos 23→27, textures 16→20 before the fix). The growth was `EntityRenderer` baking per-creature VAO/buffer/skin texture on first sight. With the small post-batching baseline that exceeds the ±10 % window. `EntityRenderer.warmUp()` now bakes every registered model once at init (called from `WorldManager`); lazy creation is unchanged for existing tests. Probe after the fix: buffers 43→43, vaos 39→39, textures 31→32 (32 <= 34.1). The draw-data texture and tint atlas never grew in the flight (64 rows, 512 slots) and any growth deletes the old texture. They are not deleted on teardown because `tests/unit/m08b-gpu.test.ts` requires two textures to survive `clearAllMeshes`; at teardown they shrink back to their initial sizes.
- m04:221 flaky driver message "Running out of reserved outsideRenderPass queueSerial": not reproduced locally. The same message also failed `m13h.spec.ts:142` (a visual test with no streaming) on retry-1 in CI run 44802846579, so it is not specific to the new upload pattern. Page and upload sizes unchanged. The A/B table below is unchanged because page sizes did not change.

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
- `perf-batch.spec.ts:56` flaked once in CI (RD16 opaque+cutout submissions 12 vs limit 11 = RD8 3 + 8); passed on retry. The margin is tight but the test was not changed. Owner decision needed if it recurs.

## Notes for dependent tasks

- Draw-data texture: width 1024, unit 2, two RGBA32F texels per draw (see src/render/terrain-batcher.ts, drawDataTexelCoords).
- Tint atlas on unit 1; slots are freed with columns.
- Arena ranges are quarantined until the fence inserted at endDrawFrame signals; after lod.draw and drawPlayer the program and VAO caches must be reset.
- Stats: getBatchStats() and getRenderStats().drawSubmissions.
