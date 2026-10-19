# M17b — IndexedDB & saving: decisions

These are the owner's decisions for M17b plus the choices made while building it.

## 1. Storage

- **Hand-written IndexedDB wrapper, no new dependencies** (`src/persist/idb.ts`). Database `blockcraft-saves`, version 1, five object stores:
  - `worlds`: metadata, key `name`.
  - `regions`: 32×32 column groups, key `[world, dim, rx, rz]`.
  - `players`: key `[world, player]` (the local player is `'local'`).
  - `entities`: ground items, key `[world, dim]`.
  - `blockEntities`: block entities of one region, key `[world, dim, rx, rz]`.
- Every key starts with the world name, so a world's records are one key range per store; `deleteWorld` is a range delete in one transaction. Keys carry the dimension, so storage is dimension-keyed (only `overworld` exists today).
- Writes are grouped into one `readwrite` transaction (`SaveDb.write`): a region and its block entities land together or not at all.
- The unit-test fake (`tests/unit/helpers/fake-idb.ts`) stands in for the browser because jsdom has no IndexedDB.

## 2. What is saved

- **Only modified columns.** `World.setBlockStateId` adds the column to `World.modifiedColumns`. Generation writes sections directly, so a generated, untouched column is never saved and regenerates from the seed. An unmodified region has **no record at all** (0 bytes; the e2e asserts < 1 KB).
- Block entities change silently (a kiln burning, a chest being used), so every loaded column that holds block entities is re-captured on each save and when it unloads.
- **Format version stays 1**, extended in place (no save has ever shipped). The migration hook (`migrations`) is applied to every record read from the database. A record from a newer game fails with a clear error.
- **M17a's serializers are used as they are**, with these extensions to `SerializedPlayerData`: `xpLevel`, `xpProgress` and `spawnPoint: [number, number, number] | null`. `Player.spawnPoint` (null = world spawn) was not on master, so M17b adds it. M11b, built in parallel, will reuse the same field.
- **Weather metadata** (`manualOverride`, `strikeCounter`, `lastTick`, `elapsed`) is required on write and on read; there are no `??` defaults.
- `world.breakCount` (the M10a loot seed) and all block-entity state (chests, kilns mid-smelt with `cookProgress`/`burnRemaining`/`burnTotal`, dispensers) are persisted.
- A column's record holds its blocks, its pending scheduled ticks with the clock they were saved at, the doors and trapdoors that the Current engine remembers as powered, and its block entities.
- Ground items are saved in the `entities` store, the player (position, vitals, XP, spawn point, inventory) in `players`.

## 3. Restoring

- `World.setColumn` is the restore hook. Light is not saved: the streamer's light stage computes it for every column it brings in, saved or generated.
- **Scheduled ticks are re-based.** `BlockTicks.addRebased(ticks, savedTime)` keeps each tick's remaining delay against the current clock (never below 1). `world.ticks.time` is restored from the world record. Ticks of an unloaded column are frozen while it is unloaded: they are saved with the column and resume with their remaining delay when it comes back.
- **M15a (Current).** The engine's tracked set is only filled through `setBlock`, so `CurrentEngine.restoreColumn` registers the components of a restored column, and `settleRestored()` settles once a column's 3×3 neighbourhood is loaded (never against half-loaded neighbours).
- **M15b (Mechanics).** Receivers are re-registered with `Mechanics.adopt`, which does not mark them dirty (so no reconcile runs against a half-loaded neighbourhood). The powered-door memory comes back through `restorePoweredOpenables`.
- Before a save and before a column unloads, `Mechanics.landAll()` lands any piston moves in flight, so a `piston_moving` cell is never written. `piston_land` ticks are not saved.
- A column that cannot be read falls back to regeneration, with a `console.warn`.
- Block entities come back through `BlockEntities.restore`, which does not call `create`/`afterPlaced` and gives the entity its tick unless a restored tick already covers it.

## 4. When it saves

- **Incremental autosave every 60 s** (`AUTOSAVE_INTERVAL_MS`), checked once per rendered frame. The run takes one slice per frame; a slice captures columns until it has used `SLICE_BUDGET_MS` (2 ms) of main-thread time, then waits for the next frame. Compression (`CompressionStream`) is async and off-thread, and regions are written one per slice (building a region's records and handing them to the database are separate slices).
- The other triggers (`pause`, `visibilitychange` hidden, `pagehide`, world exit, `save()`) run the same work with `setTimeout(0)` yields.
- A column that unloads between slices is captured by the unload hook, so walking away from an edit never loses it.
- Only **named worlds** (`createWorld({ name })`) are saved. `createWorld` with an existing name replaces that world's records. `exitWorld()` saves the previous world before another starts.
- `SaveManager.stats` reports `maxSliceMs`, `lastRunMaxSliceMs` and `lastRunSlowestStep` so the "no stretch over 16 ms" claim is measurable.
- A warm-up on attach runs each save step once on throwaway data so the first real save does not pay for cold code inside a frame.

## 5. Debug API (SPEC §4)

`save()`, `loadWorld(name)`, and for tests `autosaveNow()`, `getSaveStats()` (stats plus the real database's per-region usage) and `getBlockEntity(x, y, z)`.

`loadWorld` centres streaming on the saved player's chunk, spawns the player at the saved position, applies the player, inventory and ground-item records, and waits for terrain.

## 6. Touching code owned by other tasks

- `src/persist/compress.ts` (M17a): `deflate` and `inflate` awaited `writer.write(...)` before reading any output. That never finished in Chromium for real column data, because the stream waits for its output to be read, so the first `save()` hung. The functions now pipe a `ReadableStream` through the transform and read it at once. Unit tests still pass unchanged.
- `src/world/world.ts`, `block-entities.ts`, `ticks.ts`, `gameplay/mechanics`, `gameplay/current`, `engine/loop.ts` (`TickLoop.onPause`), `world/world-manager.ts`: only the hooks listed above.

## 7. Not in M17b

No world list UI (M17c): no thumbnails, rename, duplicate or delete screens.
