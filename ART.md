# ART.md — BlockCraft Art Direction

Every task that creates or changes textures, animation frames, item icons, creature skins or UI art follows this file. Like `SPEC.md` and `AGENTS.md`, it belongs to the repository owner: do not edit it.

The target is **crafted 16×16 pixel art**: every tile looks deliberately drawn by a pixel artist, even though code draws it. Noise is a tool for varying shapes, never the texture itself.

## 1. Rules for every tile

1. **Limited palette.** Each tile declares its palette: a hand-picked ramp of 3–7 shades per material, at most 12 colors in total (an ore tile combines the stone ramp and the ore ramp). Every output pixel is one of those colors. No continuous gradients, no unquantized noise.
2. **Structure first.** Build shapes (stones, boards, bark ridges, leaf clusters, ore nuggets, cracks), then shade them. Random single-pixel speckle must never be the main texture.
3. **Clusters, not specks.** Detail comes in clusters of 2–6 pixels. Isolated single pixels are allowed only as deliberate highlights.
4. **Consistent light from the top-left.** Shapes get a lighter pixel or edge on their top/left and a darker one on their bottom/right.
5. **Hue-shifted ramps.** Shadows are cooler and slightly more saturated; highlights are warmer and lighter. A ramp is never the same hue at different brightness.
6. **Readable contrast.** Within each opaque tile, the luminance difference between the darkest and lightest color is at least 60 (on a 0–255 scale). The tile must still read clearly in grayscale.
7. **Seamless tiling.** Generation is wrap-aware: shapes that cross an edge continue on the opposite edge. A 3×3 repeat of the tile shows no visible seam and no obvious grid pattern.
8. **Deterministic.** Same seed, same pixels. Variation between similar tiles (e.g. three plank types) comes from different palettes and different seeds, not different algorithms only.

## 2. Suggested palettes

Starting points. Tasks may adjust shades but must keep each ramp's character. Hex values are opaque unless an alpha is given.

| Material | Ramp (dark → light) |
| --- | --- |
| Stone | `#4f5257` `#62666b` `#767a7f` `#8b8f94` `#a3a7ab` |
| Dirt | `#3f2a1c` `#5a3e2b` `#72513a` `#8a6448` `#a37d5d` |
| Grass (default plains green) | `#3f6b24` `#4f842d` `#63a038` `#7cbd47` `#9bd35e` |
| Sand | `#b89c62` `#c9b27a` `#d8c28a` `#e6d29c` `#f1e2b4` |
| Gravel | `#4e4e53` `#67676d` `#818188` `#9c9ca3` plus warm pebbles `#7a6a5a` `#96836f` |
| Oak bark | `#2f2115` `#45311f` `#5b422a` `#735537` |
| Oak wood (log top, planks) | `#6e5230` `#8a6a3f` `#a5824f` `#bf9a62` |
| Birch bark | marks `#2b2a28` `#4a4843`; bark `#b9b5aa` `#d8d5cc` `#eeede6` |
| Birch wood | `#a88f5f` `#c2aa76` `#d6c08b` `#e6d3a2` |
| Pine bark | `#24170f` `#35231a` `#4a3224` `#5e412f` |
| Pine wood | `#5a3d24` `#6f4c2e` `#855d39` `#9a6f45` |
| Leaves (default green) | `#24481a` `#2f5e22` `#3f7a2c` `#55983a` `#6fb14a` |
| Coal | `#18181b` `#2a2a30` `#44444c` |
| Copper | `#8a4b2a` `#b4683a` `#d8874a`; patina `#4f9a86` `#7cc7b0` |
| Iron | `#8f735f` `#b89a86` `#d9bea8` `#f0dccb` |
| Gold | `#9c6f12` `#c7951f` `#f0c43a` `#fff08a` |
| Lumite | `#155f70` `#1f8fa6` `#37c8e0` `#9ff4ff` |
| Skyshard | `#3f1f6b` `#5a2d91` `#8a4fd1` `#c69bff` |
| Water | `#1f4f94` `#2b5fa8` `#3a73c0` `#4c88d4` `#8ec0f0` |
| Lava | crust `#2a0d06` `#4a1709`; molten `#b8360b` `#e45f10` `#f7931c` `#ffd24a` |
| Glass | frame `#dff3fa` α 220, glint `#ffffff` α 170, pane `#e9f6fb` α 25 |

