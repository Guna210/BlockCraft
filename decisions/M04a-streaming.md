# M04a-streaming — terrain streaming, culling, fenced error drain

Status: accepted
Task: M04a (changes code owned by M01a-fix, M02c and M03g: `src/main.ts`, `src/render/chunk-renderer.ts`,
`src/world/world-manager.ts`, see the handoff for the list)

## Owner decisions followed

1. **Chunk = 16x16 column, distance = Chebyshev distance in columns from the camera column.** Columns are
   generated up to RD+1, meshed up to RD, their meshes (buffers, VAOs, tint textures) freed beyond RD+1 and
   their block and light data freed beyond RD+2. The perimeter invariant holds after every main-thread
   task: a meshed section has all eight neighbour columns loaded, meshes are freed before the data they
   depend on (`canFreeData` checks it, it is not left to ring arithmetic). `World.removeColumn`
   invalidates `lastCX/lastCZ/lastCol`.
2. **One owner of column state.** `src/world/streamer.ts` holds `queuedGen / generating / generated /
   queuedMesh / meshing / meshed` per column; the planning rules are pure functions in
   `src/world/streaming-plan.ts`. Nothing is inferred from `World.hasColumn`. `createWorld` keeps its
   barrier (generate and light radius 5, mesh radius 4, no terrain draw while loading) and streaming then
   fills up to RD. `waitForTerrain(r)` is a region request to the streamer (no duplicate generation, top
   priority, its columns are pinned until it resolves, same contract as before). Both work with
   `requestAnimationFrame` held: while a request is pending, uploads and frees are also done between
   frames in slices of at most 3 ms. `worldEpoch` guards every asynchronous result as before.
3. **Priority:** Chebyshev ring, then columns in the camera frustum, then the larger dot product of the
   smoothed travel direction with the direction to the column (zero when the camera is still), then exact
   distance. Re-prioritised at most once per frame, when the camera column or the view changed.
4. **Stale jobs:** queued generation and mesh jobs of columns that left their ring are removed, results for
   columns that are no longer wanted are dropped, running jobs are not terminated, cancellations are
   counted (`cancelledJobs`).
5. **Uploads:** mesh results wait in a queue; the frame loop uploads while the upload time of this frame is
   below 3 ms (at least one section per frame, so one upload may overshoot). `uploadMsP95` is real and uses
   the same one-second window as `frameCpuMsP95`.
6. **`frameCpuMs`** is the frame callback's main-thread time as `main.ts` measures it (camera, streaming
   update, uploads, draw submission, tint textures). The debug error drain is outside that timer and timed
   as `glCheckMs`.
7. **Debug API** (`src/debug/api/streaming.ts`, one registration line each in `index.ts`):
   `setRenderDistance(n)`, `getStreamingStats()`, `resetFrameStats()` / `getFrameStats()` (adds
   `pumpMsP95` / `pumpMsMax`, see below), `getGlResourceCounts()`. `getRenderStats()`: `chunksLoaded` =
   columns with block data, `chunksMeshed` = columns completely meshed, `chunksVisible` = section meshes
   drawn.
8. **`tests/e2e/helpers/flight.ts`:** `fly()` and `waitForStreamingIdle()`. The camera pose is set in one
   function (`fly`) so M06a can switch it to teleporting the player. `fly()` waits two frames at the end so
   the streamer has seen the final pose.

## Orchestrator and owner decisions made during the task

- **Column-level frustum culling is part of M04a** (SPEC M04 scope). One conservative function
  (`columnInFrustum`, column AABB against the six planes of the view-projection matrix, margin 0.01 block)
  is used for drawing and for the in-frustum priority. Every pass draws only visible columns, draws are
  grouped by column, `chunksVisible` = sections drawn. Not in M04a: section culling, cave culling, batching,
  LOD, a culling toggle (M22a).
- **Owner decision, SPEC.md d37918d (option A):** the M04 flight criterion is now "no frame's main-thread
  work > 50 ms; `frameCpuMsP95` and `uploadMsP95` are measured and reported". Their budgets (<= 8 ms and
  <= 3 ms) are enforced at RD 8 by M22a. M04a asserts `frameCpuMsMax <= 50` and `pumpMsMax <= 50` and
  reports `frameCpuMsP95`, `uploadMsP95` and `glCheckMsMax` (test annotations and the log).

## Fence-gated error drain (changes decisions/M01a-fix-gl-error-check.md, point 2)

M01a-fix point 2 drained WebGL errors with `gl.getError()` as the last step of every debug frame.
`getError` is a synchronous round trip that returns when the GPU has executed every earlier command. With
SwiftShader a frame takes 0.4-0.8 s of GPU time, so that call blocked the main thread for that long every
frame and starved the worker result tasks (`waitForTerrain(8)` took 89.8 s in the probe).

`src/render/fenced-error-drain.ts` replaces it: `endFrame()` inserts a fence (`fenceSync` + `flush`) after the
timer stopped; `beginFrame()` of a later frame calls `getError` only when the oldest pending fence has
signalled, so the call returns at once. Differences from point 2:

- The drain is at the **start** of the next frame callback, not the end of the same one, and reads the errors
  of earlier frames. A drain after any signalled fence covers all earlier frames, so no error goes uncounted.
- **Bound:** at most `MAX_FRAMES_IN_FLIGHT = 4` frames may wait for their drain; at the fourth the next
  frame callback drains with a blocking `getError`. No error stays unread longer than that (unit-tested).
- `getRenderStats()` and the synchronous frame of `createWorld` still drain at once (`drainNow`, blocking),
  so the `holdFrames` tests and the fixture's `glErrors > 0` rule work as before.
