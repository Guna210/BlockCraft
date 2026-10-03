# M03c-fix2 — Neighbour heights for the surface cliff check

## Problem

`src/gen/surface.ts` decides whether a column is a cliff (stone stays exposed) by comparing its top
block with the four orthogonal neighbours. For a cell on the edge of its column it read the
neighbour with `(x + dx + 16) % 16`, which wraps to the opposite edge of the same column. The two
edges of a flat column differ whenever the terrain tilts, so 45–50 % of border cells on flat land
came out stone-topped.

## What the owner's prompt proposed

A padded 18×18 height grid whose ring comes from the terrain-shape height function, "the way
`caves.ts` pads its input". `caves.ts` uses `sampleTerrainClimate(...).surfaceHeight` for its ring.

## Why that is not enough

`surfaceHeight` is only the 2D target height. `generateTerrainShape` adds 3D density noise with an
amplitude of 3–22 blocks, so the real top block of a column differs from the target by up to ±16.
Measured over 7336 columns of the standard seed with target heights 66–100: `real top − (ceil(target) − 1)`
ranged from −16 to +15, with fewer than 5 % of columns at 0. A surface stage built on that ring still
left 34.44 % (standard seed) and 38.97 % (`probe-seed-gamma`) of flat border cells stone-topped.

## Options considered

1. **Generate the eight neighbouring columns with `terrainShapeStage` inside the surface stage.**
   Exact and independent of `terrain.ts` internals, but the shape stage costs about 6.5 ms per
   column here, so every column would cost about nine times as much to generate.
2. **Use only in-column neighbours (clamp at the edge).** Cheap, but a real cliff that happens to
   sit on a chunk border loses its stone face on both sides, which is the same kind of border
   artefact in a rarer form.
3. **Add an exported "top height" function to `src/gen/terrain.ts`.** The cleanest answer, but the
   task forbids touching `terrain.ts` while another fix task edits it.
4. **Repeat the density rule for one column in a new file (chosen).** `src/gen/terrain-height.ts`
   exports `sampleTerrainTopY(terrainStageSeed, wx, wz)`. It reuses the exported
   `sampleTerrainClimate` for the 2D inputs and repeats the three private pieces it needs: the two
   splines, the river distance rule and the density loop. The ring of the 18×18 grid costs about
   68 cells × 1 density scan per column; the surface stage went from 3.12 to 3.75 ms per column
   (mean of eight runs of 64 columns, measured in-process on master and on this branch).

## Risk and the guard against it

Option 4 duplicates logic that lives in `terrain.ts`. If a later task changes the density rule, the
copy drifts and the seam returns silently. `tests/unit/surface-seam.test.ts` therefore contains a test that
compares `sampleTerrainTopY` with the real top block of generated columns for more than 1000 sampled
cells over both seeds, and requires exact equality. It fails as soon as the two disagree.

## Follow-up for the owner

Once the concurrent `terrain.ts` fix has landed, replace `terrain-height.ts` by an export from
`terrain.ts` that shares the density code with `generateTerrainShape`. The guard test can stay as it is.
