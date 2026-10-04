# M03e — How ore is counted, and how the stage is calibrated

Status: accepted
Task: M03e

## Context

SPEC Appendix A.4 gives each Overworld ore a target "blocks of ore per 1,000,000 underground blocks
(y 5–100 in the Overworld)". The SPEC does not say what an underground block is, and the ratio depends
on it: ore only replaces stone, so caves and water lower the denominator and the numerator together,
and the share of a column that lies at y 5–100 depends on how high its surface is.

## Definition (used by the stage's calibration, by `tests/unit/ores.test.ts` and by these notes)

An **underground block** is a block that

- lies at y 5 to 100 inclusive, **and**
- lies strictly below its column's surface (`y < top`, where `top` is the highest block of the column
  that is not air, water or lava), **and**
- is not air, water or lava itself.

The **count per 1,000,000** of an ore is `ore blocks among the underground blocks / underground blocks × 10⁶`.
Ore blocks are therefore counted over the same set as the stone, ore, gravel, clay, snow and so on
around them. Foundation Stone (y ≤ 4) is outside the window. Blocks of features (trees, plants) are
not counted, because the sample is generated without the feature stage (ore positions are the same
with it, see below).

### Iron's mountain band

Iron has two bands (y 0–80 everywhere, y 80–256 in mountain biomes). The count uses **every iron
block that is an underground block**, so the part of the mountain band at y 80–100 is counted, and
nothing above y 100 is: the window is the same for every ore. The mountain band is not tuned to the
target and is not special-cased in the test. Its size is small: in the sample, iron at y 80–100 in
mountain columns is 0.5–0.9 % of all iron counted (103 of 12,034 blocks on the standard seed, 58 of
11,014 on the alternative seed), so the 800 target is in effect the target for the base band. The test
also reports the density of the mountain band itself (iron in y 80–255 of mountain columns per
1,000,000 underground blocks there: 575 and 698) and requires it to be between 400 and 1600.

"Mountain biome" means `frost_peaks` or `stony_heights` (the two Appendix C mountain biomes), taken
from the biome of the block's own column. Iron above y 80 never appears in any other biome.

## Sample

The count is taken over **1,024 columns per seed** (a 32 × 32 grid, one column in every 4 × 4 chunks,
covering the 2048 × 2048 block window around the origin), about 14.2 million underground blocks per
seed. Columns are generated independently of one another, so a grid of far-apart columns is a fair
sample of the window. Alternatives rejected: one contiguous 24 × 24 block of chunks gave gold 88 and
135 per 1,000,000 on the two seeds (+50 % on the second), because the mix of ocean floor, plains and
mountain differs between neighbourhoods and the denominator depends on that mix. The grid over the
whole window gave 130 and 120 with the first rates, much closer to each other.

Expected statistical error: the rarest ore is gold, about 1,100–1,400 blocks per seed in
vein-sized clusters of about 4.5 blocks, so roughly 250–300 independent veins. The test estimates the
relative standard error from the spread of 16 sub-areas (8 × 8 sampled columns each) and requires
gold's to be below 10 %; the measured values are 5.0 % and 7.2 %, well inside the ±25 % tolerance.

## Calibration

Every ore has `perColumn` vein origins per origin column per band (the integer part always, plus one
more with the probability of the fraction), with triangular heights (zero at the band's minimum and
maximum, highest at its peak). The values were fitted once on both seeds with the definition above:

| Ore | shape | band (min, peak, max) | `perColumn` |
| --- | --- | --- | --- |
| Coal | blob | 0, 96, 192 | 3.4 |
| Copper | streak | 0, 48, 112 | 0.54 |
| Iron | lumps | 0, 16, 80 and, in mountains, 80, 120, 256 | 0.53 and 1.0 |
| Gold | cluster | 0, 16, 32 | 0.36 |
| Lumite | crystal | 0, 20, 40 | 0.118 |

Appendix A.4 gives no peak for iron's mountain band; 120 was chosen so that the density rises from
zero at y 80 and falls to zero at y 256, and its rate was set so that the band's density in mountain
columns is of the order of the base band's.

## Lumite's exposed-to-air bonus

Each lumite vein is a crystal: a core (a centre block and two to four short arms) plus a **halo**, the
blocks next to the core. Core cells always become ore (if they are stone below the surface); a halo
cell becomes ore only when one of its six neighbours **inside the same column** is air. A vein
therefore grows an extra skin where it touches a cave and stays small inside solid rock. The bonus
is counted in the lumite target (the 0.118 above is the total, not the base rate).

Result: 22.3 % and 22.7 % of lumite blocks touch air, against 7–8 % for coal, copper and iron and
4–5 % for gold (lumite's share is 2.9–3.5 times that of coal, copper and iron and 4.9–5.9 times gold's). The test requires lumite's share to be more than twice every other ore's.

Limit: a halo cell on the edge of its column cannot look into the next column without reading
another column's blocks, which would make the result depend on generation order, so those
neighbours are not examined. Lumite on a chunk border is a little less likely to get its halo; the
decision for each block still depends only on the world seed and on its own column, so seamlessness
is unaffected. The same in-column rule is used when the test counts "touches air", so the shares
above are slightly below the true ones.

## Why the stage is seamless and independent of order

- A vein's origin and its shape are a pure function of the world seed, the ore, the band, the origin
  column and the attempt number (positional hashes, no stateful random generator).
- No vein reaches more than `VEIN_MAX_REACH` = 12 blocks from its origin, so a column evaluates the
  3 × 3 origin columns around itself and writes the cells that fall inside its own area.
- Where two veins overlap, the first one in the fixed order (ore list, band, origin column by z then x,
  attempt) wins in every column, because every column visits veins in the same relative order.
- A cell turns into ore only from information in its own column (stone, below the surface, height,
  the column's biome, air next to it), never from a neighbouring column.
- The stage replaces only stone below the surface, so the feature stage (which places only into air
  above the surface or in caves) and the `probeGround` prediction it relies on are unaffected: the
  full `features.test.ts` passes with the numbers unchanged (55,557 feature blocks, 138 beside water,
  0 problems).

## Consequences

- `worldHash(0,0,64,64)` for the standard seed changes from `07af0f36` to `dda64d20`. No test pins a
  hash value.
- The reference pipeline of `tests/unit/helpers/shared-areas.ts` (`noFeatures`) now includes the ore
  stage, so that it stays equal to every stage before the features; see `progress/M03e.md`.
- Any change to the rates, shapes or the definition above should re-run `tests/unit/ores.test.ts`,
  which prints the per-seed numbers.
