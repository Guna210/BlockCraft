# M08a — Fluid simulation decisions

## State and compatibility

Water and lava each have enum `level` strings `0`–`7` and `falling` strings `false`/`true` in `data/blocks/fluids.json`. A source is level zero without falling; both defaults remain sources. The registry's previous alphabetical allocation would shift existing numeric palette IDs when adding Blackglass or fluid variants. `data/block-state-ids.json` records every pre-M08a ID and appends Blackglass and the new fluid states. Source IDs retain their old numbers with their new default properties. Keep this table append-only when adding states. Unknown additions still receive deterministic IDs after the recorded maximum, so category-driven loading continues to work. State hashing includes the explicit new properties as it does for any block state.

## Scheduled and random ticks

`src/world/ticks.ts` provides a binary min-heap ordered by due tick, ascending numeric priority, then insertion order. Repeated notifications for a pending position/type coalesce without postponing its update. Callbacks may schedule future work; delays are positive simulation ticks. Column unload removes its queued work. `World.tick()` dispatches fluid updates, and PlayerController invokes it only in its existing fixed 20 TPS callback, shared by debug pause/resume/tick. There is no timer or render-driven fluid advancement.

`BlockTicks.setRandomTicks` registers a section supplier, N samples, seed and callback. It runs automatically after scheduled work each simulation tick. `World.getTickSections()` enumerates currently allocated loaded sections. Sampling is with replacement, seeded by world seed, tick and section coordinates, so section iteration order does not affect that section's samples. No random consumer is registered by M08a; unused random ticking performs no section scan. Weather code is untouched; migrating M12c's small weather tick is a later follow-up.

## Event-driven flow

Generation and streaming write directly to columns/sections and schedule nothing. Settled generated ocean, aquifer and lava-lake sources remain dormant. The normal world set-block path notifies the changed fluid and its six fluid neighbors. Fluid writes use that same path, preserving light propagation, edit invalidation and future saving integration. No generated-fluid scan or stream-in notification is added. Unloaded columns are closed flow boundaries; fluid updates cannot recreate unloaded terrain.

Water updates every five ticks, lava every thirty. No world dimension exists yet; `HOLLOWDEEP_LAVA_TICK_DELAY = 10` is the explicit integration constant for M20. Both fluids spread seven horizontal levels; falling flow resets level to zero with falling true and feeds sideways after reaching support. Four-block bounded shortest-drop search selects all tied nearest directions, or all passable directions if no drop is in range. Water creates a source with two horizontal source neighbors over a full solid block or water source; lava never does. Unsupported dependent flow repeatedly raises its level and disappears; falling columns lose support from their top as the upstream flow recedes.

## Interactions and Blackglass

Contact resolves on the lava cell: flowing/falling lava becomes cobblestone, a lava source becomes Blackglass, including water arriving from above. All lava states retain emission 15. Blackglass uses Appendix A's listed hardness 50, blast resistance 1200, pickaxe/minimum tier 3 (iron), and drops one Blackglass when harvested. It has its own block, block-item and loot category files. Its opaque procedural tile uses five blue-gray shades, wrapped cooled-glass facets and short upper-left glints. Palette, contrast, determinism and tiling are covered by the art suite. Inventory icon UI belongs to M09b.

## Scope and verification

No sloped fluid meshes, shaders, glass/ice features, weather changes or debug helper are added. The waterfall E2E uses existing debug world edits and paused tick advancement. M08a owns no Visual Review. Tests live in `tests/unit/m08a-fluids.test.ts`, `tests/unit/m08a-ticks.test.ts` and `tests/e2e/m08a.spec.ts`. Existing tests and verification harness remain unchanged. Full verification runs in the background to a log; the publish gate precedes the first push. GitHub PR Verify is the owner's final evidence, and no CI result is implied before publication.
