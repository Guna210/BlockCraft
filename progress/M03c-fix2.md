# M03c-fix2 — Surface border seam and m03c e2e headroom

Status: verified
Depends on: M03c, M03d (the surface stage runs before the cave stage)
Full verify (this session): typecheck ✓ · lint ✓ (0 errors, 2 existing `no-explicit-any` warnings in files this task does not touch) · placeholders ✓ · unit 131 passed (26 files) · e2e 19 passed (0 flaky, 0 skipped) · console errors 0

This is an owner-sanctioned fix task that is not in SPEC.md Appendix E. It touches `src/gen/surface.ts`, adds `src/gen/terrain-height.ts`, and edits `tests/e2e/m03c.spec.ts`. It does not touch `src/gen/terrain.ts`, `noise.ts`, `caves.ts`, `world-manager.ts`, `src/workers/`, `m03.spec.ts`, `m03d.spec.ts` or the harness.

## Items owned

- [x] 1. Seam fixed: cliff-check neighbours now come from an 18×18 height grid → `src/gen/surface.ts`
- [x] 2. Seam unit test, under 20 s, fails on master → `tests/unit/surface-seam.test.ts` › "stone-topped fraction on flat non-mountain land is < 1% for border and interior cells (standard | probe-seed-gamma)". Run on master (surface stage reverted) both cases failed with 47.21 % and 44.88 %. Run time of the file with the fix: 6.5 s + 6.6 s + 1.0 s + 1.2 s = 15.2 s of test time, 16.3 s wall clock.
- [x] 3. m03c e2e headroom, border-tint hue assertion, no writes into `docs/` → `tests/e2e/m03c.spec.ts`
- [x] 4. Flat-grassland border screenshot with `assertNotBlank` and `assertNoMissingTexture` → `tests/e2e/m03c.spec.ts` › "M03c-fix2: natural flat grassland shows no stone seam across a chunk border". Run on master (surface stage reverted) it failed with 16 of 16 border-column tops equal to `stone`.
- [x] 5. This file, with the three required records below.

## Stone-topped fraction (unit test, 24×24 chunk columns from chunk (0, 0), cells with true slope ≤ 1, non-mountain land, no water above)

Eligible cells exclude every biome whose own surface rule puts stone on top (`frost_peaks`, `stony_heights` and also `stony_shore`, which is not a mountain but legitimately has a stone top). The outermost ring of the region is skipped because its neighbours were not generated.

| Seed | Cells | Before (master) | After |
| --- | --- | --- | --- |
| `blockcraft-test-seed-42` | border | 10892 / 23070 = 47.21 % | 0 / 23070 = 0.00 % |
| `blockcraft-test-seed-42` | interior | 0 / 77994 = 0.00 % | 0 / 77994 = 0.00 % |
| `probe-seed-gamma` | border | 10666 / 23765 = 44.88 % | 0 / 23765 = 0.00 % |
| `probe-seed-gamma` | interior | 0 / 80972 = 0.00 % | 0 / 80972 = 0.00 % |

The test also asserts at least 1000 eligible border cells and 10 000 eligible interior cells, so it cannot pass on an empty sample. Two more tests in the file: `sampleTerrainTopY` equals the real shape-stage top block exactly (more than 1000 sampled cells, both seeds), and a 2×2 block of columns generated in forward and reverse order is identical block for block. Worker-count independence is still covered by `m03.spec.ts` (world hash identical for 1, 2 and 4 workers), which passed in both verify runs.

## Deviation from the prompt: the height function

The prompt asked for the ring of the 18×18 grid to come from the terrain-shape height function "the way `caves.ts` pads its input". That function (`sampleTerrainClimate(...).surfaceHeight`) is only the 2D target height; the 3D density noise moves the real top by up to ±16 blocks. With that ring the border fraction was still 34.44 % (standard seed) and 38.97 % (`probe-seed-gamma`), so the required test could not pass. I added `src/gen/terrain-height.ts`, which repeats the density rule for one column. Details, the options I rejected and the drift guard are in [`decisions/M03c-fix2-terrain-top.md`](../decisions/M03c-fix2-terrain-top.md). The cleaner fix is an export from `terrain.ts`, which this task was not allowed to make.

## m03c e2e durations

Seconds, from the Playwright JSON reporter, default 2 workers. "Before" is the original spec on the original code, run alone. "After, alone" is the new spec on the new code, run alone (two runs). "After, in verify" is the final full `npm run verify` (the Biome Grass Tinting test overlapped the 114.5 s `m03.spec.ts` world-hash test there). The owner measured 178.7 s and 113.4 s for the two long tests on their VM.

| Test | Before | After, alone | After, in verify |
| --- | --- | --- | --- |
| Biome Grass Tinting E2E | 136.5 | 7.1, 7.1 | 22.1 |
| M01c test scene grass top face green hue assertion | 0.9 | 0.8, 0.7 | 0.8 |
| Chunk border grass tint continuity E2E | 120.7 | 5.3, 5.2 | 5.7 |
| M03c-fix2 flat grassland border screenshot (new) | n/a | 4.1, 4.3 | 6.4 |

