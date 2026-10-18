# M10c — Kiln & tool wear: owner decisions

## 1. Kiln block definition, textures, items, recipes, and drop behavior

- **Block definition (`data/blocks/kiln.json`)**:
  - Hardness: `3.5`, blast resistance: `3.5`, required tool: `pickaxe`, `minTier: 0`.
  - Block states: `facing` (`north`, `south`, `east`, `west`) and `lit` (`false`, `true`).
  - Light emission: emits light level `13` when `lit: true`, and `0` when `lit: false`.
- **Texture generators (`src/render/textures/kiln.ts`)**:
  - Procedural generators complying with ART.md luminance, contrast, and noise rules: `genKilnFront`, `genKilnFrontLit`, `genKilnTop`, `genKilnSide`, and `genKilnBottom`.
  - Features a masonry stone surround with an arched firebox opening; when lit, the firebox illuminates with a glowing yellow-orange coal bed and flame interior.
- **Item & Icon**:
  - Registered item in `data/items/kiln.json` under `building` category.
  - Icon generated from front and top kiln textures.
- **Loot & Recipe**:
  - Loot definition in `data/loot/kiln.json`: drops itself (`kiln`, count 1) when mined with a pickaxe.
  - Crafting recipe in `data/recipes/kiln.json`: 8 `cobblestone` in a hollow ring (3x3 grid).
- **Spilling on break**:
  - When broken in survival mode (`PlayerController.onBreak`), the kiln's block entity is inspected; all non-empty item stacks from `input`, `fuel`, and `output` slots are spawned as dropped item entities in the world.

## 2. Block state ID allocation (`data/block-state-ids.json`)

- State IDs `145..152` were appended strictly to the END of `data/block-state-ids.json` without reordering or shifting any existing IDs:
  - `145`: `kiln[facing=east,lit=false]`
  - `146`: `kiln[facing=east,lit=true]`
  - `147`: `kiln[facing=north,lit=false]`
  - `148`: `kiln[facing=north,lit=true]`
  - `149`: `kiln[facing=south,lit=false]`
  - `150`: `kiln[facing=south,lit=true]`
  - `151`: `kiln[facing=west,lit=false]`
  - `152`: `kiln[facing=west,lit=true]`

## 3. Kiln block entity & simulation (`src/gameplay/kiln.ts`)

- Registered through M10a's `blockEntityRegistry` (`blockEntities.register`) as plain JSON for M17a serializer compatibility.
- **State schema**:
  - `input`: `ItemStack | null`
  - `fuel`: `ItemStack | null`
  - `output`: `ItemStack | null`
  - `burnRemaining`: number (ticks remaining for current fuel item)
  - `burnTotal`: number (total burn duration of current fuel item)
  - `cookProgress`: number (0..200 ticks for current item)
  - `storedXp`: number (accumulated experience points from completed smelts)
- **Smelting timings & fuel**:
  - Smelt duration: exactly 200 ticks (10.0 seconds at 20 ticks per second) per item.
  - Fuel burn times sourced from M10a's smelting registry (`getBurnTime(itemId)`):
    - `coal`: 1600 ticks (8 items)
    - Logs (`oak_log`, `birch_log`, `pine_log`, `rainwood_log`, `acacia_log`): 300 ticks (1.5 items)
    - Planks (`oak_planks`, `birch_planks`, `pine_planks`, `rainwood_planks`, `acacia_planks`): 300 ticks (1.5 items)
    - Wooden tools: 200 ticks (1 item)
    - Sticks: 100 ticks (0.5 item)
    - Saplings: 100 ticks (0.5 item)
- **Lit state synchronization**:
  - When `burnRemaining > 0`, the block's world state transitions to `lit: true` (emitting light level 13).
  - When fuel expires and no new fuel can be consumed, the block transitions back to `lit: false`.
- **Chunk persistence**:
  - Registered with `tickInterval: 1` so loaded chunks continue ticking the kiln even when the player walks away.

## 4. Experience points (XP) curve & collection (`src/gameplay/xp.ts`)

