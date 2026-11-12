# M21c — Client networking decisions

The owner directed browser networking to live in `src/game/net/`, loaded dynamically on connection. Shared protocol and simulation remain browser-free. Single-player must gain no per-tick or per-frame network work, and no networking fields belong on World or Player.

The multiplayer form remembers name and address in guarded localStorage, defaults to `ws://localhost:3001`, and validates mixed-content addresses. The first increment connects and handles handshake errors; it does not yet enter a world.

The remaining implementation must use server-provided columns and local lighting/meshing without local generation or persistence; reset on each ServerHello, including portal travel. Prediction uses a preallocated input ring and replay after corrections; remote entities use preallocated 100 ms interpolation buffers. The server must broadcast a protocol-v3 PlayerList on join, leave and every two seconds. Chat uses the existing UI with text-only rendering. Container windows are deferred to M21b-fix.

## Step 1 — remote entry

Connection retains messages until the dynamically loaded session subscribes. A serial async receive chain preserves order across column decompression and portal resets. WorldManager supplies generation jobs exclusively from received columns; its existing light/mesh workers remain in use. The controller's remote spawn creates only a player, with no world ticks, mobs, spawning, fluids, block ticks or save session. Quit restores the original controller frame method before returning to the menu.

## Step 2 — prediction and diagnostics

A 256-entry preallocated ring stores input sequence, intent, post-tick pose and shared Player checkpoints. Corrections compare the acknowledged pose at 0.01 blocks, restore that simulation phase, apply authoritative position/velocity, and replay outstanding intent. Checkpoint methods add no fields or work to single-player. Client Ping/Pong measures RTT; the debug domain exposes real counters and a raw FinishBreak message for reach rejection tests. BlockInteraction predicts edits and emits Start/Finish/Abort/Place through the transport.

## Step 3 — remote presentation

Each entity has a 32-pose timestamp ring sampled 100 ms behind receipt time. Positions and pitch interpolate linearly; yaw takes the shortest arc. Player presentation uses the existing player model renderer. Other registered creatures/items use their existing render components without advancing ECS/AI or item physics. DOM name labels use the shared UI palette, textContent, projected head positions and transform-only frame updates. Renderer replacement is restored on exit and ServerHello.

## Step 4 — roster

Protocol v3 appends PlayerList (bounded roster, UTF-8 names and u32 ping milliseconds). The server measures its Ping/Pong RTT and broadcasts names and ping on successful join, leave and every 40 ticks. A dedicated server integration test checks all three triggers. The existing exhaustive protocol fixture map includes the new message; the fuzz test is unchanged. The Tab overlay installs listeners only during multiplayer.

## Step 5 — chat, inventory and disconnect

The existing Chat gets an event-only multiplayer submission handler. Broadcast text uses textContent; separators, zero-width and bidi controls are escaped visibly. Commands show a short unavailable message. Window-zero inventory operations are queued through authoritative revisions; snapshots update the owned inventory. Containers remain deferred. Disconnect stops prediction, keep-alive and interaction, displays the reason, captures input and offers a menu return that restores local callbacks and frees name labels/models.
