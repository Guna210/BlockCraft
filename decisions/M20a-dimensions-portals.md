# M20a — Dimensions & portals: decisions

These were set by the orchestrator in the owner's task prompt. The implementation notes say how
each one was carried out.

## 1. One World per dimension; only the active one runs

- `src/world/dimension.ts` exports `type DimensionId = 'overworld' | 'hollowdeep'`, the 1:4
  `scaleCoordinate()`, and `DIMENSIONS`: one `DimensionDefinition` per dimension. A definition
  gives the portal y range, the fallback platform block, the biome list and `createPipeline()`.
- `WorldManager.dimension` is the active dimension. Travel (`WorldManager.changeDimension`) does
  the following:
  1. Saves the session (`save('exit')`).
  2. Tears down the active World: streamer reset, worker queues cancelled, GPU meshes freed and
     listeners removed.
  3. Opens the other dimension's `WorldStore` with `SaveManager.loadDimension()` and builds a fresh
     `World` with its own columns, lighting and block entities.
  4. Points the session at it with `SaveManager.switchDimension()` and streams around the arrival
     point.
- The inactive dimension is not kept in memory. IndexedDB records are already keyed by
  `[world, dim, …]`, and the per-dimension entities record (`[world, dim]`) now also carries that
  dimension's portal index.
- The player record is per world, not per dimension, so the player's data (inventory, vitals and
  mode) is carried across unchanged.

## 2. Generation per dimension

- Generation requests carry `dimension` (`GenWorkerRequest.dimension`, `enqueueGenJob(…,
  dimension)`). The worker keeps one lazily built `TerrainPipeline` per dimension and structure
  setting.
- The flat-world shortcut applies only to the Overworld. Superflat and Single Biome shape only the
  Overworld: the Hollowdeep's `World` always has world type `default`.
- `DIMENSIONS.hollowdeep.createPipeline` is M20b's `createHollowdeepPipeline()` (wired after M20b
  merged). The main-thread fallback generator (`generateColumnMainThread`) uses the same per-dimension
  pipeline.
- Biomes: each definition lists its biomes (`biomeIds`): the Overworld list, or M20b's
  `HOLLOWDEEP_BIOME_IDS`.
  - The worker encodes a column's biome names with its dimension's list.
  - The receiver decodes with the active dimension's list.
  - Restored saved columns have their stored indices re-named with that list.
  - Hollowdeep columns therefore report `glowcap_forest`, `magma_sea`, `driftstone_expanse` or
    `voidglass_geodes`, never Overworld names.
  - The weather lookups treat unknown biomes as rain, and they are not run in the Hollowdeep.

## 2b. The Hollowdeep environment

`HOLLOWDEEP_ENVIRONMENT` applies while `WorldManager.dimension === 'hollowdeep'`. Every frame reads
it from the active dimension, so it reverts as soon as the player returns.

- **Fog:** the chunk shader has a `u_dimensionFog` colour that replaces the sky's fog colour.
  - The fog range comes from the exponential density: it ends at `min(render distance,
    2.3 / fogDensity)` and starts at 15 % of that.
  - The frame is cleared to the fog colour with `clearBufferfv`, so the clear colour state set by
    `main.ts` is untouched.
- **No sky light:** sky brightness is `skyLight` (0) for terrain, entities, drops and moving
  blocks.
- **No sky:** the sky, clouds and weather are neither drawn nor ticked.
- **Spores:** `SporeRenderer` (`src/render/spores.ts`) draws 96 points (particles per second ×
  lifetime) in one call. Each point's position, rise and fade come from its vertex id and the time
  in the shader, in a box that wraps around the camera, so there is no CPU work per spore. It
  follows the Particles setting.
- **Lava:** `FluidSimulation.lavaTickDelay` is set per World. It is `lavaFlowTickRate` (10) in the
  Hollowdeep and the default 30 elsewhere.
- **Music:** M16b's audio service already picks its music context from `player.dimension`, which
  travel sets. No change was needed.

## 3. Portal block, frames and the surface shader

- One new block, `portal`, with an `axis` state (`x` | `z`). New ids: `portal[axis=x]` = 833 and
  `portal[axis=z]` = 834, appended after M20b's `emberite` (832). (They were 825/826 before M20b
  merged; no save ever stored those.) No existing id changed.
- Block properties: model `none` (not meshed, no collision), light emission 11 with a violet tint,
  hardness 0, and no drops. Its texture (`genPortal`) exists for its item icon.