- **Points-to-level curve (`pointsForLevel(level)`)**:
  - An original, piecewise linear progression:
    - Level 0..14: `10 + 2 * level` points per level
    - Level 15..29: `40 + 5 * (level - 15)` points per level
    - Level 30+: `115 + 10 * (level - 30)` points per level
- **Awarding XP (`addXp(player, points)`)**:
  - Adds points to the player, updating `player.xpLevel` and fractional progress `player.xpProgress`.
  - When taking output from the kiln UI or via shift-click, stored XP is awarded to the player and reset on the kiln entity.
  - Persistence of XP belongs to M17b; `src/persist/` is not modified for XP.

## 5. Kiln screen UI (`src/ui/kiln-screen.ts` & `src/ui/kiln-layout.ts`)

- Standard 39-slot layout:
  - Slot 0: Input slot
  - Slot 1: Fuel slot
  - Slot 2: Output slot
  - Slots 3..11: Player hotbar (slots 0..8)
  - Slots 12..38: Player main inventory (slots 9..35)
- **Animated Flame**:
  - Positioned between input and fuel slots.
  - Rendered with a vertical clipping mask from bottom to top proportional to `burnRemaining / burnTotal`.
- **Animated Arrow**:
  - Progress arrow between input and output slots.
  - Rendered with a horizontal clipping mask from left to right proportional to `cookProgress / 200`.
- **Shift-click routing**:
  - Smeltable items in player inventory route into Slot 0 (Input).
  - Valid fuel items route into Slot 1 (Fuel).
  - Clicking Slot 2 (Output) transfers items to player inventory and disburses stored XP.

## 6. Tool wear and durability model

- Every block broken in survival mode deducts 1 durability point (`damage` increases by 1).
- Creative mode does not deplete durability.
- Max durability determined by `getToolDurability(itemId)` from M10a (e.g. `wooden_pickaxe` = 59).
- A wooden pickaxe breaks on exactly the 59th use, disappearing from the player's inventory and triggering break particles.
- `damage` field stored on `ItemStack` (`damage?: number | null`).
- Extended M17a inventory serializer (`src/persist/serializers.ts`) with round-trip validation so item damage survives save/load.
- Durability bar rendered on damaged tools in UI slots (`drawDurabilityBar` in `src/ui/ui-kit.ts`), colored green (full) → yellow → red (critical).

## 7. Harvest-level gating on block loot

- When a block is broken in survival mode, `canHarvest(blockDefinition, heldTool)` is evaluated.
- If the held tool tier is below the block's `minTier`, `rollBlockLoot` is bypassed and no loot drops.
- Example: `iron_ore` has `minTier: 1` (`stone` tier or better). Breaking `iron_ore` with a wooden pickaxe drops nothing; breaking with a stone pickaxe drops `raw_iron`.

## 8. Automated verification

- Unit tests in `tests/unit/m10c-kiln-tools.test.ts` (14 tests) verify:
  - Fuel burn times and smelting recipes.
  - XP progression curve and level advances.
  - Inventory item damage serialization and round-trip persistence.
  - Kiln block entity tick simulation (smelting 8 iron ore with 1 coal in 1600 ticks, storing XP, and toggling lit state).
  - Light emission (13 when lit, 0 when unlit).
  - Data-driven generic front / front_lit face texture resolution across all facings.
  - Flame indicator 3-layer pixel art frames and boundary edge detection.
- E2E tests in `tests/e2e/m10c.spec.ts` (4 tests) verify:
  - Kiln smelts 8 iron ore with 1 coal in 80 s of `tick()`.
  - Wooden pickaxe breaks after exactly 59 uses.
  - Iron ore drops with stone pickaxe and drops nothing with wooden pickaxe.
  - Visual review screen capture (`m10-kiln.png` and `m10-kiln-flame.png`).
- Maintained passing status of `tests/unit/m10a-reachability.test.ts` and `tests/unit/m08c-glass-foliage.test.ts`.

## 9. Review feedback architectural decoupling & data-driven features

- **State ID Restoration (`data/block-state-ids.json`)**:
  - Restored `blue_stained_glass` through `yellow_stained_glass` to their canonical master IDs `137..144`.
  - Appended kiln states strictly to the end as `145..152` (`kiln[facing=east,lit=false]` through `kiln[facing=west,lit=true]`).
  - Updated `tests/unit/m08c-glass-foliage.test.ts` to assert that stained glass blocks occupy IDs `137..144`.
