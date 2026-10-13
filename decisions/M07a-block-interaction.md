# M07a — Raycast, breaking and placing

## Owner decisions

The builder prompt supplies these decisions:

1. Voxel DDA lives in `src/world/raycast.ts`, starts at the player's eye and follows the player's look. Survival reach is 4.5 blocks, creative reach 5. It returns block coordinates, face and distance. Fluids are excluded. Slabs, torches, plants and ladder/vine plates use real shape boxes. Debug raycast lives in its own API module, with one registration import.
2. Compare DDA against fine-step marching plus independent exact box intersection over 10,000 seeded random rays, including non-cubes.
3. Draw a thin dark depth-offset hitbox outline after terrain; hide it when there is no target.
4. Accumulate mining progress on the fixed 20 TPS tick using Appendix A.1, including independent fivefold water and airborne penalties. M07a uses bare hand; retain a tool parameter for M07b. Releasing attack or changing the target resets progress. Completion edits the world to air through its existing edit path. Creative breaks instantly. No drops in M07a.
5. Generate ten original procedural crack stages following ART.md and draw the current stage on the target's hitbox faces.
6. Place the selected hotbar block when a slot exists; while no inventory exists, use a player held-block state. Creative pick and a documented setBlock-style debug helper set it. Reject player AABB intersections and non-replaceable destination blocks. Plants and air are replaceable.
7. Logs use the clicked normal's axis. Top-face torch placement uses the existing floor torch. Side-face placement produces one of four tilted wall-torch states with the floor texture and emission. Reject bottom faces. Stairs do not exist; their introducing task owns their orientation rules.
8. Middle-click creative pick stores the targeted block's default state.
9. Use the existing world edit/light path; test fresh mesh upload within two rendered frames and sky 15 below an exposed hole.
10. Preserve M04 budgets, worker capacities and terrain draw cadence. Raycast once per tick, with reusable hot-path storage.

## Implementation choices

- `BlockShapes` caches registry state hitboxes. Physics and targeting share bottom/top slab constants. M06's non-solid plants, torches and climbers remain non-solid; hitboxes describe selection and placement intersections. Wall plates are 1/16 thick at their supporting edge. Torch boxes encompass their visible sprite; plants use a narrower central box.
- Ray-box intersection uses exact slab intervals. If an eye begins inside a shape, the result is its outgoing face. At a shared-face tie, the containing shape wins over the next voxel. The independently marched reference resolves ties by the earlier entry interval and retains exact block, face and distance assertions.
- Terrain JSON originally lacked stone/cobblestone tool and harvest-tier metadata. M07a adds pickaxe/tier 0 and terrain shovel metadata so Appendix A.1 produces 7.5 seconds for bare-hand stone. Logs/planks gain axe metadata where missing. Foundation Stone uses the existing finite JSON sentinel hardness; its block identity is explicitly unbreakable, including creative.
- `BlockInteraction` is owned by `PlayerController`, ticks after physics, and uses the same keyboard/mouse/debug action stream. Use and pick trigger on rising edges. Attack progress resets immediately on release, teleport or detachment. `heldBlock` is a numeric state ID on Player; M07b's inventory can supply the selected slot once that system exists. Pick stores the targeted block's own default state, including wall torches.
- Wall torch is a separate category JSON entry, four facings using M06b's outward normal convention. Two crossed sprites reuse the floor torch tile. Reserved packed normals 6/7 identify the two sprites, and tint bits carry their facing; CPU decoder and GLSL reconstruct the same tilt. Cube/slab/wall encodings remain unchanged. Wall torches receive exactly the floor torch's warm RGB emission.
- The wall-torch decoder compiles only into a separate shader variant selected from measured mesh content; ordinary terrain retains the existing vertex shader operations. Every section still submits its draws. Shared-quad worker normalization derives the actual oriented draw-quad count from emitted index pairs, preserving both sprite planes and both windings. The added M07a regression compares every oriented triangle before/after normalization; existing shared-quad tests remain unchanged.
- Crack textures use a four-color declared palette, nested wrap-aware branching strokes, a static ten-layer GPU texture and nearest filtering. Outline and overlays share static geometry; depth offset and a small geometric expansion avoid z-fighting. No GPU allocation happens per frame.
- Interaction edits call `World.setBlockStateId`, preserving incremental light and bulk invalidation. A foreground section job uses the mesher's existing reserved-worker path immediately after that edit, including boundary-neighbour sections. Uploads share the existing 3 ms budget with streamer uploads. Per-section serials and world epochs discard superseded jobs. Background column relight/re-mesh still supplies eventual wider propagation. Draws are never gated.
- `getInteraction()` reports progress, stage, held ID and measured edit/upload terrain-frame counters. Counters update at the actual GPU upload, and browser evidence also compares before/after pixels. These diagnostics do not wait for workers or manufacture frame results.

## Debug surface and dependent tasks

`raycast()` follows SPEC §4 and additionally returns `distance` on a block hit. `setHeldBlock(id, state?)` uses the same registry state syntax as `setBlock`, rejecting invalid states; it supplies a block without introducing an item system. `getInteraction()` returns progress in [0,1], crack stage -1 when idle or 0–9 while breaking, held block ID/null, edit frame, fresh mesh frame (-1 until uploaded) and mesh revision.

M07b extends `BlockInteraction.tool` and resolves held state from its selected inventory slot; the pure `breakSeconds` accepts type/tier/speed. M07b owns drops and particles. The task introducing stairs adds its facing/half placement rule. No pathfinding or `src/entity/ai/` changes are made.

## Publication

Before first push, report git status, changed files against origin/master, full verify summary, and exact Vitest/Playwright totals; wait for the owner. No push, PR or CI result is implied by local tests. The supplied container-only exceptions may be recorded for a draft PR without master reruns or investigation. Green draft CI permits the owner-authorized promotion only under the conditions in the task prompt.
