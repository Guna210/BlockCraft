# M03f — Floating single blocks are removed at their source

Status: accepted (owner decision, option 2)
Task: M03f (touches M03b's `src/gen/terrain.ts` and M03d's `src/gen/caves.ts` on the owner's instruction)

## Context

The M03f criterion "no floating single terrain blocks" is tested over the full height of a column (test 8a
in `tests/unit/features.test.ts`): a solid terrain voxel whose six neighbours are all air, water or lava is
a failure. On the unmodified pipeline (terrain shape, biome surface, caves) a probe over 800 columns per
seed (4 areas: oakwood forest, desert, mountain, cave-heavy; 10 × 10 columns each) found such voxels
before any M03f stage ran: a few from `terrain_shape` on the alternative seed (3 voxels) and many from
`caves` (39 in 384 columns). I stopped and reported this. The owner lifted the do-not-touch rule for
`src/gen/caves.ts` and `src/gen/terrain.ts` for this purpose only, and allowed
`src/gen/terrain-height.ts` to change if its drift guard needed it.

## The rule

After a stage has decided which voxels are solid and which are open, a solid voxel whose six neighbours
are all open (air, water or lava) becomes open too. One pass is exact: an isolated voxel has no solid
neighbour, so removing it cannot make another voxel isolated. What it becomes:

- `terrain_shape`: water at `y <= SEA_LEVEL`, otherwise air (the stage already turns every open voxel at or
  below sea level into water).
- `caves`: lava if `y < 12` and a neighbour is lava, otherwise water or air, whichever breaks fewer cave
  rules (no water beside air, no air under water) — `pickReplacement`.

## Why the result does not depend on chunk borders, order or worker count

The decision reads only data that both sides of a chunk border compute identically.

**terrain_shape.** `terrainSolidAt(terrainStageSeed, wx, y, wz)` (new, exported) repeats the density rule of
the fill loop exactly, including its Float32 roundings. Inside the column the rule reads the stage's own
solid flags; across a border it calls `terrainSolidAt` for the neighbouring column's voxel.
`tests/unit/isolated-blocks.test.ts` guards `terrainSolidAt` against drift from the fill loop.

**caves.** The cave stage already reads a padded grid, but that grid estimates the neighbouring columns'
surface from the climate height, and each column sees a different set of worms (a 5 × 5 chunk neighbourhood
centred on itself), so reading the padded grid across a border can disagree with what the neighbour decides.
The rule therefore:

1. decides interior voxels (x, z in 1..14) from the column itself;
2. for border voxels, classifies each cross-border neighbour from the noise formulas only
   (`classifyRingNeighbour`: surely open, surely solid, or unsure). "Surely open" needs a carve that no worm
   set can undo, "surely solid" needs a voxel no noise can carve (below the cave floor, above the surface
   plus a climate-derived bound, or outside every noise band);
3. for the unsure cases, generates the neighbouring column (terrain, surface, caves without the rule) and
   reads the exact voxel — `generateNeighbourBeforeRule`.

`generateCavesReference` does step 3 for every border voxel; `tests/unit/isolated-blocks.test.ts` asserts that
the classified stage equals the reference on both seeds (1000 columns each in my runs: 0 differences).
Neighbour generation was needed for about 2.5 % (standard seed) and 2.1 % (alt seed) of columns; the
reference path needs it for 6–7 %.

`src/gen/terrain-height.ts` (`sampleTerrainTopY`) now skips an isolated top voxel and continues downwards,
using `terrainSolidAt` for the horizontal neighbours, so the height prediction used by the spawn and by
`probeGround` still equals the generated column.

## Cost

Cave stage, Node, 81 columns around four centres, second pass (warm), three runs each, p95 per column (ms),
before (master `ffb37f5`) → after:

| centre | before | after |
| --- | --- | --- |
| origin | 2.33 / 2.66 / 2.34 | 2.86 / 2.98 / 2.59 |
| oakwood | 2.02 / 2.27 / 1.88 | 2.69 / 2.74 / 3.06 |
| rainforest | 1.65 / 2.06 / 1.62 | 2.64 / 2.60 / 2.03 |
| pine taiga | 2.18 / 2.24 / 2.23 | 3.02 / 2.75 / 2.75 |

The p95 grows by 0.25–1.18 ms (mean of the twelve pairs +0.60 ms); one pair, oakwood run 3, is above the
1 ms limit, where the baseline p95 (1.88) was also its lowest. The means grow by 0.2–0.9 ms. With the rule
switched off the whole-world hash is unchanged from master (`25e0710b`), so the carving itself is
bit-identical; only the rule changes voxels.

## Effects on existing hashes

`worldHash(0,0,64,64)` for the standard seed: master `25e0710b`; this branch (rule, features, new blocks)
`07af0f36`.

## Evidence

- `tests/unit/features.test.ts` 8a (unchanged from the task text): 0 floating blocks in 800 columns per seed
  (standard and alt). With the rule switched off in both stages (temporary edit, not committed) 8a fails with
  38 (standard) and 62 (alt) floating stone blocks; with only the cave rule switched off
  `tests/unit/isolated-blocks.test.ts` finds 39 in 384 columns.
- Probe, per stage, floating blocks (any non-open voxel with six open neighbours), 4 areas × 10 × 10 columns
  per seed: `terrain_shape` 0 / 0, `biome_surface` 0 / 0, `caves` 0 / 0 (standard / alt). After the
  `features` stage the probe counts isolated *leaf* voxels at crown edges (6 and 18); leaves are not terrain
  blocks and test 8a does not count them.
- Existing tests (caves, caves-floating, caves-lattice, detmath, surface-seam, seed-origin, spawn,
  terrain proportion/agreement/overhang, biomes 9a–9f) pass unchanged.

## Alternatives rejected

- Filtering floating blocks in the feature stage: that stage would then change terrain, and it would run
  after the caves stage's own water/air decisions that depend on the removed voxel.
- Reading the padded grid across the border: not identical on the two sides (see above).
