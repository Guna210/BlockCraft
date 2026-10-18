# M10b — Crafting screens & chests

## Blocks, states, items, and recipes

- Add `workbench` and `chest` as data-driven block definitions, with hardness 2.5 and procedural textures following `ART.md`. The block and item registries load these entries from their category files; the existing icon builder generates an isometric icon for each block item from its registered textures.
- Add block items and self-drop loot entries for both blocks.
- The workbench recipe is four `#any_planks` in a 2×2 square. The chest recipe is eight `#any_planks` around the perimeter of a 3×3 grid.
- Append state IDs only: workbench 145; chest north 146–148, south 149–151, east 152–154, west 155–157, each in `single`, `left`, `right` order. Preserve every earlier mapping. If `origin/master` adds IDs before publishing, merge it and renumber these entries after the new master maximum.
- Update M08c's state-ID assertion to verify its original 137–144 assignment instead of requiring those historical IDs to remain the newest eight after later tasks append states.

## Chest storage and pairing

- Each chest block entity uses M10a's registry and contains exactly 27 slots in a plain JSON `slots` array. Each occupied slot is `{ "id": string, "count": number }`; empty slots are `null`.
- A double chest remains two independent block entities so M17a can serialize each state unchanged. The UI presents the left half's 27 slots followed by the right half's 27 slots as one 54-slot view.
- Pair only adjacent chests with the same facing along that facing's left/right axis. A pair is stored as complementary `left` and `right` block states. A third matching chest does not extend a pair.
- Spill each occupied slot as an item entity before removing a chest. If the bounded item-entity pool cannot accept every stack, cancel the break and leave the chest and its contents intact.

## Crafting UI

- The inventory screen owns a 2×2 grid. A workbench opens a 3×3 grid. Both use M10a's recipe matcher and maximum-craft calculation; normal output takes one craft to the cursor, while shift-click inserts the maximum craftable output into inventory.
- Closing either crafting screen returns remaining grid stacks to inventory and drops overflow through M07b item entities.
- Recipe-book search compares the displayed result name. The craftable filter checks inventory storage slots and current grid contents. Selecting a recipe fills the maximum number of complete recipes that fit, without mutation if all ingredients cannot be supplied losslessly.
- Keep debug control on the existing SPEC §4 methods `openScreen`, `getScreen`, and `uiClickSlot`; add no M10b debug API method.

## UI slot mapping

- Inventory screen: inventory 0–40, 2×2 grid 41–44, output 45, recipe rows from 46.
- Workbench screen: 3×3 grid 0–8, output 9, inventory 10–50, recipe rows from 51.
- Chest screen: chest storage 0–26 or 0–53, then inventory slots starting immediately after the chest storage slots.

## Review evidence

- `tests/e2e/m10b.spec.ts` covers the UI-click crafting chain, actual workbench and paired-chest interactions, and saves the requested screenshots under `docs/screenshots/M10b/`.
