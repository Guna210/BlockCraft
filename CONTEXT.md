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
- Models: orchestrator on Opus. Owner (2026-10-09): Haiku with ultracode for builders and reviewers, to save cost, relying on the orchestrator to check. Orchestrator advised Sonnet for core-system builds (lighting, physics, fluids, networking) and tracking fix rounds per task. No automatic pre-merge check by the orchestrator: the owner asks explicitly when wanted (owner, 2026-10-09). Reported costs so far: orchestrator ~$36, M04a builder (Sonnet) ~$22, M04a reviewer (Haiku + ultracode) ~$0.82.
- Builder questions: the owner points the orchestrator at the session (URL, ID or title), and the orchestrator replies with `send_message`, prefixed `[Orchestrator]` (CLAUDE.md, "Talking to other sessions directly").
- Review cycle: at most 3 rounds per task, then ask the owner (CLAUDE.md, Orchestrator).
- CI: `Verify` runs the full suite on every PR and every push to master (job timeout 90 min). Reviewers use it as the full-verify evidence.

## Task status

Done (merged to master; handoff notes in `progress/`): M00a, M00b, M01a, M01b, M01c, M02a, M02b, M02c, M03a, M03b, M03c, M03d, M03e, M03f, M03g, M05a, M16a, M16c. M04a (#33, b80294e). Fix tasks also merged: M01a-fix (#32, 68ef7c7), M02b-fix, M02c-fix, M03b-fix, M03b-fix2, M03b-fix3, M03c-fix2, M03d-fix, M05a-fix.

In flight:

| Task | State | Builder session | Reviewer session | PR | Round | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| M04b | prompt written, waiting for owner to start the builder | — | — | — | — | Prompt given 2026-10-09. Includes M04a review leftover 1 (empty `meshAttempts` Set). |

States: building · gate (waiting for owner) · PR open · review n · fixing n · blocked.

Ready to start: **M04b** Fade-in & memory (depends on M04a, merged b80294e). Only ready task. Next: M05b (needs M04b + M05a), then M06a and M12a in parallel.

## Open items for the owner

- Before M22a: two-tier speed budgets in SPEC §2.3 (real-hardware targets checked by `npm run bench`; SwiftShader CI bounds set from measured CI values plus a margin), like the existing 3 s / 20 s createWorld budget. Offered to draft; owner has not asked yet.

- `retries: process.env.CI ? 2 : 0` (playwright.config.ts line 8) lets CI pass a flaky test on retry, so CI green does not prove a test is stable. Suggest a later decision: retries 0, after checking recent CI runs for flaky counts.




- M04a risk: RD 8 means about 3,000 draw calls per frame (81 columns gave 841 in `progress/M03g.md`), and `decisions/M02c-fix-load-path.md` measured 70–576 ms frames at about 750 draws in debug mode. The flight budgets (p95 ≤ 8 ms, max ≤ 50 ms) may be unreachable without M22a's culling and batching. The builder measures first and stops with a QUESTION if so.

- `npm ci` reports 1 high-severity vulnerability in the current dependencies (environment check, 2026-10-07). Not investigated.
- The 350K compaction cap is not yet confirmed on a Sonnet session. On the first builder in `BlockCraft(350K)`, `get_session` should show `context_usage.max_tokens` 350000 instead of 1000000.
- CLAUDE.md says branches are named `claude/<task-id>` and PRs are opened with `gh pr create`. Cloud sessions actually get an assigned branch name, and `gh` may be unavailable. The owner knows and left both as they are.

## Decisions not yet on master

M04a and M01a-fix decisions are on master (`decisions/M04a-streaming.md`, `decisions/M01a-fix-gl-error-check.md`).

M04b (in the builder prompt; to be recorded in `decisions/M04b-fade-and-memory.md`):

- Per-column dither fade (4×4 Bayer on gl_FragCoord, all passes, one uniform per column, fixed 300–500 ms wall clock). It starts at the column's first section upload; a re-mesh doesn't fade again; a column streamed back in fades again.
- Sections uploaded while a createWorld/waitForTerrain request is pending show at full opacity (existing screenshot tests unchanged).
- Heap test: RD 8, out and back 2000 blocks each at 60 blocks/s, gc twice before each read, growth ≤ 15 %, inside the 180 s timeout.
- RD 12 horizon test with a hole check; no fog until M12a. Fast-flight shot mid-flight at 30 blocks/s.
- Fix M04a review leftover 1 (empty Set in `meshAttempts`); leftover 2 (a failed-generation column blocks its neighbours) is left as a known limitation.

## Log (newest first)

- 2026-10-09: Owner merged M04a (#33, `b80294e`); master green. M04b builder prompt written.

- 2026-10-09: M04a review round 2: PASS, CI green on `bbc9a1e`. Recommended merging as is; non-blocking items 1–2 to go into the M04b prompt.

- 2026-10-09: M04a round-1 fixes pushed (`bbc9a1e`). Orchestrator sent the round-2 request to the reviewer session.

- 2026-10-09: Owner preference: Haiku with ultracode for builders and reviewers. No automatic pre-merge checks by the orchestrator; only when the owner asks.

- 2026-10-09: M04a review round 1: CHANGES NEEDED. Orchestrator checked the findings and sent the builder its fixes. Reviewer N6 (debug glCheckMs up to 1.8 s in CI) put to the owner to accept.

- 2026-10-09: Owner approved the M04a gate; PR [#33](https://github.com/Guna210/BlockCraft/pull/33) opened. Reviewer prompt given.

- 2026-10-09: Orchestrator checked the M04a gate message (24 files, no deletions, no harness files, verify green, 10/10 runs). Gave the owner a paste-ready approval; the orchestrator cannot approve gates (CLAUDE.md). Reviewer to check why `src/world/lighting.ts` changed.

- 2026-10-09: M04a plain verify green after the `workers: 1` change; builder at the publish gate, waiting for the owner.

- 2026-10-09: Owner merged Playwright `workers: 1` (`60590f8`). M04a builder told to sync and re-run the plain verify for the gate. Owner asked whether the thresholds are too strict: answered that they suit real hardware, and suggested two-tier budgets before M22a.

- 2026-10-08: M04a builder confirmed no test needed a retry (CI=1 verify and the 10 m04 runs).

- 2026-10-08: M04a: CI=1 verify green, plain 2-worker verify flakes on pump max (CPU contention). Recommended `workers: 1` to the owner; asked the builder for retry counts.

- 2026-10-08: M04a status: own verify failures fixed; open risk of the 50 ms checks missing under local 2-worker load. Orchestrator asked for a pool-size-1 check and a report instead of re-runs.

- 2026-10-08: Owner chose option A (SPEC `d37918d`). Orchestrator told the M04a builder to sync, finish the asserts, run m04 10 times in a row, then verify and go through the publish gate.

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
