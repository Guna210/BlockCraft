# BLOCKS-shapes — stairs, fences, doors and trapdoors

Owner-requested task outside SPEC's task list. It fixes M10a's recipe shortfall (106 of the required ≥ 120) with 22 new crafting recipes and the 22 blocks they make.

## Blocks

`{oak,birch,pine,acacia,rainwood}_{stairs,fence,door,trapdoor}` plus `stone_stairs` and `cobblestone_stairs`. Wooden ones: hardness 2, blast 3, axe. `stone_stairs`: 1.5 / 6, pickaxe. `cobblestone_stairs`: 2 / 6, pickaxe. All drop themselves once; a door is one item that places both halves.

New block models `stairs`, `fence`, `door`, `trapdoor` (`BlockModel` in `src/world/blocks/types.ts`).

## Geometry (`src/world/shape-geometry.ts`, pure)

- **Stairs**: `facing` is the direction of ascent (the riser stands on that side), `half` bottom/top. Two boxes: a slab plus a half-block step. **Straight stairs only: no inner or outer corner shapes** (known limitation).
- **Fences**: booleans `north/south/east/west`. Post 6–10/16; each arm is two bars (y 6–9/16 and 12–15/16, width 2/16). Collision is the post plus arms at height 1.5, so a player cannot jump a fence. The physics y-iteration therefore looks one cell down (`MAX_OVERHANG`).
- **Doors**: both halves carry `half`, `facing`, `hinge`, `open`. `facing` is the side where the closed 3/16 leaf sits and the way its front face points; open, the leaf swings to the hinge edge. Hinge right = (fz, -fx), hinge left = (-fz, fx). Placement: facing = opposite of the look direction, hinge from where on the face the player clicked.
- **Trapdoors**: `facing`, `half`, `open`. Closed is a 3/16 slab at the bottom or top; open is a 3/16 leaf against the `facing` side.
- `BlockShapes.boxes[id]` keeps one box (the bounding box for multi-box states) so existing code works; `BlockShapes.parts[id]` holds all boxes and is used by the raycaster and the selection outline.

## Vertex format for boxes (`src/mesh/vertex.ts`)

Box vertices are not on the 1-block grid, so they use a fourth vertex kind: word1 bits 30 and 31 both set, **and** word0's top nibble ≥ 8. Fluid vertices also set both word1 bits but use nibble 4 or 5, and no other vertex has both bits, so the test is unambiguous (`isShapeVertex(word0, word1)`).

- word0: block x/y/z (bits 0–14), normal, ao, sky, blockR, `8 | offset bits 0–2` (28–31).
- word1: tile (10 bits, so tile index < 1024), offset bits 3–14 (bits 10–21), blockG, blockB, flags.
- Offset = `x | y << 5 | z << 10`, each 0..16 sixteenths. The shader derives the UVs from the offset and the normal, so a box shows the matching part of its tile.
- Shape vertices live in the `models` bucket (merged into cutout), and the shader only honours them when `u_isCutout == 1`. The WALL_TORCH shader variant carries the extra code, so sections that contain shapes use it (`hasWallTorch`).

## Meshing (`src/mesh/shapes.ts`)

A face on the block boundary is hidden when its neighbour is a full opaque cube. A face completely covered by another box of the same state is skipped. Boundary faces use the same smooth light and AO as cube faces, bilinearly interpolated per vertex; faces inside the block use the block's own light with AO 0. The model bucket grows on demand (a fence can emit 54 quads), instead of being capped at 6 quads per block.

Door and trapdoor tiles are chosen per state in `buildMeshLookupTables`: the leaf's front face shows `<wood>_door_lower/upper`, mirrored (`_flip`) when the hinge is on the right so the handle sits on the free edge; the back face is mirrored for hinge left; other faces use planks. A trapdoor shows its own tile on its broad faces and planks on the edges.

## Interaction (`src/gameplay/shape-blocks.ts`)

- Right-click on a door or trapdoor opens or closes it (both door halves) instead of placing.
- Stairs: facing from the look direction; `half` top when placed against an underside or on the upper half of a side face.
- Trapdoors: `facing` is the wall side that was clicked; `half` from the click height or an underside.
- Doors need two free cells. Breaking either half removes both and drops one door.
- Fences connect to fences and to full opaque cubes, and neighbours update after every place and break.
- The debug API (`placeShape`, `toggleShape`, `breakShape`) runs the same functions for tests and screenshots.

## Icons

Stairs, fences and trapdoors get an isometric multi-box icon (`renderBoxes` in `src/ui/icons.ts`, same projection and shading as `renderBox`, which still draws cubes and slabs). The fence icon shows east and west arms. Doors use a flat sprite (`<wood>_door_item`).

## State IDs

376 new states are appended to `data/block-state-ids.json` (ids 158–533, after M10b's chest) in registry order. If master gains state IDs first, renumber these after master's last one.
