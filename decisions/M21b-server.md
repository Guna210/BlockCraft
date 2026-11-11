# M21b — Authoritative server

## Build and deployment

- Branch base: `origin/master` at `a60a64a`, containing M21a / PR #83.
- `vite.server.config.ts` uses Vite SSR for `server/main.ts` and
  `server/generation-worker.ts`. Registry globs and extensionless imports receive
  the same transforms as the browser build. Output is `dist-server/`; `ws` stays
  external, while `gl-matrix` is bundled. The output includes its own ESM
  `package.json`, so copying the directory works independently of the checkout.
- New scripts: `build:server` and `server`. Existing scripts are unchanged.
  `npm run server -- --port 3001` builds then forwards arguments to Node.
- `ws` is a dependency; `@types/ws` is a development dependency. `server/` is in
  the TypeScript include list. All `src/**` static imports of `ws`, `node:*`, or
  `server/` are forbidden by ESLint, including shared code's existing stricter
  import rule. Browser builds do not import the server.
- CLI: `--world` defaults to `./worlds/default`; `--seed` defaults to random and
  text seeds use the shared `hashString`; `--port` defaults to 3001;
  `--view-distance` defaults to 8; `--max-players` defaults to 8;
  `--delay-ms` defaults to 0. `--reset-world` removes that world directory before
  loading. An existing `level.json` owns its seed regardless of the CLI seed.
- One world per process. `GET /health` returns 200 and JSON containing readiness,
  process RSS, and the measured tick p95. Port 0 is supported for isolated tests.
- Lean deployment: run `npm run build:server`, copy `dist-server/` to the target,
  install only `ws` there (`npm install --omit=dev --no-save ws`), then run
  `node dist-server/main.js`. Development dependencies are unnecessary at runtime.

## Simulation and workers

- A fixed 50 ms timer drives world ticks, per-player physics, bow/combat/block
  interaction, survival, item entities once per dimension, ECS, then global time,
  weather, portal checks and replication. Every connected player has its own
  shared `Player`, inventory, interaction, combat and bow controllers.
- Pure mining commit/reward logic, death inventory drops and Ember Flint use are
  shared with single-player. Placement still uses the existing shared orientation,
  replacement, multi-cell and collision checks. Sound and particle effects remain
  absent/no-op on Node.
- Each dimension has one lazy `World`, ECS, item manager, mob runtime, portal
  index, and Blast Charge runtime. The Hollowdeep uses its shared pipeline,
  spawn rules, lava rate and Updraft field. Shared roster support selects nearby
  players for mobs, projectiles, item pickup and spawner activation; single-player
  callers retain their existing callbacks.
- Two Node worker threads reuse the shared generation pipelines. Generation
  parity is checked using `worldHash` at sampled positive/negative columns in
  both dimensions. Biome indices and tints travel in the M17 column payload.
- Initial lighting uses the shared lighting engine on workers. Edits enqueue the
  existing shared `computeBatchLight` implementation with a one-column border;
  the server adopts only the center column. Revision checks discard stale jobs.
  This also handles cross-column light and removals without flood filling on the
  tick thread. Gameplay light queries use the latest completed worker result.
- Tick timing is measured from the actual callback, retaining up to 1,200 samples.
  Generation and bulk lighting are asynchronous; replication starts at most one
  column per recipient per tick, with only one column in flight per recipient.

## Input, sequencing and validation

- `PlayerInput` supplies intent, never an authoritative position or velocity.
  The shared player physics clamps analog movement and applies its normal speed,
  acceleration, collision, fluid and flight rules. Invalid movement magnitudes
  and input floods are logged. At most four input frames are accepted per tick;
  a bounded queue consumes them in sequence order, one simulation step per tick.
- Sequence comparisons support u32 wrap. Stale/replayed input is ignored. Every
  tick sends a reused `PlayerCorrection`, acknowledging the last input actually
  simulated and containing authoritative position and velocity.
- Block actions use their own increasing sequence. A bounded action queue records
  the last input preceding each action and waits until that input is simulated.
  Thus a look packet and following click in the same socket delivery use the
  new server-side ray, rather than the previous tick's look.
- Wire version is **2**. `BlockAction` adds start break, finish break, abort and
  place; fields are action u8, x i32, y u16, z i32, face u8, held slot u8,
  sequence u32. Faces are top/bottom/north/south/east/west. The M21a fixture map
  includes the new type; its fuzz test body is unchanged. M21b also round-trips
  all four actions.
- The block must match the server ray and selected hotbar slot, and be within
  shared `SURVIVAL_REACH` / `CREATIVE_REACH` plus one block from the eye. Break
  timing uses shared hardness, tool/affix speed and water/airborne conditions.
  A finish can be **100 ms early** (two ticks) to tolerate packet/tick phase
  jitter. The slower of start/finish conditions governs acceptance. An abort,
  incompatible target/state/slot or rejected finish cannot remove a block.