What I changed to get there, and what did not work on its own:

- `createWorld` always generates, lights and meshes radius 4 (81 columns), which this task may not change. With the game's `requestAnimationFrame` loop running it takes about 24 s alone and about 40 s next to another test, because every SwiftShader frame that draws the freshly uploaded terrain takes seconds of main-thread time and starves the workers.
- Reducing the mesh radius (25 columns to 9, then to the edited columns only), dropping the redundant `waitForTerrain(4)` and clearing the spawn meshes before framing was not enough: the two long tests still took 67.1 s and 52.6 s (Tinting) and 55.1 s and 61.3 s (border) in two runs, and the new test 47.7 s and 47.0 s.
- The spec now holds back the page's `requestAnimationFrame` (`holdFrames`) until each screenshot and draws frames on demand (`renderFrames`). `createWorld` then takes about 1.5 s. This is test code only; no game code knows about it. It goes beyond what the prompt suggested, so please check you are happy with it. No timeout was changed, and every assertion and threshold of the existing tests is unchanged.
- Observed while doing this: the first game frame after a long pause renders every surface with the wrong tint and no texture detail (the tuft detail is missing and the stone and dirt come out green). From the second frame on the image is stable, so `renderFrames` draws three. It does not affect normal play, but a screenshot taken one frame after a long stall would be wrong.
- The grass patches in the Tinting test are now 13×13 and clamped so that the patch and the camera stay inside one chunk (the old 21×21 patch around the located point could straddle four chunks). The mean grass colours moved slightly: savanna `[72.3, 66.0, 28.2]` → `[70.5, 62.0, 26.8]`, rainforest `[24.7, 75.3, 25.9]` → `[25.1, 75.7, 26.1]`, max channel difference 47.6 → 45.4 (threshold 20).
- The spec no longer copies into `docs/screenshots/M03c/`. After the final verify run `git status` showed no modified committed PNG. Screenshots go to `artifacts/m03/` only.

Border tint test (item 3): the old camera at (16, 85, 0) faces −z at pitch −0.8, so by my calculation its view centre hit the y = 70 plane about 14.5 blocks in front of it, outside the ±10 fill, which is why its strips were dark grey `[49.9, 55.0, 51.0]` (that grey has a hue of about 128°, so a hue assertion alone would not have caught it). The camera is now at (16, 78, 6), eight blocks above the y = 70 plane and six blocks behind its centre, and the fill is 17×17 (x 8..24, z −8..8). Strips are `[51.1, 78.7, 29.3]` and `[50.6, 77.8, 29.0]`, max border difference 0.9 (threshold 12). `assertHueInRange(…, [80, 140], 0.6)` is added for both strips: 100.0 % of the pixels of each strip are in range (mean hue 93.5° and 93.4°). I also added `G − R ≥ 15` on both strip means, so grey cannot pass.

## New worldHash

`worldHash(0, 0, 64, 64)`, standard seed, full default pipeline (surface and caves), computed in-process: **`9cb9466b`**. The same probe on master gave `c529d1af`, which reproduces the M03d value, so the method is sound. Old → new: `c529d1af` → `9cb9466b`. No test in the repository pins this hash (the tests compare runs and worker counts against each other), so no pin needed changing. The hashes in `progress/M03b-fix.md`, `M03c.md` and `M03d.md` are history.

## Screenshots (docs/screenshots/M03c-fix2/)

Visual Review for this task is item 4 only.

- `m03c-fix2-border.png` (saved by the suite): I opened it. It is a downward view of tufted green grass in 1-block terraces with brown dirt sides and a darker grass fringe on the step edges, with grey stone cliffs in the top corners and right edge. The chunk border runs through the middle of the screen and I can see no grey strip, colour change or line there; the tint looks uniform across it. The test asserts the border columns are `grass_block`; the picture alone cannot show where the border is. 94.5 % of the pixels in the centre region are in hue 80–140°.
- `m03c-border-tint.png` (suite, `artifacts/m03/` only, not copied): I opened it. A flat patch of tufted green grass fills the middle, enclosed by grey stone walls; no seam or colour step is visible at the screen centre where x = 16 is.
- `m03c-savanna-grass.png` and `m03c-rainforest-grass.png` (suite, `artifacts/m03/` only): I opened both. Savanna: an olive-yellow tufted patch in a ravine between a brown dirt wall on the left and grey stone on the right, a small patch of sky at the top; no water. Rainforest: a dark-green tufted patch, with sand, grey stone and grass terraces and blue water on the left.
- Four supplementary renders, made by a throwaway probe spec that I deleted (so these are not suite-saved evidence): `probe-savanna-old-framing-{before,after}.png` and `probe-rainforest-old-framing-{before,after}.png`. They show the old M03c framing (21×21 patch centred on the located point, mesh radius 2) on master ("before") and on this branch ("after"). In "before" rainforest I see a grey vertical strip and a grey horizontal strip across the terraces at the top, which are the seam; in "after" rainforest they are gone.

