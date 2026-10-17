# M08c — Glass, ice & foliage decisions

## Translucent blocks

- Glass, ice, packed ice and the eight stained glass colours render in M08b's ordered translucent pass (`renderLayer: "translucent"`, depth-sorted sections and quads). They carry ordinary tint tags, not the fluid material tags 4/5, so none of the water shader paths (waves, absorption, Fresnel) apply to them.
- Glass is mostly clear: a thin frame (alpha 220), three-pixel glint streak plus a short second streak (alpha 170), pane alpha 25. Interior mean alpha is below 0.15.
- Ice is about 60 % opaque (palette alphas 135–190, tile mean about 0.57). Its palette changed from alpha 200–230 (M12c) to this; geometry, texture names and weather behaviour are unchanged.
- Packed ice keeps the translucent pass as SPEC says (its block definition changed from `opaque`/`fullOpaqueCube: true` to `translucent`/`false`) at alpha 230 (about 90 % opaque), so it reads as solid. Because it is no longer a full opaque cube, neighbouring solid blocks now draw their faces against it, and light attenuates through it by 3 levels (`opacity` in `src/world/lighting.ts`) instead of blocking fully; ice, glass and stained glass stay at 0. Existing loot (it drops itself) and recipes are untouched.
- Faces between two blocks of the same type are hidden (the existing `translucentGroup` rule keys on the block id), so a glass wall draws no inner faces. Different colours of stained glass keep the face between them.

## Stained glass

- Eight plain colours: red, orange, yellow, green, cyan, blue, purple, pink. IDs `<colour>_stained_glass`, one generator (`genStainedGlass`, seeded, placing two diagonal glint streaks) over a four-colour palette per colour (frame alpha 215, pane alpha 120, deeper shade alpha 150, white glint alpha 205).
- Blocks live in `data/blocks/stained-glass.json`, items (maxStack 64) in `data/items/stained-glass.json`, loot (empty array: drops nothing, like glass) in `data/loot/stained-glass.json`.
- `data/block-state-ids.json`: the eight states are appended at the end (137–144, alphabetical); nothing is reordered.
- `lighting.ts` matched `startsWith('stained_glass')`, which none of the SPEC-style IDs match; it now matches `endsWith('_stained_glass')` so the colours transmit light like glass.
- Obtaining them: the reachability test (M10a) requires every item to be acquirable or exempt, and the repository has no dye items. `data/recipes/stained-glass.json` adds a shaped 3×3 recipe: eight glass around one colourant gives eight stained glass. Colourants are existing items: wild_rose (red), marigold (orange), buttercup (yellow), cactus (green), lumite_shard (cyan), bluebell (blue), violet (purple), heather (pink). If dyes arrive later, these recipes are the only thing to replace.
- Icons: no code change. The inventory icon variance test applies as before; see the progress notes for the result.

## Leaves fast/fancy

- `settings.leaves: 'fancy' | 'fast'` (default `'fancy'`) in `src/engine/settings.ts`; `setLeaves(mode)` in `src/debug/api/leaves.ts` (registered by one import line in `index.ts`, typed in `core.ts`) calls `WorldManager.setLeaves`.
- Fancy: cutout leaves, every face drawn, including faces between leaves (unchanged mesher behaviour).
- Fast: `buildMeshLookupTables(registry, tileResolver, { fastLeaves: true })` marks every `*_leaves` state as an opaque cube. The mesher then hides inner faces and faces of solid neighbours behind leaves, with no mesher change. In the fragment shader, a flat `v_leaf` flag (leaf tile mask) turns transparent pixels into a dark leaf colour (`vec4(0.11, 0.17, 0.08, 1)`, still lit and tinted) and the alpha test is skipped for those fragments, so leaves are opaque cubes. A review round tried replacing that dark colour with each leaf texture's own body colour; the owner preferred the original look, which shows the leaf clusters, so the original substitute was kept. Lighting tables are unchanged: light still passes through leaves with opacity 1.
- Changing the setting rebuilds the tables and calls `streamer.invalidateAll()`, which remeshes every loaded section. The setter is a no-op for remeshing when the mode is unchanged. While remeshing, existing fancy meshes briefly draw with the fast fragment path.

## Waving

- A vertex-shader sway for leaves and plants (cross-model blocks except `torch` and `fire`: grass, flowers, mushrooms, reeds). Which tiles sway comes from two 4096-bit masks over atlas tile indices built from the registry (`getSwayMasks`), uploaded as two `uvec4[32]` uniform arrays (64 vertex uniform vectors in total, instead of the 256 that two `uint[128]` arrays can take under std packing, so minimum-spec WebGL2 GPUs still link). Word `w` of a mask is component `w & 3` of vector `w >> 2`; the data is the same contiguous words as before, so the classification is unchanged, and a unit test checks the packed lookup against the flat one for every atlas tile. The vertex word layout is unchanged.
- Displacement depends only on world position and the wind clock `u_windTime`, so vertices at the same position always move together and leaf cubes never tear. Leaves move at most 0.03 blocks horizontally and 0.01 vertically; plants at most 0.04 horizontally at the tip, scaled by `1 − v` of the sprite UV, so their bottom edge (v = 1) stays fixed. Both are within the 0.04 limit.
- No waving in fast mode (`u_swayOn = 0`).
- The sway clock is a separate `windAnimation` (a `FluidAnimationClock`, `src/render/fluid-animation.ts`) that holds while `setFluidAnimationPaused(true)` or the simulation pause (`api.pause()`) is active. Deviation from "same clock as setFluidAnimationPaused": the unchanged M12c clear-weather control compares frames with only `api.pause()` set, and plants swaying there pushed its diff to 0.031 (limit 0.005). Existing e2e tests that compare frames with leaves or plants are not edited; results are in the progress notes.

## Tests

- `tests/unit/m08c-glass-foliage.test.ts`: registry/loot/recipes/IDs, alpha targets, palette and contrast, face culling, fast-leaf tables.
- `tests/e2e/m08c.spec.ts`: the SPEC glass criterion (`0.005 < diffFraction < 0.15`, lit room through a glass wall vs air), stained glass hue/readability row, leaves fancy vs fast, plant sway with a fixed base and no sway in fast mode.
