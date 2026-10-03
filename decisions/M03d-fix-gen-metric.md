# M03d-fix — What `genMsP95` measures

Status: accepted
Task: M03d-fix (owner-sanctioned fix, not in SPEC.md Appendix E)

## Context

SPEC §2.3 budgets "Chunk generation + meshing (worker) per 16³ section, p95 ≤ 6 ms". Before this
task, `GenWorkerPool.genMsP95` reported the p95 of `perSectionMs`, where the worker computed
`perSectionMs = (time spent inside pipeline.generateColumn) / (number of allocated sections)` and
stopped the clock **before** it packaged the column for transfer. Earlier notes (M03b: "~0.15–0.28
ms", M03d: "0.20–0.22 ms") reported this value as comfortably inside the budget.

## Definition (what the number is, exactly)

`getWorkerStats().genMsP95` is the **nearest-rank 95th percentile, over 16³ sections, of the
worker wall-clock time spent generating each section's column, over the last 100 generated
columns.** In detail:

1. **Time.** For each gen job the worker reads `performance.now()` when the message arrives and again
   immediately before `postMessage`. Everything in between is counted: every pipeline stage (terrain
   shape, biome surface, caves, and any later stage), extracting every section, and building the
   biome and tint buffers. Nothing is excluded or discarded: first-use costs (noise sampler
   construction, JIT warm-up on a cold worker) are part of the samples.
2. **Sections.** A column's cost is divided by the number of 16³ sections that exist in the column
   (uniform or not, because every one of them is shipped to the main thread). A column with `n`
   sections is `n` samples of `columnMs / n`, so the percentile is taken over sections, not over
   columns. This is the unit SPEC §2.3 uses. Tall columns therefore weigh more than short ones,
   and a slow short column cannot be diluted by a tall one: its per-section cost is high, and it
   has few sections to hide behind only in proportion to its real size.
3. **Window.** The last 100 columns. A radius-4 world has 81 columns, so `createWorld` followed by
   `waitForTerrain(4)` keeps every column, including each worker's first (cold) one.
4. **Also exposed.** `GenWorkerPool.genColumnMsP95` (unweighted p95 of whole-column milliseconds)
   and, per job, `GenResult.columnMs` / `sectionCount`, so the raw numbers can always be recomputed.
   `getWorkerStats()` still returns exactly `{ genMsP95, meshMsP95, queueLength }`.

The implementation lives in `src/workers/gen-stats.ts` (`sectionPercentile`, `columnPercentile`),
`src/workers/gen.worker.ts` and `src/workers/gen-worker-pool.ts`; the definition is tested in
`tests/unit/gen-stats.test.ts`.

## What it does not contain, and where that cost is reported instead

- **Queue wait**: `getWorkerStats().queueLength`. A job's wait is not generation work.
- **Result transfer**: section buffers are transferred, not copied. The main-thread step that applies
  them (`loadBlockStatesFrom`) is main-thread work, not worker time.
- **Lighting**: a separate job on the light pool, bulk per region (~0.2 s for a radius-4 world,
  measured as the light phase in `createWorld`).
- **Meshing**: `meshMsP95`. It is the time inside `greedyMesh` only. The main-thread extraction of
  the padded 18³ copy before each mesh job is not in it; measured in Node it is 0.087 ms mean,
  0.099 ms p95 per section (636 sections, standard seed, radius 4), so it hides about 0.1 ms.

## Relation to the SPEC budget

SPEC §2.3 budgets generation **plus** meshing together. The debug API reports them separately, so
neither `genMsP95 ≤ 6` nor `meshMsP95 ≤ 6` alone proves the combined budget. Because the p95 of a
sum is at most the sum of the p95s, `genMsP95 + meshMsP95` is an upper bound for the combined p95
and is the figure to compare against 6 ms when the combined statement matters. With the
measurements below (mesh ≈ 0.4–0.6 ms) the combined bound is `genMsP95 + 0.6 ms` at most.

## What the old definition hid

- It stopped the clock before packaging. Packaging costs roughly 0.2 ms per column when a single
  worker runs and 0.6 ms with three workers running at once (a throwaway per-stage instrumentation,
  not kept in the repository).
- It was not wrong in kind about the denominator: dividing by allocated sections is the SPEC unit.
  What changed is that the percentile is now taken over sections rather than over columns, and the
  window, content and exclusions are written down.

## The earlier 0.20–0.22 ms claims are wrong

They cannot be reproduced and could not have been right on this hardware. At the M03d merge commit
(`6da73ff`, `worldHash(0,0,64,64)` = `c529d1af`, the hash the M03d notes record), built and run in
this session's VM with the same flags as the test suite, `getWorkerStats().genMsP95` read **13.86 ms**
and **11.64 ms** (two fresh runs, radius 4, standard seed). The Node numbers below point the same way:
on master a column takes 20.8–21.9 ms and a column has about 7–8 sections, which is about 2.7–2.8 ms per
section with nothing else running. I do not know how the earlier figures were obtained; they should not
be cited. The M03b estimate "~0.15–0.28 ms" fails the same check.

## Measurements (this VM, 4 vCPU, `hardwareConcurrency` 4, Chromium with the suite's SwiftShader flags)

Browser, fresh page per run, `createWorld` default type, standard seed `blockcraft-test-seed-42`,
radius 4, then `waitForTerrain(4)`:

| | master `genMsP95` (ms) | this branch `genMsP95` (ms) |
| --- | --- | --- |
| script 1, three fresh runs | 9.12, 10.07, 9.07 | 6.33, 8.56, 7.66 |
| script 2, three fresh runs, cold first world | 10.60, 8.34, 11.01 | 11.19, 10.60, 10.01 |
| script 2, second world in the same page (workers warm) | 6.78, 7.46, 6.24 | 5.02, 3.09, 4.86 |

`meshMsP95` is 0.4–0.7 ms in every run, before and after.

The cold p95 did not move reliably. See `progress/M03d-fix.md` for why: with 81 columns, the first
one or two columns of each of three cold workers (85–128 ms each against about 10 ms warm) are about
7 % of the samples, so the p95 sits inside the JIT warm-up tail and is insensitive to the steady-state
cost. The per-section statistic over warm workers fell by roughly a third.

Node, per column (81 columns, radius 4, standard seed, the second of two passes so code is warm;
mean / p95 in ms, three runs each):

| stage | master | this branch |
| --- | --- | --- |
| terrain_shape | 5.46 / 6.08, 5.74 / 6.27, 5.43 / 5.99 | 5.54 / 6.19, 5.40 / 5.96, 5.52 / 6.48 |
| biome_surface | 3.53 / 5.02, 3.64 / 5.22, 3.46 / 4.89 | 3.54 / 5.15, 3.52 / 4.99, 3.59 / 5.09 |
| caves | 11.85 / 15.13, 12.53 / 15.95, 11.90 / 15.11 | 2.20 / 2.60, 2.20 / 2.55, 2.25 / 2.78 |
| whole column | 20.83 / 24.58, 21.91 / 25.44, 20.79 / 24.20 | 11.28 / 12.51, 11.12 / 12.63, 11.35 / 12.39 |

## Consequences

- Notes and PR descriptions must quote `genMsP95` together with the conditions (cold or warm
  workers, pool size, world radius) and must not describe it as a steady-state cost without saying
  so.
- Anything that wants a steady-state figure should generate more columns than the 100-column window
  holds before reading it, or read `genColumnMsP95` and `columnMs` directly.
