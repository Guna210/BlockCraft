# CONTEXT.md — orchestrator log

The orchestrator's memory between compactions and sessions. It lives only on the `claude/orchestrator` branch, which shares no history with `master` and is never merged.

## Rules for this file

- Read it first: at the start of every orchestrator session and after every compaction. Then run `git fetch origin master` and check it against `progress/` on master and the open PRs. If they disagree, the repo wins; fix this file.
- Update it whenever a task changes state, a decision is made, or the owner states a preference. Commit and push straight away, because the container can be reclaimed at any time.
- Keep it under about 150 lines. When a task merges, move it to Done. Once a decision reaches `decisions/` on master, delete it from this file. Keep the last 20 log entries.
- Facts only, each with its source (PR, session, file). No transcripts or long output.

Last updated: 2026-11-12

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

Done (merged; notes in `progress/`): every SPEC task M00a–M21b (latest: M20c #82, M21a #83 a60a64a, M21b #84 = master b95348a), plus M13h (owner-added Cinderwraith), INFRA-ci, INFRA-stream (#70), INFRA-win, BLOCKS-shapes and earlier fix tasks. Last block id on master: 834 (blast_charge 820, M19c 821-824, M20b 825-832, portal 833-834).

Builder slots: 2 Codex + 1 Claude cloud; 2 Codex at once = smaller Codex model (owner quota).

Remaining SPEC tasks: M21c (serial); after M21c: M22a, M22c, M22d in parallel; M22b after M22a; M23 last (+ M23-fix-N).
In flight: M21c PR #85 (head 1a7f8b1, CI green). Round 1 (Sonnet, session_0155bUSB9aPA99FKYrb2QCyC) VERDICT PASS, no blocking. I asked for a counter fix (repeated acks uncounted). Codex: honest counter shows 298 corrections in the 150 ms walk (criterion < 5) -> M21c criterion NOT really met. Root cause (server.ts ~721-738 + simulation.ts:411-415): server consumes max 1 input per tick and ticks every player every tick, so client/server tick phase slips (0 or 2 inputs per tick) put the server a tick ahead/behind. Decided 2026-11-12: input-driven player movement on the server (one Player.tick per received input, drain up to 3 queued per server tick, neutral-input tick after 5 input-less ticks so gravity/fluids still apply; ack = last applied input; combat/bow/interaction/world stay per server tick). Codex asked to edit 2 of its own m21c-prediction.test.ts assertions (1->2, 0->8): told to hold until after the root fix and ask again with numbers. Status: input-driven server implemented locally; still 116 corrections (unpushed); own-test adaptations approved; Codex classifying the remainder. Then round 2 in the same reviewer session.
Found in review: server has NO respawn path (player.dead only blocks actions; dead player stuck until reconnect) and client gets no health/hunger/mode/death (HUD always full). M21b gap, not M21c. Proposed follow-up M21b-fix2 (vitals/mode/death/respawn protocol + death screen + server respawn); owner to choose order vs M21b-fix (containers). Both bump the protocol and touch server.ts -> run serially.
After M21c: review (new Sonnet session), then M21b-fix + M22a/M22c/M22d.
Owner-added task (decided 2026-11-12): M21b-fix after M21c merges = multiplayer container windows (chests, kilns, crafting tables: window ids >= 1, server-owned open-container state, distance checks, close on move away/break). Runs before or alongside M22.
Optional idle-slot fix tasks: M18c-fix (/fill into unloaded chunks, rebound menu keys act in chat, creative search IME); M19c follow-ups (spawner checks block light only, not sky light x daylight; setMiniature key string per tick; far spawners re-check every 100 ticks; no save-manager round-trip test for spawner/chest).
Codex rule: Codex prompts use the GitHub plugin, not git; owner clicks Update branch instead of Codex merging master. I can't message Codex sessions; owner relays.
Merge rule: the second PR to merge clicks Update branch and needs a fresh green run (shard 2 ~12-25 min; check log for "flaky"). Block IDs: append only; second PR renumbers. Parallel PRs touching the same test line should make identical edits.

### For the M21 prompts (decided / to include)
- Keep `ws` and server/ code out of the browser (Vite) build; Cloudflare Pages deploy (static, single-player) must keep working. CI build catches leaks.
- M21c (from #84 review): chat UI must render text safely (textContent; U+2028/2029, zero-width and bidi chars not stripped by server); break tolerance 100 ms vs real jitter (maybe tick-based later).
- Later/M22 notes: entityMove uses `delete` on reused objects (V8 dictionary mode); server tick for..of iterators; ServerPlayer.down returns number-as-boolean (needs comment). Server measured (#84): RSS 109/330 MiB idle/2 clients, CPU 0.7%/20% of one core, tick p95 0.2/2.5 ms.
- Server needs wss when reached from the https Pages site (Railway and Cloudflare Tunnel both provide TLS).

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
- 2026-11-12: #85 input-driven server done locally (M21b tests unedited) but delayed walk still 116 corrections. Approved adapting 4 of M21c's OWN new unit tests to the approved timing (exact values, fixture mirrors real server, packet pause < 5 ticks stays 0). Told Codex to classify the 116 via the trace before further changes; QUESTION after 3 approaches.
- 2026-11-12: #85 counter fix exposed 298 corrections (real criterion failure, masked by undercount). Diagnosed server tick-phase mismatch; sent Codex input-driven server movement fix; held its request to change 2 own unit assertions.
- 2026-11-12: #85 M21c round 1 PASS (Sonnet). Non-blocking but I asked for a fix: repeated-ack corrections uncounted (prediction.ts:76-94). Also found: server never respawns dead players; client has no vitals -> proposed follow-up M21b-fix2.
- 2026-11-12: #85 M21c completed by Codex retry (1a7f8b1, CI green, retitled verified). Checked diff, tests and screenshot; gave Sonnet reviewer prompt. Flagged to owner: no health/hunger/death/mode sync in multiplayer (protocol gap, not in SPEC) - candidate to add to M21b-fix or a separate follow-up.
- 2026-11-12: #85 M21c opened [INCOMPLETE] by Codex: menu + handshake only. Recommended not merging (would ship a dead-end Multiplayer button to Pages) and continuing on the same branch with a Claude builder; gave continuation prompt.
- 2026-11-12: #84 M21b merged (b95348a). Gave M21c prompt (Codex). Decisions: client net in src/game/net (not shared src/net); MP mode in world-manager: chunks from ChunkData (deserializeColumn + Hollowdeep biome fix), local light/mesh, no local gen/saves/IndexedDB, no local mob AI/block ticks; prediction ring buffer, compare to predicted pose at acked seq, eps 0.01 -> correction+replay; 100 ms interpolation, shortest-arc yaw; name tags DOM overlay; PlayerList message (names+ping) protocol v3 + server broadcast; RTT via client Ping (server echoes); menu name+address (default ws://localhost:3001), localStorage last values, errors incl. https+ws:// non-localhost needs wss; commands disabled in MP chat; chat via textContent; debug net module for raw far BlockAction; e2e on 3001/3002, kill test spawns own server; SP zero cost (dynamic import).
- 2026-11-12: #84 M21b round 2 PASS (pickup returns after first, Player identical to master via ServerPlayer subclass, roster-gated focus, chat stripping). Non-blocking: ServerPlayer.down number-as-boolean, chat unicode for M21c UI, iterators, jitter. Told owner to merge.
- 2026-11-12: #84 fix 0ca0fcf green (Player fields removed, arrow pickup test). Sent round 2.
- 2026-11-12: Owner chose M21b-fix (MP container windows) as follow-up after M21c.
- 2026-11-11: #84 M21b round 1 CHANGES NEEDED: (1) projectiles.ts:357 tickStuck arrow pickup duplicates with 2 players (probe reproduced) -> stop after first pickup + test; (2) owner perf rule: Player gains movementForward/Right fields (player.ts:122) -> move out; per-mob focus(id) in runtime.ts:332/383 + creature.ts gate on roster; spawning.ts:132 players() per mob hoist; spawners.ts:54 array per call reuse. Also chat control chars stripped. Non-blocking: for..of iterators, jitter vs 100 ms break tolerance, container windows (follow-up).
- 2026-11-11: #84 M21b green (45 files, +4130). Server: RSS 109 MiB idle / 330 MiB with 2 clients, CPU 0.7% / 20.5% of one core, tick p95 0.2 / 2.5 ms, saves 117 KiB. Protocol v2. Limitations: inventory window 0 only (chests/kilns not usable via client windows?), async server light staleness. Shared changes in M06/M07/M11/M13/M14/M19/M20 code. Gave reviewer prompt.
- 2026-11-11: M21b Codex QUESTION (zero alloc scope). Answered option 1: no steady-state allocations in server/ own bookkeeping; shared sim allocations as in single-player and ws internals OK; one copy per sent frame OK; no shared ECS refactor.
- 2026-11-11: #83 M21a merged (a60a64a). Gave M21b prompt (Codex). Decisions: Vite SSR build (vite.server.config.ts -> dist-server/, build:server + server scripts, ws runtime dep, @types/ws dev), tsconfig include server, lint forbids ws/node:/server imports in src; server tick mirrors PlayerController order with shared modules, one World per dimension lazily; gen (and light if needed) on worker_threads, deterministic vs client; server-authoritative movement from PlayerInput, PlayerCorrection ack every tick; new BlockAction messages (start/finish/abort break, place; x,y,z,face,slot) PROTOCOL_VERSION 2; validation reach (combat.ts SURVIVAL/CREATIVE_REACH + 1 tolerance), break speed (shared hardness/tool, latency tolerance), speed/teleport -> correction, inventory revisions; disk: <world>/level.json, <dim>/r.<rx>.<rz>.bin 32x32 columns M17a format, players/<name>.bin, entities, atomic writes, autosave 60 s + SIGINT/SIGTERM; CLI --world --seed --port --view-distance --delay-ms (N/2 each way) --max-players --reset-world; GET /health; Playwright webServer 3001 plain + 3002 delay 150, worlds under artifacts/; integration tests vitest node env + tiny m21b e2e via Node ws; handoff RAM/CPU/tick p95/save size + lean install.
- 2026-11-10: #83 M21a round 2 PASS (WebGL lint + self fixed; 3528/3528 deltas, 14.1 B avg, err <= 1/8192 no drift). Non-blocking: status/title/PR body stale; entityMove `delete` dictionary mode (M21b note). Told owner: Codex docs push, then merge.
- 2026-11-10: #83 fix 8a29281 green (owner). Sent round 2 to reviewer.
- 2026-11-10: #83 M21a round 1 CHANGES NEEDED: (1) lint misses WebGL* other than WebGL2RenderingContext -> generate from lib.dom like HTML*Element + test; (2) EntityMove delta path never used for real floats (only exact 1/4096 multiples) -> quantise deltas to i16 at 1/4096, sender baseline = reconstructed pose (mutated in place, no alloc), large jumps absolute, multi-tick non-dyadic test (err <= 1/8192, no drift). Non-blocking: status/title verified, unused InputState, add self.*. Everything else verified OK.
- 2026-11-10: #83 M21a CI green (4 shards, harness guard, Pages build). Gave Sonnet reviewer prompt.
- 2026-11-10: M21a gate (511b414): 40 lint violations fixed, 22 message types, unit 1428/137 files, touched e2e 153 passed 3 failed (m04 pump, m17b:579 known; m17b:232 ordinary autosave NEW - likely container, CI decides). 4 renames R098-R100 (world-manager -> src/game, noise -> src/gen/texture-noise, frustum + light-curve -> src/world); 18 tests import-path only; M11a/M14/M20c untouched. Recommended owner approve.
- 2026-11-10: M21a prompt given (Codex). Codex QUESTION: edit M11a/M14/M20c tests for the event sink? Answered: no, keep existing particles injection (already type-only), sink only for playExplosion; no test edits.
- 2026-11-10: Owner simplified: M21 per SPEC, address entry on Pages too, no hosted server, no popup; README last; I chose MIT licence.
