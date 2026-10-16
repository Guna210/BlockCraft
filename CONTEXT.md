# CONTEXT.md — orchestrator log

The orchestrator's memory between compactions and sessions. It lives only on the `claude/orchestrator` branch, which shares no history with `master` and is never merged.

## Rules for this file

- Read it first: at the start of every orchestrator session and after every compaction. Then run `git fetch origin master` and check it against `progress/` on master and the open PRs. If they disagree, the repo wins; fix this file.
- Update it whenever a task changes state, a decision is made, or the owner states a preference. Commit and push straight away, because the container can be reclaimed at any time.
- Keep it under about 150 lines. When a task merges, move it to Done. Once a decision reaches `decisions/` on master, delete it from this file. Keep the last 20 log entries.
- Facts only, each with its source (PR, session, file). No transcripts or long output.

Last updated: 2026-10-16

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
  - pending owner reply: M08b setFluidAnimationPaused(true) in m02c-fix.spec:52 and :74 (I recommended approve)
- Prompt ≠ launch: a prompt can be given and not used (the owner changed their mind on M09b once). Trust the owner's word about what is running.

## Task status

Done (merged; notes in `progress/`): M00a–M06b, M07a, M07b (#43), M08a (#45), M09a (#44), M12a (+fix), M12b (#42), M12c (#46, fe346bf), M13b, M16a, M16c, INFRA-win, plus earlier fix tasks.

In flight:

| Task | State | Builder | Reviewer | PR | Notes |
| --- | --- | --- | --- | --- | --- |
| M08b water rendering | gate (merge master first) | Codex (full model), claude/m08b | — | — | Owner's water look targets (darker, fewer highlights, translucent, ripples, animated sides; underwater unchanged). Asked to approve the m02c pause-hook edit. Must merge master (chunk-renderer overlap with M12c). Owner gave a water reference image (existing game: describe only). |
| M09b inventory screen | MERGED (#47, 0bb369f) | Sonnet session_01HomrBqg9TBAxWGTi8WLfMd, claude/m09b | — | #47 | Gate OK: unit 640, e2e 87, startup unchanged. Changed M07b/M09a: optional thrown velocity and pickup delay for Q. Next: the owner checks the screenshot, then the reviewer prompt. |
| M10a recipes/tools | MERGED (#48) | agy, agy/m10a (6a6c22e, base fe346bf) | — | none yet | Blocking: loot always drops every entry (leaves → apple 100 %, grass → seed + wheat, gravel → both, fixed ore counts). progress line 24 lists nonexistent smelting items. Ore/grass exemption reasons. 106 recipes accepted by the owner. After the fixes: push, open a PR from agy/m10a, I re-check the code, then the reviewer. |

Ready after these: M08c (after M08b; ice exists from M12c), M09c (after M09b), M17a (after M10a), M10b/M10c (after M09c + M10a).

## Open items for the owner

- New task to add to SPEC: stairs, fences, doors and trapdoors (multi-box block shapes in block-shapes.ts, collision, placement facing, plus recipes). The owner accepted it 2026-10-16 as the fix for M10a's 106 < 120 recipe shortfall.
- Worldgen tuning (later): bigger biomes (needs a SPEC edit to the M03c ≥ 10 biomes in 2048² test) plus fewer Mire patches (surface.ts patchNoise > 0.25).
- Per-biome fog colour: listed in the SPEC biome appendix, owned by no task.
- Berry bushes (wild_berries source) are owned by no task (M10a review).
- Speed budgets: two-tier §2.3 budgets before M22a (offered to draft).
- CI retries 2 can hide flaky tests; decide later.
- npm ci reports 1 high-severity vulnerability; not investigated.

## Decisions not yet on master

- M17a prompt: persist world.breakCount (M10a loot seed) and block-entity state.
- M13c prompt: call PathSearch.dispose() on abandoned searches; adapter.invalidate() or a chunk-load hook (M13b review).
- Weather migrated onto ticks.ts random ticks: later follow-up (M12c kept its own tick).
- Leftovers:
  - M12c: precipitation stat vs shader mismatch on mountains; lightning buffer re-allocated per frame during a strike; rain factor formula copied 3×; fire doesn't spread or burn out; snow lands on leaves and glass.
  - M08a: no test forces every registry state into data/block-state-ids.json; BlockTicks.removeColumn is O(n).
  - M07a: water isn't replaceable for placement (revisit with buckets).

## Log (newest first)
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
