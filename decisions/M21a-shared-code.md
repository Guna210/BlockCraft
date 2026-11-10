# M21a — Shared code and binary protocol

## Shared boundary

- The existing lint script discovers a scoped override in `eslint.config.mjs` for
  `src/world`, `src/gen`, `src/gameplay`, `src/entity`, and `src/net`. Browser globals
  are forbidden by `no-restricted-globals`, including access through `globalThis`.
  `HTML*Element` names come from the installed TypeScript DOM declarations.
  `performance.now()` remains allowed. Inline ESLint configuration is ignored in
  these directories; there are no disables.
- The TypeScript extension of `no-restricted-imports` forbids runtime imports and
  re-exports from render, UI, audio, mesh, debug, persistence, workers, and engine
  code except `engine/rng.ts`. Type-only imports remain allowed.
- `WorldManager` is client orchestration and moves from `src/world/world-manager.ts`
  to `src/game/world-manager.ts`. Its implementation is preserved; relative imports
  are adjusted. Frustum math moves to `src/world/frustum.ts`, lighting math to
  `src/world/light-curve.ts`, and pure texture/noise helpers to
  `src/gen/texture-noise.ts`. All users import the same implementation.
- `src/world/timing.ts` owns the unchanged fixed timestep; `engine/loop.ts` re-exports
  it for existing callers. `src/gameplay/input-state.ts` owns the action and plain
  input-state types. Shared controllers retain their existing plain `(action, down)`
  input API; they never read the browser input engine. The engine re-exports Action
  to preserve its client-facing API.

## Effects and hot paths

The orchestrator clarified the original particle-sink direction: keep the existing
particle injection and the M11a, M14, and M20c tests unchanged. `ParticleSink` is a
shared structural interface with `spawn`, `explosion`, and `ember`; `BreakParticles`
satisfies it without an adapter. Existing parameters, context fields, calls, and
random-number consumption are preserved. The spawner miniature's render import
is type-only and remains permitted.

Only the existing explosion audio runtime import becomes a module-level event
sink (`src/gameplay/event-sink.ts`). `main.ts` registers
`setGameEventSink({ explosion: playExplosion })` once at startup. With no registration
(the Node default), emitting an explosion does nothing and allocates nothing.
There is no event object, queue, polling, or tick callback. No World, Player, or
entity fields are added. Existing particle costs and tick behavior are unchanged.

Blast Charge skin generation and registration move into
`src/render/blast-charge-model.ts`, loaded by the entity renderer. The simulation
still uses the same model ids, component values, and flashing logic. Its texture
generator remains client code under `src/render/textures/explosions.ts`. Shared
Blast Charge code no longer imports or generates that texture.

## Protocol API and ownership

`src/net/protocol/index.ts` exports messages, `BinaryWriter`, `encodeMessage`,
`decodeMessage`, and delta/handshake helpers. There is no transport, socket package,
server, client prediction, or networking lifecycle in this task.

- `PROTOCOL_VERSION = 1`. Only ClientHello carries the u16 version. Before accepting
  a session, M21b calls `rejectIncompatibleVersion(hello.version)` and sends the
  returned LoginReject if non-null. Its reason identifies both versions.
- A WebSocket binary frame contains exactly one message, starting with a u8
  `MessageType`. All multibyte integers and IEEE-754 f64 numbers are little endian.
  Unknown types, bad enums, non-finite floats, noncanonical bool bytes, malformed
  UTF-8, truncation, oversized prefixes, and trailing bytes return typed errors.
- Version changes govern layout changes. There are no password, reserved, or
  placeholder fields. Presence bytes describe actual optional data.
- `encodeMessage(message, writer)` resets a caller-owned writer and returns a
  borrowed view. The writer grows its one buffer geometrically and reuses it;
  fields write directly, including UTF-8 without temporary byte arrays. Queueing
  code must copy or finish sending a frame before reusing the writer.
- `decodeMessage(bytes)` returns `{ ok: true, message }` or
  `{ ok: false, error: { code, offset, message } }`. Reads are bounds checked.
  Payload views borrow the incoming frame; retain that frame or copy before the
  transport recycles its storage. Strings and structured records are owned values.
- UTF-8 strings have u16 byte lengths capped at 256. Chunk payloads have u32 lengths
  capped at 1 MiB. Inventory/drag arrays have u16 counts capped at 128 and minimum
  remaining-byte checks before records are allocated. Frames are capped at
  1 MiB + 64 bytes. Inventory slots are 0–127, with 255 representing the cursor.
  These are transport limits; M21b validates gameplay permissions and semantics.
