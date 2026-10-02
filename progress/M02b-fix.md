# M02b-fix — Side-face texture orientation and tint sampling

Status: verified
Depends on: M02b, M02c, M03c
Full verify (this session): typecheck ✓ · lint ✓ · placeholders ✓ · unit 121 passed · e2e 17 passed · console errors 0

## Acceptance criteria owned

- [x] Side-face texture orientation (tile row 0 at TOP, v=0 at top, v=H at bottom, u increases left-to-right from outside) → `tests/unit/greedy.test.ts`
- [x] Rotated log bark ridge orientations running along log axis for X-, Y-, Z-axis logs → `tests/unit/greedy.test.ts`
- [x] Tint lookup for block owner `tintTexelForFace` → `tests/unit/tint.test.ts`
- [x] Tint texture caching in `ColumnTintCache` with mock GL (4 uploads, 2 frees) → `tests/unit/tint.test.ts`
- [x] Grass side face E2E visual verification (top 20% mean G-R is 31.3 higher than bottom 50%) → `tests/e2e/m02b-fix.spec.ts`

## Screenshots (docs/screenshots/M02b-fix/)

- `m02b-fix-grass-side.png`: Frontal horizontal view of a 3×3 grass block wall centered at eye height. The top of the grass block displays the green grass fringe, while the bottom portion displays the untinted brown dirt base.

## Before/After UV Table for Quad Vertices

| Face | Direction | Normal | Unrotated Vert 0 (BL) (u, v) | Unrotated Vert 1 (BR) (u, v) | Unrotated Vert 2 (TR) (u, v) | Unrotated Vert 3 (TL) (u, v) |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | East (+X) | (+1, 0, 0) | Before: (0, 0)<br>After: (0, H) | Before: (W, 0)<br>After: (W, H) | Before: (W, H)<br>After: (W, 0) | Before: (0, H)<br>After: (0, 0) |
| 1 | West (-X) | (-1, 0, 0) | Before: (0, 0)<br>After: (0, H) | Before: (W, 0)<br>After: (W, H) | Before: (W, H)<br>After: (W, 0) | Before: (0, H)<br>After: (0, 0) |
| 2 | Top (+Y) | (0, +1, 0) | Before: (0, 0)<br>After: (0, 0) | Before: (W, 0)<br>After: (W, 0) | Before: (W, H)<br>After: (W, H) | Before: (0, H)<br>After: (0, H) |
| 3 | Bottom (-Y) | (0, -1, 0) | Before: (0, 0)<br>After: (0, 0) | Before: (W, 0)<br>After: (W, 0) | Before: (W, H)<br>After: (W, H) | Before: (0, H)<br>After: (0, H) |
| 4 | South (+Z) | (0, 0, +1) | Before: (0, 0)<br>After: (0, H) | Before: (W, 0)<br>After: (W, H) | Before: (W, H)<br>After: (W, 0) | Before: (0, H)<br>After: (0, 0) |
| 5 | North (-Z) | (0, 0, -1) | Before: (0, 0)<br>After: (0, H) | Before: (W, 0)<br>After: (W, H) | Before: (W, H)<br>After: (W, 0) | Before: (0, H)<br>After: (0, 0) |

## E2E Per-Test Timing Comparison (`m02.spec.ts`)

| Test Name | Duration Before | Duration After |
| --- | --- | --- |
| `getBlock, setBlock and fill debug API methods operate correctly on world` | 0.7s | 0.7s |
| `createWorld generates flat world, meshes in workers, and renders continuous grass plane` | 9.4s | 9.2s |
| `wireframe mode displays merged quads overlay` | 9.4s | 9.3s |
| `WorkerPool uses real Web Workers, transfers padded buffers, and exposes workerCount` | 7.7s | 7.5s |
| `calling createWorld a second time clears old promises and re-meshes new world` | 13.3s | 13.1s |

## What was built

- `src/mesh/greedy.ts`: Fixed side-face UV orientation in `emitQuad` so that `v = 0` is at top vertices (vert 3, vert 2) and `v = H` at bottom vertices (vert 0, vert 1) for all four side faces (`f` in 0, 1, 4, 5) when `isUVRotated` is false, with `u` increasing left-to-right as seen from outside. Corrected `isUVRotated` logic for X- and Z-axis logs so bark ridges (texture V) run along the log axis across all four long faces.
- `src/render/tint-utils.ts`: Exported pure helper `tintTexelForFace(worldPos, normal)` calculating the 16×16 column tint map texel coordinates `[0..15]` for the block that owns the face using `floor(v_worldPos - 0.5 * v_normal) % 16`.
- `src/render/chunk-renderer.ts`: Updated `FS_CHUNK` to sample column tints using `texelFetch` with the block owner position formula, pointing to `tintTexelForFace` in a comment. Integrated `ColumnTintCache` to avoid redundant texture bindings and `texImage2D` uploads per frame.
- `src/render/tint-cache.ts`: Built `ColumnTintCache` managing per-column WebGL textures created and deleted via `GLWrapper` resource wrappers when section meshes are added or removed.
- `tests/unit/greedy.test.ts`: Added unit tests verifying side-face UV orientation (v=0 at top, v=H at bottom, u increasing left-to-right) for single grass blocks, 1×3×1 merged grass columns, and X-, Y-, Z-axis logs.
- `tests/unit/tint.test.ts`: Added unit tests verifying `tintTexelForFace` for all 6 faces in positive and negative world coordinates, and `ColumnTintCache` texture creation, upload, and free lifecycle with mock GL (asserting 4 uploads and 2 frees).
- `tests/e2e/m02b-fix.spec.ts`: Added E2E test building a 3×3 grass block wall, positioning camera horizontally at center block eye height, saving `artifacts/m02/m02b-fix-grass-side.png` and copying to `docs/screenshots/M02b-fix/m02b-fix-grass-side.png`, asserting top 20% mean (G - R) is at least 15 higher than bottom 50%.

## Decisions (links to decisions/ files)

- None.

## Known limitations

- None.

## Notes for dependent tasks

- `tintTexelForFace` in `src/render/tint-utils.ts` and `ColumnTintCache` in `src/render/tint-cache.ts` provide exact block owner tint lookups and cached WebGL textures for all terrain rendering passes.
