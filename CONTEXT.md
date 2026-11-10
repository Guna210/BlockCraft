# CONTEXT.md — orchestrator log

The orchestrator's memory between compactions and sessions. It lives only on the `claude/orchestrator` branch, which shares no history with `master` and is never merged.

## Rules for this file

- Read it first: at the start of every orchestrator session and after every compaction. Then run `git fetch origin master` and check it against `progress/` on master and the open PRs. If they disagree, the repo wins; fix this file.
- Update it whenever a task changes state, a decision is made, or the owner states a preference. Commit and push straight away, because the container can be reclaimed at any time.
- Keep it under about 150 lines. When a task merges, move it to Done. Once a decision reaches `decisions/` on master, delete it from this file. Keep the last 20 log entries.
- Facts only, each with its source (PR, session, file). No transcripts or long output.

Last updated: 2026-11-10

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

Done (merged; notes in `progress/`): every SPEC task M00a–M20c, i.e. M00–M20 complete (latest: M14 #78, M19c #77, M16b #79, M20b #80, M20a #81, M20c #82 = master c7e03dd), plus M13h (owner-added Cinderwraith), INFRA-ci, INFRA-stream (#70), INFRA-win, BLOCKS-shapes and earlier fix tasks. Last block id on master: 834 (blast_charge 820, M19c 821-824, M20b 825-832, portal 833-834).

In flight: none. All builder slots free (2 Codex + 1 Claude cloud; 2 Codex at once = smaller Codex model, owner quota).

Remaining SPEC tasks: M21a -> M21b -> M21c (serial); after M21c: M22a, M22c, M22d in parallel; M22b after M22a; M23 last (+ M23-fix-N).
In flight: M21a PR #83 (Codex), CI green incl. harness guard + Cloudflare Pages build; Round 1 CHANGES NEEDED (reviewer session_0155bUSEmBcB6FfyDSGAm9is): fix message given to owner for Codex. Decision: particles stay injected via existing `particles` params (type-only import allowed, or a shared ParticleSink interface BreakParticles satisfies); module-level sink only for real runtime imports (playExplosion in explosions.ts); no test edits for M11a/M14/M20c.
Optional idle-slot fix tasks: M18c-fix (/fill into unloaded chunks, rebound menu keys act in chat, creative search IME); M19c follow-ups (spawner checks block light only, not sky light x daylight; setMiniature key string per tick; far spawners re-check every 100 ticks; no save-manager round-trip test for spawner/chest).
Codex rule: Codex prompts use the GitHub plugin, not git; owner clicks Update branch instead of Codex merging master. I can't message Codex sessions; owner relays.
Merge rule: the second PR to merge clicks Update branch and needs a fresh green run (shard 2 ~12-25 min; check log for "flaky"). Block IDs: append only; second PR renumbers. Parallel PRs touching the same test line should make identical edits.

### For the M21 prompts (decided / to include)
- Keep `ws` and server/ code out of the browser (Vite) build; Cloudflare Pages deploy (static, single-player) must keep working. CI build catches leaks.
- M21b: gen on Node worker_threads; CLI options `--world <name> --seed <seed> --port <n>` (one world per server process); document a lean server-only install; report real server RAM/CPU idle + with clients, and save size on disk, in the handoff. Needs owner `harness-change` label (Playwright starts the server).
- M21a: leave room in the handshake for an optional server password (owner deciding, see open items).
- Server needs wss when reached from the https Pages site (Railway and Cloudflare Tunnel both provide TLS).

## Open items for the owner

- DECIDED (owner, 2026-11-10) hosting: build M21 exactly per SPEC (Multiplayer menu with address entry, also on the Cloudflare Pages site); host no server for now (maybe later on laptop/Railway). Others clone the repo and run their own server. No info popup, no build flag, server does NOT serve the client (owner: too much work). M21c prompt: when the page is https and the address is ws:// (non-localhost), show a clear error saying a wss:// address is needed (browser blocks mixed content). m18a-menus.spec:71 asserts no Multiplayer button -> M21c must edit it (owner approves).
- LICENSE: owner left it to me -> MIT, copyright Guna210. Owner adds it on GitHub (Add file > LICENSE > choose MIT template); not yet done.
- README (owner-added task, not in SPEC): last, after M23. Marketing README with fresh screenshots; play link once domain bought.
- PENDING spec decision: optional server password (and/or whitelist) for M21 - SPEC has none, so anyone with the address can join. Suggested wording: "Optional server password set with --password; client sends it in the handshake, rejected with a clear error if wrong."
- PENDING suggestion: owner could edit SPEC so M22a (culling/batching = laptop performance) depends only on M20c and runs alongside M21.

- m14:26 27-charge chain frameCpuMsMax is near its 100 ms bound on master itself (98.3 ms in M16b's A/B, 2026-10-31). Treat a one-off failure as possible flake; if it recurs, the owner decides (profile explosions or budget).

- CI shard 2 ~25 min with m04:221/276 flaky on master itself: INFRA-stream (#70) found SwiftShader backpressure, no game fix; owner approved longer time limits in m04.spec.ts. Further options are harness-side (SwiftShader flags, runner size) and the owner's call.
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
- 2026-11-10: #83 M21a round 1 CHANGES NEEDED: (1) lint misses WebGL* other than WebGL2RenderingContext -> generate from lib.dom like HTML*Element + test; (2) EntityMove delta path never used for real floats (only exact 1/4096 multiples) -> quantise deltas to i16 at 1/4096, sender baseline = reconstructed pose (mutated in place, no alloc), large jumps absolute, multi-tick non-dyadic test (err <= 1/8192, no drift). Non-blocking: status/title verified, unused InputState, add self.*. Everything else verified OK.
- 2026-11-10: #83 M21a CI green (4 shards, harness guard, Pages build). Gave Sonnet reviewer prompt.
- 2026-11-10: M21a gate (511b414): 40 lint violations fixed, 22 message types, unit 1428/137 files, touched e2e 153 passed 3 failed (m04 pump, m17b:579 known; m17b:232 ordinary autosave NEW - likely container, CI decides). 4 renames R098-R100 (world-manager -> src/game, noise -> src/gen/texture-noise, frustum + light-curve -> src/world); 18 tests import-path only; M11a/M14/M20c untouched. Recommended owner approve.
- 2026-11-10: M21a prompt given (Codex). Codex QUESTION: edit M11a/M14/M20c tests for the event sink? Answered: no, keep existing particles injection (already type-only), sink only for playExplosion; no test edits.
- 2026-11-10: Owner simplified: M21 per SPEC, address entry on Pages too, no hosted server, no popup; README last; I chose MIT licence.
- 2026-11-10: Owner decided no hosted server for now; Pages Multiplayer = info popup (see open items). Proposed build flag, server serving client, LICENSE, README task.
- 2026-11-03: #82 M20c merged (c7e03dd). Remaining SPEC tasks: M21a -> M21b -> M21c (serial), then M22a/M22c/M22d (parallel), M22b after M22a, M23 last. Only M21a ready. Optional fix tasks: M18c-fix, M19c spawner follow-ups.
- 2026-11-02: #82 M20c round 2 PASS (islands reshoot passes, updraft clear + Magmaw ignite fixed). Told owner to merge. Next: M21a (needs M20c, M18b, M18c). Non-blocking: no night-vision pixel test.
- 2026-11-02: #82 fixes b15ff11+a97a9f8 green (islands reshoot facing lava fall, updraft field cleared on travel/unload, Magmaw ignite gated). Sent round 2.
- 2026-11-02: Owner chose reshoot; I sent M20c builder (session_0155bUSAtZkJMYBBcbMy8C9p) the fix: reframe islands shot, clear updraft field on travel/unload, ignite only on successful Magmaw hit. Round 2 to session_0155bUSFJF8zqF49LSmecwby when green.
- 2026-11-02: #82 M20c round 1 CHANGES NEEDED, only blocker = m20-floating-islands.png fails 'coloured lighting visible' (lower half black); all code checks OK. Asked owner (visuals are owner's call): reshoot (reframe toward lava/glowcap light) + cheap non-blocking (clear updraft field on travel/unload, ignite only on successful Magmaw hit), or accept as is.
- 2026-11-02: #82 M20c green on b261cd9 (contains master 526e13f). I checked player.ts: only a gravity local from gravityFactor() (module-level field, early return 1 when no Hollowdeep field), no new fields. Gave Sonnet reviewer prompt.
- 2026-11-01: M20c gate: quick verify unit 1237, M20 e2e 9; touched e2e 53 passed; jump 3.09 vs 1.23 (2.5x); hue 341/352/265 vs 178; spawn test 37 Glowwing + 3 Magmaw only; no new ids. Touches player.ts (gravity factor) -> reviewer flag (no new fields). Floating-islands screenshot dim (islands unlit, M20b lighting) -> owner judges. Glowwing not truly translucent (renderer has no alpha); 'falling blocks' = primed Blast Charges (no falling sand exists).
- 2026-11-01: #81 M20a merged (526e13f). Gave M20c prompt (Claude cloud). Decisions: Updraft = deterministic region field from M20b driftstone_expanse (no per-tick scans; lookup by column), gravity x0.4 for player/mobs/items/falling blocks via one shared gravity hook, soft glow particles/tint capped; Glowwing via creature kit + bounded 3D A* over voxel grid (budgeted per tick, cached), circles then dives; Magmaw swims in lava, lunges onto shore within 6, sets fire; spawn rules Hollowdeep-only, respecting caps; Overworld spawn rules excluded from Hollowdeep; voices via M16b; Glowcap Stew recipe (glowcap + bowl) + 30 s night vision as minimal timed player effect (no general effect system); Hollowdeep music mood check; entity/drop shaders use cavern fog; screenshots forest/magma/islands; e2e low-gravity jump >= 2x, pixel + hue vs Overworld.
- 2026-10-31: #81 M20a round 2 PASS (wiring, ids 833-834, revert on return, spores zero alloc, e2e lands in real cavern, cancel fix). Told owner to merge. Non-blocking: u_dimensionFog uniform per terrain pass in Overworld; platform seal pass ~500 lookups on fallback; handoff final CI totals missing. Next: M20c ready after merge.
- 2026-10-31: #81 merge push 5ed9cef green (contains master 0b44c73, portal 833-834, M20b wired: pipeline, biome ids, fog uniform, spores.ts, lava delay; portal y 41-150; cancel() fix + test). Substantial new wiring code -> sent round 2 to session_0155bUSAs5hRGDVLLvCTE6YE instead of self-check.
- 2026-10-31: #79 M16b merged (0b44c73). Sent M20a builder the merge push: merge master, portal ids 833-834, m19c test take master, keep both in player-controller, wire createHollowdeepPipeline + HOLLOWDEEP_ENVIRONMENT + biome strings + music mood, re-check portal Y range vs real cavern with e2e, travelThroughPortal catch -> cancel() + test. Then I check diff; owner merges. After #81: M20c ready (needs M20a, M20b, M16b).
- 2026-10-31: #79 M16b round 3 PASS. Told owner: optional Codex docs push (progress Status verified + CI totals), then Update branch (bring in #80), fresh green, merge. Non-blocking: pendingPlaybacks entries accumulate only after a failed explosion render; node creation moved to next macrotask (not removed).
- 2026-10-31: #79 fix f77081f green (offline tests for new recipes, keyed pending explosions, enqueue-only explosion path, occlusion batching; m14 max 72.7 ms, A/B vs master in handoff). Round 3 (last) sent. Branch still lacks #80 -> Update branch before merge.
- 2026-10-31: #79 M16b round 2 CHANGES NEEDED: only blocker = no offline RMS/peak test for cinderwraith voices, ambience.cave, mechanism.note (m16a.spec hardcoded list; add in M16b's own spec). Music, first-play, idle cost, listeners, pitch key all FIXED. Also asked: pending explosion slot overwrite (key by position), recentPlaybacks mutate in place, m14:26 A/B vs master (91 ms max vs 100 bound) and remove any M16b cost from the explosion path. Round 3 is the last.