- Dimensions are u8 (0 Overworld, 1 Hollowdeep); weather is u8 (0 clear, 1 rain,
  2 thunder). World seed and entity ids are u32; chunk/block horizontal coordinates
  are i32; block Y is u16 checked against 0–319; state ids are u16.
- Positions, velocities, rotations and world time use f64 to retain existing
  simulation precision and large-world positions. Sequence numbers and ping ids
  are u32; sequence wrap comparison is a transport responsibility in M21b/M21c.

## Wire layouts

After the leading type byte, fields appear in the listed order. `string` and
`payload` mean the bounded length-prefixed encodings above. Vector3 contains three
f64 values; rotation/movement contains two. Enum wire ids are defined in
`messages.ts` and pinned by wire-format tests.

| Message | Fields |
| --- | --- |
| ClientHello | version u16, name string |
| ServerHello | entityId u32, seed u32, spawn Vector3, dimension u8, absolute time f64 |
| LoginReject / Disconnect | reason string |
| Ping / Pong | id u32 |
| ChunkData | dimension u8, cx i32, cz i32, payload |
| ChunkUnload | dimension u8, cx i32, cz i32 |
| BlockUpdate | dimension u8, x i32, y u16, z i32, stateId u16 |
| PlayerInput | sequence u32, movement (forward/right) 2×f64, look (yaw/pitch) 2×f64, actions u8 |
| PlayerCorrection | acknowledged sequence u32, position Vector3, velocity Vector3 |
| EntitySpawn | id u32, kind string, position Vector3, rotation, name-present bool, optional name string |
| EntityMove | id u32, changed mask u8, absolute mask u8, changed values in x/y/z/yaw/pitch order |
| EntityRemove | id u32 |
| InventorySync | windowId u32, revision u32, slot count u16, stacks, cursor stack |
| InventorySlot | windowId u32, revision u32, slot u8, stack |
| InventoryTransaction | requestId u32, windowId u32, expected revision u32, action u8, slot u8, slot count u16, drag slots u8[] |
| InventoryResult | requestId u32, resulting revision u32, accepted bool, reason string |
| ChatSend | text string |
| ChatBroadcast | senderId u32, name string, text string |
| TimeSync | dimension u8, absolute time f64 |
| WeatherSync | dimension u8, weather u8, remainingTicks u32 |

An inventory stack starts with a bool for presence. Present stacks carry id string,
count u16 (>0), damage variant u8 (0 absent, 1 null, 2 followed by u32 damage), and
affix u8 (0 absent, 1 Keen, 2 Sturdy, 3 Swift). Null slots and cursor values retain
their existing meaning. Transaction result ordering is tied to request ids and
inventory revisions; authoritative slot/full snapshots use the corresponding revision.

`ActionFlag` uses bits for jump, sneak, sprint, attack, use, and pick. Movement is
forward/right in the player's local horizontal frame; look is absolute radians.
Inventory actions cover left/right click, quick move, single/stack drop, even/one
drag, collect all, and hotbar selection. Container ids, reach, stack sizes, legal
slots, and inventory revision validation belong to M21b.

## Delta updates

EntityMove's five low changed-mask bits correspond to x/y/z/yaw/pitch. Absolute
bits must be a subset of changed bits. Each changed field uses i16 delta in units
of 1/4096 unless its absolute bit is set, in which case it uses f64. No baseline
is hidden in the codec. `entityMove(id, previous, next)` uses a small delta only
when exactly representable and reconstructing the next value losslessly; otherwise
it sends absolute. `applyEntityMove(pose, message)` mutates the caller's pose.
M21b tracks the last sent pose per recipient; M21c applies packets in reliable
WebSocket order and keeps its own interpolation history. Teleports and values
outside [-8, 32767/4096] naturally take the absolute path.

## Compression and Node integration

Compression is asynchronous and stays outside the synchronous codec. Reuse
`deflate` / `inflate` from `src/persist/compress.ts` at the transport boundary; that
file is browser-free, although the shared-folder lint deliberately prohibits
runtime persistence imports. Pass the compressed bytes as ChunkData.payload.
M21b should also bound inflated data before deserializing untrusted compressed data.

The Node server imports simulation from the shared folders and protocol from
`src/net/protocol`. Existing category registries use Vite's `import.meta.glob` and
extensionless imports. M21b must transform these with the existing Vite SSR build
pipeline (for example a server entry built using `vite build --ssr`), rather than
running raw TypeScript imports in native Node. The Node-environment Vitest glob
proof loads every shared module with Vite transforms and no browser globals.
Register creature and block-entity types as the singleplayer bootstrap does; the
server need not install the audio sink or particle implementation.
