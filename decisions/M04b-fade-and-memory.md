# M04b-fade-and-memory — column fade-in, memory bound, horizon and flight tests

Status: accepted
Task: M04b (changes code owned by M04a: `src/world/streamer.ts`, `src/world/world-manager.ts`,
`src/render/chunk-renderer.ts`; new modules `src/render/dither.ts`, `src/render/column-fade.ts`,
`src/world/mesh-attempts.ts`)

## Owner decisions followed

1. **Fade-in per column, dither dissolve.** A column fades in for `FADE_IN_MS` (400 ms of wall-clock time,
   `src/render/column-fade.ts`) from the upload of its first section mesh. The fade is one uniform per
   column (`u_fade`), set once per column in each pass, so no draw call is added. The fragment shader
   discards a fragment whose 4x4 Bayer threshold (`src/render/dither.ts`, the same table as the shader) is
   at or above the fade. The discard runs before the wireframe early return, so the opaque, cutout and
   translucent passes and the wireframe overlay all follow the fade.
2. **A re-mesh does not fade a visible column.** `uploadSectionMesh` records whether the column had section
   meshes on the GPU before the upload; only an upload to a column with none starts a fade. A column whose
   section meshes were all freed (`removeColumnMeshes`, or `removeColumnMeshesExcept` leaving none) fades
   again when it comes back. Its entry is dropped at that point, not when a single section is replaced.
3. **Sections uploaded while a load is pending show at once.** `WorldManager` passes no fade start when
   `createWorld` is running (`initialLoadCount`) or a region request is pending (`Streamer.requestPending`).
   Everything else fades.
4. **One debug field.** `getStreamingStats()` adds `columnsFading`: columns whose fade has not finished at
   the time of the call (`WorldStreamingStats` in `src/world/world-manager.ts`). Nothing else in the debug
   API changed.
5. **Heap test** (`tests/e2e/m04.spec.ts`, "heap growth after flying 2000 blocks out and back…"): at RD 8,
   idle at spawn, then a **warm-up**: 400 blocks out and back, which takes the spawn columns out of the keep
   ring. Then idle, two forced GCs, and the baseline. Then a **probe**: a plain array of 8,000,000 numbers
   (not a typed array, whose buffer is outside
   the JS heap) must raise `usedJSHeapSize` by at least 32 MiB, or the reading cannot show growth and the test fails. The probe is
   released and two GCs run before the flight. Then fly 2000 blocks out and 2000 back at 60 blocks/s, idle, two
   GCs, and growth must be at most 15 %. The bound is one-sided: a drop is not checked (the owner's call). The
   baseline, end value and growth go to the annotations and the log.
   The probe exists because without `--enable-precise-memory-info` `performance.memory` returned the same value
   before and after a 64 MB array. The heap test's log line from the run before the launch flag was on master reads `m04 heap baseline 18.41 MB (19300000 B), end 18.41 MB (19300000 B), growth 0.00 %` (19,300,000 B = 18.41 MiB), so a reading that does not move would pass the 15 % check for
   any heap. The owner chose to add the flag on master (`90c809b`); the self-checks with it are listed in `progress/M04b.md`.

   **Why the warm-up (review round 1, B1).** Without the warm-up, the final verify run on `53d5a5f` (the merged tree
   before this change) had a baseline at spawn of 18,863,296 B (17.99 MiB) and an end of 11,286,819 B (10.76 MiB),
   a drop of 40.17 % that the 15 % bound cannot see. A heap snapshot at spawn and one
   after the flight (both after two GCs; probe run, not part of the test) gave:
   - `system / JSArrayBufferData` count 5,665 → 3,816 (heap-snapshot probe run). All of the drop is in 4,096-byte
     buffers: 2,016 → 2. The other sizes match the state the page reports (indices and biome arrays), and
     their counts do not fall.
   - The page reports `LightStorage` at spawn (same probe run): **2,014 light sections, 8,249,344 bytes (7.87 MiB)**; after the flight: **0**.
     Each light section is one `Uint8Array(4096)` (`src/world/lighting.ts`), held in `LightStorage.sections`.
   - Root: the light `createWorld` computes for the spawn region (the barrier columns, radius 5, about 121
     columns). The light is kept while those columns are loaded and is what their meshes were lit with.
     The streamer frees a column's data when it leaves the keep ring (`World.removeColumn` →
     `LightEngine.removeColumn`), and a column streamed back in gets no light until M05b lights streamed
     columns. So the spawn state has about 7.87 MiB of light (8,249,344 B) that no later state has.
   - Not a leak and not an unneeded buffer: the light is needed while the spawn columns are loaded (re-mesh and
     edits read it). Freeing it at spawn would change what a re-mesh reads, so it is not freed here. The baseline
     is taken after the warm-up instead, in the state every later return to spawn reaches.
   - After the warm-up the baseline is 10,845,137 B (10.34 MiB) in the final full verify on `c1e1934`; the
     numbers of every run are in `progress/M04b.md`, "Numbers: one run" and "Heap baseline".

   **Second out-and-back (report only, probe run on this tree, not in the test).** Baseline after the warm-up
   10,820,821 B (10.32 MiB); after round 1 11,314,949 B (10.79 MiB, +4.57 %); after round 2 11,865,217 B (11.32 MiB, +9.65 % against the
   baseline). Round 2 is +4.86 % above round 1, so it does not return within 1 % of the first post-GC reading.
   The reviewer's probe measured +2.18 % for round 2, not +4.86 %. The likely cause is the frame-stats sample arrays
   (`src/engine/frame-stats.ts`, `MAX_SAMPLES` 100,000), which fill during the test because the heap test never calls
   `resetFrameStats`. That is unconfirmed. The growth is capped, so it plateaus rather than leaking. The test (one
   round) is within the bound. The test takes 2.0–2.1 min alone; the reviewer measured 3.9 min for the warm-up plus
   two rounds with snapshots, against the 180 s per-test timeout, which is not changed here.
