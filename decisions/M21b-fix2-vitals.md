# M21b-fix2 — Player vitals, death and respawn

This owner-added follow-up extends M21b/M21c; it is outside SPEC Appendix E.
The owner supplied the scope and overrides the local full-verify requirement:
Full verify: PR CI. Publishing waits for the explicit chat evidence gate.

## Protocol v4

Append PlayerVitals, RespawnRequest and PlayerRespawn without changing existing
message ids. PlayerVitals contains health, hunger, saturation, air, burning,
mode, dead, deathCause, xpLevel and xpProgress. XP is the remaining survival
state read by hudSnapshot; equipped armor, selection and hotbar already travel
through inventory sync. Submersion is a local geometric query. Attack/bow meters
are interaction state, rather than survival values. There are no extra vital
fields. The existing exhaustive M21a round-trip fixture map receives exactly
three fixtures; its fuzz test remains unchanged.

RespawnRequest has no payload. PlayerRespawn contains dimension and position.
Cross-dimension respawn uses the existing replacement actor / ServerHello path.

## Server ownership

Each peer owns one reusable vitals message. Scalar comparisons detect changes;
no snapshots, arrays, serialization strings or other bookkeeping objects are
allocated by the tick change check. Send immediately after ServerHello on join
and dimension replacement, on changes, and on the 20-tick refresh boundary.
The existing death callback still drops inventory and clears combat/input. A
wrapper captures deathCauseForDamageSource and sends dead vitals immediately.
The cause is persisted beside the existing player record so dead reconnects
receive the same cause immediately after ServerHello, including after restart.

Dead actors are omitted from entity replication; existing baseline disappearance
sends EntityRemove, and a live actor's reappearance sends EntitySpawn. Inputs
still consume the existing clock/queue and acknowledge sequence numbers, but do
not change dead players' movement/look/combat. Block validation retains its
existing dead-player rejection and authoritative block reply.

Only dead players may request respawn, and an in-flight request is guarded.
Load the saved bed's columns and the Overworld spawn column, then use the same
resolveBedRespawn collision test as single-player with the world-spawn fallback.
The existing spawnPoint stores bed coordinates in the player's dimension; a
missing/invalid bed falls back to Overworld world spawn. Clear invulnerability,
reset survival and input, teleport, and derive onGround from collision. Clear
pending pre-death block/input work, preserve input sequence continuity, and reset
MovementClock silence without replenishing its elapsed-time credit. Dimension
replacement is extracted from portal travel so both paths use the same actor,
inventory, column/baseline, ServerHello and vitals handling.

## Multiplayer client

All ongoing client work stays in the existing dynamically imported network
modules. Apply snapshots to the live Player and authoritative/provisional
checkpoint storage. Existing slots 33–37 retain their meanings; slots 38–42 hold
air, burning, creative-mode flag, XP level and XP progress. Predicted movement
cannot change the server-owned visible vitals: restore the latest received
snapshot after shared physics. Exhaustion remains checkpointed local replay
state and is not an extra wire field.

Server health loss invokes PlayerController's existing camera-tilt / procedural
hurt-sound feedback through an event method, without local damage. Local replay
death/damage callbacks have no UI/inventory effects. Mode sets the existing
Player mode, which already controls HUD visibility and interaction reach.
Multiplayer chat commands remain disabled.

The socket worker stops its input clock immediately on dead vitals, ServerHello
or PlayerRespawn. Main-thread prediction drains dead acknowledgements without
counting death-position snaps. The existing death overlay shows the server cause.
During an active presentation world its respawn callback sends RespawnRequest;
travel, disconnect and exit close the death overlay and restore the original
single-player callback. A fresh presentation reinstalls the network callback.
PlayerRespawn closes the overlay and resets the ring, checkpoint, provisional
step, input, position and movement silence clock without counting a correction;
then the independent transport clock resumes with sequence continuity. Threaded
Ping replies run in the socket worker even when dead input is stopped, so a
dead player retains keep-alives independently of main-thread presentation. The
worker also remembers dead state and rejects a late ServerHello start command
that races with an already-received death snapshot. PlayerRespawn clears that
guard before the fresh clock starts.

No fields are added to World or Player. Checkpoint methods are only called by
multiplayer. Shared UI and hurt-feedback changes are event-only; single-player
frame/tick work and behavior remain unchanged.

## Evidence and test integrity

New Node integration and prediction tests own this follow-up's coverage. The new
browser test owns an isolated port-zero server/world under artifacts and uses
ordinary forward intent to enter the standard seed's pool east of spawn. Real
server survival ticks cause drowning. WebSocket snapshots establish server
health; live player reads and the HUD canvas's actual heart pixels verify the
client presentation. No test-only server flags, hooks, commands or webdriver
checks are introduced. Existing tests other than the approved fixture additions
are unchanged. The death screenshot is produced by Playwright and opened before
handoff.
