# M21c — Client networking decisions

## Loading and lifecycle

Browser transport and session code live in `src/game/net/`, dynamically imported only on connection. Shared protocol and simulation stay browser-free. No networking fields were added to World or Player, and single-player receives no network tick/frame hook. Player checkpoint methods are called only by prediction.

Connection retains ServerHello and all subsequent messages until the game subscribes, then preserves wire order. An asynchronous receive chain also orders column decompression. Every ServerHello replaces the presentation world, including portal travel: old jobs, meshes, entities, labels and prediction history are cleared. Outgoing input sequences and the cumulative correction counter continue across travel. The server clears recipient entity baselines so destination entities receive fresh spawns.

A remote spawn creates only a Player. Its world never advances local AI, spawning, block ticks, fluids or portal mechanics. No save session is attached; generation requests resolve exclusively from received columns. Main-thread generation is explicitly rejected in remote mode. Quit restores controller, renderer and input callbacks, removes overlays/timers and permits ordinary single-player startup afterward.

## Terrain and presentation

ChunkData uses `deserializeColumn`; decoded biome indices are rebound to the dimension's biome table, including the Hollowdeep fix. Columns are adopted immediately, so later edits cannot be overwritten by delayed generation-style jobs. The existing lighting and meshing workers run locally. ChunkUnload releases data and GPU meshes. Replicated portal cells build rendering records without local activation, collapse or travel.

Remote entities keep independent delta baselines and preallocated 32-pose timestamp rings. Rendering samples 100 ms in the past, with linear position/pitch and shortest-arc yaw. Remote players use the existing player model. Other registered entities/items use their existing presentation components without advancing AI or physics. Poses are sampled before rendering; labels project that same pose after the camera update. Name tags use textContent, the shared UI palette, projected head positions and transform-only frame updates; behind-camera tags move offscreen.

## Prediction and block actions

A 256-entry preallocated input ring retains sequence, intent, post-tick pose and shared Player checkpoint storage. Corrections drop acknowledged inputs, compare the acknowledged predicted pose against the server at a 0.01-block threshold, count actual mismatches, restore the acknowledged simulation phase, replace position/velocity and replay outstanding inputs. Live look and input state survive replay. Sequence comparisons handle u32 wrap.

Raw InputEngine states are sampled and applied to Player exactly as the server applies wire input. Short release/press edges between samples cannot invent client-only double-tap sprint. A dedicated deadline-based 50 ms networking timer continues when animation frames are throttled in a background view, without accumulating callback scheduling drift. New movement is coalesced into an immediate next-frame tick when needed; no animation-frame catch-up burst is sent. These clocks exist only during the remote session.

Server physics continues every authoritative tick, including ticks without fresh input, so packet pauses cannot freeze gravity. Each ordered PlayerCorrection also identifies the next simulation tick implicitly: the client counts these messages and aligns the acknowledged checkpoint clock before replay, even when the position matches. This keeps shared movement timing aligned without changing the wire format. Integration coverage requires held movement to continue between input packets; a unit test covers exact-pose phase alignment without inflating the correction counter.

BlockInteraction predicts edits and sends StartBreak, FinishBreak, AbortBreak and Place through the real transport. Input precedes related actions; the server retains its independent ray, reach, timing and inventory checks. Authoritative BlockUpdate restores rejected predictions.

## Roster, inventory and UI

Protocol v3 appends PlayerList: a bounded roster of UTF-8 names and u32 ping milliseconds. Server Ping/Pong measures each peer's RTT; the server broadcasts on join, leave and every 40 ticks. The exhaustive M21a fixture map adds only the approved PlayerList fixture; its fuzz test is unchanged. Holding Tab shows the roster. Client getNetStats measures its own Ping/Pong RTT, takes playerCount from PlayerList and reports the actual correction counter.

Window-zero inventory operations are serialized through authoritative revisions. The first full snapshot sends the visible selected slot through SelectSlot, preventing a saved server selection from disagreeing with the client. Portal resets retain the client selection intent. Snapshots update the owned inventory and cursor. Predicted placement does not consume local inventory: accepted placement receives authoritative counts, while rejection may send only BlockUpdate because the server changed no counts. Deferred container/crafting windows are guarded against local mutations; M21b-fix must replace those guards as window protocols are introduced.

The existing Chat has an event-only multiplayer submit handler. ChatSend and ChatBroadcast traverse the socket; textContent renders names/text, and invisible separators, format, zero-width and bidi controls are escaped visibly. Slash commands show a short unavailable message. Disconnect or socket closure stops sending/simulation, shows the supplied reason or Connection lost, and offers a main-menu return.

Debug methods expose real remote model draws, recent BlockUpdates and the last 32 correction traces. The raw FinishBreak hook bypasses only the client reach check and still uses the server's BlockAction path.

## Test conditions and protocol limits

Networking browser tests select render distance 2 to reduce two-context SwiftShader load. No game default or acceptance threshold changes. All gameplay actions use real input/socket paths, names are unique, initial block states are checked and the 20-block target lies in received terrain. The 30-second walk jumps terrain steps and swims at the surface rather than drowning, and asserts actual travel as well as the correction budget. The shutdown test owns a separate server process and never terminates ports 3001/3002.

The existing protocol has no authoritative player vital/mode/death snapshots. Those values are not simulated locally in multiplayer; a later protocol extension is needed for those HUD/death states. Container windows remain expressly deferred to M21b-fix.