6. **Memory fix from the M04a review.** `world-manager.ts` kept a `Map<column, Set>` of section keys per
   open mesh attempt. An attempt discarded before its first upload left an empty Set behind, and `freeData`
   did not clear it. Now:
   - the store is `MeshAttempts` (`src/world/mesh-attempts.ts`), an entry exists only while an attempt is open;
   - the streamer calls the new host method `abandonMeshAttempt(cx, cz)` from `discardAttempt` whenever the
     column is `meshing` (the only phase with an open attempt): invalidate, invalidateAll, freeing a meshing
     column, and a stale completion all go through it;
   - `freeMesh` and `freeData` abandon the column's attempt, and `createWorld` and `resetWorldToEmpty` clear
     the store with the GPU meshes.
   Unit tests: `tests/unit/mesh-attempts.test.ts` (the store) and the "discarded attempts" block of
   `tests/unit/streamer.test.ts` (the host is told on each discard path and not on a completed attempt).
   The known limitation from M04a (a column whose generation failed three times blocks its neighbours) is
   left as it was: no test hit it.
7. **RD 12 horizon** (`m04-horizon.png`): render distance 12, streaming idle and no column fading, and before
   the shot the debug API confirms that every column within RD 12 is meshed and `columnsFading` is 0. The
   camera is 40 blocks above the highest ground sampled within 144 blocks of the spawn column, pitched 20
   degrees down, looking along +x.
   **Holes:** sky that a 4-connected flood fill from the sky pixels of the top row cannot reach is enclosed by
   terrain. The largest connected enclosed area must be at most `MAX_HOLE_PIXELS` = 64 px. The total enclosed
   and the largest component are logged. A missing interior column adds a 251 px enclosed component (the reviewer's
   measurement), which is over the 64 px limit, so one such column fails the test. **What the check does not catch:** a column at
   the RD 12 edge. Its sky is open (it reaches the top row, or the frame edge past it), so it is reported as
   open sky, not as a hole. The check catches missing interior chunks, not the loaded edge. The hole finder is
   `tests/e2e/helpers/sky-holes.ts`, unit-tested on synthetic frames in `tests/unit/sky-holes.test.ts`: an
   enclosed 10x60 patch fails, an open notch from the top row passes.
   **Open sky:** sky reached from the top row, including the view past the RD 12 edge in the far corners. That
   is correct: there is no fog until M12a, so the edge is a hard line. The corners are reported, not asserted.
   **Top tenth:** more than half sky, which shows the far edge is in the frame.
   **Earlier version, replaced:** the first check looked at the centre half of the lower third. It cannot see the
   far chunks around the middle of the frame, which are the ones most likely to be missing at RD 12 (review
   from the orchestrator). The first run had also measured sky in the outer lower corners (6.4 % of the whole
   lower third, about 11 % of the left quarter); that sky is the RD 12 edge in view and is reported only.
