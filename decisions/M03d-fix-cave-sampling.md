# M03d-fix — Cave sampling, deterministic worms, bedrock floor

Status: accepted
Task: M03d-fix

## Why

The caves stage took 11.85–12.53 ms of a 20.8–21.9 ms column (Node, warm). It evaluated cheese,
spaghetti and aquifer noise for every block of a padded 22×22×128 grid, per column, so 484 columns of
the grid were evaluated for the 256 the column owns.

## Sampling model

Cheese, the two spaghetti fields and the aquifer-zone field are smooth, so they are sampled on a
lattice anchored to **world coordinates** and trilinearly interpolated per block:

| field | x/z spacing | y spacing |
| --- | --- | --- |
| cheese | 4 | 4 |
| spaghetti n1, n2 | 4 | 2 |
| aquifer zone | 4 | 4 |

Lattice level `k` is at `y = 4 + k · spacing`. Because the lattice never depends on which column is
being generated, a block gets the same value from every column that evaluates it, so generation stays
seamless and order-independent (`tests/unit/caves-lattice.test.ts` generates 7×7 columns forward,
reversed and shuffled for two seeds and requires identical blocks; existing `caves.test.ts` "c" also
passes unchanged).

Work is skipped only where the interpolant provably cannot reach the threshold, since a trilinear
value is a convex combination of the cell's corner values:

- a cheese cell is skipped when its largest corner is ≤ 0.42;
- a spaghetti cell is skipped when all n1 corners are beyond ±0.038, or all n2 corners are beyond
  ±√0.0014 on the same side of zero; n2 is only evaluated for cells n1 passes through;
- per column, blocks are skipped when both plane blends (cell lower and upper level) are outside the
  threshold.

Only levels up to the highest carvable block in a cell are sampled, so shallow columns sample fewer
levels. Worm carvers no longer test every block against a per-y bucket of segments: each segment stamps
its own sphere into the grid (capacity is `25 worms × 60 steps`, so no segment is ever dropped; the old
code silently dropped segments beyond 480 per column and beyond 32 per y).

### Accuracy of interpolation (measured, 64×64×86 blocks, standard seed)

| field | spacing (xz, y) | carved blocks (exact) | carved blocks (lattice) | overlap / recall |
| --- | --- | --- | --- | --- |
| spaghetti | 4, 2 (used) | 2087 | 2092 | 0.877 |
| spaghetti | 2, 2 | 2087 | 2083 | 0.954 |
| spaghetti | 4, 4 | 2087 | 2074 | 0.807 |
| cheese | 4, 4 (used) | 50343 | 48506 | 0.962 recall, 0.998 precision |

Spaghetti is 0.59 % of blocks and cheese 14.3 %. Tubes keep their volume and continuity but move by up
to about a block; cheese caverns lose about 3.6 % of their volume at the edges. This was acceptable: the
statistical criteria have wide margins and results are in the same range (below).

### Result

Whole column (Node, warm): 20.8–21.9 ms → 11.1–11.4 ms. Caves: 11.85–12.53 ms → 2.20–2.25 ms mean
(p95 2.55–2.78 ms). Remaining caves cost per column (ms, instrumented): surface scan and border
climate sampling 0.52, lattice noise 0.53, spaghetti cells 0.44, apply 0.28, per-column setup 0.21,
cheese 0.07, worms 0.11, aquifer and support 0.15.

The existing `caves.test.ts` passes unchanged. Cave air y 10–60: standard 16.14 % (was 16.23 % in the
M03d notes), alt 17.10 % (was 14.12 %); largest connected component 136,223 and 69,282 blocks
(was 133,041 and 27,497).

## Deterministic trig

`src/gen/detmath.ts` provides `detSin` / `detCos`, using only `+`, `-`, `*` and `Math.floor`, which
ECMAScript defines exactly, so every engine returns identical doubles (a Taylor polynomial on
[−π/2, π/2] after exact range reduction; error below 1e-9). The worm carver uses them instead of
`Math.sin` / `Math.cos`. `tests/unit/detmath.test.ts` pins bit-exact outputs, bounds the error against
`Math.sin` / `Math.cos`, and scans `caves.ts` and `detmath.ts` for any implementation-approximated math
function (code only, comments stripped). A search of `src/gen`, `src/engine` and `src/world` found no
other `Math.sin`, `cos`, `pow`, `exp` or `log`; the only other math calls are `Math.sqrt`, which is
exactly rounded, and `Math.floor` / `Math.min` / `Math.max`.

## Bedrock floor (floating blocks)

The bottom of the cave volume used a per-block random dropout at y 5–9: a carved cell survived with
probability `(y − 4) / 6`, decided independently per block. That leaves single stone blocks inside open
cave space. On master, over 64×64 columns, 76 blocks (standard seed) and 2 (alt seed) in y 0–20 had
all six neighbours air or fluid, at y 7–9.

The fix is at the source: the dropout is replaced by a smooth per-column floor. Each column's lowest
carvable y is 5 + ⌊5·v⌋ (so 5–9), where `v` is value noise in [0, 1) on a world-aligned lattice of
spacing 4 with smoothstep interpolation (`caveFloorY`). Rock below the floor is solid and sits on the
Foundation Stone floor (y ≤ 4), so a block under the floor always has solid rock beneath it and cannot
be isolated, and the cave bottom is a continuous noisy heightfield. The new
`tests/unit/caves-floating.test.ts` (both seeds, 62×62 interior of 64×64 columns, y 0–20) failed on
master with 76 and 2, and passes with 0 and 0. The full-height criterion belongs to M03f and is not
tested here.

## Consequences

- Cave geometry changed slightly, so `worldHash` changed. No test pins a hash value (`grep` of
  `tests/` and `src/` found none), so no pin was edited. Old → new for `worldHash(0,0,64,64)`: standard
  seed `e6927151` → `25e0710b`; `blockcraft-alt-seed-7` `722b584e` → `85c93103`. (`c529d1af` in the
  M03d notes was the hash at M03d; later fix tasks had already moved master to `e6927151`.)
- Lattice-scratch arrays are module-level and reused between columns. Any later change must keep every
  lattice read inside the levels evaluated for that column (`*_POINT_LEVELS`); `caves-lattice.test.ts`
  catches the common mistakes (it fails if the grid is not cleared or a level is dropped).
