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
   idle at spawn, two forced GCs, baseline; fly 2000 blocks out and 2000 back at 60 blocks/s with `fly()`;
   idle; two forced GCs; growth must be at most 15 %. The baseline, end value and growth go to the
   annotations and the log.
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
7. **RD 12 horizon** (`m04-horizon.png`): render distance 12, streaming idle and no column fading, then a
   camera 40 blocks above the highest ground sampled within 144 blocks of the spawn column, pitched 20
   degrees down, looking along +x. The centre half of the lower third (columns 320 to 960 of 1280, rows
   480 to 720) must show no sky: at most 0.1 % of its pixels may be sky-coloured. A 16x16 column in that
   area covers about 150 pixels or more, so one missing column fails the test. The top tenth of the frame
   must be mostly sky (more than 50 %), which shows that the far edge is in the frame.
   **Why not the whole lower third:** the frame is 16:9 with a 70 degree vertical FOV, so its outer lower
   corners look at the far corners of the loaded square. The first run measured sky there (6.4 % of the
   whole lower third, all of it in the outer quarters on each side, about 11 % of the left quarter): the
   square's edge is in view and sky beyond it is correct. The test reports those quarters and does not
   assert on them. The geometry in the first draft of this decision was wrong about that.
   **There is no fog until M12a.** At RD 12 the terrain stops at the edge of the loaded square with the sky
   behind it, so the far edge is a hard line, not a fade.
8. **Mid-flight screenshot** (`m04-fast-flight.png`): RD 8, `fly()` at 30 blocks/s over 1000 blocks, the
   screenshot taken when the camera is 500 blocks along. Asserted only with `assertNotBlank` and
   `assertNoMissingTexture`. The spawn area is not waited for, so the chunks still loading are visible on
   purpose.

## Choices made in this task (not owner decisions)

- **Clock:** the fade reads `performance.now()` once per frame in `ChunkRenderer.render()`; the upload uses the
  same clock. The stat `columnsFading` is computed from the same clock, so a test that waits for it to reach
  zero waits for the fades to finish by wall-clock time, not by a count of frames.
- **Slow frames:** on SwiftShader a frame takes about 0.75 s, so a 400 ms fade is usually over before the
  frame after its upload, and the dither is rarely seen mid-way in a screenshot. The unit tests cover the
  clock, the threshold table and the upload rule. The e2e flight reports `columnsFading` above zero during
  streaming, which shows fades run; no e2e test checks a pixel mid-fade. On a GPU at 60 fps the fade is a
  visible dissolve.
- **Horizon camera:** the height rule (40 above the highest sampled ground) and the pitch were chosen for this
  seed. The centre-half check is the part that does not depend on the seed's terrain being lower or higher.

## Options considered

- **Asserting the whole lower third** of the horizon frame: rejected after the first run (see decision 7).
- **Fade keyed to the first draw** instead of the first upload: needs a per-column draw test in the renderer
  and gives the same result, since a column is drawn in the frame after its upload. Rejected for simplicity.
- **A fade on every upload** (per section): would make a re-mesh flicker, which decision 2 rules out.
- **A count of frames instead of wall-clock time** for the fade: frame time varies by 100× between a GPU and
  SwiftShader, so the same count would be a different fade on each machine. Rejected (decision 1).
- **Clearing the attempt store in `endMeshAttempt`-style calls only**: leaves the discard paths open, which
  is the bug. Rejected.
