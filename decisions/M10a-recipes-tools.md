# M10a — Recipes, tools & block-entity framework: owner decisions

## 1. Recipes, tags, and new items/blocks

- **Recipe count & categories**: Recipes live under `data/recipes/*.json` split by category (`wood.json`: 13, `slabs.json`: 9, `tools.json`: 30, `armor.json`: 8, `light.json`: 3, `terrain.json`: 14, `materials.json`: 8, `food.json`: 4, and `smelting.json`: 17), totaling **106 recipes** (89 crafting + 17 smelting) against SPEC's 120. The owner has accepted 106 recipes: stairs, fences, doors, and trapdoors need multi-box block shapes, and a later task will add them with their recipes. No duplicate or filler recipes are added.
- **Tags**: `data/tags/items.json` defines `any_planks`, `any_log`, `any_sand`, `any_mushroom`, `any_wood_slab`, and `any_leaves`. Every tag member is validated against the item registry at startup.
- **Registry additions for craftable items**:
  - Simple cube blocks: `rainwood_planks`, `acacia_planks`, `coarse_dirt`, `mud`, and `lumite_block` (with wrap-seamless procedural textures and declared palettes in `src/render/textures/`, plus `lumite_block` light color `[0.45, 0.85, 1]` in `src/render/light-curve.ts`).
  - Slabs: `oak_slab`, `birch_slab`, `pine_slab`, `rainwood_slab`, `acacia_slab`, `cobblestone_slab`, and `mossy_cobblestone_slab` (reusing their base block textures and `half` bottom/top state properties, allocated state IDs `118..136` in `data/block-state-ids.json`).
  - Non-block items: `gold_ingot` and `arrow` appended to `data/items/materials.json` (their procedural sprites were already registered in `src/render/textures/inventory-items.ts`).

## 2. Crafting matcher (`src/gameplay/crafting.ts`)

- Built once at startup and exported as a singleton `crafting` (`CraftingRegistry`).
- **Shaped recipes**: Trimmed to their minimal bounding box (up to 3×3) and indexed under both the trimmed pattern and its horizontal mirror.
- **Shapeless recipes**: Indexed by sorted ingredient combinations and ingredient count for tag matching.
- **Ambiguity handling**: Ambiguity is not checked at startup; instead, if multiple recipes match the given grid at runtime, `match()` throws an error detailing the colliding recipe IDs. Zero recipe ambiguity across registered recipes is asserted by the unit test suite (`tests/unit/m10a-recipes.test.ts`).
- **Pure API**:
  - `match(grid)`: Accepts a 2×2 or 3×3 grid of item IDs (`string | null | undefined`, or `{ id, count }` slots) and returns the matched `CraftingRecipe` or `null`.
  - `maxCrafts(grid)`: Accepts a 2×2 or 3×3 grid of `{ id, count }` slots (or item ID strings, treated as count 1) and returns the maximum number of crafts possible from the current stack counts.

## 3. Smelting data (`data/recipes/smelting.json` & `src/gameplay/smelting.ts`)

- `data/recipes/smelting.json` defines 17 data-only smelting recipes (`input`, `output`, `count`, `xp`):
  - `copper_ingot`: `raw_copper` → `copper_ingot` (count 1, xp 0.7)
  - `iron_ingot`: `raw_iron` → `iron_ingot` (count 1, xp 0.7)
  - `gold_ingot`: `raw_gold` → `gold_ingot` (count 1, xp 1.0)
  - `stone`: `cobblestone` → `stone` (count 1, xp 0.1)
  - `glass_from_sand`: `sand` → `glass` (count 1, xp 0.1)
  - `glass_from_red_sand`: `red_sand` → `glass` (count 1, xp 0.1)
  - `clayrock_terracotta`: `clay` → `clayrock_terracotta` (count 1, xp 0.35)
  - `coal_from_oak_log`: `oak_log` → `coal` (count 1, xp 0.15)
  - `coal_from_birch_log`: `birch_log` → `coal` (count 1, xp 0.15)
  - `coal_from_pine_log`: `pine_log` → `coal` (count 1, xp 0.15)
  - `coal_from_rainwood_log`: `rainwood_log` → `coal` (count 1, xp 0.15)
  - `coal_from_acacia_log`: `acacia_log` → `coal` (count 1, xp 0.15)
  - `roast_tuftbuck_shank`: `raw_tuftbuck_shank` → `roast_tuftbuck_shank` (count 1, xp 0.35)
  - `roast_boar_chop`: `raw_boar_chop` → `roast_boar_chop` (count 1, xp 0.35)
  - `roast_fowl`: `raw_fowl` → `roast_fowl` (count 1, xp 0.35)
  - `baked_tuber`: `tuber` → `baked_tuber` (count 1, xp 0.35)
  - `dirt_from_mud`: `mud` → `dirt` (count 1, xp 0.1)
- `src/gameplay/smelting.ts` validates all inputs/outputs against `itemRegistry` and exposes `getByInput(itemId)` and `isFuel(itemId)`. Kiln block-entity logic and UI belong to M10c.

## 4. Loot rolls, break counter & survival reachability graph

