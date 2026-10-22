# INFRA-stream — Streaming headroom for M04b

Not a SPEC task; the owner requested it. Goal: both borderline M04b e2e tests (`m04.spec.ts:221` heap, `m04.spec.ts:276` RD12 horizon) pass on the first attempt on GitHub CI. Method: relative measurements in the build container, because the container is slower than CI and does not reproduce the CI failure by itself (all three M04b tests pass on master here, 6.0 min).

**Result: no game-code change gave a clear, repeatable gain, so none is included.** The PR carries this write-up and the owner-approved time limits (below).

## Probe

A scratch Playwright script (not committed) creates a world, sets RD 12, clouds off, and polls `getStreamingStats` / `getFrameStats` once a second until genQueued, genRunning, lightQueued, lightRunning, meshQueued, meshRunning and uploadsDeferred are all 0 on two polls. It reports time to idle and frames drawn. A second mode counts `requestAnimationFrame` calls in a 20 s window once idle. Each commit was built in its own git worktree (`vite build`) and served by `vite preview`. "Pinned" means `taskset -c 0,1` on the whole browser, to look like a 2-core CI runner.

## 1. Bisect: no step change between merge commits

Time to idle at RD 12 (s), 4-core container, no pinning:

| Commit | Time to idle | Frames in that time |
| --- | --- | --- |
| ae48baf (M17b) | 55 | 71 |
| fa0bb62 (M17c) | 49 | 67 |
| 203ecbc (M13c) | 56 | 74 |
| cf97712 (master, M18a) | 63 (first run); 53, 56, 54 in three later runs | 78 |

Steady state after idle (`rAF` over 15 s): ae48baf 2093 and 2376 ms per frame; cf97712 2384 ms (a second cf97712 run had one 37 s stall). Draw calls (1565), triangles (1,062,699) and visible sections (1154) are identical at ae48baf and cf97712. Pinned to 2 cores: ae48baf did not go idle in 130 s (25 uploads still deferred), 203ecbc did not in 146 s (10 deferred, 134 mesh queued), cf97712 went idle at 97 s. Pinned base runs later: 168, 183, 187 s. So the pinned runs are 2–3× slower and noisy (±40 %), and no commit stands out.

The real test on master in this container: heap 2.5 min, RD12 2.3 min, fast flight 1.1 min, all passed (`--retries=0`).

## 2. Profile (current master, RD 12, 4 cores)

- V8 sampling profile over a 100 s run: 76.5 % of main-thread time is `(idle)`. Of the rest, `gl.getError` was 15 % (the blocking drain; in the first profile 54 % was my own probe calling `getRenderStats`), `World.getHeight` from `updateColumn` (called from `applyStep`) 2.8 %, worker `postMessage` 0.7 %, GC 0.6 %, `processQueue` 0.5 %. Draw submission, uploads, HUD, ECS, menu and autosave code do not show up.
- `WorldManager.render()` itself takes 4–8 ms per frame. Wrapped `drainUploads` calls show 100–150 uploads in one 3 ms budget when the GPU is idle (about 0.03 ms each) and 1 upload at 5–7 ms when the GPU is behind.
- `requestAnimationFrame` callbacks come in bursts of about 4 frames 3–30 ms apart, then stall for 1–4 s (once 37 s) with the main thread idle. Frame cadence is about 0.4–0.7 fps. Removing every draw call (`drawElements`/`drawArrays` no-ops) did not restore frame rate, so the stall is not terrain draw cost alone.
- The page has two canvases (game, HUD) and no filters, blur or large DOM layers.

## 3. Why uploads defer

Uploads happen only in the frame callback inside a 3 ms budget (decisions/M04a-streaming.md: the pump must not upload without a pending request). The budget counts upload time only, not unrelated work, and nothing else eats it. What limits throughput is the **frame cadence under SwiftShader backpressure**: the GPU process (software rasteriser, sharing a few cores with the workers) takes 1–3 s per frame at RD 12; Chrome lets about 4 frames queue and then throttles `rAF`; when a frame starts with the GPU behind, `bufferData` blocks until the command ring drains, so only 1–5 uploads fit; when it starts with the GPU idle, 100+ fit. Mesh dispatch stops at `maxDeferred` (256), so `uploadsDeferred` sits near 256–290 while `meshQueued` drains at the rate uploads happen. Time to idle is therefore about (sections to upload ÷ uploads per frame) × frame time. Main-thread cost matters only indirectly (CPU taken from SwiftShader on a small runner), which is how M17c, M13c and M13d each pushed the tests over the edge without a visible regression in a profile.

## 4. Experiments (A/B), including the negative ones

Upper-bound experiments patch the page before load (`addInitScript`), so they change the picture and are measurements only.

| Experiment | Result | Kept? |
| --- | --- | --- |
| Strip every `discard` from the terrain fragment shader (SwiftShader may skip early depth test when a shader can discard), unpinned, 2 runs each | idle 48 / 53 s vs 55 / 57 s base; frames per 20 s 10 / 6 vs 6 / 2 | no, see next row |
| Visual-identical version: `NO_DISCARD` program variants for the opaque pass of finished-fade columns, plus nearest-first column draw order, unpinned, 3 runs each against a master build | **worse**: idle 62 / 58 / 59 s vs 53 / 56 / 54 s; frames per 20 s 3 / 2 / 2 vs 6 / 10 / 6 | **no**, reverted (never pushed) |
| Same, pinned (2 cores), strip discards, 3 runs | idle 113 / 227 / 231 s vs base 168 / 183 / 187 s | no: within noise |
| No depth blit at all (`blitFramebuffer` no-op, upper bound for skipping `FluidDepth.capture`), pinned, 3 runs | idle 207 / 104 / 157 s vs base 168 / 183 / 187 s | no: within noise, so a cheaper capture cannot help |
| Throttle gen/light dispatch while `uploadsDeferred` is at its limit | not built. Gen and light queues are empty after about 10 s of a ~55 s run, and mesh dispatch already stops at `maxDeferred`; `SharedWorkerBudget` already limits all three pools to `hardwareConcurrency - 1` threads in total. Nothing is left to throttle in the long phase | no |
| Heap test (m04:221) | passes here: baseline 34.49 MB, end 34.79 MB, growth 0.86 % (limit 15 %). The CI failure mode is "streaming did not become idle", not growth, so no leak was looked for beyond this | no change |

Not attempted, out of scope: occlusion culling of enclosed sections (SPEC M22a), smaller upload units (moved to M22a by the owner), lowering render quality or RD.

## 5. What this PR changes

Only owner-approved time limits in `tests/e2e/m04.spec.ts` (no assertion, threshold, harness, config or helper change; the file is not one of the SPEC §5.7 harness paths):

| Test | Before | After |
| --- | --- | --- |
| heap (`:221`) | default 180 s test timeout; `waitForStreamingIdle` 60 s ×3 | `test.setTimeout(420_000)`; 120 s ×3 |
| RD12 horizon (`:276`) | default 180 s; `waitForStreamingIdle` 120 s | `test.setTimeout(420_000)`; 300 s |

No game code changed. If CI shard 2 still takes much longer than 15 minutes, the remaining levers are on the harness side (SwiftShader flags, CI machine size), which are the owner's call.
