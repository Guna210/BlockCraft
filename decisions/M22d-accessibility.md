# M22d — Accessibility & resilience decisions

## Directional captions

`src/audio/captions.ts` is the single mapping from every non-`music.*` and non-`ui.*` sound recipe to a short caption and its audible distance. Creature and location names follow SPEC Appendices A–C. Positional captions use a horizontal source vector relative to the camera yaw; the four 90-degree sectors are `ahead` (−45°, +45°], `right` (+45°, +135°], `behind` (greater than +135° or at most −135°), and `left` (−135°, −45°]. Non-positional sounds have no direction.

The tracker keeps at most five distinct caption texts, refreshes an existing text with its new direction and age, expires it after 3 seconds, and fades it during the final 600 ms. Caption distances match the audio service's 36-block hearing range, with idle creature calls limited to 24 blocks. `AudioService.play()` records the caption next to the sound-ring record before checking for a running AudioContext so muted and pre-gesture playback is still captioned.

## Recovery boundary

The full animation-frame body is guarded, and `window.error` plus `window.unhandledrejection` route to the same one-shot handler. On a singleplayer fault the handler suspends the player, stops scheduling render frames, releases capture, and invokes `SaveManager.exit()` through `WorldManager.saveForRecovery()`, racing it against 10 seconds. The screen reports the save result. Back to title runs the normal world teardown; if it rejects or times out, the page reloads.

For multiplayer, the handler invokes the session's `remoteExit`, skips the local save, and tells the player that the server owns the world. The recovery screen still returns through normal teardown.

The boundary uses one `console.warn` line beginning `[BlockCraft] recovered from error:` because the exception was handled and recovery is active; the warning keeps the fault visible in diagnostics without reporting it as an uncaught console error. Message whitespace is collapsed so the log remains one line.

## High contrast

High-contrast UI tokens use opaque near-black fills (`#050505`, `#080808`, and black), pure white text and borders, and `#ffff00` accents and focus/hover outlines. Canvas panels and insets use thicker white borders; hovered buttons use a thicker yellow outline. The shared UI getters read the live setting so canvas screens use the palette on their next draw. The HUD adds an opaque backing for its numeric text; chat message rows and its input use opaque backgrounds and a visible yellow focus outline.

## Audio parameter fix (M16b)

The old audio helper clamped all smoothed parameter values to zero or greater. Listener position and forward-vector components are signed and must preserve negative values for correct panning. `setAudioParamTarget()` now clamps only calls explicitly marked as gains; the master, music, effects, and ambient gains opt in, while listener position and orientation do not. A unit test covers both negative vector values and gain clamping.
