# M02c-fix — World load time and the stale first frame

Status: verified
Depends on: M02c, M03b-fix3 (epoch checks), M03c-fix2 (`holdFrames`), M03d-fix, M05a
Full verify (this session): typecheck ✓ · lint ✓ (0 errors, 2 existing `no-explicit-any` warnings in files this task does not touch) · placeholders ✓ · unit 151 passed (32 files) · e2e 24 passed (0 flaky, 0 skipped; 54.4 s of Playwright wall time) · console errors 0 · total `npm run verify` time 103 s (master: 197 s)

This is an owner-sanctioned fix task that is not in SPEC.md Appendix E. It touches `src/world/world-manager.ts`
and `src/render/chunk-renderer.ts` and adds `tests/e2e/m02c-fix.spec.ts`. It does not touch `src/gen/`, `data/`,
the harness, any timeout or any existing test file.

An earlier full `verify` of this session failed once: `tests/unit/tint.test.ts` (mock GL without `activeTexture`)
broke when I first put the stale-frame fix into `src/render/tint-cache.ts`. I moved the fix into the renderer
(see below), reverted `tint-cache.ts`, and the second full verify, the one reported here, passed everything.

## Items owned

- [x] 1. Measured first, normal frame loop, 3 fresh runs, standard seed, before and after → tables below
- [x] 2. Cause fixed; default `createWorld` resolves in 1.3–1.4 s (limit 10 s); `m03.spec.ts` worker-count test 62.1 s → 9.8 s in verify, 6.7 s alone (limit 90 s) → `decisions/M02c-fix-load-path.md`
- [x] 3. Stale first frame: cause found and fixed in game code; test fails on master and passes → `tests/e2e/m02c-fix.spec.ts` › "after a stall the first frame drawn equals the third frame (static camera)" and › "a frame that has to create new column tint textures equals the settled frame"
- [x] 4. Default `createWorld` completes and a terrain frame is drawn within 20 s, measured with `performance.now` and `getRenderStats` only → `tests/e2e/m02c-fix.spec.ts` › "default createWorld completes and a terrain frame is drawn within 20 s (SPEC 2.3)". All three tests take 5.6–8.0 s each in verify (limit 60 s).
- [x] 5. Every existing test passes unchanged, including the `holdFrames` tests in `m03c.spec.ts`
- [x] 6. This file

## Failing on master, passing now

I stashed the two `src/` edits (the new spec stayed) and ran the spec against master code.

| Test | On master | With the fix |
| --- | --- | --- |
| first frame = third frame | **fails**: `diffFraction` 1 (limit 0.01) | passes |
| frame that creates new tint textures = settled frame | **fails**: `diffFraction` 1 | passes |
| default `createWorld` + terrain frame within 20 s | **fails**: 27 350 ms (and 27 613 ms in an earlier run) | passes, 1.3 s |

With only the load gate and without the renderer fix, test 1 passes and test 2 fails (the first frame the
test draws is then the second frame overall, because `createWorld` already drew a stale one). Test 2 exists
for that reason: it forces a frame that creates every column's tint textures and so guards the renderer fix on
its own.

## Measurements (this VM: 4 vCPU, `hardwareConcurrency` 4, Chromium with the suite's SwiftShader flags, `?debug=1`)

Probe script kept outside the repository: fresh page, `createWorld({ seed: 'blockcraft-test-seed-42', type: 'default' })`
with the page's `requestAnimationFrame` loop running, pools wrapped through `window.WorldManager`, every
`requestAnimationFrame` callback timed. Before = unmodified master `e6aa1ce`; after = this branch. Three fresh
pages each; values per run.

