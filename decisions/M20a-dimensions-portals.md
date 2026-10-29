# M20a — Dimensions & portals: decisions

These were set by the orchestrator in the owner's task prompt. The implementation notes say how
each one was carried out.

## 1. One World per dimension; only the active one runs

- `src/world/dimension.ts` exports `type DimensionId = 'overworld' | 'hollowdeep'`, the 1:4
  `scaleCoordinate()`, and `DIMENSIONS`: one `DimensionDefinition` per dimension. A definition
  gives the portal y range, the fallback platform block and `createPipeline()`.
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
- The flat-world shortcut applies only to the Overworld.
- **M20b is not on master**, so `DIMENSIONS.hollowdeep.createPipeline` returns an empty
  `TerrainPipeline` and the Hollowdeep is all air. Arrival portals there stand on their own safe
  platform.
- M20b wires itself in by replacing that one `createPipeline` with
  `() => createHollowdeepPipeline()`, and by applying `HOLLOWDEEP_ENVIRONMENT` where
  `WorldManager.dimension === 'hollowdeep'`.

## 3. Portal block, frames and the surface shader

- One new block, `portal`, with an `axis` state (`x` | `z`). New ids: `portal[axis=x]` = 825 and
  `portal[axis=z]` = 826, appended after 824. No existing id changed.
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
