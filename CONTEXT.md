# CONTEXT.md — orchestrator log

The orchestrator's memory between compactions and sessions. It lives only on the `claude/orchestrator` branch, which shares no history with `master` and is never merged.

## Rules for this file

- Read it first: at the start of every orchestrator session and after every compaction. Then run `git fetch origin master` and check it against `progress/` on master and the open PRs. If they disagree, the repo wins; fix this file.
- Update it whenever a task changes state, a decision is made, or the owner states a preference. Commit and push straight away, because the container can be reclaimed at any time.
- Keep it under about 150 lines. When a task merges, move it to Done. Once a decision reaches `decisions/` on master, delete it from this file. Keep the last 20 log entries.
- Facts only, each with its source (PR, session, file). No transcripts or long output.

Last updated: 2026-10-10

## Setup

- The owner starts every builder and reviewer session by hand, pasting the prompt the orchestrator writes. The owner approves every publish gate and merges every PR. Only the owner writes to `master`: PR merges, plus direct commits for owner-file and harness edits (below). Sessions never push to it.
- Environments: the orchestrator runs in `BlockCraft`. Builders and reviewers run in `BlockCraft(350K)` (`CLAUDE_CODE_AUTO_COMPACT_WINDOW=350000`, so long sessions compact themselves at about 350k tokens) or `BlockCraft(750K)` (the M04b builder).
- Models: orchestrator on Opus. Owner (2026-10-09): Haiku with ultracode for builders and reviewers, to save cost, relying on the orchestrator to check. Orchestrator advised Sonnet for core-system builds (lighting, physics, fluids, networking) and tracking fix rounds per task. No automatic pre-merge check by the orchestrator: the owner asks explicitly when wanted (owner, 2026-10-09). Reported costs so far: orchestrator ~$36, M04a builder (Sonnet) ~$22, M04a reviewer (Haiku + ultracode) ~$0.82.
- Builder questions: the owner points the orchestrator at the session (URL, ID or title), and the orchestrator replies with `send_message`, prefixed `[Orchestrator]` (CLAUDE.md, "Talking to other sessions directly"). Builders and reviewers also message the orchestrator directly; their messages arrive as queued notifications (read with ReadNotifications). Find a session by title with `list_sessions`.
- Branches: builders push to `claude/<task-id>` as CLAUDE.md says (worked for #32 `claude/m01a-fix` and #33 `claude/m04a`). Gate approval comes only from the owner in the builder's session; the orchestrator gives the owner a paste-ready approval line.
- The owner edits owner files and harness files directly on master: SPEC `2be70f2` (§3.2 GL errors once per frame, `&glcheck=draw`), `6411d94` (column-level frustum culling moved into M04a), `d37918d` (M04 flight p95 reported, enforced at RD 8 by M22a), playwright.config.ts `60590f8` (`workers: 1`), and `90c809b` + SPEC `67381df` (`--enable-precise-memory-info` for the M04b heap test).
- Review cycle: at most 3 rounds per task, then ask the owner (CLAUDE.md, Orchestrator).
- CI: `Verify` runs the full suite on every PR and every push to master (job timeout 90 min). Reviewers use it as the full-verify evidence.

## Task status

Done (merged to master; handoff notes in `progress/`): M00a, M00b, M01a, M01b, M01c, M02a, M02b, M02c, M03a, M03b, M03c, M03d, M03e, M03f, M03g, M05a, M16a, M16c. M04a (#33, b80294e). Fix tasks also merged: M01a-fix (#32, 68ef7c7), M02b-fix, M02c-fix, M03b-fix, M03b-fix2, M03b-fix3, M03c-fix2, M03d-fix, M05a-fix.

In flight:

| Task | State | Builder session | Reviewer session | PR | Round | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| M04b | building: gate posted, sent back for fixes (orchestrator, 2026-10-09) | `session_01CfDHzBTv5kNyqS718jaK4u` (BlockCraft(750K), Haiku) | — | — | — | Local commit `dacd4e4` (docs; `8b4d00f` before): horizon fix done (largest enclosed 14 px); heap probe fails as expected (64 MB array, 0 growth). Push to `claude/m04b`. Owner chose A (flag on master). Builder told to merge master, run m04 ×3 and full verify, then post a new gate. |

States: building · gate (waiting for owner) · PR open · review n · fixing n · blocked.

Ready to start: none (M04b is in flight). Next: M05b (needs M04b + M05a), then M06a and M12a in parallel.

## Open items for the owner

- Before M22a: two-tier speed budgets in SPEC §2.3 (real-hardware targets checked by `npm run bench`; SwiftShader CI bounds set from measured CI values plus a margin), like the existing 3 s / 20 s createWorld budget. Offered to draft; owner has not asked yet.
- `retries: process.env.CI ? 2 : 0` (playwright.config.ts line 8) lets CI pass a flaky test on retry, so a green CI run doesn't prove a test is stable. Suggest a later decision on retries 0, after checking recent CI runs for flaky counts.
- `npm ci` reports 1 high-severity vulnerability in the current dependencies (environment check, 2026-10-07). Not investigated.

## Decisions not yet on master

M04a and M01a-fix decisions are on master (`decisions/M04a-streaming.md`, `decisions/M01a-fix-gl-error-check.md`).

M04b (in the builder prompt; to be recorded in `decisions/M04b-fade-and-memory.md`):

- Per-column dither fade (4×4 Bayer on gl_FragCoord, all passes, one uniform per column, fixed 300–500 ms wall clock). It starts at the column's first section upload; a re-mesh doesn't fade again; a column streamed back in fades again.
- Sections uploaded while a createWorld/waitForTerrain request is pending show at full opacity (existing screenshot tests unchanged).
- Heap test: RD 8, out and back 2000 blocks each at 60 blocks/s, gc twice before each read, growth ≤ 15 %, inside the 180 s timeout.
- RD 12 horizon test with a hole check; no fog until M12a. Fast-flight shot mid-flight at 30 blocks/s.
- Fix M04a review leftover 1 (empty Set in `meshAttempts`); leftover 2 (a failed-generation column blocks its neighbours) is left as a known limitation.
- Gate round (2026-10-09): branch `claude/m04b`, not the session default. The horizon hole check is an enclosed-sky flood fill over the whole frame (largest enclosed component ≤ 64 px), plus a debug-API check that every column within RD 12 is meshed and none is fading; it replaces the builder's centre-only check. The heap test gets a self-check: a 64 MB JS array must show ≥ 32 MB growth. `m04-fast-flight.png` is accepted as a known SwiftShader limitation (the honest mid-flight frame, hole-finder numbers reported, M22a to retake it); the owner can overrule.

## Log (newest first)

- 2026-10-10: Owner added `--enable-precise-memory-info` on master (`90c809b`, SPEC `67381df`). M04b builder told to merge master, run m04 ×3 and full verify, then post a new gate.
- 2026-10-09: M04b builder corrected the orchestrator's fast-flight wording, with a probe (sky past the RD 8 edge; ceiling in view): the notes now say the enclosed sky can't be told apart from sky past the edge. Orchestrator agreed; no extra test (`dacd4e4`).
- 2026-10-09: M04b builder report (`8b4d00f`): horizon enclosed-sky check passes; heap probe shows 0 growth after a 64 MB allocation, so the problem is confirmed; fast-flight frame has 37,510 px enclosed (no sky in top row). Orchestrator: keep top-row seed (enclosed = not yet drawn); heap waits for owner.
- 2026-10-09: M04b gate (`5d3de39`, verify green, 334 unit / 44 e2e). Orchestrator answered: branch `claude/m04b`; horizon check replaced by an enclosed-sky check; heap test found vacuous (bucketed `performance.memory`), fix put to the owner; fast-flight shot accepted as a known limitation. New gate to follow.
- 2026-10-09: CONTEXT.md tidied before an owner compaction (open items, log trimmed to 20, setup facts added).
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
