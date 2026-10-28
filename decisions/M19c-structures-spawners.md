# M19c — Crypts, ruins, warrens & spawners: decisions

These were set by the orchestrator in the owner's task prompt. The implementation notes say how
each one was carried out.

## 1. Structures go through the M19a pipeline

- Sunken Crypts, Spire Ruins and Mineshaft Warrens are `StructureRegistration`s, registered the
  same way as M19b's Wayfarer Hamlet. They use placement data in `data/structures/placement.json`,
  jigsaw pieces, terrain adaptation and `terrainVariant()`.
- `src/gen/structures/registrations.ts` lists every registration
  (`STRUCTURE_REGISTRATIONS`). The generation worker, the main-thread fallback and the Create World
  Structures toggle all use that one list. With the toggle off, no structures are generated.
- All three designs are original:
  - Crypt: a mossy hall with a spawner and two chests, then corridors, tombs and collapses.
  - Spire: a crenellated tower with side walls and stumps, decayed by noise.
  - Warren: a timber hub, framed tunnels, crossings, stores and cave-ins, with rails and Silkmesh.
- **Buried Caches were skipped**, as the owner instructed. They are not done.
- Two new registration fields, both optional so hamlets are unaffected:
  - `buried: { cover, minY }` sinks the start to `cover` blocks below the lowest ground under the
    structure's pieces, sampled every 4 blocks with an 8-block margin. Buried pieces get no
    foundations.
  - `decay` removes blocks of a surface ruin with a 2×2×2 noise lattice. Removal is likelier
    higher up a piece. The bottom layer and chests always stay.
- `locate structure` returns the buried start's real y, from `structureStartY()`, for buried
  registrations.

## 2. Structure markers replace the M19b chest scan

- `buildStartCells` records a marker for every structure chest (with its registration's loot
  table) and every spawner (with a creature picked by position hash).
- The generation stage returns the markers for the column being generated:
  `StructureStage.takeMarkers` → `GenPipeline.takeStructureMarkers` → the worker message's
  `markers` field.
- `applyStructureMarkers` (src/gameplay/structure-markers.ts) runs after the chunk is installed. It
  fills empty chests through `rollChestLootById` and sets each spawner's creature.
- This replaces M19b's per-section chest scan in `world-manager.ts`. Each structure needs its own
  table and spawners need data, and markers make the per-section scan unnecessary.
- Hamlets now carry `lootTable: 'wayfarer_hamlet'`, so their chests roll the same table as before.

## 3. Spawner block entity (src/gameplay/spawners.ts)

- State is `{ creature, delay }` and persists with the block entity.
- The spawner is active only while the player is within `SPAWNER_ACTIVATION_RANGE` = 16 blocks of
  the block's centre.
- While active, the delay counts down in 10-tick steps. When it runs out:
  - The delay rerolls to 200–800 ticks.
  - Up to 4 spawn attempts are made, with at most 2 spawns per cycle.
  - Spawn spots are within 4 blocks horizontally and 1 block vertically of the spawner.
- A spawn spot is valid only if:
  - its column is loaded and lit;
  - the block below is solid;
  - there are two passable cells;
  - its block light is 0.
- The spawner does not spawn when 6 or more of its own creature are within 8 blocks, or when the
  global hostile cap (`MOB_CAPS.hostile`) is reached.
- Spawns go through `MobRuntime.spawn` → M13 `spawnEntity`.
- Spawners follow the world's mob-spawning switch: with Create World spawning off, they never spawn.
- Crypt spawners hold `hollow`, `skitterer` or `sporeburst`.

## 4. Spawner cost and miniature

- No per-frame work for spawners. A spawner's block-entity tick reschedules itself through
  `nextTickDelay`:
  - every 10 ticks within 40 blocks of the player;
  - every 100 ticks beyond that.
- Beyond 16 blocks, a tick only checks distance and updates the miniature list.
- The spinning miniature is drawn by the existing entity renderer at small scale (`computeRestPose`
  plus `miniatureFit`). There is one draw per spawner, only for spawners within 32 blocks.
- `MobRuntime` instances are found per world through a module-level `WeakMap`
  (`mobRuntimeForWorld`). No properties were added to `World`, `Player` or other shared objects.

## 5. New blocks

- `spawner`, `silkmesh` and `decorative_rail` (`axis` x|z). Each has an ART.md texture generator in
  `src/render/textures/structures.ts`, a registry entry, an item/icon and loot:
  - spawner drops nothing;
  - silkmesh drops silk;
  - decorative_rail drops itself.
- Silkmesh is a cross model. It is harvested with shears or a sword (`tool: "shears/sword"`, added
  to `canHarvest`).
- A player inside Silkmesh moves at 0.25× horizontal speed. Their fall speed is clamped to 1.2,
  their rise speed to 0.6, and they take no fall damage.
- State ids are appended after 819 only: spawner 820, silkmesh 821, decorative_rail[axis=x] 822 and
  decorative_rail[axis=z] 823.

## 6. Chest loot

- One table per structure in `data/loot/chests/`: `sunken_crypt`, `spire_ruin` and
  `mineshaft_warren`. They are rolled through `src/gameplay/chest-loot.ts`.
- Durable weapons and tools carry durability ranges and affix chances. Armour has no durability in
  this codebase, so armour entries carry neither.
