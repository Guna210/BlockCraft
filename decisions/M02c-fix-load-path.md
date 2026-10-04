# M02c-fix — How the initial world load avoids the frame loop

Status: accepted
Task: M02c-fix (owner-sanctioned fix task, not in SPEC.md Appendix E)

## Problem

The default `createWorld` (radius 4, 81 columns, 636 non-trivial sections) took 27–30 s under SwiftShader
against a SPEC §2.3 budget of 20 s, although generation is about 0.7 s, the light job about 0.2 s and
meshing in the workers about 0.24 s of worker time in total.

## Measurement (this VM, 4 vCPU, normal `requestAnimationFrame` loop, `?debug=1`, standard seed)

Three fresh pages each, before = unmodified master `e6aa1ce`. The probe wraps the pools through
`window.WorldManager` and the page's `requestAnimationFrame`; it is not part of the repository.
Full table in `progress/M02c-fix.md`. The numbers that decide the question (before → after, three runs):

| | before | after |
| --- | --- | --- |
| `createWorld` (ms) | 28 062, 29 541, 27 170 | 1 353, 1 307, 1 318 |
| frames drawn during the load | 250, 249, 220 | 72, 69, 71 |
| main-thread time inside those frames (ms) | 26 294, 28 064, 25 825 | 19, 16, 8 |
| longest frame (ms) | 486, 546, 576 | 3.8, 7.6, 1.5 |
| `buildPaddedSection` for 636 sections (ms) | 61, 75, 60 | 56, 54, 56 |
| mesh dispatch, 636 `postMessage` calls (ms) | 5.3, 1.8, 1.5 | 1.0, 0.7, 1.3 |
| uploads, 636 sections (ms) | 80, 76, 41 | 51, 40, 38 |
| mesh worker busy time, summed (ms) | 220, 224, 219 | 247, 242, 244 |

So 92–95 % of `createWorld` was main-thread time inside frames that drew the terrain uploaded so far. The
work the prompt suspected (padded sections, dispatch, uploads) is about 0.14 s in total. The workers are not
the bottleneck either (0.22 s of busy time spread over three workers).

Mechanism (an inference from these numbers; I did not trace Chromium's scheduler): each frame took 70–576 ms
and the duration grows with the number of uploaded sections (up to 750 draw calls, each followed by
`gl.getError()` in debug mode; I did not test whether that call is what makes the frames slow). Only about
2.5 worker result messages were handled per frame (636 uploads over 250 frames), and the mesh pool only
dispatches its next job when it handles a result, so the three workers sat idle for most of the 27 s. The
earlier tests that hold `requestAnimationFrame` (`holdFrames`, M03c-fix2) hid exactly this.

## Decision

1. **No terrain draw while `createWorld` is running.** `WorldManager` counts unfinished `createWorld`
   calls; while the count is non-zero `render()` returns without drawing, so the page shows sky-clear
   frames only (the clear stays in `main.ts`). The count is decremented in a `finally`, so a rejected or
   superseded call cannot leave terrain hidden. It does not read `?debug=1`, tests or timing.
2. **One synchronous terrain frame at the end of `createWorld`.** After the last mesh is uploaded (and only
   if the call was not superseded, using the existing `worldEpoch`) `createWorld` clears and draws once in
   its own task. That frame is presented before whatever awaits `createWorld` runs, so a screenshot taken
   right after `await createWorld()` (m02, m03d and others do this) shows terrain, and it does not depend on
   `requestAnimationFrame`, which `holdFrames` tests suspend (waiting for a rAF frame there would deadlock).
   `renderStats.drawCalls` is non-zero when `createWorld` resolves.
3. **Stale first frame fixed separately** (see below). It is part of this decision because the new
   synchronous frame is the first frame that creates every column's tint textures.

`gl.getError()` after every draw in debug mode (`GLWrapper.drawElements`) is untouched. Debug API
signatures, generation, lighting, meshing, `waitForTerrain` and the epoch checks of M03b-fix3 are untouched
(`worldHash(0, 0, 64, 64)` for the standard seed is `25e0710b` before and after, in every probe run).

## Stale first frame: cause

`ColumnTintCache.createTintTexture` (and `uploadTextureData`) call `gl.bindTexture(TEXTURE_2D, tex)` on
whatever texture unit is active. `ChunkRenderer.render()` binds the atlas to unit 0, then calls
`getColumnTints` for the first column, which creates the two tint textures while unit 0 is still active, so
the 16×16 foliage tint texture replaces the atlas on unit 0 for the rest of that frame. Every face then
samples a flat tint colour instead of the atlas (no texture detail; stone and dirt come out olive/green),
until the next frame binds the atlas again. Only frames that create textures are affected, i.e. the first
frame that sees new columns; after a long pause that is every column at once. Fix: `render()` selects
texture unit 3 (a unit it never samples from) before it asks the cache for textures
(`src/render/chunk-renderer.ts`). `tint-cache.ts` is unchanged because `tests/unit/tint.test.ts` uses a mock
GL without `activeTexture` and existing tests must pass unchanged; an earlier attempt that put the fix in
the cache failed that test.

## Options considered

- **Limit draws while load jobs are pending (every N-th frame).** Still costs a frame of 70–500 ms per
  draw, and the right N depends on hardware speed. Rejected.
- **Batch uploads / frame budget for uploads.** Uploads are 0.04–0.08 s in total; the problem is the frames,
  not the uploads. Needed anyway for M04a (SPEC §2.3, ≤ 3 ms per frame), but would not fix this.
- **Move `buildPaddedSection` into the workers.** It costs 0.06 s of main thread for the whole load.
  Rejected on the numbers.
- **Gate every `meshRadius` load, including `waitForTerrain`.** Not needed for the budget; it would also have
  needed a terrain frame after every `waitForTerrain` call, which costs time in the `holdFrames` tests.

## Consequences and limits

- During `createWorld` the screen shows sky colour only (no loading screen yet; M22b owns the progress bar).
- Frames after the load still cost 100–300 ms each in SwiftShader with debug on (753 draw calls, no
  culling). That is steady-state render cost (M22a), not load cost, and is unchanged by this task.
- `waitForTerrain(r)` for areas that `createWorld` did not load (and re-meshes after edits) still runs with
  the frame loop drawing and is as slow as before; no existing flow needs it to be fast.
- Not measured: the same probe without `?debug=1` (no debug API, so nothing can call `createWorld`); the
  gate is identical in both modes by construction.
