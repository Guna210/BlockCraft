# M03f — Cross models, the model bucket and leaf tint

Status: accepted
Task: M03f

## Cross models

Tall grass, the eight flowers, brown and red mushrooms and sugar reeds are `"model": "cross"` blocks
(`BlockDefinition.model`, optional, default `"cube"`). `src/mesh/models.ts` emits two quads along the two
diagonals of the block, corner to corner. Every corner is a block corner, so positions are integers and the
vertex format of `decisions/M02b-vertex-format.md` is unchanged. Both quads carry normal index +Y (plants
are lit like a top face from both sides). Both windings are emitted for each quad (eight triangles per
block), so the plants are visible from both sides without any change to GL culling state.

Cacti, pumpkins, logs and leaves stay cubes.

## A separate `models` bucket in `SectionMeshData`

Cross quads are not face quads: they do not merge, and they must not take part in face culling or in the
quad-area bookkeeping that the existing mesher tests check. `greedyMesh` therefore returns them in a fourth
bucket, `models`, and `chunk-renderer.ts` concatenates it into the cutout bucket (`mergeMeshBuckets`) at
upload time, so a section still has one cutout draw call. A cross block emits no cube faces (`shouldCullFace` returns true when the block itself is a model), and it is not
an opaque cube, so it never hides the faces of its neighbours.

## Tint indices

- `tall_grass`: tint index 1 (grass tint), like `grass_top`. The tile is a neutral ramp.
- Flowers, mushrooms and reeds: no tint (tint index 0). Their colours are part of what they depict.
- `rainwood_leaves` and `acacia_leaves`: tint index 2 (foliage tint), like `oak_leaves`. **Decision:** the
  neutral grey leaf tiles are multiplied by the biome's foliage tint, so each biome tints them (rainforest
  rainwood is deep green, savanna acacia is yellow-green) and the foliage-tint continuity guarantee of M03c
  holds for them too. The alternative, baking a fixed colour as birch and pine do, would have made
  rainforest and savanna trees an identical green. Consequence: in the texture sheet and any grayscale view
  the two leaf tiles appear grey; this is the same as `oak_leaves`.
- The tint maps are per column and indexed by x/z, so a cross model's tint texel is the plant's own x/z
  cell. `tintTexelForFace` with the +Y normal returns that cell for every interior point of both diagonal
  quads; `tests/unit/tint.test.ts` checks this with real mesher vertices at x/z 0 and 15 of a section,
  in positive and negative columns.

## Registry fields

`BlockDefinition` gained optional `model`, `tool` and `minTier` fields. Only the new blocks set `tool` /
`minTier` (SPEC A.3); existing blocks are unchanged.