## 3. Material notes

- **Stone:** soft irregular blotches of 3–8 pixels in 3–4 shades, plus 2–3 short dark crack lines. Calm overall, so ores and cobblestone stand out against it.
- **Cobblestone:** 6–9 rounded stones of varied size separated by 1-pixel dark mortar gaps. Each stone has a top-left highlight and a bottom-right shadow.
- **Dirt:** 3–4 browns with darker clumps and a few light 2-pixel pebbles.
- **Grass top:** short blade tufts (1×2 and 1×3 strokes) in 3 tones over a mid-green base.
- **Grass side:** the dirt texture with an irregular grass fringe hanging 3–6 pixels down from the top edge, with a darker lower edge where it overhangs.
- **Sand:** fine grain in 3 warm tones with one or two faint diagonal ripple lines.
- **Gravel:** 6–9 distinct rounded pebbles in grays and warm browns, each with highlight and shadow, packed tightly.
- **Log side:** vertical bark ridges with dark crevices. Oak is deeply furrowed brown; birch is pale with short black horizontal marks; pine is dark and scaly.
- **Log top:** growth rings in the wood ramp around a small darker pith, enclosed by a 1–2 pixel bark ring at the tile border.
- **Planks:** 4 horizontal boards with dark seams, subtle grain streaks, and board joints offset between rows.
- **Leaves:** clusters of leaf shapes with darker interiors and lighter tips. Transparent gaps between clusters (for the cutout pass) take up about 15–25 % of the tile.
- **Ores:** the stone texture plus 3–5 ore nuggets, each a 2×2 to 3×3 cluster with a highlight pixel and a dark edge. Every ore has a distinct hue and nugget shape: coal is dark and matte; copper mixes orange with teal patina; iron is pinkish beige; gold is bright yellow; lumite is cyan with a bright core; skyshard is angular violet crystal shards.
- **Glass:** mostly transparent, with a thin light frame and one or two diagonal glint streaks.
- **Water (animated):** a calm blue base with light ripple lines that drift between frames. The animation loops seamlessly from the last frame back to the first.
- **Lava (animated):** dark crust patches floating over a bright molten flow, with the brightest yellow in the cracks. Loops seamlessly.
- **Biome-tinted materials:** grass and leaves must still read well in grayscale. M03c will convert them to neutral tiles multiplied by a biome tint; until then, bake the default greens above.

## 4. Other art (later tasks)

- **Item icons (M09b):** clear silhouettes with a 1-pixel dark outline and the same palette rules.
- **Creature skins (M13+):** the palette rules apply per body part. Silhouettes and color schemes must be original and must not resemble creatures from existing games.
- **UI (M09b+):** panels, slots and buttons use one shared UI palette of at most 8 colors, with bevels lit from the top-left.

## 5. Checks every art task adds or keeps passing

Automated (unit tests):

- Every pixel of every tile belongs to that tile's declared palette, and no palette exceeds 12 colors.
- Every opaque static tile has a darkest-to-lightest luminance difference of at least 60.
- Every animation loops: the difference between the last and first frames is no larger than 1.5 × the average difference between consecutive frames.

For review (screenshots):

- `artifacts/m01/m01-texture-sheet.png`: every tile shown as a 3×3 repeat at 4× scale with an 8-pixel gap between tiles and no atlas padding visible, in registry order. List the order in the progress notes.
- In the progress notes, one line per tile stating what it depicts and confirming it reads without a label, has no visible seam in its 3×3 repeat, and follows its material note above.
