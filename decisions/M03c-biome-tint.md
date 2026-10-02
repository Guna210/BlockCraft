# M03c — Biome Tinting Mechanism

## Overview

Biome tinting applies procedural grass and foliage colors dynamically without altering vertex geometry or breaking greedy quad merging. Tint categories are identified by `tintIndex` packed into vertex Word 0 (bits 28–31):

- `0`: None (untinted material)
- `1`: Grass tint
- `2`: Foliage tint

## Tint Lookup

1. **Per-Column Data:**
   - Each `ChunkColumn` maintains a 16×16 array of grass RGB tints and 16×16 array of foliage RGB tints.
   - Neighboring biomes are smoothly blended across a 13×13 block sample neighborhood during surface generation so tint differences between adjacent blocks across chunk borders stay ≤ 12/255 per RGB channel.
   - Border columns compute identical tint values along shared edges using the pure `sampleBiome` function.

2. **Shader Sampling:**
   - Per-column grass and foliage tints are uploaded to GLSL shader uniforms `u_grassTint` and `u_foliageTint`.
   - Default / flat / standalone test scenes (e.g. M01c test scene, texture sheet, flat worlds) use the default Plains grass tint `[124, 189, 71] / 255` and foliage tint `[119, 177, 58] / 255`.

## Neutral Base Tiles & Grass-Side Masking with Mip Chain

1. **Grass Top & Oak Leaves:**
   - `grass_top` and `oak_leaves` are generated as neutral grayscale tiles with high luminance contrast (≥ 60).
   - Birch leaves (`birch_leaves`) and Pine leaves (`pine_leaves`) remain fixed green tiles (`tintIndex = 0`) to preserve their signature distinct foliage colors.
   - In GLSL, `texColor.rgb` is multiplied directly by `u_grassTint` or `u_foliageTint` when `v_tintIndex` is 1 or 2.

2. **Grass Side Masking (`grass_side`):**
   - The `grass_side` tile consists of an untinted brown dirt base and an overhanging grayscale grass fringe.
   - Grayscale fringe pixels are detected in GLSL by `abs(texColor.r - texColor.g) < 0.05 && abs(texColor.g - texColor.b) < 0.05` and multiplied by `u_grassTint`.
   - Untinted brown dirt base pixels (`r > g`) remain untinted.
   - All `grass_side` pixels remain 100% opaque (Alpha = 255), keeping `grass_side` within the 10-color palette limit in ART checks.

3. **Manual Mip Chain Integrity:**
   - The manual per-tile mip chain generator in `src/render/atlas.ts` downsamples 2×2 pixel blocks across RGB channels simultaneously.
   - Because both grass fringe and dirt base colors are box-filtered, mip levels 1 (8×8) and 2 (4×4) retain proper contrast and color boundaries without color shifts or subpixel bleeding.