| Quantity | before (master) | after |
| --- | --- | --- |
| `createWorld` total (ms) | 28 061.6 · 29 541.3 · 27 169.9 | 1 353.2 · 1 307.2 · 1 318.0 |
| first frame with terrain, from the `createWorld` call (ms; `drawCalls > 0`) | 28 061.8 · 29 541.6 · 27 170.1 | 1 353.3 · 1 307.3 · 1 318.1 |
| generation, 81 columns, ends at (ms) | 1 012.5 · 726.4 · 712.5 | 737.6 · 703.5 · 735.6 |
| lighting, one region job (ms) | 239.2 · 209.6 · 194.8 | 183.9 · 189.9 · 195.6 |
| main thread: `buildPaddedSection` ×636 (ms) | 61.2 · 74.6 · 59.8 | 56.2 · 54.0 · 56.0 |
| main thread: dispatch, 636 `enqueueMeshJob` (ms) | 5.3 · 1.8 · 1.5 | 1.0 · 0.7 · 1.3 |
| main thread: uploads, 636 (total ms; longest) | 80.5 (2.7) · 76.4 (3.4) · 41.3 (2.9) | 51.1 (2.9) · 39.8 (2.2) · 38.1 (2.8) |
| mesh phase after the dispatch burst (ms) | 26 716.7 · 28 511.1 · 26 184.5 | 355.0 · 340.6 · 311.0 |
| mesh worker busy time, sum over workers (ms; 3 workers) | 220.3 · 223.6 · 218.9 | 246.5 · 241.6 · 243.6 |
| mesh phase minus uploads minus frame time ("waiting on workers", ms) | 342.1 · 370.5 · 317.9 | 285.2 · 285.3 · 264.8 |
| frames drawn during the load | 250 · 249 · 220 | 72 · 69 · 71 |
| main-thread time inside those frames (ms) | 26 294.1 · 28 064.2 · 25 825.3 | 18.7 · 15.5 · 8.1 |
| frame time median / max (ms) | 68.2 / 485.5 · 95.7 / 546.1 · 100.5 / 576.1 | 0.1 / 3.8 · 0.1 / 7.6 · 0.1 / 1.5 |
| long tasks (count; total ms) | 131; 25 665 · 143; 26 706 · 123; 25 054 | 1; 61 · 1; 58 · 1; 62 |
| draw calls in the stats after the load | 752 · 751 · 751 | 753 · 753 · 753 |

Notes on reading it: the "after" `createWorld` time includes the one synchronous terrain frame at its end (its
own duration is not separated out). Before, about 95 % of `createWorld` was time inside frames that drew
the terrain uploaded so far; the padded-section, dispatch and upload work is about 0.14 s in total in both
versions. In the "after" column the 69–72 frames are sky-clear frames only.

Not changed by this task, for the record: the per-frame cost once terrain is drawn. After the load a frame
with 753 draw calls still took about 270 ms in the "before" runs' last frames; that is M22a's culling and
batching territory.

## `worldHash`

`worldHash(0, 0, 64, 64)`, standard seed, default pipeline: **`25e0710b`** on master and on this branch, read
in all six probe runs (three before, three after). It is also the M03d-fix value. Generation, lighting and
meshing code is untouched, so no pin or hash changed. `m03.spec.ts` compares it across worker counts and passed.

## Stale first frame: cause

`ColumnTintCache` creates a column's two tint textures with `gl.bindTexture` on whichever texture unit is
active. In `ChunkRenderer.render()` the active unit is unit 0, which holds the atlas, when the first column's
tint textures are created, so the 16×16 tint map replaces the atlas for the rest of that frame: no texture detail,
flat tint colours (stone and dirt come out olive/green). Only a frame that creates textures is affected, which
is the first frame that sees new columns; after a long pause that is all of them, from the second frame on the
image is correct. It also affected normal play for one frame whenever a new column appeared. Fix:
`render()` selects texture unit 3, which it never samples from, before it asks the cache for textures
(`src/render/chunk-renderer.ts`, `bindColumnTints`). Details in `decisions/M02c-fix-load-path.md`.

## Screenshots (docs/screenshots/M02c-fix/)

This task has no Visual Review item; these are saved by the new spec and committed as evidence. I opened all four.

