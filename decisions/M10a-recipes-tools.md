# M10a — Recipes, tools & block-entity framework: owner decisions

## 1. Recipes, tags, and new items/blocks

- **Recipe categories**: Recipes live under `data/recipes/*.json` split by category (`wood.json`, `slabs.json`, `tools.json`, `armor.json`, `light.json`, `terrain.json`, `materials.json`, `food.json`, and `smelting.json`), totaling 106 recipes (89 crafting + 17 smelting). No duplicate or filler recipes are added.
- **Tags**: `data/tags/items.json` defines `any_planks`, `any_log`, `any_sand`, `any_mushroom`, `any_wood_slab`, and `any_leaves`. Every tag member is validated against the item registry at startup.
- **Registry additions for craftable items**:
  - Simple cube blocks: `rainwood_planks`, `acacia_planks`, `coarse_dirt`, `mud`, and `lumite_block` (with wrap-seamless procedural textures and declared palettes in `src/render/textures/`, plus `lumite_block` light color `[0.45, 0.85, 1]` in `src/render/light-curve.ts`).
  - Slabs: `oak_slab`, `birch_slab`, `pine_slab`, `rainwood_slab`, `acacia_slab`, `cobblestone_slab`, and `mossy_cobblestone_slab` (reusing their base block textures and `half` bottom/top state properties, allocated state IDs `118..136` in `data/block-state-ids.json`).
  - Non-block items: `gold_ingot` and `arrow` appended to `data/items/materials.json` (their procedural sprites were already registered in `src/render/textures/inventory-items.ts`).
  - Stairs, fences, doors, and trapdoors are not added in M10a because their custom geometry belongs to later tasks.

## 2. Crafting matcher (`src/gameplay/crafting.ts`)

- Built once at startup and exported as a singleton `crafting` (`CraftingRegistry`).
- **Shaped recipes**: Trimmed to their minimal bounding box (up to 3×3) and indexed under both the trimmed pattern and its horizontal mirror. Tag symbols expand into concrete candidate patterns and verify against any collision with another distinct recipe ID.
- **Shapeless recipes**: Indexed by sorted ingredient combinations (expanding tag ingredients across all member items) and verified against ambiguity with other shapeless recipes or 1×1 shaped recipes.
- **Pure API**:
  - `match(grid)`: Accepts a 2×2 or 3×3 grid of item IDs (`string | null | undefined`, or `{ itemId, count }` slots) and returns the matched `CraftingRecipe` or `null`.
  - `maxCrafts(grid)`: Accepts a 2×2 or 3×3 grid of `{ itemId, count }` slots (or item ID strings, treated as count 1) and returns the maximum number of crafts possible from the current stack counts.

## 3. Smelting data (`data/recipes/smelting.json` & `src/gameplay/smelting.ts`)

- `data/recipes/smelting.json` defines 17 data-only smelting recipes (`input`, `output`, `count`, `xp`) covering ore refining (`raw_copper`, `raw_iron`, `raw_gold`, and silk-touched ore blocks), food cooking (`raw_pork`, `raw_beef`, `raw_fowl`, `raw_fish`, `potato`), terrain/stone refining (`sand`, `red_sand`, `cobblestone`, `clay_lump`, `clay`), and `charcoal` from logs.
- `src/gameplay/smelting.ts` validates all inputs/outputs against `itemRegistry` and exposes `getByInput(itemId)` and `isFuel(itemId)`. Kiln block-entity logic and UI belong to M10c.

## 4. Survival reachability graph & loot updates

- Loot tables were updated so worldgen blocks yield their Appendix A resources:
  - `data/loot/ores.json`: `coal_ore` → `coal`, `copper_ore` → `raw_copper`, `iron_ore` → `raw_iron`, `gold_ore` → `raw_gold`, `lumite_ore` → `lumite_shard`, `skyshard_ore` → `skyshard_crystal`.
  - `data/loot/terrain.json`: `gravel` adds `flint` drop.
  - `data/loot/vegetation.json`: `tall_grass` adds `seed` and `wheat` drops.
  - `data/loot/wood.json` and `data/loot/wood-extra.json`: leaves drop saplings, sticks, and `apple` (from `oak_leaves`).
- Reachability starts from worldgen blocks (surface/subsurface biome rules, ores, vegetation, trees, and water/ocean blocks) and iterates drops, 2×2/3×3 crafting, and smelting to a fixed point.
- Items whose only acquisition source belongs to a later milestone are listed in an explicit, minimal `SURVIVAL_REACHABILITY_EXEMPTIONS` table in `tests/unit/m10a-reachability.test.ts` with their owning task ID and reason (M13 creature drops and M10c/crop-farming drops).

## 5. Tool tiers and armor defense (`src/gameplay/tools.ts`)

- **Tool tiers** (`TOOL_TIERS`):
  - `wood`: harvestLevel 1, miningSpeed 2, durability 59, swordDamage 4
  - `stone`: harvestLevel 2, miningSpeed 4, durability 131, swordDamage 5
  - `copper`: harvestLevel 2, miningSpeed 5, durability 190, swordDamage 5
  - `iron`: harvestLevel 3, miningSpeed 6, durability 250, swordDamage 6
  - `skyshard`: harvestLevel 4, miningSpeed 9, durability 2000, swordDamage 8
- **Attack damage**: Sword = tier `swordDamage`; Axe = Sword − 1; Pickaxe = Sword − 2; Shovel = Sword − 3; Hoe = 1 across all tiers; unarmed/non-weapon = 1.
- **Special tool durabilities**: `iron_shears`: 250, `bow`: 384, `shield`: 336, `ember_flint`: 64.
- **Armor defense points** (`ARMOR_DEFENSE`, exposed via `getArmorDefense(itemId)` and `getTotalArmorDefense(equippedItemIds)` while keeping `data/items/armor.json` free of `defense`/`durability` fields to preserve M09a's data-only armor contract):
  - Copper (total 10): `copper_helmet`: 2, `copper_chestplate`: 4, `copper_leggings`: 3, `copper_boots`: 1
  - Iron (total 15): `iron_helmet`: 2, `iron_chestplate`: 6, `iron_leggings`: 5, `iron_boots`: 2
- `src/gameplay/mining.ts` already reads `item.miningSpeed` from `itemRegistry` when a matching tool is held. Durability loss, tool breaking, and harvest-level drop gating belong to M10c.

## 6. Block-entity framework (`src/world/block-entities.ts` & `src/world/world.ts`)

- `BlockEntityRegistry` maps block IDs to `{ createInitialState(), tick?(state, ctx) }` definitions where state is plain JSON (`JsonObject`).
- `BlockEntityManager` manages block-entity lifecycles per block coordinate `(x, y, z)` and chunk column `(cx, cz)`:
  - Automatically creates the block entity when a registered block is placed via `World.setBlockStateId` (and schedules its next tick when `tick` is defined).
  - Automatically removes the block entity when the block is broken/replaced with another block ID, or when its column unloads via `World.removeColumn`.
  - Ticks only in loaded chunks via `src/world/ticks.ts` (`BLOCK_ENTITY_TICK_TYPE = 'block_entity'`), stopping while paused and advancing deterministically with `World.tick()` / debug `tick(n)`.
- Verified with a test-only block-entity type in `tests/unit/m10a-tools-block-entities.test.ts`. No chest, kiln, workbench, or serialization code is added in M10a.