- Frame detection (`findPortalFrame`):
  - The frame is 4×5 outer with a 2×3 interior. The 10 non-corner frame cells must be
    `lumite_block`; corners are optional.
  - Both axes are tried, x first, from any of the six interior cells, and the interior must be air.
  - Using Ember Flint on a block lights the frame whose interior holds the cell in front of the
    clicked face. This costs one durability in survival.
- `PortalGuard` is a `WorldListener` (`blockEdited` and `blocksRemoved`). When a frame or portal
  cell of an indexed portal changes, including by explosion, the portal is dropped from the index
  and its remaining portal blocks are set to air.
- The surface: `PortalRenderer` (`src/render/portal.ts`) draws each loaded, in-frustum portal as
  one quad through the middle plane of its blocks. It runs after the terrain, with an animated,
  pixel-snapped cyan-violet swirl shader, alpha blended, without writing depth.
  - It binds nothing and draws nothing when no portal is in view.
  - The program is only created the first time a portal exists.

## 4. Travel, linking and safe arrival

- `PortalTravel.tick` runs from the player controller's tick (`onTick`). It checks the feet and
  head cells against the portal index first, and returns at once when the index is empty and no
  warp or cooldown is active.
- 80 ticks inside starts travel. `warp = ticks / 80` drives the `WarpOverlay` screen effect (a
  swirl closing in from the edges), and the warp decays when the player steps out.
- After arriving, the player must leave the portal (`needsExit`) and wait out a 40-tick cooldown
  before it counts again.
- Scaling: Overworld → Hollowdeep divides x/z by 4, and the reverse multiplies by 4.
- Link search (`findLinkedPortal`) uses the destination's `PortalIndex`, a per-column map saved in
  the dimension's entities record. It returns the nearest intact portal within 32 blocks
  horizontally, and never scans the world. Index entries whose column is loaded but whose portal is
  gone are dropped.
- New portals (`placeArrivalPortal`):
  - The search is bounded and seeded: the scaled point first, then 47 seeded offsets within 16
    blocks, nearest first, each tried at dy 0, +1, −1, … up to ±24 within the dimension's portal y
    range.
  - A spot is safe with solid full cubes under the frame and both sides of it, and air (no fluid)
    in the 4 rows above.
  - The search yields every 2 ms.
  - Otherwise, `buildPlatformPortal` builds a 6×5 platform with an air pocket.
    - It goes at the first open cell at or above the clamped point, out of rock and fluid.
    - Any water or lava touching the pocket is replaced with the platform block, so nothing flows
      in.
- The Hollowdeep's portal range fits the real cavern.
  - `portalMinY` is `MAGMA_LEVEL + 1` (41): lava fills every floor below 40, so a portal never
    stands in or on the magma sea.
  - `portalMaxY` is 150, so the 5-block frame stays under the lowest ceiling (172 − 14 = 158).
  - Platforms there are `duskrock`.
- If a dimension change fails at any point, `travelThroughPortal` calls `portalTravel.cancel()`, so
  the player is never left marked as travelling. This was a round-1 review finding.
- Travel waits until the arrival region has generated (the streamer's `requestRegion` and
  `waitForTerrain`). Terrain drawing is held off (`initialLoadCount`) while the dimension swaps.

## 5. Persistence

- `Player.dimension` is set on travel and saved in the player record.
- `SaveManager.load(name, dimensionOf)` reads the player record first, then opens that
  dimension's store and entities. A world saved in the Hollowdeep therefore reloads in the
  Hollowdeep.
- No fields were added to `World` or `Player`.

## 6. Performance

- With no portal indexed, no warp and no cooldown, `tickPortals()` returns after three
  comparisons, and `PortalRenderer.render` returns on an empty list. Both are zero cost.
- `PortalTravel.tick` and the index lookups allocate nothing per tick. Column keys are numeric.
- Nothing is defined on `World` or `Player` at runtime.

## 7. Debug API

`src/debug/api/dimension.ts`, registered with one line in `index.ts`, adds:

- `getDimension()`;
- `travelTo(dimension, x?, y?, z?)`, which defaults to the scaled current position;
- `waitForTravel()`;
- `getPortals()`;
- `getPortalTravel()`.

`getPlayer().dimension` reports the dimension.

## 8. Edits to other tasks' tests (approved by the owner)

The owner approved both edits through the orchestrator.

- `tests/unit/m19c-structures.test.ts`: the global `Math.max(...ids) === 824` assertion was
  removed, because any block appended after M19c breaks it. The exact checks for M19c's own ids
  (821–824) stay. After merging master, the file is master's version (M20b's edit), which also
  removed the unused `ids` local.
- `tests/unit/m10a-reachability.test.ts`: a `portal` exemption (task `M20a`). The portal is lit
  with Ember Flint, never crafted or mined, and drops nothing.