- `first-frame.png`: the first frame drawn after the stall, camera tilted down at the spawn. I see a textured dark-grey stone wall filling the top two thirds, a lighter grey stone floor at the bottom, a pool of blue water at the left with a tile pattern and some stepped stone blocks on the right; no flat colour fill and no green or olive tint. (The spawn column on this seed is a stone top, a known limitation from M03b-fix3, so there is no grass in the view.)
- `third-frame.png`: same view; the file is byte-identical to `first-frame.png` (`cmp`).
- `rebuilt-frame.png`: the frame drawn right after all tint textures were dropped; the same picture as above, byte-identical to the settled frame.
- `default-world.png`: the canvas after a default `createWorld` with the normal frame loop, in front of the spawn: the dark-grey stone wall texture fills the view, and a darker block edge at the left. Not blank, no magenta.

Observed on master earlier in this session (not saved, so not suite evidence): with the camera at its default pitch the first frame was a flat olive-brown fill with no texture, a few darker polygons, and the third frame showed the grey textured stone wall; that is the symptom from `progress/M03c-fix2.md`.

## per-test e2e durations, before and after

Seconds, from the Playwright HTML report of one full `npm run verify` each (default 2 workers, so tests overlap).
Before = master `e6aa1ce` (21 tests, verify 197 s); after = this branch (24 tests, verify 103 s).

| spec | test | before | after |
| --- | --- | --- | --- |
| m00-canary | Canary: Blank canvas should fail assertNotBlank | 0.9 s | 0.6 s |
| m00-canary | Canary: Magenta canvas should fail assertNoMissingTexture | 0.6 s | 0.5 s |
| m00-canary | Canary: Page error should fail the test | 0.6 s | 0.5 s |
| m00 | M00: page loads with 0 errors and clears to sky blue | 0.5 s | 0.4 s |
| m01 | M01: 5x5 texture grid test scene renders correctly and updates on camera rotation | 1.7 s | 1.6 s |
| m02 | WorkerPool uses real Web Workers, transfers padded buffers, and exposes workerCount | 2.5 s | 2.0 s |
| m02 | calling createWorld a second time clears old promises and re-meshes new world | 1.8 s | 1.8 s |
| m02 | createWorld generates flat world, meshes in workers, and renders continuous grass plane | 2.6 s | 1.9 s |
| m02 | getBlock, setBlock and fill debug API methods operate correctly on world | 0.4 s | 0.3 s |
| m02 | wireframe mode displays merged quads overlay | 3.0 s | 2.3 s |
| m02b-fix | renders 3x3 grass_block wall with top grass fringe having mean (G - R) >= 15 higher than bottom dirt | 5.0 s | 4.0 s |
| m02c-fix | a frame that has to create new column tint textures equals the settled frame | n/a | 8.0 s |
| m02c-fix | after a stall the first frame drawn equals the third frame (static camera) | n/a | 5.6 s |
| m02c-fix | default createWorld completes and a terrain frame is drawn within 20 s (SPEC 2.3) | n/a | 7.6 s |
| m03 | default world spawns the camera on dry land above sea level (blockcraft-alt-seed-7) | 18.3 s | 4.9 s |
| m03 | default world spawns the camera on dry land above sea level (blockcraft-test-seed-42) | 47.3 s | 6.9 s |
| m03 | worldHash of region (0,0)-(64,64) is identical for worker counts 1, 2 and 4, on a repeat run, and matches main-thread generation | 62.1 s | 9.8 s |
| m03b-fix3 | a createWorld that is superseded by a newer one cannot write into the newer world | 28.4 s | 5.3 s |
| m03c | M03c-fix2: natural flat grassland shows no stone seam across a chunk border | 3.8 s | 4.2 s |
| m03c | M03c: Biome Grass Tinting E2E | 11.1 s | 6.9 s |
| m03c | M03c: Chunk border grass tint continuity E2E | 4.6 s | 4.7 s |
| m03c | M03c: M01c test scene grass top face green hue assertion | 0.7 s | 1.1 s |
| m03d | renders cave interior with assertNotBlank and assertNoMissingTexture | 44.7 s | 9.9 s |
| m16a | generates all expected sounds with correct RMS and peak levels | 14.6 s | 6.9 s |

Sum of test durations: before 255.1 s over 21 tests, after 97.6 s over 24 tests. Run alone on this branch
the `m03.spec.ts` worker-count test took 6.7 s and the three new tests 3.4 s, 3.7 s and 4.5 s.