- **Core Decoupling (`src/world/block-entities.ts`)**:
  - Removed kiln import and registration from `src/world/block-entities.ts` to preserve clean layering where the core world does not import gameplay mechanisms.
  - Kiln block entity registers at application runtime startup in `src/main.ts` via `registerKilnBlockEntity()`.
  - Simulation unit tests call `registerKilnBlockEntity()` in `beforeEach()`.
- **Generic Data-Driven Block Features**:
  - **Facing & Lit Textures (`src/world/blocks/registry.ts`)**: Replaced `blockId === 'kiln'` special case with a generic rule: any block defining `front` (and optionally `front_lit`) resolves that texture on the face matching its `facing` state.
  - **Icon Generation (`src/ui/icons.ts`)**: Replaced hardcoded kiln check with the generic rule checking `front` / `front_lit` for the icon's south face.
  - **State-Dependent Lighting (`src/world/lighting.ts` & `data/blocks/kiln.json`)**: Supported `lightEmissionWhen` in block definitions matching property conditions (e.g. `{"lit": "true", "value": 13}`), removing all hardcoded lighting engine branches for kiln.
  - Verification: Zero occurrences of `'kiln'` in `src/world/block-entities.ts`, `src/world/blocks/registry.ts`, `src/ui/icons.ts`, and `src/world/lighting.ts`.
- **Flame Indicator Redesign & Animation (`src/ui/kiln-screen.ts`)**:
  - Redrawn 14×14 flame as a teardrop silhouette (rounded bottom, rising point at top, 2–3 flickering wisps along edges across 3 animation frames).
  - 3 nested color layers: outer RED (`#b32b1b`), middle ORANGE (`#d96d1a`), and inner YELLOW core (`#f2c12e`) in the lower-middle.
  - Depletion shrinks smoothly from top down as fuel is consumed.
  - Renders an empty dark flame outline (`UI.outline` edge, `UI.slot` interior) when unlit or depleted.
- **Visual Review Screenshots**:
  - `docs/screenshots/M10c/m10-kiln.png`: Mid-smelt kiln UI with new teardrop flame and damaged wooden pickaxe wear bar in hotbar.
  - `docs/screenshots/M10c/m10-kiln-flame.png`: Side-by-side zoomed comparison of the flame at full fuel vs ~half fuel.

## 10. Merge with master and builder change

- The builder changed from agy to Claude. Branch `claude/m10c` = `agy/m10c` + merge of `origin/master` (M10b workbench/chest/crafting #55, BLOCKS-shapes #54). It supersedes draft PR #56.
- **State IDs:** master's table is kept exactly (ends at 533). The 8 kiln states are appended at `534..541` (superseding `145..152` above). `tests/unit/m08c-glass-foliage.test.ts` is master's version.
- **Interaction:** the kiln-specific `onInteract`/`onBreak(blockEntity)` paths were dropped for M10b's generic hooks. Opening: `onUse` (wired in `main.ts`) → `UiManager.openKiln`. Spilling: `onBreakBeforeRemove` → `spillKilnContents`, with the same full-pool refusal as chests. Tool wear stays in `onBreak`; harvest-level gating still goes through `canHarvest`. Door/trapdoor toggling and `removeShapeBlock` from BLOCKS-shapes are unchanged.
- **Placement facing:** the kiln's facing from the player's yaw is applied before shape placement in `BlockInteraction.place`.
- **UI:** `ui-manager.ts` is master's, with the `'kiln'` screen added next to crafting/chest (own layout, slot mapping 3..38 → inventory 0..35, click handler from agy).
- **Flame:** now a ragged teardrop (red edge, orange body, small yellow teardrop core) with 3 frames moving the tip and 1–2 edge tongues.
- Fix-round items re-checked after the merge: kiln registered in `main.ts` not `world/block-entities.ts`; front/front_lit textures data-driven (no `'kiln'` in the registry or icons); per-state light via `lightEmissionWhen`; iron/copper/gold smelting recipes kept.
