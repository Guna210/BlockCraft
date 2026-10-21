# M19a — Structure engines

## Placement grid

- Placement definitions live in data/structures/placement.json. M19a adds only the wayfarer_hamlet definition: spacing 34 chunks, separation 16 chunks, salt wayfarer_hamlet, and the existing plains, savanna, and meadow biomes.
- Each region chooses independent integer X/Z offsets from [0, spacing - separation), using deriveSeed(worldSeed, salt) and the region coordinates. Candidate biome checks sample the center block of the candidate chunk with sampleBiome.
- createPlacementGrid(worldSeed) returns candidateAtRegion, within, and locateNearest; the nearest query uses horizontal block distance and accepts either an (x,z) or (x,y,z) position.

## Jigsaw assembly

- Templates store a palette, local block positions with palette indices, and connectors. A pool entry is sampled by positive weight; entries are considered in a seeded weighted order if an attachment cannot fit.
- A connector's target must match and its transformed facing must oppose the parent connector. Connector block positions are placed one cell apart along the parent facing.
- Assembly expands breadth-first. The root is depth 0, maxDepth limits the attachment depth, and maxPieces includes the root. All pieces use one of four Y-axis rotations.
- Piece bounds are half-open. Intersecting volumes are rejected, while pieces that touch at a face or edge are allowed.

## Terrain adaptation and pipeline

- Adaptation samples sampleTerrainTopY(deriveSeed(worldSeed, 'terrain_shape'), x, z) and never reads a generated column. On dry ground it fills every footprint column from terrain to the piece base with the foundation block.
- When terrain is below sea level, stilts use footprint support columns no more than three blocks apart, including the footprint edges, and continue down to the seabed. The selected stilt block defaults to the foundation block.
- The structures stage follows features. It searches candidate starts within a radius derived conservatively from the registered templates and depth limit, caches assembled block output per pipeline instance by world seed and start key (bounded to 256 recent starts), and writes cells only into the current column.
- M19a registers no structure templates. Therefore the default stage does not allocate blocks or change any generated column. Later work can supply complete registrations to createDefaultPipeline.

## Chest loot and affixes

- Chest tables use data/loot/chests/*.json and a separate loader. The existing block-drop loader's direct-child glob remains unchanged and does not include the chests/ directory.
- rolls and count ranges are inclusive. Each roll selects an entry with replacement by weight. durability: [minFrac, maxFrac] means the fraction of maximum durability remaining; the stored stack damage is round(maxDurability * (1 - remainingFraction)).
- affixChance is rolled per stack. A successful roll selects Keen, Sturdy, or Swift uniformly. The roll seed includes the world seed, table id, chest coordinates, and loot index.
- Affixes are optional ItemStack.affix values and retain the existing inventory save format version 1. Keen adds 1 attack damage, Swift multiplies mining speed by 1.2, and Sturdy multiplies maximum durability by 1.5 rounded to the nearest whole use.
- Affixed stacks remain distinct during inventory and container merges. Tool queries accept either an item id or a stack, so callers can apply the affix modifier without changing item definitions. Tooltips prefix the base item name with the affix.
- Unit tests define their loot tables inline; only the usable Wayfarer Hamlet table is stored under data/.
