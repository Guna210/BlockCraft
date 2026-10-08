# CONTEXT.md — orchestrator log

The orchestrator's memory between compactions and sessions. It lives only on the `claude/orchestrator` branch, which shares no history with `master` and is never merged.

## Rules for this file

- Read it first: at the start of every orchestrator session and after every compaction. Then run `git fetch origin master` and check it against `progress/` on master and the open PRs. If they disagree, the repo wins; fix this file.
- Update it whenever a task changes state, a decision is made, or the owner states a preference. Commit and push straight away, because the container can be reclaimed at any time.
- Keep it under about 150 lines. When a task merges, move it to Done. Once a decision reaches `decisions/` on master, delete it from this file. Keep the last 20 log entries.
- Facts only, each with its source (PR, session, file). No transcripts or long output.

Last updated: 2026-10-07

## Setup

- The owner starts every builder and reviewer session by hand, pasting the prompt the orchestrator writes. The owner approves every publish gate and merges every PR. `master` is protected: no direct pushes.
- Environments: the orchestrator runs in `BlockCraft`. Builders and reviewers run in `BlockCraft(350K)`, which sets `CLAUDE_CODE_AUTO_COMPACT_WINDOW=350000` so long sessions compact themselves at about 350k tokens.
- Models: orchestrator on Opus; builders and reviewers on Sonnet.
- Builder questions: the owner points the orchestrator at the session (URL, ID or title), and the orchestrator replies with `send_message`, prefixed `[Orchestrator]` (CLAUDE.md, "Talking to other sessions directly").
- Review cycle: at most 3 rounds per task, then ask the owner (CLAUDE.md, Orchestrator).
- CI: `Verify` runs the full suite on every PR and every push to master (job timeout 90 min). Reviewers use it as the full-verify evidence.

## Task status

