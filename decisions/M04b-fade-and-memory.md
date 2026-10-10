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
   idle at spawn, two forced GCs, baseline. Then a **probe**: a plain array of 8,000,000 numbers (about 64 MB
   on the JS heap; not a typed array, whose buffer is outside the JS heap) must raise `usedJSHeapSize` by at
   least 32 MB, or the reading cannot show growth and the test fails. The probe is released and two GCs run
   before the flight. Then fly 2000 blocks out and 2000 back at 60 blocks/s, idle, two GCs, and growth must be
   at most 15 %. The baseline, end value and growth go to the annotations and the log.
   The probe exists because without `--enable-precise-memory-info` `performance.memory` returned the same value
   before and after a 64 MB array (19,300,000 B), so a reading that does not move would pass the 15 % check for
   any heap. The owner chose to add the flag on master (`90c809b`); with it the probe moves by +61 to +89 MB.
   The 15 % check is an upper bound: the runs ended 40–41 % below the baseline, which passes it. Numbers are in
   `progress/M04b.md`.
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
   and the largest component are logged. A missing chunk at about 190 blocks is roughly 10x60 px (600), so one
   missing chunk fails the test; gaps between leaves are smaller. The hole finder is
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
  fast-flight frame the top row is terrain, so all of its sky is enclosed (37,510 px, largest 32,390 px). The
  frame cannot say whether that is terrain not yet drawn or mid-fade (dithered edges, `columnsFading` 19,
  `meshQueued` 101, `uploadsDeferred` 171), or sky beyond the RD 8 loaded edge: a separate probe at the same pose
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
