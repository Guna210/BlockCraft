# M09b — Inventory screen & icons: decisions

These are the owner's technical decisions for M09b, plus the choices made while building them.

## Owner decisions

1. **UI kit.** Panels, slots, tooltips and buttons are drawn by code on a 2D canvas overlay
   (`src/ui/ui-kit.ts`); there are no image files. Lettering comes from a 5×7 bitmap font defined
   as data in `src/ui/pixel-font.ts` (upper case, digits and a few symbols). The shared palette has
   eight colors (`UI` in `ui-kit.ts`, ART.md §4) with bevels lit from the top-left. The scale is an
   integer: the largest `s` such that a 320×240 UI area fits the window (`uiScaleFor`), recomputed on
   every resize. The overlay canvas uses `image-rendering: pixelated` and `imageSmoothingEnabled =
   false`, and every rectangle is drawn on whole canvas pixels, so edges stay crisp.
2. **Icon atlas.** `buildIconSheet` (`src/ui/icons.ts`) walks `items.items` once and renders one
   16×16 icon per item into a single 256-pixel-wide sheet, so a new block or item gets an icon with
   no extra code. Block items use their registry textures from the world atlas that is already built:
   - full cubes: isometric, 2:1 top diamond plus two side faces, each pixel centre mapped back onto
     the face it shows. Shades: top 1.12 (lightest), left 0.88, right 0.66; the blue channel loses
     less than red and green, so shadows are cooler (ART.md §1.5). The silhouette is darkened;
   - `slab` blocks (`snow_layer`) use the same box at half height, lower texture half on the sides;
   - `cross`, `wall` and `wall_torch` models (plants, torch, fire, ladder, vine) are flat sprites
     with a one-pixel dark outline;
   - grass and leaves use the plains tint colors from `BIOME_DEFINITIONS`; a grass side's alpha
     selects the tinted fringe as in the chunk shader, so it is not transparency;
   - `cutout` cubes (leaves) fill holes with a dark backing; `translucent` cubes (ice, glass) keep a
     minimum alpha of 115 so they stay visible; `opaque` slabs ignore texture alpha.
   - non-block items reuse M09a's item sprites (terrain atlas tools or `inventoryItemGenerators`),
     with the same outline. Air is registered as an item and draws nothing.
   - Ice, snow_layer, fire (M12c) and blackglass (M08a) are covered by tests that fail on a
     missing or empty icon.
   - **Startup cost.** The sheet is built once, right after the first frame, off the path to
     `ready()`; opening a screen first builds it if it is not there yet. The two 2D canvases are
     created on first open. M09a's lazy world-drop atlas is untouched. Measured numbers are in
     `progress/M09b.md`.
3. **Inventory screen.** E toggles it; Esc and the X button close it; E and Esc work only while a
   player exists. It shows hotbar (0–8), main (9–35), armor (36–39), offhand (40), the cursor stack
   following the mouse and a tooltip with the item name (empty cursor only). Opening releases pointer
   lock and `InputEngine.setCapture(true)` clears every action and ignores key presses, mouse look and
   mouse buttons until it closes. Closing calls `Inventory.returnCursor()` (new; moves as much of the
   cursor stack into storage 0–35 as fits, conserving counts) and throws any remainder into the world
   through `dropInventoryStack`. Pointer lock is requested again if it was held before; a refusal
   from the browser is ignored.
4. **Clicks use M09a's pure operations.** Left, right, shift-click, drag and double click call
   `leftClick`, `rightClick`, `shiftClick`, `drag` and `doubleClick`. While a stack is on the cursor,
   a press only starts a drag; the release decides: one slot is a normal click, several slots call
   `drag(slots, button)`. A second left press within 400 ms on the slot a stack was just picked from
   is a double click. A press outside the panel with a cursor stack throws it (all with left, one
   with right). Q drops one and Ctrl+Q the whole stack, through `dropInventoryStack`: the hovered
   slot while the screen is open, the selected hotbar slot while it is closed.
5. **Unstackable swap (M09a review follow-up).** `leftClick` merged any two stacks with the same id,
   so an unstackable item on the cursor met a full slot and nothing happened. Now `maxStack > 1`
   is required to merge; unstackable items swap like any two different items. With today's data
   (no per-stack durability) the resulting inventory is the same, so the unit test checks that the
   two stack objects trade places; it will matter once stacks carry data.
6. **Debug API** (`src/debug/api/ui.ts`, registered with one import line): `openScreen(name)`
   (`'inventory'` or `'none'` to close), `getScreen()` and `uiClickSlot(slot, button, shift?)`.
   `getScreen()` returns `{ name, scale, panel, slots[41], closeButton, hoverSlot, tooltip }`;
   rectangles are in CSS pixels, so tests can crop screenshots. `uiClickSlot` goes through the same
   `UiManager.clickSlot` the mouse handler uses and requires the screen to be open.
7. **No M08b files touched.** `src/render/chunk-renderer.ts` and `src/render/textures/fluids.ts` are
   unchanged.
8. **M09a record.** `progress/M09a.md`'s status line is out of date; it is another task's record
   (AGENTS.md §8) and was not edited.

## Choices made while building

- **Thrown items.** M07b's `spawn` pops items in a random direction and the player's magnet takes
  them back after 4 ticks. Q throws need a direction and a delay, so `ItemEntityManager.spawn` and
  `dropInventoryStack` take an optional `thrown: { velocity, pickupDelay }`. Without it, behavior
  and the random draws are unchanged. A thrown item leaves 0.3 blocks in front of the eye at 4
  blocks/s plus 1 upward, and cannot be collected for 40 ticks (2 s). Both files belong to M07b
  and M09a.
- **Input capture** is a flag on `InputEngine` (`captured`), not a separate input path, so every
  existing consumer (movement, interaction, the debug `input()` action) sees it.
- **Overlay, not WebGL.** The UI is a 2D canvas above the game canvas. It is hidden (`display:
  none`) when no screen is open, so it costs nothing per frame; while open it redraws every frame so
  pickups show up.
- **Font.** Lower case is displayed in upper case. Item names are the id with underscores turned
  into spaces. A unit test checks that every registered item name is drawable.
- **Out of scope** (M09c): HUD, on-screen hotbar, number keys, mouse wheel selection, F3.
