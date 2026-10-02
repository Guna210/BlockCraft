# M03c — Biome Tinting Mechanism

## Overview

Biome tinting applies procedural grass and foliage colors dynamically without altering vertex geometry or breaking greedy quad merging. Tint categories are identified by `tintIndex` packed into vertex Word 0 (bits 28–31):

- `0`: None (untinted material / fixed tiles like `birch_leaves`, `pine_leaves`)
- `1`: Grass top (`grass_top`)
- `2`: Foliage tint (`oak_leaves`)
- `3`: Grass side (`grass_side`)

## Tint Lookup & Column Tint Maps

1. **Per-Column Data:**
   - Each `ChunkColumn` maintains a 16×16 array of grass RGB tints (`Uint8Array(768)`) and 16×16 array of foliage RGB tints (`Uint8Array(768)`).
   - Neighboring biomes are smoothly blended across a 13×13 block sample neighborhood during surface generation so tint differences between adjacent blocks across chunk borders stay ≤ 12/255 per RGB channel.
   - Border columns compute identical tint values along shared edges using the pure `sampleBiome` function.

2. **Shader Sampling:**
   - Per-column grass and foliage tints are uploaded to 16×16 WebGL `u_grassTintMap` and `u_foliageTintMap` 2D textures (`gl.TEXTURE1` and `gl.TEXTURE2`) with linear filtering.
   - The chunk fragment shader samples these textures using world coordinates `fract(v_worldPos.xz / 16.0)`.
   - Default / flat / standalone test scenes (e.g. M01c test scene, texture sheet, flat worlds) use default 16×16 textures initialized to the Plains grass tint `[124, 189, 71]` and foliage tint `[119, 177, 58]`.

## Neutral Base Tiles & Grass-Side Masking with Mip Chain

1. **Grass Top & Oak Leaves:**
   - `grass_top` and `oak_leaves` are generated as neutral grayscale tiles with high luminance contrast (≥ 60).
   - Birch leaves (`birch_leaves`) and Pine leaves (`pine_leaves`) remain fixed green tiles (`tintIndex = 0`) to preserve their signature distinct foliage colors.
   - In GLSL, `texColor.rgb` is multiplied directly by `grassTint` or `foliageTint` when `v_tintIndex` is 1 or 2.

2. **Grass Side Masking (`grass_side`):**
   - The `grass_side` tile consists of an untinted brown dirt base and an overhanging grayscale grass fringe.
   - The `grass_side` generator encodes the grass fringe mask in the tile's **Alpha channel**:
     - Grass fringe pixels have `Alpha = 255` (1.0).
     - Dirt base pixels have `Alpha = 0` (0.0).
   - In GLSL, the tint is applied using `mix()` and output alpha is forced to 1.0 (opaque):
     ```glsl
     vec3 tintedRgb = texColor.rgb * grassTint;
     texColor = vec4(mix(texColor.rgb, tintedRgb, texColor.a), 1.0);
     ```

3. **Manual Mip Chain Integrity:**
   - The manual per-tile mip chain generator in `src/render/atlas.ts` downsamples 2×2 pixel blocks across RGBA channels simultaneously.
   - Because alpha is box-filtered alongside RGB, mip levels 1 (8×8) and 2 (4×4) retain fractional fringe mask values, producing smooth, artifact-free tint transition fringes at distance.

4. **Caution for Future Passes / Renderers:**
   - **Warning:** The Alpha channel of the `grass_side` tile in the texture atlas is repurposed specifically as a **grass fringe tint mask** rather than surface transparency.
   - Opaque rendering shaders must always override the final output alpha for `grass_side` faces to 1.0. Any future rendering pass, post-processing shader, shadow map generator, or secondary raytracer sampling `grass_side` from the texture atlas must treat its alpha channel as a tint mask, not as cutout or alpha transparency.