Without `holdFrames`: I ran a throwaway copy of `m03c.spec.ts` with `holdFrames` a no-op and `renderFrames`
waiting for three real frames (deleted afterwards). All four tests passed, in 17.7 s, 0.8 s, 11.7 s and
7.5 s against 6.9 s, 1.1 s, 4.7 s and 4.2 s in verify with the helper.

## What was built

- `src/world/world-manager.ts`: `initialLoadCount`; `createWorld` is a wrapper around the old body
  (`loadInitialWorld`, which now returns whether it completed), counts itself in and out in a `finally`, and
  draws one terrain frame (`drawTerrainFrame`) when it completed and was not superseded. `render()` skips
  the terrain draw while the count is non-zero. Nothing else in the load path changed.
- `src/render/chunk-renderer.ts`: texture unit 3 is selected before the tint cache is asked for textures.
- `tests/e2e/m02c-fix.spec.ts`: three tests (above). It carries its own copy of `holdFrames` and a
  `drawFrames(n)` helper because `tests/harness/` is read-only and `m03c.spec.ts` does not export them.
- `decisions/M02c-fix-load-path.md`.

## Decisions (links to decisions/ files)

- [`decisions/M02c-fix-load-path.md`](../decisions/M02c-fix-load-path.md)

## Known limitations

- While `createWorld` runs the screen is sky colour only; there is no loading screen until M22b.
- `waitForTerrain` for columns that `createWorld` did not load, and re-meshes after block edits, still run with the frame loop drawing and are as slow as before.
- Frames after the load cost 100–300 ms in SwiftShader with debug on (753 draws, no culling).
- Test 2 of the new spec reaches into `WorldManager.chunkRenderer.tintCache` (private in TypeScript) the way `m03c.spec.ts` reaches into `pendingTerrainPromises`. If the cache is renamed or moved the test needs the new path.
- I did not run the probe without `?debug=1`: without it there is no debug API to call `createWorld`. The gate and the synchronous frame do not read the debug flag.
- `tests/unit/biomes.test.ts` still rewrites `docs/screenshots/M03c/*.png` on every unit run (see M03b-fix3); I restored them with `git checkout` and did not commit them.

## Notes for dependent tasks

- **M04a, what must be kept when streaming replaces this load path:**
  1. No frame may spend more main-thread time than the load jobs can tolerate. Before this task a 100–500 ms
     frame between worker messages cut the whole pipeline to about 2.5 results per frame. Streaming draws
     while it loads, so it needs the ≤ 3 ms/frame upload budget and a bounded draw cost (frustum
     culling), or the same starvation returns. Keep mesh jobs queued ahead in the workers instead of
     dispatching one job per received result.
  2. Keep "sky-clear frames only while the initial load runs, then one synchronous terrain frame before the
     promise resolves" (`initialLoadCount`, `drawTerrainFrame`), or an equivalent that does not wait on
     `requestAnimationFrame`: tests that hold the frame loop would deadlock, and tests screenshot right after
     `await createWorld()`. The default `createWorld` must stay under the 20 s of SPEC §2.3 (the new spec
     asserts it) and was 1.3 s here.
  3. Keep the epoch checks of M03b-fix3; `createWorld` counts itself in and out in a `finally`, so a superseded call
     cannot leave terrain hidden.
  4. Tint textures are created lazily inside the first frame that draws a column. Keep that on a texture
     unit the renderer does not sample from (unit 3 now), and count it in the upload budget.
  5. Keep `tests/e2e/m02c-fix.spec.ts` passing; its second test forces the "new columns in this frame"
     case on purpose.
- **`holdFrames` in `m03c.spec.ts`:** no longer needed for `createWorld` speed (it takes 1.3 s with the loop
  running). It is still worth having: it makes the three-frame screenshots deterministic and avoids frames of
  100–300 ms while `waitForTerrain(1)` re-meshes edited columns; without it the same four tests pass but take
  about 2.5× as long (numbers above). Remove it only together with the M04a work on frame cost.
- Any new asynchronous result that writes into `WorldManager.world` must still capture `worldEpoch` first.
