# M15b — Pistons & mechanical outputs decisions

## One power system

- Pistons, powered doors and trapdoors, the Dispenser and the Note Block are receivers inside M15a's `CurrentEngine`. They live in `src/gameplay/mechanics/` (class `Mechanics`, reached as `world.current.mechanics`) and have no power rules of their own.
- The engine registers receivers as `setBlock` changes arrive, like its other tracked components, and calls `Mechanics.reconcile()` after every `settle()`. A receiver reads `max(weakPowerAt, strongPowerAt)` at its own cell, so a lever stuck on a piston powers it and a full opaque neighbour conducts strong power to it, the same as for a Lamp.
- Because Pistons, Dispensers and Note Blocks are full opaque cubes, they conduct strong power like any other solid block. Two pistons side by side share a strongly powered neighbour. This follows from M15a's rules and is not special-cased.
- M15a behaviour and tests are unchanged. The engine only gained the receiver set, the `reconcile` call and delegation of scheduled ticks and `useBlock`.

## Block state IDs

- `data/block-state-ids.json` is append-only. M15b appends 104 states at 699–802: Dispenser, Note Block, Piston, Piston Head, Piston Moving, Sticky Piston, Sticky Piston Head. Nothing existing changed.
- Piston and Sticky Piston have `facing` (north, east, south, west, up, down) and `extended`. The two heads and Piston Moving carry `facing` only. Dispenser has `facing` and `triggered`. Note Block has `note` (0–24) and `powered`.

## Piston movement

- A Piston or Sticky Piston pushes up to 12 blocks. A line of 13 or more, or a line that ends against an immovable block or the world edge, means the piston does not extend. The cell after the line must be air.
- Immovable: Foundation Stone, Blackglass, any block that has a block entity (chest, kiln, dispenser, inverter torch, gauge and so on), an extended piston, a piston head, and a block in flight. Nothing else is immovable.
- Extending sets the piston's `extended` to true, then turns the head's cell and every pushed block's destination cell into a `piston_moving` block with a block entity. Every cell a block leaves is the destination of the block behind it (the head for the first one), so a move leaves no hole and moves one block per cell.
- A Piston Moving entity stores the parts it draws (block state and start offset), the movement vector, the start tick, the duration (`PISTON_MOVE_TICKS`, 2) and the state the cell becomes when the move ends. When the move lands the cell becomes that state, as a real block.
- Landing is a scheduled tick (`piston_land`, one per cell) through the existing `BlockTicks`, so timing is deterministic and saved ticks stay valid. A piston is busy until all of its cells have landed; the engine re-evaluates it as soon as the last one lands, so a pulse that ended during the move is not lost.
- Retracting a Piston turns its head into a moving block that slides back into the piston and lands as air. A Sticky Piston also pulls the movable block directly in front of its head: that block and the head share the front cell and move together, and the cell lands as the pulled block. A Sticky Piston with air or an immovable block in front retracts like a plain Piston.
- A piston head whose piston is missing or retracted removes itself, and a piston marked extended without its head resets to retracted, so broken states cannot persist.
- The Moving Blocks renderer (`src/render/moving-blocks.ts`) draws the entities' parts at `cell + from + move × progress`, with progress taken from the world tick plus the render interpolation alpha, so blocks glide between cells. Light comes from the cell they are in.
- Pistons place facing the direction the player looks (up and down when looking steeply).

## Doors, Dispenser, Note Block

- A powered Door or Trapdoor drives the existing `open` state: powered opens, unpowered closes. The engine remembers each openable's last power in memory and acts only when it changes, so hand toggling still works and stays until the power changes again. A door counts as powered if either half is. No new door blocks.
- The Dispenser has nine slots in a block entity and exposes them through the generic container interface. On a rising edge (tracked by its `triggered` state) it ejects one item from the first stocked slot as an item entity, through `world.itemSpawner`, a hook the player controller fills with the existing `ItemEntityManager`. The item leaves in the facing direction, including up and down, with a short pickup delay. An empty dispenser does nothing. There is no arrow or projectile behaviour (M13d).
- Without a screen of its own, using a Dispenser loads one held item (survival consumes it). A dispenser screen can replace this later. Breaking a dispenser does not spill its contents yet.
- The Note Block's rising edge (tracked by its `powered` state) emits a tone event `{x, y, z, note, pitch}`. Using it steps `note` 0–24 and plays that note. Listeners subscribe with `world.current.mechanics.onTone(listener)`. There is no audio code; M16b can subscribe.

## Art, items, recipes

- Every new block has a texture generator and palette in `src/render/textures/mechanics.ts` (ART.md: at most 12 colours per tile, luminance spread of at least 60, deterministic, lit from the top-left), a registry entry, an item, an icon and a self-drop loot entry.
- The Piston, Sticky Piston, Dispenser and Note Block are craftable from existing materials. The heads and Piston Moving are technical blocks: they have items only because the registry parity test requires one, and they are added to the reachability exemption table with their reason.
- The Dispenser recipe uses a stick where a bow would belong, because the Bow is not obtainable until M13d and the reachability test rejects recipes that need it.

## Visual Review wording

- "Door open with pistons extended" cannot be built from this task's pieces. A piston's head always fills the cell the piston pushed into, and a sliding block can only move one cell per push, so extended pistons cannot clear a doorway. The test door therefore closes when its sticky pistons extend (their heads and the panels they push fill the doorway) and opens when they retract. `m15-piston-door.png` shows the open door at night, and `m15-piston-door-closed.png` shows the extended pistons with the door shut.

## Interrupted moves

- Every moving cell is tracked with its owning piston. When a cell's landing tick fires, or its column unloads, the owner is released whether or not the cell is still `piston_moving`.
- If something else replaced or removed a moving cell, the block it carried is lost (never duplicated) and the piston carries on.
- Unloading a column lands its moving cells immediately, so no `piston_moving` cell is left without a landing tick, and forgets its receivers.
- `piston_moving` has negative hardness (unbreakable by mining) and no collision. `piston_head` collides with its plate and shaft.
