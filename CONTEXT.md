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
- Reviewers: new Sonnet session per task; rounds 2–3 in the same session; at most 3 rounds, then ask the owner.
- Known 2-core container-only failures (list them in every builder prompt; CI decides):
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
- Prompt ≠ launch: a prompt can be given and not used (the owner changed their mind on M09b once). Trust the owner's word about what is running.

## Task status

Done (merged; notes in `progress/`): M00a–M06b, M07a, M07b (#43), M08a (#45), M09a (#44), M09b (#47, 0bb369f), M10a (#48, bf34ade; agy), M17a (#49; agy), M08b (#50, 4fd462d), M08c (#52; Sonnet builder), M12a (+fix), M12b (#42), M12c (#46, fe346bf), M13b, M16a, M16c, INFRA-win, plus earlier fix tasks.

In flight:

| Task | State | Builder | Reviewer | PR | Notes |
| --- | --- | --- | --- | --- | --- |

Ready next: M09c (prompt given for Codex), M08c (prompt given; agy out after a power cut, so the prompt was re-given for a Claude cloud session on claude/m08c). M10b/M10c need M09c. M17b needs M15b (SPEC order) or an owner SPEC change.

## Open items for the owner

- New task to add to SPEC: stairs, fences, doors and trapdoors (multi-box block shapes in block-shapes.ts, collision, placement facing, plus recipes). The owner accepted it 2026-10-16 as the fix for M10a's 106 < 120 recipe shortfall.
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
- npm ci reports 1 high-severity vulnerability; not investigated.

## Decisions not yet on master

- M17a prompt: persist world.breakCount (M10a loot seed) and block-entity state.
- M17b prompt (from M17a review 2 non-blocking): make weather-timer meta fields (manualOverride, strikeCounter, lastTick, elapsed) required on read and write (no ?? defaults; v1 never shipped); BlockTicks.addTicks must rebase due by (current clock - saved column time) or M17b documents a single world clock; actually call LightEngine recompute on load (progress/M17a claims it, persist/ doesn't do it); World.setColumn is the restore hook (only tests call it today).
- M13c prompt: call PathSearch.dispose() on abandoned searches; adapter.invalidate() or a chunk-load hook (M13b review).
- Weather migrated onto ticks.ts random ticks: later follow-up (M12c kept its own tick).
- Leftovers:
  - M12c: precipitation stat vs shader mismatch on mountains; lightning buffer re-allocated per frame during a strike; rain factor formula copied 3×; fire doesn't spread or burn out; snow lands on leaves and glass.
  - M08a: no test forces every registry state into data/block-state-ids.json; BlockTicks.removeColumn is O(n).
  - M07a: water isn't replaceable for placement (revisit with buckets).

## Log (newest first)
- 2026-10-17: M09c round 2 PASS on b110d84 (CI #224 green, title verified, merges clean). Told the owner to merge #51; then M10b/M10c are unblocked.
- 2026-10-17: M09c F3 gate restored (4014936, SPEC §3.2), head b110d84, CI green per the owner. Sent round 2 to session_01WTzFdgDYTcgc2XBz6SSkhu.
- 2026-10-17: M09c fix 7a8b641 (264-sample graph, 0-33 ms scale, e2e graph check, ART rule named, dead entry removed, F3 ungated) + 294c315 (progress verified with CI #220 numbers). MY ERROR: SPEC §3.2 (binding) says ?debug=1 enables the F3 overlay, so ungating F3 breaks SPEC. Told the owner: either revert the gate (recommended) or edit SPEC §3.2. Round 2 goes to session_01WTzFdgDYTcgc2XBz6SSkhu after the final CI is green.
- 2026-10-17: M09c review 1 (session_01WTzFdgDYTcgc2XBz6SSkhu) PASS on 0c3d387, merges clean onto master c9d4acf. Underwater: bubbles use the same submerged flag as the fog (no bug). Fix prompt given for Codex: progress/title verified (oranges described), F3 graph history ≥ width + visible scale + e2e check, F3 works without ?debug=1 (player-facing per SPEC), name the ART item-icon rule in the decision, remove the dead ORANGE_BLUSH entry.
- 2026-10-17: #52 (M08c) merged. M09c: the owner swapped the carrots for oranges (head 0c3d387, CI green; I checked the icons: round, outlined, half and empty states fine). Reviewer prompt given.
- 2026-10-17: #52 CI green on 0424f18; told the owner to merge. A trial merge of m08c with m09c is clean.
- 2026-10-17: M08c revert pushed (0424f18): fast-leaf screenshot byte-identical to 8f0d70f; net change vs the reviewed head is only the sway-mask packing + its test + notes. Merge #52 once CI is green.
- 2026-10-17: Owner disliked the new fast-leaves look; asked the M08c builder to revert only the fast-leaf colour (keep the original near-black substitute) and keep the uvec4 sway packing. Then merge #52 when CI is green.
- 2026-10-17: M08c fix 257a3f3 pushed: sway masks uvec4[32]×2 (64 vectors, equivalence test over 4096 tiles, src/render/foliage.ts); fast leaves fill with the texture's own body colour × tint (screenshot checked: even dark green, no black, no wallpaper pattern). Told the owner to merge #52 once CI is green (no round 2 needed). M09c awaits the owner: chunkier carrots or start the reviewer.
- 2026-10-17: Sent the M08c fix round (owner-approved) to session_01DR2TANX6z4XcX2ac2TvxWj: pack the sway masks as uvec4[32] or a texture (+ equivalence test); fast leaves use the darkest mid-green × biome tint, re-capture the screenshot. Then the same reviewer for round 2 if needed, or merge.
- 2026-10-17: M08c review 1 (session_01HfQXqib82PoFwEDCW1rFXa) PASS, no blocking. Non-blocking: sway masks are 2× uint[128] uniforms (~256 vertex uniform vectors, a link-failure risk on minimum-spec GPUs); fast leaves near-black; diagonal sway ~0.057. Recommended a small fix (pack as uvec4[32] or a texture), plus optionally a mid-green for fast leaves. Awaiting the owner's choice.
- 2026-10-17: M09c c51f405 (icon change), CI green. Hearts match the owner's request; carrots read well as hunger but are thin (about 2 px), and I offered a chunkier-carrot fix line. Updated reviewer prompt given (head c51f405; the PR title still says [INCOMPLETE]).
- 2026-10-17: M08c PR #52 (8f0d70f), CI green. My screenshot check: glass and stained glass good; fast leaves near-black with a visible repeating pattern (owner to judge). Reviewer prompt given. M09c head moved to c51f405 (icon change); check its screenshots once CI is green.
- 2026-10-17: M08c gate (Sonnet builder session_01DR2TANX6z4XcX2ac2TvxWj, claude/m08c, 1 commit): unit 741; e2e 95 passed, failing only m04:276. Glass diff 0.031. Deviations accepted: wind clock also freezes on api.pause() (the M12c clear control needs it); stained-glass recipes 8 glass + flower/plant (reachability test, no dyes); packed ice translucent with light opacity 3. Touches lighting.ts and world-manager.ts (reviewer to check). State IDs 137-144 appended. Advised approve.
- 2026-10-17: Owner wants HUD icons changed before the M09c review: red outlined hearts with a pink/white highlight top-right; hunger as carrots (I picked carrots over meat to avoid Minecraft's drumstick). Status icons follow the ART item-icon rule (outline, ≤12 colours), not the 8-colour panel palette. Fix prompt given for Codex; then I check the screenshots and the reviewer starts.
- 2026-10-17: M09c PR #51 (head 4426542), CI green including m04:66. My screenshot check: hearts and hunger both gold (hard to tell apart); the underwater shot shows bubbles but no tint (eye likely between the 0.875 rendered surface and the block top, from the M08b limitation); F3 graph nearly empty. Reviewer prompt given. M08c builder session_01DR2TANX6z4XcX2ac2TvxWj: full verify running since 08:11 UTC, gate pending.
- 2026-10-17: Codex M09c gate (98105b7, not pushed): 17 files, all in scope, no existing test changed. Unit 730 passed; e2e 95/97, failing m04:66 (pump 72.4 ms, higher than the usual ~51-55) and m04:221 timeout. Advised approve; watch m04:66 in CI (a real HUD cost if red there). Check screenshots after the push.
- 2026-10-17: Power cut, so agy is unavailable. M08c prompt adapted for a Claude cloud builder (claude/m08c, CLAUDE.md flow, full verify in background). Not confirmed started.
- 2026-10-17: #50 merged (master 4fd462d). Only M08c and M09c are ready (everything else chains off M09c). Gave prompts: Codex -> M09c (claude/m09c; armorPoints in data/items/armor.json; Player xpLevel/xpProgress + debug setter; creative shows hotbar+crosshair only; F3 data-biome; M04/M05 budgets unchanged). agy -> M08c (agy/m08c; stained-glass.json with 8 colours, append-only state IDs, drop nothing; settings.leaves fancy/fast + src/debug/api/leaves.ts; waving off in fast, existing frame tests must pass unchanged). Not started until the owner says so.
- 2026-10-17: Owner merged #49 (M17a). #50 verify green on 90c4b1c; told owner to merge without Update branch (no shared files).
- 2026-10-17: Codex pushed M08b paperwork fix 90c4b1c (title verified; progress cites CI run #204); verify running. #49 and #50 share no files, and a trial merge is clean. Told owner: merge #49 now, #50 when verify is green.
- 2026-10-17: Owner played M08b on a real GPU: water look approved (darker with depth, shallows see-through), depth blit fine. Gave Codex a paperwork-only fix (progress/M08b.md verified using CI numbers, PR title verified). Then merge #50; #49 ready to merge too.
- 2026-10-17: M17a review 2 PASS on 7cf86c5 (CI green). Every round-1 finding fixed; truncation fuzz at every length rejected. Non-blocking items carried to the M17b prompt (see Decisions). Recommended the owner merge #49.
- 2026-10-17: M17a fix 1 (7cf86c5, CI green) checked: tints in 1807-byte header, player stats, tick save/load, weather meta, index/trailing/bounds checks, compaction tests, real 1165 B column. Round 2 sent to session_01DLa6aEZcGeoci97ppP3gPU.
- 2026-10-17: M08b review 1 (session_01TT5HXsajbjVjMegRNHFMdQ) PASS, no blocking. Non-blocking: water subdued/no visible sky tint, faint waterfall, progress + PR title still say incomplete, depth blit from antialiased default framebuffer untested on a real GPU. Told owner: check look + real GPU, then a paperwork fix (or look fix as round 2) before merge.
- 2026-10-16: M08b PR #50 (claude/m08b 40581bd) contains master (M09b and M10a merged in); CI green (verify, harness guard, Cloudflare). Not yet reviewed; reviewer prompt given.
- 2026-10-16: M17a review round 1 (session_01DLa6aEZcGeoci97ppP3gPU) on b51b116 (CI green): CHANGES NEEDED.
  - grassTints/foliageTints not saved (blended, not derivable from biome indices), so reloaded columns would turn plains-green.
  - Tests are missing compaction, refCounts, edit-after-load and corruption cases.
  - An out-of-range packed index and trailing bytes are accepted silently.
  - Player: health/hunger/saturation/air/flying/dimension exist in player.ts and must be saved (MY prompt wrongly said they did not exist).
  - "Typical column 51 bytes" came from a toy column.
  - deserializeWorld lacks bounds checks.
  - Fix now: (a) scheduled ticks; (b) weather timers (manualOverride, strikeCounter, lastTick, elapsed).
  - Gave the owner an agy fix prompt.
- 2026-10-16: Checked agy M17a (b51b116, PR #49). Good: BCCF column format with a fixed header, palette and indices matching chunk.ts (compaction re-packs bits, so it stays consistent); unknown ID throws; migration registry; deflate via CompressionStream; inventory (41 + cursor + selected), item entities, player, world meta incl. breakCount; serializeWorld with BCWD; light recomputed on load (documented). Gaps for the reviewer: pending scheduled ticks (M08a fluids) not serialized, so mid-flow water would freeze after a reload; weather schedule/strike counters not saved. Reviewer prompt given.
- 2026-10-16: The owner asked for an agy task while Codex merges master into M08b. Recommended M17a (serialization; needs only M10a, merged; unit round-trips only, no screenshots), branch agy/m17a. Decisions: src/persist/; the section format reuses the chunk palette + packed indices; deflate via CompressionStream (Node 22 CI and Node 24 laptop have it); serialize only what exists (columns, block entities, inventory incl. cursor/armor/offhand, item entities, player pos/rot/mode, world meta incl. breakCount and seed); format version plus migration registry; no IndexedDB (M17b). M09c stays for a Claude/Codex session (visual).
- 2026-10-16: The owner merged #48 (M10a). The M08b master-merge message was updated to mention both #47 and #48.
- 2026-10-16: M08b gate ed7a133 (Codex, not pushed): full verify unit 625; e2e 78 pass, 2 known container fails (m04:66 pump 59.7 ms, m04:221 heap timeout). Static-water test 0%. m02c pause calls added as approved. Based before M09b (#47), which also touched main.ts and debug api core/index, so I advised merging origin/master before the first push (otherwise a conflicted PR skips Verify). The owner judges the lake-top look (darker, sparse streaks, translucent steps; reads quite grey).
- 2026-10-16: M10a review round 2: VERDICT PASS on 1b45e66 (PR #48, CI green). The loot seed includes world.breakCount (10.2% flint over 20k breaks); gravel uses an explicit exclusive table; tags fixed; PAL_MUD added. Clean merge with master (M09b only added an optional spawn arg). Non-blocking: progress status line says incomplete; breakCount isn't persisted (M17a should save it); exclusive tables don't validate their sum. Told the owner to merge #48. Next ready: M09c (after M09b), M17a (after M10a), M10b/M10c after M09c.
- 2026-10-16: M09b merged (#47, 0bb369f). M10a fix 02 (1b45e66) pushed, CI green per the owner; it merges cleanly with the new master. I sent round 2 to reviewer session_015kFuFMUwR216caRJiSojps myself.
- 2026-10-16: M09b review (session_01DP1LpKF6t9vDwU2kRwvHFK): VERDICT PASS on 7d41a11 (CI green). Non-blocking: the main screenshot variance crop includes count digits and the tooltip covers 2 slots (the count-1 batch tests do cover icons); a quick second click within 400 ms on the same slot while holding a stack counts as a double-click collect; trousers show tan + slate. Told the owner to merge #47. After the merge, M09c becomes ready.
- 2026-10-16: M09b figure rework pushed (7d41a11, owner approved option A: the figure colours are checked against FIGURE_COLORS, everything else against UI). CI green. Screenshot viewed by me: skin-tone face, iron cap, copper jacket with sash, slate trousers. Reviewer prompt given for #47.
- 2026-10-16: M10a review round 1 (session_015kFuFMUwR216caRJiSojps) on 0ad85e1 (CI green): CHANGES NEEDED.
  - Blocking: loot seed is position-only, and its own test asserts that.
  - Non-blocking, bundled into the fix: docs falsely claim a startup ambiguity check; stale status line; exemption tags (skyshard → M20b, glowcap_stew/membrane/emberite → M20c); implicit exclusive roll should be an explicit flag; leaf self-drop to be noted; mud palette same as dirt.
  - The reviewer's own pairwise probe found 0 ambiguous recipes, matcher ~1 ms. Wild berries: no task adds berry bushes (new SPEC gap). Gave the owner an agy fix prompt.
- 2026-10-16: M09b figure rework done locally (src/ui/preview-figure.ts; player palettes; face; armor drawn). Its own new test m09b-ui.test.ts "at most 8 colors from the shared palette" fails (the figure uses player colours). Builder asks: A) check the figure against player plus armor palettes and everything else against the UI palette, or B) redraw in 8 UI colours. I recommended A (the test is new in this PR, not on master, and still checks an explicit allowed set). The owner decides and approves the screenshot in the builder chat.
- 2026-10-16: agy M10a fix 0ad85e1 checked: rollBlockLoot (chance, min/max, exclusive roll when chances sum to 1) wired into player-controller; data per A.4/A.5; no wheat from grass; progress accurate (106 = 89 crafting + 17 smelting); 3 new loot tests; unit 633 locally. Issue caused by MY instruction: the seed is world + position only, so the same spot always gives the same drop (place/break gravel at one spot never yields flint); fix by adding a per-world break counter or tick. Flagged for the reviewer. The owner must open a PR from agy/m10a so CI runs; reviewer prompt given.
- 2026-10-16: The owner disliked the M09b inventory character (lavender block, yellow shirt, no face). Sent to the builder: skin tones and outfit from src/render/textures/player.ts (match the F5 player model); face with hair, eyes, brows, nose and mouth; ART.md shading; new screenshot shown to the owner before the push to #47.

- 2026-10-16: The owner gave the M10a fixes to agy again (not Sonnet) and accepted the 106-recipe shortfall plus a later stairs task. agy fix prompt covers seeded chance and min/max loot, an accurate progress file, exemption reasons, and documenting the shortfall.
- 2026-10-16: Inspected agy/m10a 6a6c22e (owner pushed, no PR).
  - The code is better than agy's report: exemptions are real registered items (M13e/M13f/M20a); smelting is 17 real recipes; the light-curve change is only a lumite_block cool tint.
  - Blocking: deterministic loot (see table); progress line 24 is wrong.
- 2026-10-16: agy M10a questions answered:
  - simple cubes plus slabs only; smelting counts toward 120; no filler
  - armor: copper 10, iron 15
  - damage: axe = sword − 1, pick − 2, shovel − 3, hoe 1; shears 250, bow 384, shield 336, ember flint 64
  - add ore/plant loot data
- 2026-10-16: M09b gate OK and the owner approved the push; PR #47 is a draft.
- 2026-10-16: The owner proposed agy=M09b, Claude=M10a. I advised swapping (agy=M10a unit-only, Claude=M09b visual); the owner did that.
- 2026-10-16: M08b (Codex) asked to add setFluidAnimationPaused(true) to two m02c-fix static-frame tests (1.66 % / 1.70 % diffs, all inside the water). Recommended approve; the owner decides in Codex's chat.
- 2026-10-16: M08b prompt given (Codex, claude/m08b) with the owner's water-look targets.
  - Code facts: PAL_WATER forces the lightest colour for noise > 0.3 and the second-lightest for > 0.15; water alpha is 255; animation frames are generated but not played.
- 2026-10-16: The owner merged #46 (M12c) as fe346bf.
  - M12c round 2 PASS (session_01XoNjGgzgbuNekNeGSPxJQv): rain e2e uses a clear control (0 vs 0.042); desert asserted; heightmap cache versioned; eviction wired.
  - Round 1 had found the rain diff passing with clear weather.
- 2026-10-16: M12c lightning reworked into continuous mitred ribbons (the owner disliked the stitched pieces); weather block states appended to block-state-ids.json; the owner liked the result.
- 2026-10-16: M08a merged (#45, d72f329). Review PASS (session_01MJsmZ7jGqiURDkfykCzczR): state-ID table keeps the 84 old IDs; oceans schedule 0 ticks.
- 2026-10-16: The owner rejected two M12c storm screenshots (tiny squiggle bolt, then stitched pieces) before the ribbon fix.
- 2026-10-15: M12c moved from agy to a Sonnet builder (session_01JQ62XznmM2AD8JKHq9hFqh) on claude/m12c, built from agy/m12c; it fixed freezing, ticking and flash, and added a natural weather schedule.
- 2026-10-15: Owner order: M08a → M08b (water look) → M09b. The owner later approved running M09b in parallel with M08b (low overlap).
- 2026-10-15: M09a merged (#44). Review PASS (session_01FW4W953qLyw17A6nW8LNHP).
- 2026-10-15: M12b merged (#42); round-1 notes only in decisions/M12b-clouds.md (minor doc gap).
- 2026-10-14: M07b merged (#43). Its pathfinding speedup was reviewed as behaviour-identical.
