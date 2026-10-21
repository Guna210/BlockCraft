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

Done (merged; notes in `progress/`): M13a (#64), M13c (#65, 203ecbc), M18a (#66), M17c (#63, fa0bb62; Codex), M00a–M06b, M07a, M07b (#43), M08a (#45), M09a (#44), M09b (#47, 0bb369f), M10a (#48, bf34ade; agy), M17a (#49; agy), M08b (#50, 4fd462d), M08c (#52; Sonnet builder), M09c (#51, 355d136), M10b (#55, 477baf4; Codex), BLOCKS-shapes (#54, fcaaa1f; IDs 158-533), INFRA-ci (#53, 4-way CI sharding, ~13 min), M12a (+fix), M12b (#42), M12c (#46, fe346bf), M13b, M16a, M16c, INFRA-win, M10c (#57, 00aefea; kiln 534-541), M15a (#59; IDs 542-698), M11a (#58; agy), M15b (#60; IDs 699-802), M11b (#61, 5cc53ad; bed 803-810; bed needs wool from M13e), M17b (#62, ae48baf; autosave-spike test best-of-3 attempts; leftovers: formatVersion tests only regions/worlds, garbled column warns each load), plus earlier fix tasks.

In flight:

| Task | State | Builder | Reviewer | PR | Notes |
| --- | --- | --- | --- | --- | --- |


| M19a Structure engines | #67 merged master (2715f4b, green 15 min); round 1 CHANGES NEEDED (Keen not applied in combat); fix + jigsaw seed per start + per-tick alloc + stage test + remove hamlet chest table sent to Codex; reviewer session_01WsF2t3CkcmU1PDq2QpPwmd | Codex | - | #67 | src/gen/structures/{placement,jigsaw,adapt,stage}.ts; grid spacing/separation chunks, only wayfarer_hamlet config (34/16) in data/structures/placement.json; jigsaw BFS 4 rotations AABB reject; foundations/stilts from terrain-height; structures stage writes nothing without templates (hashes unchanged); chest loot data/loot/chests/*.json + src/gameplay/chest-loot.ts; affixes Keen/Sturdy/Swift on stack, persisted |

| M13d Projectiles & bows | #68 fix 0476df9 (lazy runtime, idle HUD snapshot), run 286 green but m04:221/276 flaky (shard 2 25 min) = same as master; round 1 reviewer prompt given | Codex #2 | - | - | src/entity/projectiles.ts ECS ProjectileC; kinds as data, only 'arrow'; gravity 0.05, drag 0.99/0.6; swept DDA, no tunnelling; hits via M13c combat; embed pulled back 0.05; despawn 1200; pickup survival-fired only; bow 20-tick charge, speed 3*(c^2+2c)/3; fireProjectile with ballistic aimAt for M13f; debug getProjectile; e2e drop+embed and pickup |

| M13e Passive creatures | Prompt given | Claude cloud (claude/m13e) | - | - | src/entity/mobs/<name>.ts; types tuftbuck/rootboar/dapplefowl/mossback/glimmer_moth; behaviours per Appendix B; babies 0.5 scale grow 24000 ticks; NO spawn rules (moved to M13g, data recorded in decisions 'For M13g'); emissive moth; lineup probe screenshot; reachability exemptions untouched |

| INFRA-stream Streaming headroom | Prompt given | Claude cloud (claude/infra-stream) | - | - | owner-requested, not in SPEC; target m04:221/276 clean on CI |

Ready now (not started): M18b, M18c (for Codex as slots free). Blocked: M19b (needs M19a), M13f (needs M13d). Owner has 2 Codex + 1 Claude cloud. Proposed: M18a Claude now, M19a Codex now, M13d Codex after #65, M13e Claude after M18a. Merge rule: second PR to merge clicks Update branch and needs a fresh green run with normal shard times. Block IDs: append only, flag it.

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
- sky-holes.test.ts timeout raised to 120 s on master by the owner (resolved).
- npm ci reports 1 high-severity vulnerability; not investigated.

## Decisions not yet on master

- M13c prompt: call PathSearch.dispose() on abandoned searches; adapter.invalidate() or a chunk-load hook (M13b review).
- Weather migrated onto ticks.ts random ticks: later follow-up (M12c kept its own tick).
- Armor values are duplicated: M10a ARMOR_DEFENSE in tools.ts and M09c armorPoints in data/items/armor.json (values match today). M11a applies no armor (decided 2026-10-18), so M13c (combat) must unify them to one source.
- M11b leftovers after da79a14: untested bed facing, broken-bed fallback in a real world, creative feedback, tilt/shake.
- Entities aren't pushed by pistons; a player in the destination cell overlaps the landing block (M15b, documented). Follow-up with entity pushing.
- Dispenser doesn't spill contents on break and has no inventory screen (M15b): track for M17/inventory follow-up.
- Leftovers:
  - M12c: precipitation stat vs shader mismatch on mountains; lightning buffer re-allocated per frame during a strike; rain factor formula copied 3×; fire doesn't spread or burn out; snow lands on leaves and glass.
  - M08a: no test forces every registry state into data/block-state-ids.json; BlockTicks.removeColumn is O(n).
  - M07a: water isn't replaceable for placement (revisit with buckets).

## Log (newest first)
- 2026-10-21: Owner approved INFRA-stream; prompt given for Claude cloud (branch claude/infra-stream). Bisect master merges by M04b timing/uploadsDeferred, profile RD12 flight, fix in game code, no test/harness edits, CI evidence: 2 clean runs, shard 2 <=15 min, no flaky.
- 2026-10-21: MASTER itself (cf97712, run 284) now flaky on m04:221 and m04:276 (shard 2 24.7 min, '2 flaky'), while M18a PR run 282 had 12.7 min clean: CI variance + game getting heavier; these tests are borderline. Proposed INFRA-stream task (profile RD12 flight upload starvation on master, fix in game code); owner decides. #68 M13d is now at master level; gave reviewer prompt.
- 2026-10-21: #67 M19a round 1 CHANGES NEEDED: Keen ignored in live combat (combat.ts passes held id). Also: jigsaw seed ignored start position (all hamlets same layout), per-tick allocations in BlockInteraction.tick, no stage-with-templates test, hamlet chest table out of scope. Limitations for M19b: ItemEntity loses affix; stage ignores flat/amplified terrain variant.
- 2026-10-21: M13e QUESTION: natural spawn rules break m07b:106 (always), m08c:160, m17b:70. Decided B: no spawn rules in M13e (or M13f); M13g registers all natural spawning and handles other-spec fallout (owner will need to approve those test edits then). Spawn data recorded in M13e decisions for M13g.
- 2026-10-21: #67 M19a green on 203ecbc but conflicts with master cf97712 (pixel-font.ts). Gave Codex merge message and reviewer prompt (flags: hamlet chest table maybe M19b scope; ui-manager +162 lines).
- 2026-10-21: Gave M13e prompt (Claude).
- 2026-10-21: #66 M18a merged. Ready: M13e, M18b, M18c.
- 2026-10-21: #68 M13d CI red, same M04b streaming symptom as M13c. Static read found nothing obvious (no World mutation); asked Codex to time master vs branch and bisect (HUD bowCharge, bow tick, ProjectileRuntime, Transform pitch shape).
- 2026-10-21: #66 M18a round 2 PASS. Screenshot now full of terrain. Follow-ups: teardown e2e queue asserts may pass vacuously if panorama already idle; PANORAMA_* constants and Create World name-clash / Single Biome / Starting Chest UI untested (unit only). Told the owner to merge.
- 2026-10-21: #66 head 309fa4f green (merge 5f311bb + fix 362d3ea + new screenshot); sent round 2.
- 2026-10-21: #66 M18a round 1 CHANGES NEEDED: no e2e for panorama teardown/restart. Also asked: clear meshMsTimes in WorkerPool.cancelAll (panorama samples could pollute next world's p95), panorama camera shows a dark void (regenerate screenshot). Default hash unchanged (reviewer checked independently); m02:54 green on CI.
- 2026-10-21: #65 merged (203ecbc). #66 M18a green but conflicts with master in src/world/world.ts (one hunk); told the builder to merge master and push; gave M18a reviewer prompt.
- 2026-10-21: #65 M13c round 2 PASS (regression test fails with old adapter). Told the owner to merge; gave M13d prompt for Codex #2.
- 2026-10-21: #65 run 276 green (16 min total) after the dictionary-mode fix; sent round 2 to the M13c reviewer, fix only.
- 2026-10-21: M18a gate: quick verify green, 57 other e2e passed, m02/m04/m05 durations equal to master; m02:54 failed on branch (6.2 ms) but passed on master locally, and builder touched mesh/light/gen worker pools -> asked for a per-pool note; on CI m02:54 counts as M18a's. Answered QUESTION: keep static menu redraw-on-change (drawing every frame broke M00 canaries); 1.5 s fade OK.
- 2026-10-20: Gave M18a (Claude) and M19a (Codex) prompts.
- 2026-10-20: M13c builder root cause: WorldAdapter redefined World.onBlockEdited as an accessor -> V8 dictionary mode, all World calls ~3x slower (195 vs 554 ms per 1.3M reads); uploads starved. Fix: adapter gets a view object; world.listeners (blockEdited, column load/unload) -> invalidate; spawner no-op without rules; regression test that onBlockEdited stays a data property. Gate pending. Lesson: never redefine properties on hot shared objects.
- 2026-10-20: #65 Update branch (2553bca) red: m04:221 heap + m04:276 RD12 fail x3. Master+M17c green 13 min; #65 alone green but shard 2 27 min (retries). Cause: M13c per-column-load work (adapter.invalidate each load, unbounded unpopulatedColumns, spawn scans with no rules). Sent perf fix to builder. Lesson: compare shard durations, a 2x slower shard means retries.
- 2026-10-20: #65 M13c round 1 PASS. Follow-ups: player has no 10-tick i-frames (decide in M13f); navigation MAX_ACTIVE_SEARCHES 3 and MAX_SEARCH_NODES 4000 (revisit if long chases fail); sweep fires when primary hit absorbed by i-frames; blast with no source sets attacker -1; runtime.dispose comment overstates. Told the owner to merge.
- 2026-10-20: #65 M13c green (4f31479, 39 files, merges clean). Gave round 1 reviewer prompt.
- 2026-10-20: #63 M17c merged (fa0bb62). Proposed M18a and M19a; waiting for builder choice.
- 2026-10-20: #63 M17c round 2 PASS (probe: old code fails all 3 new tests). CI 271 had M04 heap/RD12 pass on retry (29 min) but 268/269/272 normal (11-15 min) -> noise. Watch: M17b heavy autosave slices 9/40/38/10 ms locally (2-of-4 rule). Told the owner to merge #63. M13c PR #65 opened.
- 2026-10-20: #63 head 76f22ab green (hidden-save fix + tests); sent round 2 to the same reviewer. Merges clean with master.
- 2026-10-20: #64 M13a merged. M13c given to Sonnet (prompt with decisions in the in-flight row).
- 2026-10-20: #64 M13a round 1 PASS (probe: +1 drawCall per entity in the real game). Follow-ups: entityLight duplicates the terrain light formula in TS with no test linking them (M13e/f e2e should compare entity vs terrain brightness); distance-only culling. Told the owner to merge #64; M13c ready after.
- 2026-10-20: #63 M17c round 1 CHANGES NEEDED: hidden/exit saves wait up to 500 ms for a thumbnail frame before writing player/world (pagehide data loss). Fix: skip frame wait on hidden/exit, tests; plus thumbnail-less record test. Non-blocking: duplicate keeps source lastPlayed, no name edge tests.
- 2026-10-20: #63 (339b96b) and #64 M13a (a7e1e64) CI green; they merge clean with each other. Gave both reviewer prompts.
- 2026-10-20: #63 M17c CI red, shard 2: m04:221/276 streaming never idle (uploadsDeferred stuck). Cause: captureThumbnailFrame after every frame. Gave the owner a fix for Codex (capture on save request only); also the m17b:537 autosave timeout Codex called 'known' must pass.
- 2026-10-20: #62 M17b merged (ae48baf). Owner asked me to assign: M13a to Claude Code cloud, M17c to Codex; prompts given.
- 2026-10-20: #62 M17b round 3 PASS (probe: in-flight test fails without the wait; spawnPoint declared once). Open owner decision: autosave-spike e2e was loosened in 37b82c0 (retry up to 3 attempts, pass if one attempt of 3 autosaves stays <=16 ms; old total.maxSliceMs check removed; heavy test 2 of 4), threshold unchanged. Recommended accept and merge. Leftovers: stray console.log('DROPS') in m17b.spec.ts; newer-formatVersion tests only for regions/worlds; garbled column warns every load until edited.
- 2026-10-20: #62 head d809174 green (fix adds m17b-inflight.test.ts + e2e warm-up only). Sent round 3 (last): prove the test fails without the wait, no weakening, spawnPoint once.
- 2026-10-20: #62 M17b round 2 CHANGES NEEDED: the 'not compressed yet' wait in save-manager isn't covered by a test (the reviewer deleted it and the tests still passed). Everything else fixed. The builder already merged master (37b82c0) with a single spawnPoint field. Sent the fix (in-flight deflate test that must fail without the wait, optional warm-up). Round 3 is the last; if it fails, ask the owner.
- 2026-10-19: #61 M11b merged. Told the M17b builder to merge master now (single spawnPoint, sleep-time round trip, a spawnPoint save/load + respawn test) while round 2 runs. M13a is now ready.
- 2026-10-19: #61 M11b round 2 PASS (sleep → next multiple of 24000; tests for bed break, hostile 8/9, armor/offhand drops, double kill). Non-blocking: double-Respawn-click untested. Told the owner to merge #61; then the M17b builder merges master.
- 2026-10-19: Owner chose to fix M11b's sleep-day bug plus 4 tests before merge (da79a14). M17b round 1 fixes bcbd273. Both CI green; sent round 2 to both reviewers. Order: #61 merges, then M17b merges master (player.ts) before #62 merges.
- 2026-10-19: #61 M11b round 1 PASS (non-blocking: sleep sets absolute time 0 = day-counter bug, several untested behaviours; recorded as follow-ups). #62 M17b round 1 CHANGES NEEDED: tests for light on load, weather through the real path, save triggers (pause/visibility/pagehide/createWorld), overlapping saves plus the 'not compressed yet' abort, XP/spawnPoint end to end, corrupt data. Sent to the builder with the merge-master-after-#61 note, a compress large-input test, a terrain-heavy autosave variant, the stray pixel.
- 2026-10-19: #61 M11b (d398094) and #62 M17b (b9132a5) green. M11b: bed IDs 803-810; m10a-reachability exemption for bed (crafted from wool, which comes from M13e Tuftbuck), so survival players can't get a bed until M13e; owner to approve. Viewed m11-death.png (YOU DIED / KILLED / RESPAWN panel over a reddened world) and m11-hurt.png (red vignette, 2 hearts, empty air bubbles, inside a water box). #61 and #62 conflict only in src/entity/player.ts (both add spawnPoint); whichever merges second merges master. Gave both reviewer prompts.
- 2026-10-19: M17b gate: quick unit 884, M17 e2e 3, other-milestone e2e 28. Test edit: m17a-serializers fixtures gain xpLevel/xpProgress/spawnPoint (additive; recommended approval). Fixed an M17a compress.ts deadlock (write before read hung in Chromium). Autosave-spike e2e is noise-sensitive (2 ms slices, warm-up; 12/12 locally); watch it on CI. Limits: only named worlds saved; unloaded columns' ticks freeze.
- 2026-10-19: #60 M15b merged. Gave the M11b prompt (Codex) and the M17b prompt (Sonnet), both with the quick-verify and known-failures blocks. Shared contract: Player.spawnPoint: [number, number, number] | null (bed head position, null = world spawn); whichever lands second merges master. M17b player data adds xp level/progress + spawnPoint; format v1 extended in place (no shipped saves). M17b includes the pending M17a/M15a/M15b load notes.
- 2026-10-19: #60 M15b round 2 PASS (6f733c6). hardness -1 → breakSeconds Infinity → unbreakable in both modes. Told the owner to merge. Then ready: M11b (needs M11a, merged) and M17b (needs M15b + M17a).
- 2026-10-19: M15b builder fixes 6f733c6 (local): owners always released; a replaced moving cell's block is lost, never duplicated; column unload lands moves; piston_moving hardness -1 (unbreakable, reviewer to confirm mining treats -1 that way); head plate+shaft collision, moving has none; 3 new tests; notes. Quick: unit 859, e2e 2 + 21 other. Told the owner to approve the push.
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
