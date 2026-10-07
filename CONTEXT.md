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

Done (merged to master; handoff notes in `progress/`): M00a, M00b, M01a, M01b, M01c, M02a, M02b, M02c, M03a, M03b, M03c, M03d, M03e, M03f, M03g, M05a, M16a, M16c. Fix tasks also merged: M02b-fix, M02c-fix, M03b-fix, M03b-fix2, M03b-fix3, M03c-fix2, M03d-fix, M05a-fix.

In flight:

| Task | State | Builder session | Reviewer session | PR | Round | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| M04a | prompt written, waiting for owner to start the builder | — | — | — | — | Builder prompt given in orchestrator session `session_01Nz4dZnD2fqqWa3facEZZ6g` (2026-10-07). |

States: building · gate (waiting for owner) · PR open · review n · fixing n · blocked.

Ready to start: **M04a** Streaming core (depends on M03g, merged). It is the only ready task (M13b, M10a, M17a early starts still wait on M06b, M09a, M10a). Next on the critical path: M04a → M04b → M05b → M06a and M12a.

## Open items for the owner

- M04a frame-time metric: the builder prompt defines `frameCpuMs` as frame main-thread time minus only the wait inside the debug-mode `gl.getError()` loop (SPEC §2.3 "excludes GPU"), with that wait exposed separately. Owner may veto before starting the builder.
- M04a risk: RD 8 means about 3,000 draw calls per frame (81 columns gave 841 in `progress/M03g.md`), and `decisions/M02c-fix-load-path.md` measured 70–576 ms frames at about 750 draws in debug mode. The flight budgets (p95 ≤ 8 ms, max ≤ 50 ms) may be unreachable without M22a's culling and batching. The builder measures first and stops with a QUESTION if so.

- `npm ci` reports 1 high-severity vulnerability in the current dependencies (environment check, 2026-10-07). Not investigated.
- The 350K compaction cap is not yet confirmed on a Sonnet session. On the first builder in `BlockCraft(350K)`, `get_session` should show `context_usage.max_tokens` 350000 instead of 1000000.
- CLAUDE.md says branches are named `claude/<task-id>` and PRs are opened with `gh pr create`. Cloud sessions actually get an assigned branch name, and `gh` may be unavailable. The owner knows and left both as they are.

## Decisions not yet on master

M04a (in the builder prompt; the builder records them in `decisions/M04a-streaming.md`):

- Chunk = 16×16 column; Chebyshev distance in columns. Generate ≤ RD+1, mesh ≤ RD, free meshes > RD+1, free block and light data > RD+2. Invariant: every meshed section has all 8 neighbour columns loaded.
- One streamer owns column state (not `World.hasColumn`). `createWorld` keeps its radius-5/4 barrier; `waitForTerrain` goes through the streamer, works with rAF suspended.
- Priority: ring, then in-frustum, then travel direction, then exact distance. Queued stale jobs removed, running ones dropped on arrival.
- Upload queue drained ≤ 3 ms per frame; `uploadMsP95` made real.
- `frameCpuMs` excludes only the debug `getError` wait (see open items).
- New debug module `src/debug/api/streaming.ts`: `setRenderDistance` (clamp 2–32), `getStreamingStats`, `resetFrameStats`/`getFrameStats`, `getGlResourceCounts`. `chunksLoaded` = columns with block data, `chunksMeshed` = fully meshed columns, `chunksVisible` unchanged.
- Flight helper `tests/e2e/helpers/flight.ts` (page-side rAF loop, wall-clock speed, camera via `window.WorldManager` + `look`), plus `waitForStreamingIdle`.
- Not M04a: fade-in, heap test, RD 12 horizon, screenshots (M04b); streamed lighting (M05b); draw culling, batching, LOD (M22a/b); teleport (M06a).

## Log (newest first)

- 2026-10-07: Orchestrator session `session_01Nz4dZnD2fqqWa3facEZZ6g` started. CONTEXT.md matched master (19c3944, no open PRs). M04a builder prompt written; waiting for the owner.

- 2026-10-07: CONTEXT.md created on `claude/orchestrator`.
- 2026-10-07: `BlockCraft(350K)` environment created and checked: npm ci, Playwright install and typecheck pass.
- 2026-10-07: CLAUDE.md roles (orchestrator, builder, reviewer) merged in [Guna210/BlockCraft#30](https://github.com/Guna210/BlockCraft/pull/30).
