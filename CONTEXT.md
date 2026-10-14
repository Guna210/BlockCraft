# CONTEXT.md — orchestrator log

The orchestrator's memory between compactions and sessions. It lives only on the `claude/orchestrator` branch, which shares no history with `master` and is never merged.

## Rules for this file

- Read it first: at the start of every orchestrator session and after every compaction. Then run `git fetch origin master` and check it against `progress/` on master and the open PRs. If they disagree, the repo wins; fix this file.
- Update it whenever a task changes state, a decision is made, or the owner states a preference. Commit and push straight away, because the container can be reclaimed at any time.
- Keep it under about 150 lines. When a task merges, move it to Done. Once a decision reaches `decisions/` on master, delete it from this file. Keep the last 20 log entries.
- Facts only, each with its source (PR, session, file). No transcripts or long output.

Last updated: 2026-10-13

## Setup

- The owner starts every builder and reviewer session by hand, pasting the prompt the orchestrator writes. The owner approves every publish gate and merges every PR. Only the owner writes to `master`: PR merges, plus direct commits for owner-file and harness edits (below). Sessions never push to it.
- Environments: the orchestrator runs in `BlockCraft`. Builders and reviewers run in `BlockCraft(350K)` (`CLAUDE_CODE_AUTO_COMPACT_WINDOW=350000`, so long sessions compact themselves at about 350k tokens) or `BlockCraft(750K)` (the M04b builder).
- Models: orchestrator on Opus. Owner (2026-10-09): Haiku with ultracode for builders and reviewers, to save cost, relying on the orchestrator to check. Orchestrator advised Sonnet for core-system builds (lighting, physics, fluids, networking) and tracking fix rounds per task. No automatic pre-merge check by the orchestrator: the owner asks explicitly when wanted (owner, 2026-10-09). Reported costs so far: orchestrator ~$36, M04a builder (Sonnet) ~$22, M04a reviewer (Haiku + ultracode) ~$0.82.
- Builder questions: the owner points the orchestrator at the session (URL, ID or title), and the orchestrator replies with `send_message`, prefixed `[Orchestrator]` (CLAUDE.md, "Talking to other sessions directly"). Builders and reviewers also message the orchestrator directly; their messages arrive as queued notifications (read with ReadNotifications). Find a session by title with `list_sessions`.
- Branches: builders push to `claude/<task-id>` as CLAUDE.md says (worked for #32 `claude/m01a-fix` and #33 `claude/m04a`). Gate approval comes only from the owner in the builder's session; the orchestrator gives the owner a paste-ready approval line.
- The owner edits owner files and harness files directly on master: SPEC `2be70f2` (§3.2 GL errors once per frame, `&glcheck=draw`), `6411d94` (column-level frustum culling moved into M04a), `d37918d` (M04 flight p95 reported, enforced at RD 8 by M22a), playwright.config.ts `60590f8` (`workers: 1`), and `90c809b` + SPEC `67381df` (`--enable-precise-memory-info` for the M04b heap test).
- Codex (owner, 2026-10-11, updated 10-13): Codex cloud builds most tasks (full model for core work). Prompts carry the CLAUDE.md rules and the known container-only failure list. Branch `claude/<id>`; publish gate in chat, owner approves; Codex opens the PR via its connected GitHub integration when `gh` is blocked. Container has a 2-core quota, so local timing failures go to a draft PR and CI decides.
- Reviewers: Claude Sonnet sessions (new session per task; rounds 2–3 in the same session). The orchestrator reads verdicts via list_events (kinds: result).
- agy / Antigravity (owner, 2026-10-13): runs on the owner's old Windows laptop (PowerShell, Node 24, git from GitHub Desktop at C:\Users\Akbho\AppData\Local\GitHubDesktop\app-3.6.6\resources\app\git\cmd). Workflow: owner creates `agy/<id>` on GitHub from master, checks it out in GitHub Desktop; agy may only commit (no checkout/switch/branch/push/pull/merge/rebase/reset, never amend); owner pushes via Desktop and opens a draft PR. agy runs only `verify:quick`; GitHub CI is the full-verify evidence (owner decision). For unit-only tasks, 'no tests found' in quick e2e is expected (agy once added a placeholder spec; prompts must say this). Laptop too slow for full verify; a Ryzen 5700U laptop may be used later (low disk).
- Master is branch-protected (owner ruleset, 2026-10-13) after agy pushed M12a straight to master. Owner keeps it on while agy works.
- Merge conflicts between parallel PRs: a fresh Sonnet session merges origin/master into the later PR's branch (merge commit, no rebase), resolves, verifies, pushes; orchestrator writes the prompt.
- Review cycle: at most 3 rounds per task, then ask the owner (CLAUDE.md, Orchestrator).
- CI: `Verify` runs the full suite on every PR and every push to master (job timeout 90 min). Reviewers use it as the full-verify evidence.

## Task status

Done (merged to master; handoff notes in `progress/`): M00a, M00b, M01a, M01b, M01c, M02a, M02b, M02c, M03a, M03b, M03c, M03d, M03e, M03f, M03g, M05a, M16a, M16c. M04a (#33, b80294e). M04b (#34, 427660a). M06a (#36, b18882b), M12a (5a73d9a, agy direct push) + M12a-fix (#38, 58dfc07), M06b (#39), M13b (#41, 6e3cd8f; agy), M07a (#40, 3addcbc), INFRA-win (#37, 43d8fe5), M05b (#35, 431e5d5; built in Codex). Fix tasks also merged: M01a-fix (#32, 68ef7c7), M02b-fix, M02c-fix, M03b-fix, M03b-fix2, M03b-fix3, M03c-fix2, M03d-fix, M05a-fix.

In flight:

| Task | State | Builder session | Reviewer session | PR | Round | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| M07b | prompt given (Codex full model), branch claude/m07b | Codex | — | — | — | Item registry + inventory core (36 slots, hotbar 0–8), loot JSON in data/loot/, wooden_pickaxe etc. for tests, dedicated item-entity manager (not ECS; M13a owns ECS), placement uses selected hotbar block and consumes in survival. |
| M12b | prompt given (agy, old laptop), branch agy/m12b (owner creates on GitHub) | agy | — | — | — | Clouds y=192 fancy/fast/off in settings.ts, fade to sky by distance; sun glare (owner extra). Pre-approved (owner may veto): if clouds break M12a-fix coverage test or M04 hole tests, those tests may call a new debug setClouds('off') before measuring, no threshold/flow change otherwise. Local failures → CI decides. |

States: building · gate (waiting for owner) · PR open · review n · fixing n · blocked.

Ready next: M12c, M13a? (check deps M11/M12). M07b + M12b in flight.

## Open items for the owner

- Before M22a: two-tier speed budgets in SPEC §2.3 (real-hardware targets checked by `npm run bench`; SwiftShader CI bounds set from measured CI values plus a margin), like the existing 3 s / 20 s createWorld budget. Offered to draft; owner has not asked yet.
- `retries: process.env.CI ? 2 : 0` (playwright.config.ts line 8) lets CI pass a flaky test on retry, so a green CI run doesn't prove a test is stable. Suggest a later decision on retries 0, after checking recent CI runs for flaky counts.
- Planned worldgen-tuning task (owner, later): increase biome size AND reduce Mire patch coverage in Swampland (src/gen/surface.ts, patchNoise > 0.25 threshold) at the same time. Biome size needs an owner SPEC edit first: the M03c unit test requires ≥ 10 biomes in 2048×2048 with 20–50 % ocean (e.g. widen the sample to 4096×4096). Biome climate noise is at 0.0012 in src/gen/biomes.ts.
- Per-biome fog colour: SPEC biome appendix lists it, but no task row owns it and biomes.ts has no fog field. Owner to assign (e.g. M12c) or drop.
- Owner views builds with a bookmarklet that adds ?debug=1 and calls createWorld (no code change). A dev URL auto-create param would need a tiny task; deferred to M18a's menu unless asked.
- `npm ci` reports 1 high-severity vulnerability in the current dependencies (environment check, 2026-10-07). Not investigated.

## Decisions not yet on master

- Codex prompts list the known container-only failures (M04b heap and RD12 timeouts, M04b mid-flight blank, M01a GL-check count, occasional M02 mesh p95, M04a pump max over 50 ms, seen up to 84.8 ms in M07a and passing on CI; an M05 streaming timeout that also fails on unchanged master, seen in M07b): don't investigate or re-run master; draft PR, CI decides. Owner may add this to AGENTS.md §9.
- For the M13c prompt (from M13b review, PR #41): callers must call PathSearch.dispose() on abandoned searches; WorldAdapter caches stay valid across chunk loads (unloaded = solid), so call adapter.invalidate() or hook chunk-load events.
- For the M12c prompt: per-biome fog colour is an open owner item; weather must keep the M12a-fix sky classifier and M04 hole tests valid (same issue as M12b clouds).
- M06b non-blocking leftovers: bob curve not pinned by a test; limb swing unasserted. M07a: water not replaceable for placement (revisit with buckets, M08).

## Log (newest first)

- 2026-10-14: Owner on M12b clouds (looking up at noon): 'look like shit', fix later, wait for CI first. Seen: sun glare halo shows through the cloud underside, flat lavender-grey underside with no shading variation, huge jagged staircase edges overhead. Suggested fixing in the M12b PR via the review cycle rather than merging and doing M12b-fix.
- 2026-10-14: M12b agy gate 56082af (14 files, 0 setClouds lines; unit 490/490; M12b + M12a time-of-day e2e pass; m12.spec:258 RD8 sky test timed out locally at waitForTerrain, so the clouds-vs-sky-classifier risk is unverified). Recommended: push, draft PR '[INCOMPLETE] M12b: Clouds'; on CI watch m12.spec:258 — a coverage (not timeout) failure means clouds break the classifier → use the pre-approved setClouds('off') fallback unless owner vetoed.
- 2026-10-14: M07b Codex QUESTION: M05 timeout reproduces on unchanged master. Answered: add it to the container exceptions, remove blockers/M07b.md (not M07b's problem), finish full verify with the M04 polling fix, post gate; CI decides.
- 2026-10-13: Owner merged M07a (#40). M07b → Codex, M12b (clouds + owner sun-glare request) → agy on agy/m12b. Owner confirmed: laptop test failures → GitHub CI is the standard. CONTEXT tidied before compaction.
- 2026-10-13: M13b merged (#41). M13c prompt must include: call PathSearch.dispose() for abandoned searches; adapter.invalidate() (or hook) on chunk load. M07a review PASS.
- 2026-10-13: Owner merged M06b (#39). Owner wants parallel builds: Codex + agy. Recommended Codex = M07a (core, critical path, touches world/input/mesh), agy = M13b (pure A* module, unit tests only, suits old laptop; verify:quick + CI as evidence; agy prompt must use --no-track branch + explicit push; owner to add master branch protection). M12b/M12c next after. Merge conflicts: fresh Sonnet session merges origin/master into the later PR's branch (no rebase), re-runs verify, pushes.
- 2026-10-13: Owner decision: will increase biome size later and reduce Mire spawning in the same worldgen-tuning task (open item added).
- 2026-10-13: Owner asked about brown slowing blocks on grass: Mire patches in Swampland (surface.ts patchNoise>0.25), slowdown by SPEC design ('soul-sand-style'); 0.4 multiplier was orchestrator's choice. Offered: soften to 0.6 in the same M06b tweak (owner's call); patch coverage is M03 territory (later tuning).
- 2026-10-13: Owner merged #38 (58dfc07). M06b prompt given for Codex full model (branch claude/m06b). Decisions: swim/ladder/vine/Mire numbers, ladder+vine as thin face models with 4 facings, no worldgen placement, F5 via input action (no new debug API), settings.ts in-memory viewBobbing default on, water opacity 2→1 + underwater min brightness floor, underwater fog 2–24 blocks overriding M12 fog.
- 2026-10-13: M12a-fix round 2 PASS. Owner request: sun should be a blinding glare at midday with the disc only readable near sunrise/sunset. Plan: add to the M12b prompt as an owner extra (elevation-scaled additive halo in sky shader + sun billboard saturating to white; disc dims/reddens near horizon; no HDR/bloom pass; must keep M12 noon/sunset tests and M04 tests unchanged).
- 2026-10-13: M12a-fix gate c873ccd: radius 1.73, closest terrain 3.735 (2.005 margin), real sky coverage 100 % at 6000/10000; unit 433/433; e2e 55 pass, 2 container-only fails (M01a GL count 1446<1449, M04a pump 57.1 ms); RD12, fast-flight, M12 pass. Recommended approve → draft PR, CI decides.
- 2026-10-13: M12a-fix Codex QUESTION: legacy SKY_RGB±16 check accepts fogged lumite (117,206,252). Answered Option B: drop legacy check, curve-only match, radius = largest rejecting full sweep with ≥2 margin; plus m12.spec assertion ≥98 % of top-quarter noon pixels are isSkyPixel at 6000 and 10000 ticks (guards against silent hole loss).
- 2026-10-13: Owner asked about fog in deserts. Found gap: SPEC Appendix (line ~1459) says each biome defines a fog color, but biomes.ts has no fog field and no task row owns it. Not added to M12a-fix (keeps classifier simple). Open item for owner: assign per-biome fog tint to a task (e.g. M12c) via SPEC.
- 2026-10-13: M12a review CHANGES NEEDED. M12a-fix decisions: classifier = tight distance to the sky pass's own noon colour curve (tolerance ≤ ~8), permanent unit test sweeping all texture generators × light × tints at fog ≤ 0.6 → false; fog factor per fragment, fog colour 100 % sky, fogEnd = (RD−1)×16, fogStart 0.6–0.75 of that; RD12 test must still pass (accepted trade-off: last chunk ring is fully fogged so holes there are invisible to players and test alike); fix progress notes/status. Stars absent below horizon: intended, no change.
- 2026-10-13: agy gate looked good (unit 430/430; 5 laptop-only streaming-idle timeouts reproduced on master). Owner approved; agy pushed 5a73d9a directly to master (19 files, +1469). No harness paths touched. Recommended: keep, wait for CI #161, post-hoc review on the commit, stop Codex M12a, add branch protection on master.
- 2026-10-13: Owner: old laptop struggles with full verify; agy postponed (maybe Ryzen 5700U laptop later, low disk). Back to Codex cloud + Claude Code cloud. M12a reassigned to Codex (agy work stays local, unpushed). Option noted for future local builders: verify:quick locally + CI as full-verify evidence (owner's call).
- 2026-10-12: Windows laptop set up: npm ci, typecheck, lint (2 existing any-warnings), placeholders, unit 425/425, MILESTONE=M06 verify:quick all pass in PowerShell. WezTerm defaulted to cmd; told owner to use powershell. Owner asked for the smaller ready task for agy: M12a (self-contained render/time) over M06b (blocks, model, physics, camera). agy prompt: branch agy/m12a, PowerShell syntax, full verify to log, laptop timing failures checked against master on the same laptop then draft PR, CI decides; push via git, owner creates PR in browser.
- 2026-10-12: Owner merged M06a (#36, b18882b) and INFRA-win (#37, 43d8fe5). Ready next: M06b, M12a (owner picks).
- 2026-10-12: INFRA-win round 2 (fc2fef7, 716b36a): test now uses os.tmpdir() fixtures and runs the script with cwd=fixture; no writes to repo src/server, retry loop gone, missing-server case added. VERDICT PASS; owner to merge. After merge: Windows clone works with PowerShell (`$env:MILESTONE=...`).
- 2026-10-12: INFRA-win PR #37 review (orchestrator, round 1): script and .gitattributes OK. Blocking: lint-placeholders.test.ts plants forbidden files in real src/ and server/ while lint.test.ts (unchanged harness-adjacent test) expects a clean pass in parallel, so it can flake; the 2 s retry loop only shields the new test. Fix: run `node scripts/lint-placeholders.mjs` with cwd set to a temp fixture dir (the script uses process.cwd()) and drop the retry loop. Fix prompt given to owner for Codex.
- 2026-10-12: INFRA-win gate (11cc5aa): renormalize staged nothing unrelated; old/new lint equivalent; unit 424/424; e2e 4 fails (M02 mesh p95, M04a pump 62.8 ms also on master archive, M04b heap, mid-flight blank), all container-only. Recommended: approve push as draft PR, owner adds harness-change label, Codex retitles '— verified' once CI is green. M04a pump added to known container failures.
- 2026-10-12: Owner wants to build on a Windows laptop with agy (PowerShell only, no Git Bash; Node 24). Only blockers found: lint-placeholders.mjs shells out to grep (silently passes on Windows) and no .gitattributes (CRLF breaks prettier). INFRA-win task prompt written. agy prompts must use PowerShell env syntax for MILESTONE.
- 2026-10-12: M06a review PASS, no blockers. Next after merge: M06b (include deep-water light tuning) or M12a (swap decision 1 to M06a's tick); owner picks order.
- 2026-10-12: M06a PR #36 ready (CI Verify green, 55 e2e, first attempt). Reviewer prompt written for a Claude Sonnet session. Owner deferred the Windows agy setup (notes: .gitattributes eol=lf; Git Bash terminal so grep is on PATH for lint-placeholders; middle PATH option).