- Rejected edits send the actual `BlockUpdate`; a rejected placement also sends
  the neighboring destination cell. Accepted edits broadcast to every recipient
  with that column loaded. Entity attack presses use shared server-ray combat.
- Inventory window 0 is each player's 41-slot inventory plus cursor. Requests
  carry operations rather than stack contents. Shared inventory operations own
  count conservation, stack limits and equipment routing. Revisions, ownership,
  action shape, drag duplicates and slot ranges are checked before mutation.
  Results identify the request and resulting revision; rejection always includes
  a full authoritative sync. Server-held chest/kiln inventories persist with
  their block entities; arbitrary client window ids are rejected.

## Replication and connections

- M17 palette/packed column bytes are deflated by the existing compression
  module. Protocol limits cap compressed payloads at 1 MiB. Region loading bounds
  inflation to 512 KiB before parsing a column. Client chunk-upload messages are
  not accepted. Columns stream nearest first; leaving view sends `ChunkUnload`.
  Server columns beyond view distance plus two are saved before unloading.
  Unloads use a bounded per-tick slice; pending joins/portal arrivals pin their
  destination dimension during generation. Restored Blast Charges freeze until
  their column is loaded through an opt-in shared runtime setting; single-player
  keeps its existing default.
- Per-recipient entity baselines and `createEntityMove` messages are retained and
  reused. Quantized deltas update the reconstructed sender baseline. Spawn/remove
  are recipient-specific and dimension/range filtered. Network ids are opaque.
- Join and every five seconds send time; join and weather changes send weather.
  Hollowdeep weather is clear. Chat is a broadcast to logged-in players, limited
  by the codec to 256 UTF-8 bytes and to one accepted message per second.
- Login checks protocol version before names or simulation; empty/control/path
  names, duplicate names (case insensitive), and a full server receive clear
  `LoginReject` reasons. Names reserve a slot while their world is loading.
- Ping is sent every two seconds. Fifteen seconds without incoming traffic sends
  a disconnect. Shutdown sends a reason and flushes delayed output before closing.
- Delay injection queues every binary message for N/2 ms in each direction,
  preserving WebSocket order. Queues reuse fixed rings, bounded by frame count
  and bytes. A single scheduled callback wakes for the next due frame; idle
  transports do not poll. Each transport reuses its writer and owns one copy of
  each sent frame while queued or retained by `ws`.
- Allocation scope follows the owner's clarification: server steady tick state,
  player/recipient records, streaming queue storage, entity baselines/messages,
  delay queues and writers are reused. Existing shared simulation allocations,
  codec decoding, `ws` internals, one owned copy per sent frame, and allocations
  when columns/entities/connections/edits/saves change are retained. No shared
  engine allocation refactor was undertaken.

## Persistence

- `level.json` stores format version, seed, absolute time, weather state and
  per-dimension break counters/tick clocks; it is created before readiness.
- `<dimension>/r.<rx>.<rz>.bin` groups 32×32 columns. The BCRG table contains format
  version, count, local column index and length, followed by each column's
  existing deflated M17a BCCF payload. Only modified columns enter region files.
  Generated untouched columns regenerate from the saved seed.
- Per-column state files retain existing block-entity and scheduled-tick
  serializers plus powered openables. Pistons land before capture. Entities
  retain ground items, portals and shared ECS data; AI closures/path caches are
  reconstructed by registered shared entity factories. Player files use the
  existing player/inventory serializers, including vitals, XP, spawn and dimension.
- Writes use unique temporary files and rename, serialized per destination;
  region read/modify/write operations are also serialized. Autosave runs every
  60 seconds and yields between columns/state records. Shutdown waits for saves
  and pending unload/player writes before exiting. Login waits for pending player
  saves before reading inventory, preventing a reconnect from loading stale data.

## Harness and evidence

- Playwright's `webServer` is an array: the original preview entry is unchanged,
  plus reset-world servers on 3001 and delayed 3002, with the standard seed and
  worlds under `artifacts/`. Explicit `use.baseURL` preserves relative browser
  navigation after switching to an array. The PR needs the owner's
  **`harness-change`** label.
- M21b owns headless Node integration tests and two Playwright handshake tests.
  Existing tests are unchanged except the approved new M21a protocol fixture.
- Owner testing override: `MILESTONE=M21 npm run verify:quick` and affected
  milestone browser specs. **Full verify: PR CI.** Known container timing
  failures are reported without retries, investigation or test edits.
- `scripts/m21b-benchmark.ts` launches a separate production server process and
  two Node clients at default view distance 8. Linux `/proc/<pid>/stat` measures
  server CPU (including workers); `/health` measures process-wide RSS and tick
  p95. Clients remain outside that process. The short session measures idle,
  initial streaming, a scripted moving interval and final saved bytes. Actual
  movement distances are printed alongside resource numbers.