## Corrections to `progress/M03c.md` (not edited)

1. **`m03c-biome-map.png` does not match its description.** The notes describe broad zones: origin in a birch grove or pine taiga zone beside an ocean channel, badlands and deserts to the southwest, swamp and rainforest to the southeast, snow in the north, deep oceans framing east and west. The image is a fine mosaic with no such zones. Classifying all 1 048 576 pixels by nearest legend colour: ocean, deep ocean and frozen ocean cover 31.3 % of the west fifth, 34.7 % of the middle and 27.1 % of the east fifth (no frame); snow biomes cover 8.9 % of the north third and 9.1 % of the south third; badlands and desert cover 4.1 % of the south-west quadrant against 3.3–6.5 % elsewhere; swamp and rainforest cover 7.9 % of the south-east quadrant against 7.1 % in the north-west. There are 321 separate ocean blobs, the largest 3.8 % of the map. The origin pixel (512, 512) is classified as river. The biome counts and percentages in the notes are unaffected; only the prose is wrong. The image itself does not depend on this task (it comes from `sampleBiome`).
2. **`m03c-savanna-grass.png` shows dark triangles in the water and a stray dark block.** I confirmed both in the committed image, and they still appear:
   - On this branch with the old framing, the savanna render still has a dark brown block with a tail in the middle of the grass patch, and dark polygons on the water at the left. The block is identical on master. The water polygons are not stable: they differ in shape and position between renders of the same code (two master renders and two branch renders all differ, and a dark polygon also appeared on the rainforest water in one of the branch renders). I have not root-caused either.
   - What I checked: the block data is correct. The patch layer at y = 78 is all `grass_block` and y = 79 is all air around the located point (−16, 79.15, 48), so the block is a rendering or meshing artefact, not a wrong block. The located point is exactly the corner of four chunks, and part of the slab floats over air (the terrain below is lower there), so the artefact may be a chunk-corner meshing problem; that is a guess.
   - The new suite screenshot no longer shows them because the framing changed (patch confined to one chunk, camera in a ravine without water), not because they were fixed. The suite therefore no longer exercises that corner. I recommend a separate fix task for the mesher and water polygons.
3. **Minor:** that file's savanna RGB `[72.2, 66.0, 28.0]` and the tint difference 47.4 are from the old framing; the new values are in the durations section above.

## What was built

- `src/gen/surface.ts`: the cliff check reads an 18×18 grid of top heights (`heights`). Interior cells are scanned from the real column; the ring uses `sampleTerrainTopY`. The grid is computed before any surface edit, so earlier edits (for example a snow block on a neighbour) no longer feed later cells.
- `src/gen/terrain-height.ts`: `sampleTerrainTopY(terrainStageSeed, wx, wz)`, the highest solid block `terrainShapeStage` produces at a position.
- `tests/unit/surface-seam.test.ts`: the four tests above.
- `tests/e2e/m03c.spec.ts`: the changes described above, plus the new flat-grassland test. It searches the loaded 9×9 columns for an 8×8 window straddling a chunk border with height range ≤ 1 and grass-topped outer columns, asserts all 16 columns beside the border are `grass_block` and none is `stone`, frames the border and takes the screenshot (`assertNotBlank`, `assertNoMissingTexture`, hue assertion). Nothing is edited, so no re-mesh is needed.
- `decisions/M03c-fix2-terrain-top.md`.

## Decisions

- [`decisions/M03c-fix2-terrain-top.md`](../decisions/M03c-fix2-terrain-top.md)

## Known limitations

- `terrain-height.ts` repeats logic from `terrain.ts` (see the decision record). If the concurrent terrain fix changes the density rule, `surface-seam.test.ts` › "sampleTerrainTopY matches the real terrain-shape top block exactly" fails and the copy must be updated.
- Cliff semantics changed slightly: the old check looked ±10 blocks around the column's own top and reported slope 0 when the neighbour was further away; the new check uses true heights, so drops of more than 10 blocks now count as cliffs.
- The ring costs about 0.6 ms extra per column: surface stage 3.12 ms on master → 3.75 ms with the fix (mean of eight runs of 64 columns, same probe and process settings, after a warm-up; the shape stage was 5.2–6.0 ms per column in the same runs). I did not re-measure `genMsP95` in the browser.
- The test excludes `stony_shore` as well as the mountain biomes, as explained above.
- The dark water polygons and the stray dark block described above are unresolved.

## Notes for dependent tasks

- `holdFrames` and `renderFrames` live in `tests/e2e/m03c.spec.ts` because `tests/harness/` is read-only. Any later e2e test that calls `createWorld` with the default world can copy them to cut its run time sharply, but it must draw at least two frames before a screenshot.
- The surface stage still depends only on its own column plus seeded samplers, so results are independent of generation order and worker count.
