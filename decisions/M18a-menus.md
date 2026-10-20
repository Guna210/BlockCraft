# M18a — Main menu, world creation & pause decisions

The owner's decisions for M18a (1–11), then the implementation decisions made while building them.

## Owner decisions

1. **Boot.** The page boots to the main menu. `ready()` resolves once the menu is interactive, on the first frame. Debug `createWorld`/`loadWorld` and the test scenes hide the menu and tear the panorama down (`WorldManager.leaveMenu()`). Existing e2e run unchanged.
2. **Panorama.**
   - The panorama is a real world with seed `blockcraft-panorama` at render distance 4, using the normal renderer and the gen, light and mesh workers.
   - The camera turns once every 120 s (`PANORAMA_TURN_MS`). It starts 1 s after the menu appears (`PANORAMA_DELAY_MS`) and fades in from the sky colour over 1.5 s (`PANORAMA_FADE_MS`).
   - It is torn down completely when a world starts:
     - the world epoch is bumped;
     - the streamer is reset and deactivated;
     - `cancelAll()` runs on the gen, light and mesh pools;
     - every column mesh and its GPU buffers are freed.
   - The player's render distance is restored. The panorama restarts when Save & Quit returns to the menu.
3. **Logo and splashes.**
   - The logo is drawn by `src/ui/logo.ts` from the pixel font's glyphs, following ART.md: 10 colours lit from the top-left, with dithered stone faces, grass caps, extrusion and an outline.
   - `data/splashes.json` holds 25 original lines. One is picked at random every time the menu is shown, drawn in yellow, tilted −20° and pulsing.
4. **Buttons.** The menu has Singleplayer, which opens `WorldListScreen.open()` (its Create opens the new screen), and Credits, which opens a credits panel with Back. There is no Settings or Multiplayer button.
5. **Create World screen.**
   - The name defaults to "New World" and uses M17c's rules (trimmed, 1–32 code points, unique). A clash shows "already exists" on screen.
   - The seed is free text. An empty seed means a random 12-digit seed, which is shown afterwards in a 5 s message ("Seed: …").
   - Mode toggles Survival/Creative. The type cycles Default → Flat → Amplified → Single Biome, and Single Biome adds a biome toggle that cycles the overworld biomes.
   - Structures defaults to on and is only stored. Starting Chest defaults to off; when on, a chest next to the spawn holds 8 oak_log, 4 bread, 1 wooden_pickaxe, 1 wooden_axe and 16 torch.
   - The debug `createWorld` options grow additively with `type`, `biome?`, `structures?` and `startingChest?`.
6. **Amplified.**
   - `shapeHeight` roughly doubles the height above sea level and clamps it to y 319. The density ceiling moves from 220 to 290 so the taller peaks are carved.
   - Over a sampled 256×256 area with `blockcraft-test-seed-42`, the maximum height is above 250 (unit and e2e tests).
   - Default generation is untouched: golden `worldHash` values computed on master are asserted. Caves and aquifers still run.
7. **Single Biome.** `sampleBiome` returns the chosen biome everywhere; the terrain shape still comes from noise.
8. **Saving.**
   - `WorldRecord.worldType` widens to `WorldType`, and the record gains `options?: { structures, startingChest, biome? }`.
   - Records without options load with the defaults (`normalizeWorldOptions`).
   - Every gen worker job carries the type and the biome.
9. **Pause.**
   - Esc opens the pause menu (Resume, Save & Quit) when no other screen is open and a player exists. Losing pointer lock while the game is not captured also opens it.
   - Save & Quit saves, disposes the world and returns to the main menu, and the world list then shows the world.
10. **Full-flow e2e.** The flow uses real pointer clicks and the keyboard only. Debug calls are used only to wait and to read results. The same-seed test creates two worlds through the UI with seed `abc` and compares their `worldHash`.
11. **Visual Review.** `m18-main-menu.png` shows the panorama behind the logo, the splash and the buttons. It is copied to `docs/screenshots/M18a/`.

## Implementation decisions

- **The static menu is drawn only when it changes** (note for the owner).
  - The canary tests clear the canvas to a new colour and expect a blank or magenta screenshot. A menu composited into every frame broke them.
  - With no world, no panorama and no test scene, the main loop now presents the last menu frame and skips `gl.clear` and drawing until something on the menu changes: hover, a credits toggle, a resize, or the panorama starting.
  - The pulsing splash is a small CSS-animated DOM canvas, so it needs no WebGL redraws.
  - The panorama starts 1 s after boot. The canaries finish their clears within that second, as they did on master.
- **Menu art goes through WebGL.** The logo, buttons and credits panel are drawn into one 2D canvas, which `MenuOverlayRenderer` composites into the WebGL frame as a nearest-filtered quad. The menu buttons themselves are transparent DOM `<button>`s placed over the drawn ones, so they have real roles and names.
- **The panorama is not the debug world.** The panorama world is never passed to `setWorldInstance`, so debug reads made at the menu (m02's first test) keep using the debug world instance. Panorama and menu frames are left out of the frame statistics, CPU and upload timings, and thumbnail capture.
- **Create World lives on the world-list canvas.** The Create World screen replaces M17c's name prompt on `#world-list-canvas`. Cancel and Create stay at the prompt's button positions, the default name is pre-selected so typing replaces it, and the canvas's aria-label still starts "Create world name." The M17c e2e passes unchanged.
- **The terrain variant is ambient.** `src/gen/world-options.ts` holds the current `TerrainVariant`:
  - `generateColumn` wraps its stages in `withTerrainVariant`;
  - workers receive the variant with each job;
  - the main thread sets it with the world kind.
  This keeps the generation changes to the few functions that read it, because M13c and M19a also touch generation.
- **The starting chest** is placed only in a newly created world, on the first free neighbour of the spawn column that has air above solid ground, before the player spawns.
- **No new block ids.** `data/block-state-ids.json` is unchanged.
