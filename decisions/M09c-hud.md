# M09c — HUD & F3 decisions

## Owner decisions

1. **Shared pixel UI.** Draw the HUD with M09b's `ui-kit.ts`, `pixel-font.ts`, and item icon atlas. Use `uiScaleFor` for the UI canvas's whole-number scale; the reticle uses integer scale 1 and leaves its center open so the target remains visible. The hotbar is centred along the bottom edge, uses the existing slot/icon styling, and highlights the selected slot. Number keys 1–9 and the mouse wheel update `player.inventory.selectedSlot`; both ignore input while `InputEngine.captured` is true. A separate item-name canvas appears on a slot change, remains visible for about 1.6 seconds, then fades over 0.4 seconds.
2. **Player bars.** Draw 10 hearts from `player.health` (20 health points, half-heart increments), 10 hunger icons from `player.hunger` (20 points), and 10 air bubbles from `player.air` (30 air per bubble). Air bubbles render only while `WorldManager.underwaterView.submerged` is true, reusing M06b's head-in-water detection. The XP bar uses `player.xpProgress`; `player.xpLevel` appears above it only when greater than zero. Creative mode draws only the hotbar and crosshair. Survival mode draws all applicable bars and popups.
3. **Armor points.** Add `armorPoints` to every item in `data/items/armor.json`; one point fills half of one shield icon. Keep the values consistent with M10a's existing defense-point choices so future damage handling has one scale. The bar sums slots 36–39 and is hidden at zero; it has no effect on damage in M09c.

   | Armor piece | Points |
   | --- | ---: |
   | Copper helmet | 2 |
   | Copper chestplate | 4 |
   | Copper leggings | 3 |
   | Copper boots | 1 |
   | **Copper full set** | **10** |
   | Iron helmet | 2 |
   | Iron chestplate | 6 |
   | Iron leggings | 5 |
   | Iron boots | 2 |
   | **Iron full set** | **15** |

4. **XP state and debug setters.** Add `xpLevel` (non-negative integer) and `xpProgress` (0–1) to `Player`, both defaulting to 0. `src/debug/api/xp.ts` registers `setXp(level, progress)`; it validates and updates only the player's in-memory XP fields. No persistence code is changed. `src/debug/api/vitals.ts` adds `setVitals({ health?, hunger?, air? })` so M09c's visual states can be set through the supported debug API before M11a implements survival progression.
5. **F3 diagnostics.** F3 prevents the browser default and toggles the overlay only in `?debug=1` mode, as required by SPEC §3.2. Use the existing debug concepts in SPEC §4: render and worker statistics, player position, `getBiome`, `getLight`, and `raycast` target data. `data-biome` contains the same value returned by `getBiome(floor(player.x), floor(player.z))`. The frame graph uses the most recent CPU frame samples recorded by `frameStats`.
6. **Redraw cadence.** Keep inventory, HUD, item popup, and F3 on separate canvases. Redraw the HUD only when its rendered values or viewport dimensions change. Let CSS fade the popup without redrawing the HUD. Refresh F3 text and graph at most once every 250 ms. Frame history is stored in a fixed-size ring buffer to keep per-frame recording constant-time.
7. **Status-icon art.** Draw hearts and hunger icons as 9×9 pixel silhouettes with 1-pixel outlines and palettes independent of the shared eight-colour UI palette used for panels, slots and buttons. Hearts use a deep maroon outline, dark desaturated empty interiors, shaded red fills, and a three-pixel pink/near-white highlight on the top-right lobe; partial hearts fill from the left. The owner-approved orange hunger icon replaces carrots with a round orange body, dark brown outline, dark empty interior, shaded orange fill, a three-pixel yellow/cream highlight, and a small green leaf with a brown stem. Partial oranges fill from the left. Keep the existing UI scale, positions and 9-pixel step.

   | Icon | Palette (hex) | Count |
   | --- | --- | ---: |
   | Heart | `#4a1528`, `#4a4248`, `#8f1d35`, `#c82a44`, `#ea455b`, `#ff93a3`, `#ffe8ec` | 7 |
   | Orange | `#54250f`, `#4a4248`, `#b74d12`, `#e47416`, `#f39224`, `#ffd37a`, `#fff1d2`, `#347b3c`, `#67b653`, `#80502c` | 10 |

## Evidence targets

- `docs/screenshots/M09c/m09-hud.png`: survival HUD with one half-heart missing, partial hunger, equipped armor, and a visible XP level/bar.
- `docs/screenshots/M09c/m09-underwater.png`: survival HUD underwater with the air bubbles visible.
- `docs/screenshots/M09c/m09-hud-icons.png`: native UI-scale crop showing five full icons, one half icon, and four empty slots for both hearts and oranges.
- `docs/screenshots/M09c/m09-f3.png`: F3 text and frame-time graph visible.
