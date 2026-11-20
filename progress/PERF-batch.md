# PERF-batch — Terrain draw batching

Status: verified
Depends on: M22a, M22b, M22c
Full verify: PR CI (owner override; no local full verify)
Local (this session): typecheck ✓ · lint ✓ (0 errors) · placeholders ✓ · unit: Test Files 170 passed (170), Tests 1588 passed (1588) · e2e perf-batch 2 passed; m22a 4 passed; m22b 1–3 passed; m22c 5 passed; m01/m02/m05/m08*/m12 21 passed. m04 and m21c e2e not run locally (left to CI).

## Acceptance criteria owned

- [x] Opaque+cutout submissions ≤ constant and RD16 ≈ RD8 → tests/e2e/perf-batch.spec.ts (RD8: 3, RD16: 11; translucent 1 / 75 reported separately)
- [x] Pixel identity at 3 viewpoints, diff 0 (batched vs glcheck=draw on the same build; master baseline not used) → tests/e2e/perf-batch.spec.ts
- [x] Batch bucketing, draw-data layout, tint slots, fence quarantine, page growth → tests/unit/perf-batch.test.ts

## Screenshots (docs/screenshots/PERF-batch/)

- perf-batch-overworld-daytime.png: narrow rocky canyon, blue sky strip, water at bottom.
- perf-batch-underground-cave.png: stone and ore walls, lava at lower right.
- perf-batch-water-translucent.png: snowy ridge with an arch, blue sky, grass lower left; water is NOT clearly visible, so this viewpoint is weak for translucency.

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

## Notes for dependent tasks

- Draw-data texture: width 1024, unit 2, two RGBA32F texels per draw (see src/render/terrain-batcher.ts, drawDataTexelCoords).
- Tint atlas on unit 1; slots are freed with columns.
- Arena ranges are quarantined until the fence inserted at endDrawFrame signals; after lod.draw and drawPlayer the program and VAO caches must be reset.
- Stats: getBatchStats() and getRenderStats().drawSubmissions.
