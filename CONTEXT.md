# CONTEXT.md — orchestrator log

The orchestrator's memory between compactions and sessions. It lives only on the `claude/orchestrator` branch, which shares no history with `master` and is never merged.

## Rules for this file

- Read it first: at the start of every orchestrator session and after every compaction. Then run `git fetch origin master` and check it against `progress/` on master and the open PRs. If they disagree, the repo wins; fix this file.
- Update it whenever a task changes state, a decision is made, or the owner states a preference. Commit and push straight away, because the container can be reclaimed at any time.
- Keep it under about 150 lines. When a task merges, move it to Done. Once a decision reaches `decisions/` on master, delete it from this file. Keep the last 20 log entries.
- Facts only, each with its source (PR, session, file). No transcripts or long output.

Last updated: 2026-11-26

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

Done (merged; notes in `progress/`): every SPEC task M00a–M22c, plus owner-added PERF-batch #91 (master 3de3483, 2026-11-26), M13h (Cinderwraith), M21b-fix2 #86 (protocol v4), M21b-fix #87 (protocol v5), INFRA-ci, INFRA-stream (#70), INFRA-win, BLOCKS-shapes and earlier fix tasks. Latest: M22b #89 (LOD blocky textured, setting `lod` default OFF by owner), M22c #90 (fxaa/bloom/godRays default off; Video tab 9 rows + 3x2 toggle grid), PERF-batch #91. Master SPEC §2.3 has the owner's SwiftShader CI budget tier (48822e0). Last block id on master: 834.

Builder slots: 2 Codex + 1 Claude cloud; 2 Codex at once = smaller Codex model (owner quota). Claude Code cloud builders are fine for fix work (PERF-batch fixes); their permission classifier may block test edits -> owner answers the QUESTION in that session.

Remaining SPEC tasks: M22d (prompt given 2026-11-26, branch claude/m22d; not confirmed launched), then M23 last (+ M23-fix-N). README after M23.
In flight: none (2026-11-26).
Next for owner: M22d prompt when asked. Open perf question: owner to send F3 fps without recording, Task Manager GPU 3D %, chrome://gpu GL_RENDERER line (ANGLE backend), to decide on any PERF-2.

PERF-batch summary (decisions/PERF-batch-terrain.md on master): cross-column multi-draw keyed (pass, lighting variant, arena page); draw-data RGBA32F texture ring of 3 (u_drawBase + gl_DrawID); shared tint atlas (512 slots, MAX_TEXTURE_SIZE guard, overflow -> plains slot 0); large pages (1,048,576/524,288/262,144 quads) with lazy chunked index fill; NO terrain fences: 4-completed-draw-frame quarantine; all terrain GPU writes in one upload phase before the frame's first clear/draw (runs every rAF, also during loading); EntityRenderer.warmUp at init (10.8 ms). SwiftShader A/B: RD8 submissions 341 -> 6; RD32 lod-off ~6,600 -> ~351, frame p95 182 -> ~55 ms. Lesson: on ANGLE Vulkan (SwiftShader CI) per-frame fenceSync and writes into GPU-in-use buffers after the first draw trigger "Running out of reserved outsideRenderPass queueSerial" (fixture-fatal); master was 0/10. Owner-approved test edits: m08b-gpu textures toBe(2)->toBe(4); perf-batch.spec own bound = 4 x (opaque+cutout pages) + ceil(draws/4096) with page caps RD8 <= 4, RD16 <= 6.
Post-PERF-batch trace (owner, 2026-11-26, master 3de3483, RD32 lod off, while recording): rAF interval p50 48.5 -> 29.2 ms (~20 -> ~34 fps; owner says faster without recording); main-thread JS per rAF p50 31.7 -> 7.1 ms, main thread 65% idle, GL calls <1% of samples (prepareFrame 8%); GPU-process main thread still 95-100% busy but 5x fewer tasks (121k -> 23k) = new ceiling; owner sees much higher GPU use. Owner chrome://gpu: ANGLE D3D11 (no native multi-draw on D3D11, so ANGLE loops sub-draws = likely GPU-process cost), no Vulkan, 200 Hz display, 16 threads. ANGLE log warns 'dynamic indexing of vectors is emulated' x2 lines = chunk-renderer.ts VS_CHUNK u_swayLeaf/u_swayPlant[...][(swayTile>>5u)&3u] (small per-vertex cost; cheap fix candidate). Asked owner to test chrome://flags/#use-angle = OpenGL vs D3D11 fps.
Baseline trace (owner, 2026-11-19, master before PERF-batch, RD32 lod off, RTX 5060): ~18-20 fps; 86% main-thread busy in terrain GL calls; Chrome GPU-process main thread 95-99% busy; streaming ~3-5%; GC ~0.3%.
Perf follow-ups (verified by me from the 2026-11-18 swarm report; not tasks yet): G12 audio/service.ts setParam clamps listener position/forward to >= 0 (wrong panning at negative coords) - real bug, small fix; G3 autosave re-captures every column with a block entity; G2 UiManager re-renders + filters recipes every frame while a screen is open; B1 mesh lookup tables cloned per mesh job; random ticks never run (BlockTicks.setRandomTicks has no caller - check if a feature is missing). Infra: m21b* unit tests share dist-server/generation-worker.js (rare "Cannot find module" race, 1 of ~40 runs). Recurring CI flakes: m13f:162, m16b:132/211, m18b-settings:92, M21c world, m04:277 horizon 67 px.
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

