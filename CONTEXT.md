# CONTEXT.md — orchestrator log

The orchestrator's memory between compactions and sessions. It lives only on the `claude/orchestrator` branch, which shares no history with `master` and is never merged.

## Rules for this file

- Read it first: at the start of every orchestrator session and after every compaction. Then run `git fetch origin master` and check it against `progress/` on master and the open PRs. If they disagree, the repo wins; fix this file.
- Update it whenever a task changes state, a decision is made, or the owner states a preference. Commit and push straight away, because the container can be reclaimed at any time.
- Keep it under about 150 lines. When a task merges, move it to Done. Once a decision reaches `decisions/` on master, delete it from this file. Keep the last 20 log entries.
- Facts only, each with its source (PR, session, file). No transcripts or long output.

Last updated: 2026-10-16 (before compaction)

## Setup

- The owner starts every builder and reviewer session by hand from prompts the orchestrator writes, approves every publish gate in the builder's own chat, and merges every PR. Master is branch-protected. The owner edits owner and harness files directly on master.
- Orchestrator: Opus. It may read builder and reviewer sessions (list_sessions, list_events with kinds result) and message them with send_message prefixed `[Orchestrator]`. It never relays approvals: builders correctly refuse approval that comes from the orchestrator. Builders and reviewers also message the orchestrator; read those with ReadNotifications.
- Builders:
  - Codex cloud (full model) for core work; branch `claude/<id>`; it opens its own PR.
  - Claude Code cloud sessions on Sonnet; branch `claude/<id>`.
  - agy (Antigravity) on the owner's old Windows laptop:
    - agy does NOTHING with git; the owner creates `agy/<id>` on GitHub, then commits and pushes via GitHub Desktop.
    - agy runs only `verify:quick` (PowerShell `$env:MILESTONE=...`); GitHub CI is the standard.
    - On the laptop, a timeout in untouched code is likely the machine; an assertion failure is likely real. CI decides.
    - Its chat reports have been inaccurate (M12c screenshot, M10a exemption table), so the orchestrator checks the pushed code itself.