8. **Mid-flight screenshot** (`m04-fast-flight.png`): RD 8, `fly()` at 30 blocks/s over 1000 blocks, the
   screenshot taken when the camera is 500 blocks along. Asserted only with `assertNotBlank` and
   `assertNoMissingTexture`. The hole finder numbers and `columnsFading` at the moment of capture are reported,
   not asserted. The frame is the real mid-flight frame: streaming is not waited for, so the chunks still
   loading are in it on purpose. Under SwiftShader the frame does not fully meet its checklist ("at most a few
   chunks still loading at the far edge, near terrain fully present"): the reasons are in `progress/M04b.md`.
   The orchestrator decided to keep the frame as a known limitation for this PR, with a retake in M22a; the
   owner confirms that at the publish gate.

## Choices made in this task (not owner decisions)

- **Hole finder seed (top row only).** The flood fill starts from sky pixels in the top row, as the orchestrator
  decided; the other frame edges are not seeds. Enclosed sky is sky not reached from the top row. In the
  fast-flight frame the top row is terrain, so all of its sky is enclosed (39,515 px, largest 36,916 px, final full
  verify). The frame cannot say whether that is terrain not yet drawn or mid-fade (dithered edges, `columnsFading`
  41, `meshQueued` 116, `uploadsDeferred` 47), or sky beyond the RD 8 loaded edge: a separate probe at the same pose
  measured 0.60 % sky after streaming went idle at RD 8 and 0.07 % at RD 12. The argument "a lower ray in a
  column hits terrain no farther away than a higher one" holds only for downward rays over a height field; the
  top row of that frame looks up at a ceiling, and caves let lower rays pass through open air. So the top-row
  rule shows enclosed sky, not its cause.

- **Clock:** the fade reads `performance.now()` once per frame in `ChunkRenderer.render()`; the upload uses the
  same clock. The stat `columnsFading` is computed from the same clock, so a test that waits for it to reach
  zero waits for the fades to finish by wall-clock time, not by a count of frames.
- **Slow frames:** on SwiftShader a frame takes about 0.75 s, so a 400 ms fade is usually over before the
  frame after its upload, and the dither is rarely seen mid-way in a screenshot. The unit tests cover the
  clock, the threshold table and the upload rule. The e2e flight reports `columnsFading` above zero during
  streaming, which shows fades run; no e2e test checks a pixel mid-fade. On a GPU at 60 fps the fade is a
  visible dissolve.
- **Fade start (review round 1).** The start rule is a pure function, `fadeStartFor(loadPending, nowMs)`, so
  the full-opacity rule while `createWorld` or a region request is pending is unit-tested
  (`tests/unit/column-fade.test.ts`). `WorldManager.uploadSection` uses it.
- **Fade uniform (review round 1).** The last value written to `u_fade` is cached (`UniformValueCache`); a
  finished column (fade 1) is not written again in each pass. `render()` forgets the cache each frame, so the
  first write of a frame always goes through.
- **Horizon camera:** the height rule (40 above the highest sampled ground) and the pitch were chosen for this
  seed. They decide how much of the frame the far edge takes; the hole check does not depend on them.

## Options considered

- **Asserting only the centre of the lower third** (the first version): rejected after review; it cannot see the
  far chunks around the middle of the frame (see decision 7). The whole-frame enclosed-sky check replaces it.
- **Fade keyed to the first draw** instead of the first upload: needs a per-column draw test in the renderer
  and gives the same result, since a column is drawn in the frame after its upload. Rejected for simplicity.
- **A fade on every upload** (per section): would make a re-mesh flicker, which decision 2 rules out.
- **A count of frames instead of wall-clock time** for the fade: frame time varies by 100× between a GPU and
  SwiftShader, so the same count would be a different fade on each machine. Rejected (decision 1).
- **Clearing the attempt store in `endMeshAttempt`-style calls only**: leaves the discard paths open, which
  is the bug. Rejected.
