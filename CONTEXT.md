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

Done (merged to master; handoff notes in `progress/`): M00a, M00b, M01a, M01b, M01c, M02a, M02b, M02c, M03a, M03b, M03c, M03d, M03e, M03f, M03g, M05a, M16a, M16c. M04a (#33, b80294e). M04b (#34, 427660a). Fix tasks also merged: M01a-fix (#32, 68ef7c7), M02b-fix, M02c-fix, M03b-fix, M03b-fix2, M03b-fix3, M03c-fix2, M03d-fix, M05a-fix.

In flight:

| Task | State | Builder session | Reviewer session | PR | Round | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| M05b | building: QUESTION answered, owner decision pending on the cave tests | `session_01RsegcCFUbMz3XUzDKjxLBs` (BlockCraft(750K), Haiku) | — | — | — | Local `2c93ffc`, 4 e2e failing. Told the builder: torch tint applied after the brightness curve (channel = level − offset); batched light jobs + ≤ 2 ms main thread per job; build `setDebugLight`. Owner to decide: may M05b call setDebugLight in the M03g cave viewpoint and m03d cave tests (SPEC line 523 says "with debug light")? |

States: building · gate (waiting for owner) · PR open · review n · fixing n · blocked.

Ready to start: **M05b** Smooth lighting & AO (depends on M04b #34 and M05a, both merged). Only ready task. Next: M06a and M12a in parallel (both need only M05b). Next: M05b (needs M04b + M05a), then M06a and M12a in parallel.

## Open items for the owner

- Before M22a: two-tier speed budgets in SPEC §2.3 (real-hardware targets checked by `npm run bench`; SwiftShader CI bounds set from measured CI values plus a margin), like the existing 3 s / 20 s createWorld budget. Offered to draft; owner has not asked yet.
- `retries: process.env.CI ? 2 : 0` (playwright.config.ts line 8) lets CI pass a flaky test on retry, so a green CI run doesn't prove a test is stable. Suggest a later decision on retries 0, after checking recent CI runs for flaky counts.
- `npm ci` reports 1 high-severity vulnerability in the current dependencies (environment check, 2026-10-07). Not investigated.

## Decisions not yet on master

M04a and M01a-fix decisions are on master (`decisions/M04a-streaming.md`, `decisions/M01a-fix-gl-error-check.md`).

M04b decisions are on master (`decisions/M04b-fade-and-memory.md`).

M05b (in the builder prompt; to be recorded in `decisions/M05b-smooth-lighting.md`):

- Streamed columns are lit by a per-column light job: block data of the column plus its 8 neighbours, computed from scratch, committing only the centre column. This is exact, because a light path is ≤ 15 blocks and the neighbours cover 16. It also returns a 1-block skirt, used for padded light where a neighbour isn't lit yet. Streamer phases: generated → lit → meshed; light ring = mesh ring (≤ RD). createWorld keeps the region job; a unit test checks the two methods agree cell for cell on interior columns.
- Block light becomes R, G, B channels (each a BFS, combined by max). `getLight().block` = max(R,G,B), which equals the old single channel exactly, so M05a's tests stay unchanged. Emitters: level + tint, channel = round(level × tint component) with the tint's max component = 1. Torch 14 warm orange, lumite 12 cool cyan, lava 15. Lamp and glowcap values go to their own tasks.
- Uniform sky-15 / no-block-light sections share one sentinel (no allocation).
- Vertex: word0 block field = R; word1 repacked to tile 12 bits, u 5, v 5, G 4, B 4 (assert < 4096 tiles). A greedy merge requires identical corner tuples.
- Smooth light: average of the transparent cells among the 4 samples, dropping the corner when both sides are opaque. AO: classic 0–3; quad flip on the diagonal comparison; plants and models take their own cell's light and no AO.
- Shader: light interpolated per fragment, then a named brightness curve (brightness(0) ≤ 0.05, brightness(15) = 1), then max per channel of sky (white × u_skyBrightness, 1.0) and block RGB, × AO factor × the existing face shading.
- Torch: a standing non-cube model, its texture per ART.md, in a new data/blocks file. No item or icon.
- Existing tests whose assertions change legitimately under lighting: stop and ask, don't edit them. Re-check the heap test (M04b note).

## Log (newest first)

- 2026-10-10: M05b round-2 report: torch rise 31.7 (hue 25°), setDebugLight built, mid-flight still 100 % sky (now mesh-bound), M04b heap test 2.8 min (times out in the suite). Orchestrator: tune the curve exponent and room; diagnose the per-stage streaming throughput against master and fix the regression in M05b's code. Owner's cave decision still pending.
- 2026-10-10: M05b QUESTION (4 e2e failing: M03d/M03g caves dark, M04b mid-flight 100 % sky, torch rise 25.5). Orchestrator rejected changing tests or criteria; gave fixes (tint after the curve, batched light jobs, cheaper main thread, debug light). Asked the owner about the cave tests.
- 2026-10-10: Owner merged M04b (#34, `427660a`); master green. M05b builder prompt written (only ready task).
- 2026-10-10: M04b review round 4: PASS, CI green on `2c89919`. Waiting for the owner to merge #34.
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