## Log (oldest first; keep the last 20)
- 2026-11-14: #85 M21c merged (ff53966). Owner chose M21b-fix2 (vitals/death/respawn) first; gave Codex prompt.
- 2026-11-13: #85 M21c round 2 PASS. Told owner to merge; next: owner picks order of M21b-fix2 (vitals/death/respawn, recommended first) and M21b-fix (containers); M22a/M22c/M22d can start after merge.
- 2026-11-18: Owner shared Antigravity swarm report (run before M22b). Verified top claims myself; summary now under Perf follow-ups. Gave verdict, no prompt yet.
- 2026-11-18: Owner agreed to keep M22b to LOD + loading screen (batching A1/A2 separate later). Gave M22b Codex prompt.
- 2026-11-18: Gave M22c Codex prompt (parallel with M22b -> smaller model for both, or M22c on Sonnet slot).
- 2026-11-19: Codex opened #89 (M22b) and #90 (M22c), both CI green. Gave two Sonnet reviewer prompts; merge order #89 then #90 with conflict follow-up.
- 2026-11-19: Owner rejected #89 LOD visuals (smooth low-poly). Proposed blocky stair-stepped LOD + detail rings (1/2/4 block) + real textures + matching water; owner leaning yes, fix prompt not yet given. Owner sent RD32 Chrome trace: draw-submission bound (see Perf). Recommend batching task right after #89/#90.
- 2026-11-19: #89 and #90 reviews: both CHANGES NEEDED (small). Gave both fix prompts with conditional merge-integration step.
- 2026-11-19: #89 round-2 review PASS. Told owner to merge #89 after head CI finishes; #90 then does the integration.
- 2026-11-19: Owner merged #89 (M22b) -> master 964719c. #90 red only m02:54 on docs commit; gave #90 merge/integration prompt.
- 2026-11-19: #90 round-2 review PASS; ready for owner merge. Then only M22d left in M22, then M23.
- 2026-11-19: Owner merged #90 (M22c) -> master c7909b1. Gave PERF-batch prompt.
- 2026-11-20: PERF-batch PR #91 CI red (resource release bugs). Gave Claude Code cloud fix prompt.
- 2026-11-21: PERF-batch review round 1 CHANGES NEEDED (fence hole, +150 ms first terrain). Sent fix instructions to builder directly.
- 2026-11-21: PERF-batch round 3 exhausted (queueSerial unresolved). Asked owner whether to start new builder; gave prompt.
- 2026-11-26: PERF-batch queueSerial fixed (F+G+load fix, 0 in 2 runs). Gave new reviewer prompt; owner to rerun failed shard + real-HW trace.
- 2026-11-26: PERF-batch review PASS, head re-run green. Offered final small commit (prepareFrame flag, counter assertion, handoff) before merge.
- 2026-11-26: Owner merged PERF-batch #91 (master 3de3483). CONTEXT refreshed for compaction: next = owner real-HW trace, then M22d, M23.
- 2026-11-26: Owner real-HW trace after PERF-batch: ~20 -> ~34 fps while recording, main thread now mostly idle, GPU process still saturated. Asked for fps/GPU%/chrome://gpu before any PERF-2.
- 2026-11-26: Gave M22d prompt (Codex): new ACCESS tab (subtitles, reducedMotion, highContrast, default off), subtitles emitted in AudioService.play before context check, try/catch boundary in main loop + window error listeners, warn not console.error, debug injectFault, G12 listener clamp fix included as owner extra.