- Both parts are outside the `frameCpuMs` timer and counted in `glCheckMs`. `&glcheck=draw` is unchanged.
- With the frame loop and fences the probe `waitForTerrain(8)` takes about 4.2 s instead of 89.8 s.

## The upload rule

During streaming, `bufferData` uploads happen **only in the frame callback, inside its 3 ms budget**. Between
frames the pump (a timer task, <= 3 ms per slice) does GPU frees and starts mesh jobs (copying the padded
sections costs up to ~10 ms for one column) and, **only while a `createWorld` / `waitForTerrain` request is
pending**, uploads. An earlier version also uploaded in the pump whenever the last frame was older than 100
ms; that went around the frame budget and produced single uploads blocked for 0.5-1.7 s. Streaming tasks
outside the frame callback (pump slices and the handlers of worker results) are timed one by one and
reported as `pumpMsP95` / `pumpMsMax`; the flight test asserts `pumpMsMax <= 50`.

## Other implementation decisions

- **No fence-gating of uploads.** Tried and removed: status of a fence appears about 20 frames late in
  Chrome (sampled at each frame start, 18-24 fences were reported unsignalled while a blocking `getError`
  showed a backlog of only ~0.8 s, about two frames). With the gate "no upload while the GPU is behind",
  uploads starved completely (269 deferred for 120 s).
- **Off-frame work for requests.** A pending request lets the pump upload and free in slices so that
  `createWorld` / `waitForTerrain` finish with `requestAnimationFrame` suspended.
- **Hysteresis:** meshes are freed beyond RD+1 and data beyond RD+2, so a column at the edge does not flip
  while the camera hovers over a column border.
- **`pendingTerrainPromises`** is a `StaleMeshHandle` (a `Map` subclass): `delete(key)` / `clear()` on it, as
  existing e2e tests do to force a re-mesh, invalidates the streamer's column instead of leaving it
  `meshed`.
- **Main-thread generation** (`generateColumnMainThread`, used by tests) calls `streamer.adoptColumn`; a
  queued or running worker generation of that column is cancelled and its result ignored.
- **Tint textures** of a column are created while its first section is uploaded (`prepareColumnTints`), not
  in the first frame that draws it, and the per-draw `bindBuffer` of the element buffer was removed (VAOs
  record it). The wireframe pass restores the triangle EBO after each draw.
- **Worker pool replacement** (`setWorkerPoolSize` between worlds) calls `abandonGenerations`: generation jobs
  the old pool dropped silently go back to the queue.
- **A re-mesh replaces the column's section meshes.** A mesh attempt begins with `beginMeshAttempt` and, when
  it completes, `endMeshAttempt` frees the section meshes of earlier attempts that it did not upload. This also
  covers an attempt that produces no section at all, which frees every mesh of the column. Before this, a column
  that became smaller on re-mesh kept its old sections on the GPU (found in review of PR #33).
- **Generation retries are bounded.** A failed generation is queued again until it has had three tries; after
  that the column is marked failed (so no region request waits on it) and `console.error` reports it. Mesh
  jobs are not retried yet: a failed mesh job still leaves its column unmeshed without a report (Known
  limitations).

## Work between frames is in steps (added after the first verify runs under load)

Storing a generated column (20 sections) and copying the padded sections of a column's mesh jobs ran
inside the handlers of worker results and took up to 277 ms when the CPU was contended. `StreamerHost`
now returns steps (`applyGen`: the column with its biome data, then one per section) and starters
(`requestMesh`: one per section that needs a mesh); the pump runs them alternately for about 3 ms per
slice. A generation slot stays taken until the column is stored. A mesh slot is given back when a column
is discarded before all its starters ran. A 0.3 ms step can still take 25-130 ms when the OS preempts
the renderer; that is not fixable by smaller steps (see the handoff, Known limitations).

## Background jobs leave one mesh worker free

`WorkerPool.enqueueMeshJob(..., background)`: streaming jobs never take the last idle worker of a pool
with more than one worker. After `createWorld` the streamer keeps meshing, which left no idle worker for
a foreground job (the M02 WorkerPool test enqueues one right after `createWorld` and expects its buffer
transferred at once; edits in M05+ need the same). Streaming throughput on a 3-worker pool is two
workers; meshing is not the bottleneck on SwiftShader.

## `moveTo` before a region request

With `requestAnimationFrame` held no frame calls `streamer.update`, so after `waitForTerrain` at a new
place the pump freed the new region relative to the old camera column (blank screenshots in M03 tests).
`Streamer.moveTo(view)` is called by `waitForTerrain`.

## SwiftShader findings (what limits the p95 values here)

- One section upload costs 6-10 ms. The frame always uploads at least one section, so `uploadMsP95` is one
  section's cost (6.2-10.1 ms in four RD 8 flights), above the 3 ms budget M22a will enforce.
- Draw submission of ~740 visible sections (3 GL calls each) costs about 5 ms; `frameCpuMsP95` was 10.6-12.2
  ms in the same flights.
- Frames run at ~1.3 fps (GPU 0.4-0.8 s per frame); a `bufferData` call blocks when the GPU is behind.
- Fence status becomes visible about 20 frames late.

## Options considered

- **Moving every upload out of the frame into timer tasks:** hides the cost from the frame timer and keeps
  the main thread equally blocked. Rejected (see the upload rule).
- **Smaller upload units (one bucket per call) and section culling:** would lower both p95 values; moved to
  M22a by the owner (SPEC d37918d).
- **Test-only `glcheck` mode or a longer test timeout** to hide the blocking drain: rejected by the
  orchestrator; the drain was fixed instead.
