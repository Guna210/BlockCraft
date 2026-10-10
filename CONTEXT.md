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
| M04b | review 4 (owner-authorised, docs `2c89919`) | `session_01CfDHzBTv5kNyqS718jaK4u` (BlockCraft(750K), Haiku) | `session_01FjLKf1YKQ6MQ1NWbXtzkx2` | [#34](https://github.com/Guna210/BlockCraft/pull/34) (`claude/m04b`) | 2 | Round 2 CHANGES NEEDED: B1 resolved (keeping the light data is legitimate); B2 = unlabelled, mixed-unit heap figures in progress line 41 and decision lines 38–39. Also: decision 7 sentence, frameStats growth note, thin heap-test time margin. Round 3 is the last. CI green on `aa08b33`. Docs fix pushed `7079849`. |

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

- 2026-10-10: M04b docs fix pushed (`2c89919`, two doc files only). Orchestrator sent the round-4 request.
- 2026-10-10: Owner chose option 3 for M04b: docs-only fix, then a 4th review round. Orchestrator sent the builder the 7 provenance items plus the decision 7 measurement.
- 2026-10-10: M04b review round 3: CHANGES NEEDED, docs provenance only (7 unsourced or unlabelled historical heap figures). CI green on `7079849`; code accepted. 3-round limit hit: asked the owner. Recommended one more docs-only commit dropping the unsourced figures, then merge without a 4th review.
- 2026-10-10: M04b docs fix pushed (`7079849`, two doc files only). Orchestrator sent the round-3 request.
- 2026-10-10: M04b review round 2: CHANGES NEEDED, docs only (B2 heap figures). B1 resolved. Builder sent a docs-only fix for round 3 (the last).
- 2026-10-10: M04b round-1 fixes pushed (`aa08b33`). Orchestrator sent the round-2 request (check that keeping the light data is legitimate; look at the +4.9 % second round).
- 2026-10-10: M04b review round 1: CHANGES NEEDED (heap baseline inflated by ~7.9 MB of retained ArrayBuffers; handoff numbers inconsistent). Orchestrator sent the fix list to the builder.
- 2026-10-10: Owner approved M04b gate; PR [#34](https://github.com/Guna210/BlockCraft/pull/34) opened from `claude/m04b` (`ca25171`). Reviewer prompt given.
- 2026-10-10: M04b new gate on `f428c46`: verify green (629 s), heap self-check +61 MB, three m04 runs at −41 % growth, horizon largest hole 14 px. Waiting for owner approval.
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