- `src/gameplay/loot.ts` extends `LootEntry` with optional `chance` (`0..1`, default `1`) and optional `min`/`max` counts (default `count`), validated on load via `validateLootEntry`.
- Supports explicit table format `RawLootDefinition = LootEntry[] | { exclusive?: boolean; entries: LootEntry[] }`. When `exclusive: true` is set (e.g. for `gravel`), a single roll selects at most one entry based on cumulative chances.
- `rollBlockLoot(block, worldSeed, x, y, z, breakCount)` derives PRNG seed via `deriveSeed(worldSeed, `loot:${x},${y},${z}:${breakCount}`)`, where `world.breakCount` increments on every block break in survival (`PlayerController`), so breaking a block at the same location multiple times yields varied, reproducible drops.
- Loot table values (per SPEC Appendix A.4/A.5):
  - `data/loot/ores.json`: `coal_ore` → `coal` (1), `copper_ore` → `raw_copper` (`min: 2, max: 5`), `iron_ore` → `raw_iron` (1), `gold_ore` → `raw_gold` (1), `lumite_ore` → `lumite_shard` (`min: 2, max: 4`), `skyshard_ore` → `skyshard_crystal` (1).
  - All 5 leaf types (`oak_leaves`, `birch_leaves`, `pine_leaves`, `rainwood_leaves`, `acacia_leaves`) drop themselves when broken by hand (shears/hoe gating is M10c). In addition:
    - `oak_leaves`: self-drop (`count: 1`) + `apple` (`count: 1, chance: 0.005`).
    - `rainwood_leaves`: self-drop (`count: 1`) + `vine` (`count: 1, chance: 0.05`).
  - `data/loot/terrain.json`: `gravel` has `"exclusive": true`, dropping `flint` (`count: 1, chance: 0.1`) instead of `gravel` (`count: 1, chance: 0.9`) — one or the other, never both.
  - `data/loot/vegetation.json`: `tall_grass` keeps self-drop (`count: 1`) + `seed` (`count: 1, chance: 0.125`); `wheat` does not drop from grass.
- Reachability treats `chance > 0` as obtainable and iterates drops, loot, crafting, and smelting to a fixed point from overworld worldgen blocks. Unreachable items are listed in `REACHABILITY_EXEMPTIONS` in `tests/unit/m10a-reachability.test.ts` with their owning task ID and reason.

## 5. Tool tiers and armor defense (`src/gameplay/tools.ts`)

- **Tool tiers** (`TOOL_TIERS`):
  - `wood`: harvestLevel 0, miningSpeed 2, durability 59, swordDamage 4, craftedFrom `#any_planks`
  - `stone`: harvestLevel 1, miningSpeed 4, durability 131, swordDamage 5, craftedFrom `cobblestone`
  - `copper`: harvestLevel 2, miningSpeed 5, durability 190, swordDamage 5, craftedFrom `copper_ingot`
  - `iron`: harvestLevel 3, miningSpeed 6, durability 250, swordDamage 6, craftedFrom `iron_ingot`
  - `skyshard`: harvestLevel 4, miningSpeed 9, durability 2000, swordDamage 8, craftedFrom `skyshard_crystal`
- **Attack damage**: Sword = tier `swordDamage`; Axe = Sword − 1; Pickaxe = Sword − 2; Shovel = Sword − 3; Hoe = 1 across all tiers; unarmed/non-weapon = 1.
- **Special tool durabilities**: `iron_shears`: 250, `bow`: 384, `shield`: 336, `ember_flint`: 64.
- **Armor defense points** (`ARMOR_DEFENSE`, exposed via `getArmorDefense(itemId)` and `getTotalArmorDefense(equippedIds)` while keeping `data/items/armor.json` free of `defense`/`durability` fields to preserve M09a's data-only armor contract):
  - Copper (total 10): `copper_helmet`: 2, `copper_chestplate`: 4, `copper_leggings`: 3, `copper_boots`: 1
  - Iron (total 15): `iron_helmet`: 2, `iron_chestplate`: 6, `iron_leggings`: 5, `iron_boots`: 2

## 6. Block-entity framework (`src/world/block-entities.ts` & `src/world/world.ts`)

- `BlockEntityRegistry` maps block IDs to `{ blockId, tickInterval?, create(x, y, z), tick?(entity, world) }` definitions where state is plain JSON (`BlockEntityState`).
- `BlockEntityManager` manages block-entity lifecycles per block coordinate `(x, y, z)` and chunk column `(cx, cz)`:
  - Automatically creates the block entity when a registered block is placed via `World.setBlockStateId` (and schedules its next tick when `tick` is defined).
  - Automatically removes the block entity when the block is broken/replaced with another block ID, or when its column unloads via `World.removeColumn`.
  - Ticks only in loaded chunks via `src/world/ticks.ts` (`BLOCK_ENTITY_TICK_TYPE = 'block_entity'`), stopping while paused and advancing deterministically with `World.tick()` / `PlayerController.tick(n)`.
- Verified with a test-only block-entity type in `tests/unit/m10a-tools-block-entities.test.ts`. No chest, kiln, workbench, or serialization code is added in M10a.
