# M01b Atlas Packer Decisions

## Mip chain vs padding
With 16 px tiles and 4 px padding (24 px cells), only mip levels 0–2 keep whole-pixel tile offsets with at least 1 px of padding:
- Level 0: 16px tile, 4px padding, 24px cell
- Level 1: 8px tile, 2px padding, 12px cell
- Level 2: 4px tile, 1px padding, 6px cell
- Level 3: 2px tile, 0.5px padding (fractional padding)

We chose to stop the mip chain at level 2 (`ATLAS_MAX_MIP = 2`) to maintain whole-pixel offsets and at least 1px of padding.

## Wrapping padding pixels
Because block textures repeat across greedy-meshed faces, padding needs to wrap pixels from the tile's opposite edge (as opposed to clamping to the edge). The padding logic reads from the tile's opposite side to fill the border, handling wrapping consistently across all supported mip levels.
