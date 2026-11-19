# CONTEXT.md — orchestrator log

The orchestrator's memory between compactions and sessions. It lives only on the `claude/orchestrator` branch, which shares no history with `master` and is never merged.

## Rules for this file

- Read it first: at the start of every orchestrator session and after every compaction. Then run `git fetch origin master` and check it against `progress/` on master and the open PRs. If they disagree, the repo wins; fix this file.
- Update it whenever a task changes state, a decision is made, or the owner states a preference. Commit and push straight away, because the container can be reclaimed at any time.
- Keep it under about 150 lines. When a task merges, move it to Done. Once a decision reaches `decisions/` on master, delete it from this file. Keep the last 20 log entries.
- Facts only, each with its source (PR, session, file). No transcripts or long output.

Last updated: 2026-11-17

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
  - m02:54 mesh p95 (borderline on CI too; re-run once)
  - m04:66 pump > 50 ms
  - m04:131/221/276 streaming idle / heap / RD12
  - M04b mid-flight blank
  - m05-streaming timeout
  - M01a GL count
  - pathfinding 2 ms benchmark
  - m17b:232 and m17b:579 autosave budgets
  - m14:26 frame time (tight on master)
  - general timeouts in untouched code when the container is starved
- Codex container: `npx playwright install --with-deps chromium` can't authenticate as root; bundled Chromium without deps works (M21a-c). Codex threads must run in the BlockCraft environment (a CryptKeep-environment thread hit 403 on cdn.playwright.dev, 2026-11-12).
- CI: `Verify` (pull_request) is skipped on conflicted PRs; the harness guard (pull_request_target) still runs. Retries are 2 on CI.
- Owner-approved test edits so far:
  - setClouds('off') ×3: m12 RD8, m12 M12a time-of-day, m04:276
  - M12c screenshot step aimed at the lightning strike
  - M08b setFluidAnimationPaused(true) in m02c-fix.spec:52 and :74 (approved, in PR #50)
  - sky-holes.test.ts:168 timeout → 120000 (owner edits master directly, 2026-10-18)
- Prompt ≠ launch: a prompt can be given and not used (the owner changed their mind on M09b once). Trust the owner's word about what is running.

## Task status

Done (merged; notes in `progress/`): every SPEC task M00a–M22b (latest: M22a #88, M22b #89 = master 964719c; LOD blocky textured, setting lod default off), plus owner-added M13h (Cinderwraith), M21b-fix2 #86 (protocol v4 vitals/death/respawn), M21b-fix #87 (protocol v5 container windows), INFRA-ci, INFRA-stream (#70), INFRA-win, BLOCKS-shapes and earlier fix tasks. Master SPEC §2.3 has the owner's SwiftShader CI budget tier (48822e0). Last block id on master: 834.

Builder slots: 2 Codex + 1 Claude cloud; 2 Codex at once = smaller Codex model (owner quota).

Remaining SPEC tasks: M22b, M22c, M22d (all ready, parallel); M23 last (+ M23-fix-N).
In flight (2026-11-19 ~12:00Z): M22c PR #90: round-1 fixes in ee6f161 (CI 44507298837 green); docs head 54de688 CI 44511304900 red only on m02:54 mesh p95 (known borderline, not #90's). Integration prompt given: merge master (964719c) - conflicts debug/api/index.ts, chunk-renderer.ts (FS moved to terrain-fragment.ts; re-apply BLOOM_EMISSIVE there), settings-screen.ts (15 Video rows; >=11 px pitch, two-column toggles allowed; m18 test edit -> QUESTION); LOD opaque (~1630) and water (~1674) draws run under drawBuf2 -> drawBuf1 around lod.draw or LOD bloom variant; new e2e lod+bloom no stray glow. After push: I send round-2 review to session_0155bUSBWbBDaj5Z9gqbeQrW. M22d ready.
M22b prompt decisions: LOD only overworld + single-player + RD>12; full-detail radius const 12 (plan mesh/gen/keep use min(RD,12)); LOD from sampleTerrainTopY+sampleBiome in workers (no full gen beyond 12), 4-block grid, water at sea level, biome colours = atlas average x tint; separate LodRenderer, 4x4-column tiles in one shared buffer with multi-draw, skirts, same fog; LOD hidden per column only once full mesh drawn; debug lod.ts; loading screen on SP create/load (MP join out of scope); FOV/aspect recompute-key fix included; arena/tint batching (A1/A2) explicitly out of scope; if RD16 drawCalls >1500 -> QUESTION, don't shrink radius; RD32+RD8 A/B required.
M22b prompt must include (from #88 review): add camera FOV and aspect ratio to the cave-culling recompute key (src/render/section-visibility.ts:111-123); M22a rewrote World.getHeight (section walk), not in its handoff. M22b owns RD > 12 heightmap LOD + loading screen; SPEC criterion RD16 horizon + drawCalls <= 1500.
Perf investigation (owner, 2026-11-17): RTX 5060, RD32 feels laggy with GPU ~50% and low VRAM -> main-thread bound; no LOD beyond RD12 until M22b. Owner will run an Antigravity /swarm read-only investigation AFTER M22b merges (prompt drafted 2026-11-17: 4 investigators frame/streaming/tick-scaling/memory + verifier; read-only, no git; file:line + measurements; I verify findings before turning them into tasks). Suspect to check: game-tick work scaling with loaded area (no separate simulation distance found; ticks.ts random-tick hook exists but has no caller).
Owner Chrome trace 2026-11-19 (master build, RD32, RTX 5060, 31 s): ~18-20 fps steady, rAF callback 35-45 ms. Main thread: 86% of busy time in ChunkRenderer.render GL calls (multiDrawElementsWEBGL 14%, uniform4fv 8% (per-batch drawData), bindTexture 6% (per-column tints), bindVertexArray 5% (arena pages), activeTexture 3%, drawPass JS 4%); streaming/loading ~3-5%; GC ~0.3%. Chrome GPU-process main thread 95-99% busy = the bottleneck (command validation/ANGLE). 46 worker threads, ~0.4 cores busy total. => lag is draw-submission overhead (A1/A2 confirmed by measurement). Batching task design: few large shared buffers so multi-draw spans many columns; no per-column bindTexture (tint via texture array/atlas); per-draw data via data texture or gl_DrawID, not uniform4fv per batch; fewer pass splits; target GL submissions/frame in tens at RD12.
Swarm report (owner ran it BEFORE M22b, 2026-11-18; static only, no measurements, 118 items, overclaims '0 false positives'). My spot-checks on master 14febf4: CONFIRMED + fits RD32 symptom: A1 terrain-arena.ts:162 skips pages drawn in last 4 frames -> every upload frame creates a new >=4096-quad page/VAO, and chunk-renderer.ts:1151-1215 drawPass batches multi-draw per column AND per VAO, re-run per skyOnly/wallTorch pass -> GL submissions scale with visible columns (RD^2). The skip is likely deliberate (avoid writing a buffer the GPU is reading), so fix = reuse/ring with fence or bigger pages, not deletion. CONFIRMED real bug: G12 audio/service.ts:1268 setParam clamps listener position/forward to >=0 -> wrong panning at negative coords/facing. CONFIRMED minor: G3 autosave re-captures every column with a block entity (save-manager.ts:580); G2 UiManager.frame re-renders + filters recipes every frame while a screen is open; B1 mesh tables cloned per job (worker-pool.ts:291); F2 prediction always replays (deliberate M21c design, leave). WRONG/overstated: D2 random ticks never run (setRandomTicks no caller); D3 FrameStats snapshot is debug-API only; G1 F3 text redraws every 250 ms only with F3 open. Gen items C1-C6 are determinism-risky and run in workers. Plan: no bulk tasks; after M22b propose (1) render-batching task A1+A2 measured by GL submissions/frame CPU at RD32, (2) small G12 audio fix; maybe later a measured hygiene task (G3/G2/B1). Ask owner for a Chrome Performance profile at RD32.
Optional idle-slot fix tasks: M18c-fix (/fill into unloaded chunks, rebound menu keys act in chat, creative search IME); M19c follow-ups (spawner checks block light only, not sky light x daylight; setMiniature key string per tick; far spawners re-check every 100 ticks; no save-manager round-trip test for spawner/chest).
Codex rule: Codex prompts use the GitHub plugin, not git; owner clicks Update branch instead of Codex merging master. I can't message Codex sessions; owner relays. Codex's env sometimes dies mid-task: a new thread on the same branch is fine.
Handoff rule (#86-#88): a docs-only head commit can't cite its own CI run; citing the last code commit's run is accepted if the numbers match it and the head run is green.
Merge rule: the second PR to merge clicks Update branch and needs a fresh green run (shard 2 ~12-25 min; check log for "flaky"). Block IDs: append only; second PR renumbers. Parallel PRs touching the same test line should make identical edits.

### Multiplayer notes for later tasks
- Protocol now v5 (M21b-fix). Server: input-driven movement with wall-clock credit (src/net/movement-clock.ts), socket worker client, MP-only GL error drain (src/game/net/error-drain.ts). Decisions in decisions/M21c-client.md, M21b-fix2-vitals.md, M21b-fix-containers.md.
- Minor leftovers: entityMove `delete` on reused objects; server tick for..of iterators; ServerPlayer.down number-as-boolean; hurt feedback source always 'killed'; quickMoveInventoryToWindow spreads {...source} (copyStack cleaner); MP chest e2e break poll up to 30 s.
- Server needs wss when reached from the https Pages site.

## Open items for the owner

- DECIDED (owner, 2026-11-10) hosting: build M21 exactly per SPEC (Multiplayer menu with address entry, also on the Cloudflare Pages site); host no server for now (maybe later on laptop/Railway). Others clone the repo and run their own server. No info popup, no build flag, server does NOT serve the client (owner: too much work). M21c prompt: when the page is https and the address is ws:// (non-localhost), show a clear error saying a wss:// address is needed (browser blocks mixed content). m18a-menus.spec:71 asserts no Multiplayer button -> M21c must edit it (owner approves).
- LICENSE: MIT, added by owner on master (4260ce4).
- README (owner-added task, not in SPEC): last, after M23. Marketing README with fresh screenshots; play link once domain bought.
- PENDING (low priority, owner hosts no server): optional server password/whitelist - SPEC has none, anyone with the address can join. Would be a protocol version bump + server flag; candidate follow-up if the owner ever hosts.

- m14:26 27-charge chain frameCpuMsMax is near its 100 ms bound on master itself (98.3 ms in M16b's A/B, 2026-10-31). Treat a one-off failure as possible flake; if it recurs, the owner decides (profile explosions or budget).

- CI shard 2 ~25 min with m04:221/276 flaky on master itself: INFRA-stream (#70) found SwiftShader backpressure, no game fix; owner approved longer time limits in m04.spec.ts. Further options are harness-side (SwiftShader flags, runner size) and the owner's call.
- Worldgen tuning (later): bigger biomes (needs a SPEC edit to the M03c ≥ 10 biomes in 2048² test) plus fewer Mire patches (surface.ts patchNoise > 0.25).
- Per-biome fog colour: listed in the SPEC biome appendix, owned by no task.
- Berry bushes (wild_berries source) are owned by no task (M10a review).
- Owner idea (2026-10-16): export/import a .save file in the browser (proposed M17d, after M17b) and a desktop app (Tauri recommended over Electron) that saves to disk. Neither is in SPEC; the owner decides whether to add them.
  - Desktop: needs a SPEC edit (§2.1/2.2 browser-only stack) plus an owner-run packaging and signing step; best after M22.
  - .save file: cheap once M17a/M17b exist (format + Blob download + file picker).
  - SPEC wording offered, not yet written (the owner hasn't asked).
- Speed budgets: DONE. Owner edited SPEC §2.3 (48822e0, 2026-11-17): SwiftShader CI tier frame <= 22, upload p95 <= 8, gen+mesh <= 22 ms; real HW 8/3/6 via npm run bench.
- Performance: the owner's Ryzen 7 5700U (Vega iGPU, the SPEC §1.2 target class) struggles, with the GPU maxed and the tab at ~1 GB. Culling and batching are M22a/M22b (end of the plan); there is only column-level frustum culling today. M22a (culling/batching) now merged; owner may run npm run bench on real HW (optional).
- CI retries 2 can hide flaky tests; decide later. Occasional flakes seen recently: m17b:278, M18b settings, M21b-fix containers e2e. m21c-world 500 ms flake: gone since M22a culling (4 clean runs) - watch.
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
- 2026-11-16: #88 M22a CI red: m01a-fix x2, m03g x2 (arena broke debug readback), budget frame CPU > 8. Told owner yes, sent Codex fix message.
- 2026-11-15: #87 M21b-fix merged (2f87382). Owner: M22a next (Codex), with m21c-world no-retry as extra goal; if still flaky after culling, investigate separately. Gave M22a prompt.
- 2026-11-15: #87 round 2: both code findings fixed; reviewer's only blocking = handoff cites run 43688521527 (source commit 5d5680b) not head docs commit c48e28d run 43691062113. I overruled: a docs commit can't cite its own run; numbers match the source run; head run green. Told owner to merge. m21c-world first-attempt flake again on 5d5680b (now ~3 of last 7 runs) -> raised to owner.
- 2026-11-15: #87 fixes 5d5680b + docs c48e28d (owner: CI green). setCapture(false) now only on close paths (checked). Sent round 2 to reviewer session_0155bUSAxWNf9YzFRTncPKiv myself.
- 2026-11-15: #87 round 1 CHANGES NEEDED: input capture, SP shift-click item loss (copy vs live access), stale handoff. Gave Codex fix message; round 2 same reviewer.
- 2026-11-15: #87 M21b-fix opened, CI green. Flagged uncaptured movement input in MP windows + SP refactor parity + recurring m21c-world flake. Gave reviewer prompt.
- 2026-11-14: #86 M21b-fix2 merged (9bf4de9). Gave M21b-fix (containers) Codex prompt.
- 2026-11-14: #86 docs fix af75dc7 checked OK, CI green, title verified. Told owner to merge. Next: M21b-fix (containers) + M22a/M22c/M22d.
- 2026-11-14: #86 round 1 (Sonnet session_0155bUSBHPvwRWj23TEzSY62) CHANGES NEEDED, docs only: status/title/PR body say incomplete; head run 43596988135 clean (49/49/49/48, no retries). Code checks all OK. Non-blocking: hurt feedback source always 'killed'; originalRespawn read at construction. Gave Codex docs-fix message; I'll check the docs push myself instead of a round 2.
- 2026-11-14: #86 M21b-fix2 opened by Codex; head CI clean (no retries). Answered pending QUESTION: no M21c test edit. Gave reviewer prompt.
- 2026-11-14: #85 M21c merged (ff53966). Owner chose M21b-fix2 (vitals/death/respawn) first; gave Codex prompt.
- 2026-11-13: #85 M21c round 2 PASS. Told owner to merge; next: owner picks order of M21b-fix2 (vitals/death/respawn, recommended first) and M21b-fix (containers); M22a/M22c/M22d can start after merge.
- 2026-11-18: Owner shared Antigravity swarm report (run before M22b). Verified top claims myself; summary in Perf investigation section. Gave verdict, no prompt yet.
- 2026-11-18: Owner agreed to keep M22b to LOD + loading screen (batching A1/A2 separate later). Gave M22b Codex prompt.
- 2026-11-18: Gave M22c Codex prompt (parallel with M22b -> smaller model for both, or M22c on Sonnet slot).
- 2026-11-19: Codex opened #89 (M22b) and #90 (M22c), both CI green. Gave two Sonnet reviewer prompts; merge order #89 then #90 with conflict follow-up.
- 2026-11-19: Owner rejected #89 LOD visuals (smooth low-poly). Proposed blocky stair-stepped LOD + detail rings (1/2/4 block) + real textures + matching water; owner leaning yes, fix prompt not yet given. Owner sent RD32 Chrome trace: draw-submission bound (see Perf). Recommend batching task right after #89/#90.
- 2026-11-19: #89 and #90 reviews: both CHANGES NEEDED (small). Gave both fix prompts with conditional merge-integration step.
- 2026-11-19: #89 round-2 review PASS. Told owner to merge #89 after head CI finishes; #90 then does the integration.
- 2026-11-19: Owner merged #89 (M22b) -> master 964719c. #90 red only m02:54 on docs commit; gave #90 merge/integration prompt.
