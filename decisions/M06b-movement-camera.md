# M06b — Swimming, climbing and camera

## Owner decisions

All behavior in this record is the M06b scope approved in the task prompt.

- Extend M06a's fixed 20 TPS `Player`/`BlockCollision` simulation. No frame-based physics or allocations in the new tick paths. Preserve worker pools at SPEC §3.2 sizes and draw every terrain frame.
- Water overlap means `inFluid === 'water'`. Water movement targets 2 b/s horizontally or 3 when sprinting, strong drag, sinking capped at 2 b/s, and jump acceleration toward 3 b/s upward. Jump at the surface bobs; moving against a one-block bank with jump climbs out. Water resets falls; lava is unchanged.
- Add ladder and vine as four-facing thin non-solid wall faces, through the existing model bucket, with zero light opacity and foliage tint for vines. No generation placement.
- AABB overlap with either climber caps descent at 2.35 b/s; input into its supporting wall or jump climbs at 2.35 b/s; sneak holds. Reset fall distance while climbing.
- Mire remains a solid full block and multiplies ground movement speed by 0.4.
- `src/engine/settings.ts` is in-memory only: FOV 70 degrees and view bobbing enabled. M18b owns settings UI and persistence.
- Sprint raises FOV by 10%, eased across about 0.25 seconds and interpolated between ticks. Small ground-distance vertical/roll bob is off in water, climbing and flight.
- F5 cycles first person, third-person back, third-person front through a rebindable input action and existing debug `input()`; no new debug method.
- Third-person eye-to-camera distance is four blocks, ray-tested against solid block shapes, stopping 0.2 before a hit.
- Only third person draws the original procedural player skin on head, torso, two arms and two legs, with distance-driven limb swing.
- Only the camera being inside water enables the blue final frame tint and 2–24 block water fog. Fog blue and the minimum underwater brightness floor follow M12 sky brightness. Change water light opacity from 2 to 1; retain all existing M05 tests. Noon sky colors and above-water M12 fog stay unchanged.

## Implementation choices

- `perspective` is the action name for F5. Cycling occurs once per rising input edge, including debug input, so key repeats cannot cycle repeatedly. External legacy camera writes retain M06a detachment and return perspective to first person.
- Surface equilibrium puts feet 0.5 below the waterline with a fixed-tick ±0.04-block buoyancy bob. The water upward speed is limited at that equilibrium. A blocked horizontal sweep near the surface may start a 12 b/s exit impulse only when a free upward sweep and raised destination fit over a bank no more than one block above water. Twelve subsequent ticks use the original gravity before water control resumes.
- Climber facing names describe the face's outward normal: north -Z, south +Z, east +X, west -X; the supporting wall is opposite that normal. Directional climb input points toward the wall. Registry-facing tables are cached when the collision engine is created.
- The two-word mesh preserves all previous vertex fields and the half-Y bit. Word1 bit31 marks a wall face, moved 1/32 along its outward normal from its integer supporting plane. The shared decoder and GLSL apply the same inset. Two windings become two quads in the existing cutout/model draw, keeping wall sprites visible from either side.
- Camera collision intersects the short ray exactly with cached solid AABBs, including half slabs. FOV progresses by 0.2 of the sprint offset per tick and interpolates per frame. Ground walk phase and amplitude are also tick state.
- The underwater light floor is 0.28 times squared sky brightness, with a minimum 0.028 while submerged, applied before AO/face shading. It affects rendering only while submerged and does not modify world light samples. A final fullscreen blend uses water-blue with alpha 0.16. No post framebuffer or per-frame GL resources are needed.
- The player skin is a copper coat with a sea-green shoulder sash, dark slate trousers/boots and swept dark hair. Tiles declare original limited palettes and use shaded clusters. Six articulated boxes draw between cutout and translucent terrain, with static GPU geometry and atlas textures.
- Existing `getRenderStats()` gains measured camera position/FOV/roll, perspective, underwater fog/floor and player-part draw count. These are diagnostics of actual camera/render state, not new control APIs or fabricated counters. All browser movement uses paused debug `tick()` and `input()`.

## Publication

Before the first push, report status, changed-file list against origin/master, full verification summary and exact Vitest/Playwright totals, then wait for the owner's reply. Known container-only failures listed in the task prompt are recorded without master reruns or investigation; any other failures are fixed. The PR remains draft/incomplete until the required verification gate (or the owner's explicit green-CI exception) holds.