- No local full verify (owner, 2026-10-18): every builder prompt and fix message says, as an explicit owner override of AGENTS.md §3 step 4 / §4 and CLAUDE.md's publish-gate verify table, to run only `MILESTONE=<Mxx> npm run verify:quick` (plus the e2e specs of other milestones whose code it touched); the PR's GitHub CI Verify is the full-verify evidence. The handoff line says "Full verify: PR CI". The '— verified' title is allowed once CI is green. Suggested the owner write this into CLAUDE.md/AGENTS.md (owner files).
- Reviewers: new Sonnet session per task; rounds 2–3 in the same session; at most 3 rounds, then ask the owner.
- Known 2-core container-only failures (list them in EVERY builder and fix prompt, Codex especially (owner, 2026-10-18): say they are expected, don't retry, investigate or write blockers for them; CI decides):
  - m02:54 mesh p95
  - m04:66 pump > 50 ms
  - m04:221 heap timeout
  - m04:276 RD12
  - M04b mid-flight blank
  - m05-streaming timeout
  - M01a GL count
  - pathfinding 2 ms benchmark
  - general timeouts when the container is starved
- CI: `Verify` (pull_request) is skipped on conflicted PRs; the harness guard (pull_request_target) still runs. Retries are 2 on CI.
- Owner-approved test edits so far:
  - setClouds('off') ×3: m12 RD8, m12 M12a time-of-day, m04:276
  - M12c screenshot step aimed at the lightning strike
  - M08b setFluidAnimationPaused(true) in m02c-fix.spec:52 and :74 (approved, in PR #50)
  - sky-holes.test.ts:168 timeout → 120000 (owner edits master directly, 2026-10-18)
- Prompt ≠ launch: a prompt can be given and not used (the owner changed their mind on M09b once). Trust the owner's word about what is running.

## Task status

Done (merged; notes in `progress/`): M00a–M06b, M07a, M07b (#43), M08a (#45), M09a (#44), M09b (#47, 0bb369f), M10a (#48, bf34ade; agy), M17a (#49; agy), M08b (#50, 4fd462d), M08c (#52; Sonnet builder), M09c (#51, 355d136), M10b (#55, 477baf4; Codex), BLOCKS-shapes (#54, fcaaa1f; IDs 158-533), INFRA-ci (#53, 4-way CI sharding, ~13 min), M12a (+fix), M12b (#42), M12c (#46, fe346bf), M13b, M16a, M16c, INFRA-win, plus earlier fix tasks.

In flight:

| Task | State | Builder | Reviewer | PR | Notes |
| --- | --- | --- | --- | --- | --- |
| M15b pistons & mechanical outputs | Round 1 CHANGES NEEDED (reviewer session_012Yj1n1qta112TUDVxQp5P5); fixes sent to builder session_01XTL4SoHKhr41oa5ftYgx5T | Sonnet (claude/m15b) | - | - | quick: unit 823, e2e m15a+m15b 2 + 35 other-milestone specs. Test edit: m10a-reachability exemptions for piston_head, sticky_piston_head, piston_moving (recommended approval). Door is closed when the pistons extend (SPEC 'open with pistons extended' is physically impossible; owner may reword the SPEC). Dispenser: no screen, doesn't spill on break (reviewer to judge). |
| M11a survival & hazards | Round 2 PASS on eff64b1 (reviewer session_01BAyj1XRYFzLoPxR7kNQjs5); owner to merge #58 || air < 300`); owner reverting that line | agy (agy/m11a) | not started (round 1 = new reviewer) | #58 | sky-holes timeout edit reverted by owner (8a56ef4). Handoff claims 'Full verify (this session)' but only quick ran → say 'PR CI'. Survival default saturation 0 (master had 5). Fold into round 1 fixes. |
| M15a current & logic | Round 2 PASS on 9300e40; owner to merge #59 | Codex | not started (new reviewer) | #59 | IDs 542-698 (157 new, none changed); atlas.test.ts edit = assertion messages only (recommended approval) |

Ready next: M11a (Survival model & hazards) and M15a (Current core & logic), both unblocked by M10c (#57, 00aefea). Prompts given 2026-10-18; recommended Codex → M15a, agy → M11a. Afterwards: M11b (after M11a), M15b (after M15a; prompt given 2026-10-18; owner may run it on Sonnet). M17b needs M15b or an owner SPEC change.

## Open items for the owner

- CI shard 2 is ~25-28 min: m04:221/276 time out once then pass on retry (~12 min). Possible follow-up: make them robust or split shard balance (not this PR's fault; seen on master).
- Worldgen tuning (later): bigger biomes (needs a SPEC edit to the M03c ≥ 10 biomes in 2048² test) plus fewer Mire patches (surface.ts patchNoise > 0.25).
- Per-biome fog colour: listed in the SPEC biome appendix, owned by no task.
- Berry bushes (wild_berries source) are owned by no task (M10a review).
- Owner idea (2026-10-16): export/import a .save file in the browser (proposed M17d, after M17b) and a desktop app (Tauri recommended over Electron) that saves to disk. Neither is in SPEC; the owner decides whether to add them.
  - Desktop: needs a SPEC edit (§2.1/2.2 browser-only stack) plus an owner-run packaging and signing step; best after M22.
  - .save file: cheap once M17a/M17b exist (format + Blob download + file picker).
  - SPEC wording offered, not yet written (the owner hasn't asked).
- Speed budgets: two-tier §2.3 budgets before M22a (offered to draft).
- Performance: the owner's Ryzen 7 5700U (Vega iGPU, the SPEC §1.2 target class) struggles, with the GPU maxed and the tab at ~1 GB. Culling and batching are M22a/M22b (end of the plan); there is only column-level frustum culling today. Suggested: get F3 numbers at RD8 after M09c merges, then the owner may edit SPEC to pull M22a's cave and section culling earlier (e.g. after M10).
- CI retries 2 can hide flaky tests; decide later.
- m02:54 mesh p95 ≤ 6 ms is now borderline on GitHub CI too (#59: 8.2 then pass; #60: 7.9/6.1/6.3 all fail). Not caused by M15a/M15b (greedy change is a MODEL_NONE skip). If it keeps failing: profile the mesher, or the owner decides on the budget (SPEC perf numbers are owner territory).
- sky-holes.test.ts:94 'rejects every generated block colour' runs ~30-34 s on CI against a 30 s vitest timeout, and it grows with every new block (M15a added 157 states). Failed on #59 0f2befa; agy hit it on the laptop. Options: owner approves a timeout raise (line 168, e.g. 120000) or a faster test; offered.
- npm ci reports 1 high-severity vulnerability; not investigated.

## Decisions not yet on master

- M17a prompt: persist world.breakCount (M10a loot seed) and block-entity state.
- M17b prompt (from M17a review 2 non-blocking): make weather-timer meta fields (manualOverride, strikeCounter, lastTick, elapsed) required on read and write (no ?? defaults; v1 never shipped); BlockTicks.addTicks must rebase due by (current clock - saved column time) or M17b documents a single world clock; actually call LightEngine recompute on load (progress/M17a claims it, persist/ doesn't do it); World.setColumn is the restore hook (only tests call it today).
- M13c prompt: call PathSearch.dispose() on abandoned searches; adapter.invalidate() or a chunk-load hook (M13b review).
- Weather migrated onto ticks.ts random ticks: later follow-up (M12c kept its own tick).
- Armor values are duplicated: M10a ARMOR_DEFENSE in tools.ts and M09c armorPoints in data/items/armor.json (values match today). M11a applies no armor (decided 2026-10-18), so M13c (combat) must unify them to one source.
- Dispenser doesn't spill contents on break and has no inventory screen (M15b): track for M17/inventory follow-up.
- Leftovers:
  - M12c: precipitation stat vs shader mismatch on mountains; lightning buffer re-allocated per frame during a strike; rain factor formula copied 3×; fire doesn't spread or burn out; snow lands on leaves and glass.
  - M08a: no test forces every registry state into data/block-state-ids.json; BlockTicks.removeColumn is O(n).
  - M07a: water isn't replaceable for placement (revisit with buckets).

## Log (newest first)
- 2026-10-19: #60 M15b round 1 CHANGES NEEDED: the piston stays busy forever if a moving cell is replaced mid-move or its column unloads (mechanics/index.ts:244, owners not released); in-flight moves on unload untested/undocumented. Sent fixes directly to the builder: always release owners, clean column removal, piston_moving unbreakable, 2 unit tests; plus collision for head/moving and limitation notes. The reviewer reports to me directly (send_message) for this PR.
- 2026-10-19: #60 M15b green on 2117d70 (merged master incl. M11a). IDs 699-802. Viewed both PNGs: night, a wall with a 2-wide doorway, torches. Open = clear doorway with retracted pistons visible in side pockets; closed = doorway filled with wall blocks and the extended heads visible in the pockets. Gave the round 1 reviewer prompt.
- 2026-10-19: #60 M15b CI shard 1 failed only m02:54 mesh p95 (7.9, 6.1, 6.3 ms vs 6). The M15b greedy.ts change only skips MODEL_NONE early (no slowdown), and the greedy unit benchmark in the same run was 2x slower than on #59 (noisy runner). PR is based on ad63a81 (no M11a), so Update branch gives a fresh run; told the builder to change nothing.
- 2026-10-19: #58 M11a round 2 PASS. Non-blocking: the sprint test uses a floor stub; overlapping dead setters on Player and Survival; damage() sets dead twice. #58 is up to date with master (ad63a81). Told the owner to merge it; M11b becomes ready.
- 2026-10-19: agy M11a Fix 01 (afaa791), then the owner merged master (eff64b1, includes M15a). CI green. Checked: sprint test now drives Player.tick (760 blocks, hunger 6); hook tests jump/sprint-jump/swim/break/creative; drowning first hit at 320 with e2e asserts at 299/319/320; useConsumed stops eating after block use (interaction.tick moved before survival.tick); regen/starvation survival-only; health <= 0 → dead (setter on Survival); duplicate eatFood removed; glass/leaves/slab/stairs suffocation test; progress says 'Full verify: PR CI'. The owner deleted the round 1 reviewer chat, so round 2 goes to a new reviewer with the round 1 list.
- 2026-10-19: M15b gate checked (Sonnet). Recommended approving the push and the reachability exemption edit. SPEC M15 Visual Review wording 'door open with pistons extended' can't be built (heads fill the doorway); the builder made a door that is closed when the pistons extend and open when they retract. Owner may reword the SPEC.
- 2026-10-18: #59 M15a round 2 PASS. Non-blocking: strongPowerAt no longer counts neighbours' weak power (a floor lever beside a block doesn't turn off a torch on it; vanilla-like, should be noted in decisions); clock edge interval 10. Told the owner to merge #59, then Update branch on #58 (player-controller overlap). Gave the M15b prompt (IDs after 698; pistons ≤ 12, immovable Foundation Stone/Blackglass/block entities; powered doors/trapdoors through the existing open state; dispenser drops item entities; note block emits a tone event only).
- 2026-10-18: Owner raised the sky-holes timeout on master (bc376d5) and clicked Update branch on #59 (9300e40); CI green. Sent M15a round 2 to session_01Qh8guTsjL7Pm8sXzx8Xb4b. Codex must git pull before any further push.
- 2026-10-18: Owner decided to raise the sky-holes.test.ts:168 timeout to 120000 directly on master (web edit). Open PRs pick it up on their next push (a re-run reuses the old merge commit).
- 2026-10-18: M15a round 1 fixes 0f2befa (strong power through blocks + tests, night screenshot). Viewed the new m15-circuit.png: night, the far trace bright and the near one dark, the far lamp lit with a light pool on the grass, the near lamp unlit, a lever at left. Looks right. CI shard 1 failed only on the sky-holes unit timeout (34.5 s vs 30 s) plus an m02:54 retry. Told the owner to re-run failed jobs once and Codex not to change anything; offered the owner a timeout raise as the permanent fix.
- 2026-10-18: Round 1 results. M11a CHANGES NEEDED: the sprint test bypasses Player (hooks and creative untested); progress/decisions inaccurate (hud, sky-holes listed, verify line, swim 3D vs horizontal). I added: drowning first hit at tick 320 (currently 319), no eating when the use press went to block use, gate regen/starvation to survival, health <= 0 dead, drop duplicate eatFood, suffocation test for glass/leaves/slab/stairs. Keep saturation 0 (reviewer: 5 makes M06 fall test see fast regen). M15a CHANGES NEEDED: strongly powered blocks don't power adjacent traces/lamps/relays (lever on wall + trace = 0); screenshot fails (night, close, lit vs unlit lamp). Plus decisions notes for O(n^2) settle and M17b re-registering components on load.
- 2026-10-18: #58 M11a CI green (7c9c588, hud revert in). #59 M15a CI green (9d59614). Viewed m15-circuit.png: daytime flat world, one bright peach trace and one dark trace, a dark framed block and a tan block at the ends; it is unclear which lamp is lit and no light glow is visible in daylight. Asked the reviewer to judge (possible fix: night-time or darker scene). Gave both round 1 reviewer prompts.
- 2026-10-18: M15a: atlas.test.ts diff only adds failure messages to 2 expects (same assertions); recommended approval. IDs 542-698, none changed. Blocker removed, progress verified (9d59614). Told the owner to approve the push; reviewer after CI green.
- 2026-10-18: Codex M15a gate: unit 807, e2e 110 passed / 1 failed (m04:66 pump 56-61 ms, known) / 2 flaky (m04 heap and horizon); it wrote blockers/M15a.md and marked progress incomplete. Changed tests/unit/atlas.test.ts without disclosing it. Gave the owner a message: show the atlas diff, delete the blocker, mark verified, confirm IDs from 542, no more local full verify. Owner preference: every builder prompt lists the known container failures so Codex doesn't keep retrying.
- 2026-10-18: Owner reverted the sky-holes timeout on agy/m11a (8a56ef4). CI shard 4 failed m09c:183 ('air bubbles appear only while head underwater'): agy changed hud.ts:361 to `submerged || air < 300`; the test teleports out without a tick, so air stays 180 and the bubbles stay. A real regression of M09c behaviour. Told the owner to revert line 361 to `if (snapshot.submerged)`; it's unnecessary because M11a refills air instantly on surfacing.
- 2026-10-18: agy M11a PR #58 (f573ea8, draft). Checked code: survival.ts matches the prompt's rates; dead flag only; burning in getPlayer; e2e drowning + lava. Issues: sky-holes.test.ts timeout raised to 60000 (another task's test; owner decides, recommend revert); handoff says full verify this session (only quick); saturation default 0 vs 5; crumbs use mapped block states. Gave reviewer prompt for after CI.
- 2026-10-18: Owner preference: builders skip the local full verify and run only verify:quick; CI is the full verify. Gave an add-on block for the M11a/M15a prompts.
- 2026-10-18: #57 M10c merged (00aefea), master green; IDs end at 541. Gave M11a and M15a builder prompts. M11a decisions: survival.ts at 20 TPS; 1 health = 1 half-heart; drowning 2/20 ticks after air 0; lava 4/10 ticks + burning 300 ticks; fire 1/10 + burning 160; burning 1/20; water extinguishes; cactus 1/10; suffocation 1/10; void y<-64 4/10; starvation floor 1 (easy rule, no difficulty until M18b); health 0 → dead flag only (screen is M11b); no armor; getPlayer gains burning; eating 32 ticks, hunger<20; no new blocks. M15a decisions: state holds power only (trace connections computed at mesh time); IDs from 542; BlockTicks with (due, priority, seq) order; no quasi-connectivity; lamp via lightEmissionWhen; pressure plate/tripwire detect player + item entities; gauge reads chest/kiln; items, recipes, textures, icons; no doors/pistons (M15b).
- 2026-10-18: #57 M10c round 2 PASS (72b4976). Dark tip pixel = flame fill rounding at ~94% fuel (Math.round); owner is fine with it. Told owner to merge #57 and close #56; then M11a + M15a are ready.
- 2026-10-18: #57 CI green on 72b4976; sent round 2 to session_017hxoR9pRWVocku9pgtrLa3 (check flame from game code, the 3 new unit tests, decisions IDs; dark tip pixel non-blocking).
