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

Done (merged; notes in `progress/`): M00a–M06b, M07a, M07b (#43), M08a (#45), M09a (#44), M09b (#47, 0bb369f), M10a (#48, bf34ade; agy), M17a (#49; agy), M08b (#50, 4fd462d), M08c (#52; Sonnet builder), M09c (#51, 355d136), M10b (#55, 477baf4; Codex), BLOCKS-shapes (#54, fcaaa1f; IDs 158-533), INFRA-ci (#53, 4-way CI sharding, ~13 min), M12a (+fix), M12b (#42), M12c (#46, fe346bf), M13b, M16a, M16c, INFRA-win, plus earlier fix tasks.

In flight:

| Task | State | Builder | Reviewer | PR | Notes |
| --- | --- | --- | --- | --- | --- |
| M10c kiln & tool wear | Round 2 PASS on 72b4976; owner to merge #57 | agy built; Sonnet finished on claude/m10c (11 commits over agy/m10c) | session_017hxoR9pRWVocku9pgtrLa3 (rounds 2-3 go here) | #57 (supersedes #56; owner closing #56) | Full verify: 790 unit, 112 e2e. Kiln 534-541, m08c test = master, hooks via onUse/onBreakBeforeRemove, flame teardrop + yellow core + tongues. Reviewer to check: e2e spec keeps its own copy of flame frames (flame screenshot may not come from game code); one kiln-specific facing branch in block-interaction. |

Ready next: nothing else until M10c merges. Then M11a (Survival model & hazards) and M15a (Current core & logic) both need M10b+M10c. M17b needs M15b or an owner SPEC change.

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
- npm ci reports 1 high-severity vulnerability; not investigated.

## Decisions not yet on master

- M17a prompt: persist world.breakCount (M10a loot seed) and block-entity state.
- M17b prompt (from M17a review 2 non-blocking): make weather-timer meta fields (manualOverride, strikeCounter, lastTick, elapsed) required on read and write (no ?? defaults; v1 never shipped); BlockTicks.addTicks must rebase due by (current clock - saved column time) or M17b documents a single world clock; actually call LightEngine recompute on load (progress/M17a claims it, persist/ doesn't do it); World.setColumn is the restore hook (only tests call it today).
- M13c prompt: call PathSearch.dispose() on abandoned searches; adapter.invalidate() or a chunk-load hook (M13b review).
- Weather migrated onto ticks.ts random ticks: later follow-up (M12c kept its own tick).
- Armor values are duplicated: M10a ARMOR_DEFENSE in tools.ts and M09c armorPoints in data/items/armor.json (values match today). M11a should use one source.
- Leftovers:
  - M12c: precipitation stat vs shader mismatch on mountains; lightning buffer re-allocated per frame during a strike; rain factor formula copied 3×; fire doesn't spread or burn out; snow lands on leaves and glass.
  - M08a: no test forces every registry state into data/block-state-ids.json; BlockTicks.removeColumn is O(n).
  - M07a: water isn't replaceable for placement (revisit with buckets).

## Log (newest first)
- 2026-10-18: #57 M10c round 2 PASS (72b4976). Dark tip pixel = flame fill rounding at ~94% fuel (Math.round); owner is fine with it. Told owner to merge #57 and close #56; then M11a + M15a are ready.
- 2026-10-18: #57 CI green on 72b4976; sent round 2 to session_017hxoR9pRWVocku9pgtrLa3 (check flame from game code, the 3 new unit tests, decisions IDs; dark tip pixel non-blocking).
- 2026-10-18: M10c 72b4976 commits regenerated PNGs (flame 4099 B). Viewed: tall pointed yellow core, red edge, orange body, moving tongues, half fuel dark top. Odd single dark pixel above the tip in the full-fuel frames; owner to judge. Round 2 after CI is green.
- 2026-10-18: M10c round 1 fixes pushed (46b5088 + 7f0c153): flameBox in getScreen, flame cropped from the real screen, pointed core, spill/full-pool/world.tick tests, decisions IDs fixed. But the committed m10-kiln-flame.png is byte-identical to 9236db9 (old spec-drawn image), so I asked the builder to regenerate and commit both PNGs. The owner told the builder to skip the full local verify; CI is the full verify.
- 2026-10-18: #57 round 1 CHANGES NEEDED. Blocking: flame PNG drawn from the e2e spec's copy, not src. The reviewer also listed missing tests (spill, stacking, away-ticking, partial fuel, per-item timing), but those aren't owned ACs (the SPEC row owns only smelts 8 ores + 59 uses/harvest level), so I asked only for spill-on-break + away-ticking tests. Sent the builder: flame PNG from game code, taller pointed yellow core (owner's original request), the 2 tests, decisions §2/§9 IDs fix.
- 2026-10-18: #57 M10c CI green (9236db9). Checked: IDs 534-541 appended, only m10c tests in tests/ diff, screenshots viewed (flame = red edge/orange body/small yellow core, tongues shift; core still smallish and blocky; owner to judge). Gave round 1 reviewer prompt.
- 2026-10-18: M10c Sonnet takeover reached the publish gate: merged master, kiln 534-541, m08c test identical to master, flame teardrop with yellow core and tongues, 790 unit / 112 e2e passed, unrelated screenshot rewrites restored. Told owner to approve; reviewer to check the flame-frame copy in the e2e spec.
- 2026-10-18: #54 merged (fcaaa1f; master IDs end at 533). agy M10c fix bda76dc: kiln back to append (145-152), registration in main.ts, lightEmissionWhen, flame now a teardrop but with a plus-shaped core and no tongues; agy re-edited the m08c test (undisclosed). A trial merge with master conflicts in 6 files. Gave a Sonnet takeover prompt: claude/m10c from agy/m10c, merge master, kiln 534-541, master's m08c test, keep the hooks from all 3 tasks, teardrop core + tongues, full verify, gate; the new PR supersedes #56.
- 2026-10-18: Owner approved the m10b-crafting-chests.test.ts:42 edit (≥ 157). #54 CI green on 57ef54d; told the owner to merge.
- 2026-10-18: BLOCKS-shapes catch-up 57ef54d: merged master, IDs 158-533, m08c test identical to master, crafting 121 + smelting 17, tile ≥ 1024 guard + door-drop test. Needs owner approval for a test edit: m10b-crafting-chests.test.ts:42 getMaxStateId() toBe(157) → ≥ 157 (exact workbench/chest IDs still pinned); I recommended approval. Merge #54 when CI is green; then M10c kiln = 534-541.
- 2026-10-18: #55 M10b merged (477baf4; master IDs end at chest 157). Sent BLOCKS-shapes the catch-up: merge master, renumber to 158-533, take master's m08c test, confirm crafting ≥ 120, optional tile/door tests. M10c kiln will go after 533 once #54 merges.
- 2026-10-18: Merge order changed: M10b (#55) → BLOCKS-shapes (#54, renumber to 158-533 and take master's m08c test) → M10c (#56, renumber once at the end, after master's last ID, probably 534-541).
- 2026-10-18: M10b round 2 PASS on 76c4776 (slot mapping verified by the e2e test; non-blocking: RESULT label touches a count, unexplained READY button). Told the owner to merge #55; then M10c renumbers after 157 and takes Codex's m08c test, and BLOCKS-shapes renumbers last.
- 2026-10-18: M10b fix 76c4776 (CI green per the owner): the double-chest screenshot now fits (one-line title, 27 slots + separate hotbar, margins). Sent round 2 to session_01CVaVvTgfoBEWzTvk2QPuyd.
- 2026-10-18: BLOCKS-shapes #54 review 1 (session_01RmTZW4vQiYRGCxtUG6TBvr) PASS; non-blocking: tile<1024 guard, door drop and fence collision tests, mesher allocation, weak fence icons. Merge after renumbering post M10b/M10c. Slow shard 2 = m04:221/276 time out then pass on retry (~12 min), also on master: a follow-up idea.
- 2026-10-18: M10b #55 review 1 (session_01CVaVvTgfoBEWzTvk2QPuyd) CHANGES NEEDED: double-chest screen title wraps, panel overflows the viewport, shows armor/offhand slots, hotbar not separated. Polish: displayName tooltips, '1/1' page indicator, RESULT label clipped. Fix prompt given for Codex. M10b IDs: workbench 145, chest 146-157.
- 2026-10-18: Open PRs: #55 M10b (fd56c66, CI green), #54 BLOCKS-shapes (bfba567, CI green; shard 2 took 28 min, check for retries), #56 M10c draft (agy fixing). Reviewer prompts given for #55 and #54 (in parallel). Merge order: M10b → M10c → BLOCKS-shapes.
- 2026-10-18: Owner wants the kiln flame redone: teardrop shape with ragged tongues, red outer / orange / yellow teardrop core (no box), subtle 2-3 frame flicker, shrinks with fuel, plus a zoomed crop screenshot. Added as point 4 of the agy M10c fix prompt.
- 2026-10-18: Checked agy M10c PR #56 (cb3fad0). BLOCKING: kiln inserted at IDs 137-144 and stained glass shifted to 145-152 (append-only violated; breaks Codex's pinned test). Also: block-entities.ts imports gameplay/kiln (layering); kiln-only branches in registry texture lookup, icons.ts and lighting.ts (make them data-driven: front/front_lit by facing, per-state emission); flame icon is an oval. OK: iron/copper/gold ore smelting (SPEC literal), durability bar, damage serialization. Gave the owner an agy fix prompt. After M10b merges, kiln IDs need renumbering again.
- 2026-10-18: agy reports M10c done (verify:quick ok; 2 unit timeouts in untouched lighting tests; one screenshot combining the kiln UI + durability bar). To check after the push: unexplained edits to light-curve.ts / lighting.ts / registry.ts / block-entities.ts / hud.ts; how m08c-glass-foliage still passes (silent edit or IDs not appended?); 'added ore smelting recipes' may duplicate M10a. Merge order: M10b → M10c → BLOCKS-shapes (each later one renumbers and takes Codex's m08c test version).