Done (merged to master; handoff notes in `progress/`): M00a, M00b, M01a, M01b, M01c, M02a, M02b, M02c, M03a, M03b, M03c, M03d, M03e, M03f, M03g, M05a, M16a, M16c. Fix tasks also merged: M01a-fix (#32, 68ef7c7), M02b-fix, M02c-fix, M03b-fix, M03b-fix2, M03b-fix3, M03c-fix2, M03d-fix, M05a-fix.

In flight:

| Task | State | Builder session | Reviewer session | PR | Round | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| M04a | blocked on owner (p95 budget policy) | `session_01GEWHvX4zk6pp3FJX84Faaa` | — | — | — | Local `46b140d`. Pump slices had been uploading outside the frame budget (the source of the 0.5–1.7 s stalls); fixed: streaming uploads only in the frame's 3 ms budget. 4 flights: frame max ≤ 21.5 ms and pump max ≤ 40.6 ms (≤ 50 holds 4/4); coverage, `chunksLoaded` and GL-count checks pass; p95 fails 4/4 (`frameCpuMsP95` 10.6–12.2, `uploadMsP95` 6.2–10.1: one section upload costs 6–10 ms on SwiftShader, draw submission ~5 ms). |

States: building · gate (waiting for owner) · PR open · review n · fixing n · blocked.

Ready to start: **M04a** Streaming core (depends on M03g, merged). It is the only ready task (M13b, M10a, M17a early starts still wait on M06b, M09a, M10a). Next on the critical path: M04a → M04b → M05b → M06a and M12a.

## Open items for the owner

- M04a p95 policy (owner), superseding the earlier five-edit proposal: recommended A = M04a asserts the 50 ms rules plus the functional checks and reports p95; p95 enforced at RD 8 by M22a (SPEC lines 565 and 580 drafted). B = section culling plus smaller uploads, upload p95 ≤ 3 still unlikely. The §2.3 "exclude blocked GL calls" clarification is no longer recommended (it would exclude almost all upload time in CI).



- M04a risk: RD 8 means about 3,000 draw calls per frame (81 columns gave 841 in `progress/M03g.md`), and `decisions/M02c-fix-load-path.md` measured 70–576 ms frames at about 750 draws in debug mode. The flight budgets (p95 ≤ 8 ms, max ≤ 50 ms) may be unreachable without M22a's culling and batching. The builder measures first and stops with a QUESTION if so.

- `npm ci` reports 1 high-severity vulnerability in the current dependencies (environment check, 2026-10-07). Not investigated.
- The 350K compaction cap is not yet confirmed on a Sonnet session. On the first builder in `BlockCraft(350K)`, `get_session` should show `context_usage.max_tokens` 350000 instead of 1000000.
- CLAUDE.md says branches are named `claude/<task-id>` and PRs are opened with `gh pr create`. Cloud sessions actually get an assigned branch name, and `gh` may be unavailable. The owner knows and left both as they are.

## Decisions not yet on master

M01a-fix (in its builder prompt; recorded in `decisions/M01a-fix-gl-error-check.md`): `GLWrapper` constructor and per-draw behaviour unchanged (keeps `tests/unit/gl.test.ts` passing); new public drain method; `main.ts` drains once per frame after the frame timer stops, per-draw only with `&glcheck=draw`; also drains at the end of `createWorld`'s synchronous frame and inside `getRenderStats()`.

M04a (in the builder prompt; the builder records them in `decisions/M04a-streaming.md`):

- Chunk = 16×16 column; Chebyshev distance in columns. Generate ≤ RD+1, mesh ≤ RD, free meshes > RD+1, free block and light data > RD+2. Invariant: every meshed section has all 8 neighbour columns loaded.
- One streamer owns column state (not `World.hasColumn`). `createWorld` keeps its radius-5/4 barrier; `waitForTerrain` goes through the streamer, works with rAF suspended.
- Priority: ring, then in-frustum, then travel direction, then exact distance. Queued stale jobs removed, running ones dropped on arrival.
- Upload queue drained ≤ 3 ms per frame; `uploadMsP95` made real.
- Decision 6 (reissued prompt): `frameCpuMs` as `main.ts` measures it; the M01a-fix per-frame drain stays after the timer; nothing else excluded; drain time exposed as `glCheckMs`; handoff reports max of `frameCpuMs + glCheckMs`.
- New debug module `src/debug/api/streaming.ts`: `setRenderDistance` (clamp 2–32), `getStreamingStats`, `resetFrameStats`/`getFrameStats`, `getGlResourceCounts`. `chunksLoaded` = columns with block data, `chunksMeshed` = fully meshed columns, `chunksVisible` unchanged.
- Flight helper `tests/e2e/helpers/flight.ts` (page-side rAF loop, wall-clock speed, camera via `window.WorldManager` + `look`), plus `waitForStreamingIdle`.
- Column-level frustum culling (owner, SPEC `6411d94`): one conservative column-AABB vs frustum test, shared by draw culling and priority; all passes; `chunksVisible` = sections drawn. Allowed: drop the redundant per-draw `bindBuffer`, sort draws by column. Stop if RD 8 standing-still p95 > 5 ms after culling.
- Per-frame debug drain (inside M04a, changes M01a-fix's `main.ts` design): fence-gated, plus a blocking drain once 4 frames are unread; the blocking drain counts as `glCheckMs`, outside the frame timer; the bound is unit-tested.
- Not M04a: fade-in, heap test, RD 12 horizon, screenshots (M04b); streamed lighting (M05b); section-level or cave culling, batching, culling toggle, LOD (M22a/b); teleport (M06a).

## Log (newest first)

- 2026-10-08: M04a: background-slice uploads around the frame budget found and fixed; 50 ms rules now hold. Recommendation to the owner revised: assert the 50 ms rules in M04a, enforce p95 at RD 8 in M22a.

- 2026-10-08: M04a QUESTION 5: in-scope fixes can't make the 50 ms rule hold under SwiftShader (blocked uploads of 0.5–1.7 s). Put the budget-policy decision to the owner; builder holding.

- 2026-10-08: M04a QUESTION 4: flight test flaky against its budgets (numbers in the table). Sent the owner the section-culling decision; told the builder to fence-gate uploads and account for pump slices meanwhile.

- 2026-10-08: M04a builder (status message): drain fix done (variant b plus a 4-frame bound), streaming 22× faster in CI. Orchestrator acked and asked for glCheckMs accounting and a unit test of the bound.

- 2026-10-08: M04a QUESTION 3: the per-frame `getError` drain makes streaming ~29× slower in CI. Orchestrator rejected test-only workarounds and asked for a non-blocking drain within SPEC §3.2's "once per frame".

- 2026-10-08: M04a QUESTION 2 (p95 tail after culling). Orchestrator chose a bounded investigation, then the streamer; budget decisions wait for real flight numbers (owner's).

- 2026-10-08: Owner merged the SPEC change (`6411d94`, column-level frustum culling moved from M22a into M04a). Orchestrator answered the M04a builder: option 1, sync to master, branch `claude/m04a`, culling first.

- 2026-10-08: M01a-fix merged (#32). M04a builder stopped with a QUESTION: RD 8 frame budget unreachable on master (numbers in the table). Recommended pulling column-level frustum culling into M04a; SPEC edits handed to the owner.

- 2026-10-08: M01a-fix review round 1 PASS; CI `verify` green on `9f3dbda`, mergeable clean. Told the owner to merge; suggested a real-GPU check on the branch preview. M04a prompt reissued with decision 6 rewritten.

- 2026-10-08: M01a-fix opened [#32](https://github.com/Guna210/BlockCraft/pull/32). Builder measured under SwiftShader: `getError` 841 → 1 per frame, `frameCpuMsP95` 349–674 → 1.3–3.6 ms, fps unchanged at 2–4 (software rasterising limits fps in CI; matters for M04a streaming throughput). Owner asked about reusing one reviewer for all PRs: answered no, one reviewer session per task (CLAUDE.md Roles).

- 2026-10-07: Owner measured 22 → 200 FPS with the per-draw check off. Full replacement text for SPEC.md lines 180, 431, 454 given to the owner.

- 2026-10-07: Owner confirmed the per-draw `getError` cause with the console check. M01a-fix prompt and SPEC wording given; M04a waits for M01a-fix.

- 2026-10-07: Owner reported low debug-mode FPS on real hardware. M04a put on hold; console check proposed (see open items).

- 2026-10-07: Orchestrator session `session_01Nz4dZnD2fqqWa3facEZZ6g` started. CONTEXT.md matched master (19c3944, no open PRs). M04a builder prompt written; waiting for the owner.

- 2026-10-07: CONTEXT.md created on `claude/orchestrator`.
- 2026-10-07: `BlockCraft(350K)` environment created and checked: npm ci, Playwright install and typecheck pass.
- 2026-10-07: CLAUDE.md roles (orchestrator, builder, reviewer) merged in [Guna210/BlockCraft#30](https://github.com/Guna210/BlockCraft/pull/30).
