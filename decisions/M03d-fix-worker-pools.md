# M03d-fix — Worker pool count and contention

Status: accepted (pools left as they are; revisit in M04a)
Task: M03d-fix

## Context

`WorldManager` creates three pools, each sized `max(2, navigator.hardwareConcurrency − 1)`: gen
(`GenWorkerPool`), mesh (`WorkerPool`) and light (`LightWorkerPool`). On a 4-core machine that is 9
workers. SPEC §3.2 describes one pool of that size for generation, meshing and bulk light. The
question for this task was whether the extra workers inflate `genMsP95` enough to justify folding
them into one shared pool.

## Measurements (this VM: 4 vCPU, `hardwareConcurrency` 4, Chromium with the suite's flags)

All numbers are the pool's own `genMsP95` for a batch of 100 gen jobs (columns cx 20–29, cz 0–9 of the
standard seed) queued after a normal radius-4 `createWorld`, so the workers are warm.

**1. Do idle extra workers cost anything?** (master code, old metric, 3 workers per pool)
Alternating fresh pages: A = all 9 workers alive and idle, B = mesh and light pools terminated so only
the 3 gen workers exist. Per-section p95, ms:

- A (9 workers): 10.84, 10.51, 10.26, 10.16, 10.84, 10.58 (mean 10.53)
- B (3 workers): 10.87, 11.26, 12.30, 11.28, 11.28, 13.09 (mean 11.68)

Removing the idle workers did not lower the figure (B is, if anything, higher: noise). Idle workers
use no CPU.

**2. Worst case: all three pools saturated at the same time.** Besides the gen batch, the light pool
ran back-to-back radius-4 region jobs (3 in flight) and the mesh pool ran back-to-back mesh jobs
(3 in flight), 9 busy workers on 4 cores.

| code | idle other pools (ms) | other pools saturated (ms) | difference |
| --- | --- | --- | --- |
| master, old metric | 9.94, 6.61, 6.97, 5.89, 5.80 (mean 7.04; warm reps only 6.32) | 9.26, 7.49, 6.70, 8.84, 7.60 (mean 7.98) | +0.9 ms (+13 %); +1.7 ms (+26 %) over the warm reps |
| this branch, new metric | 4.67, 3.97, 4.14, 4.81 (mean 4.40) | 5.22, 4.27, 4.29, 5.10 (mean 4.72) | +0.32 ms (+7 %) |

Wall time of the 100-column batch: master 11.5–12.2 s idle vs 14.7–15.8 s saturated; this branch
11.0–11.5 s vs 13.7–14.1 s. Those walls are dominated by main-thread round trips under SwiftShader, not
generation (see `progress/M03d-fix.md`).

**3. What actually inflates the per-section number: concurrent *gen* workers during cold start, not
the extra pools.** On a fresh page with an empty scene, 81 columns through the real pool (this branch):

| gen workers | batch wall (ms) | column mean (ms) | `genMsP95` (ms) |
| --- | --- | --- | --- |
| 1 | 911 | 10.9 | 2.14 |
| 2 | 731 | 16.9 | 4.00 |
| 3 | 837 | 29.3 | 9.34 |
| 4 | 837 | 38.3 | 16.96 |

The same worker, same code: with three workers the first columns take 85–128 ms each against about
10 ms once warm. Every stage inflates alike (terrain 5.3→13.5 ms, surface 3.1→7.8 ms, caves 2.1→6.6 ms
in a throwaway instrumented build), which points at JIT warm-up competing for the same cores rather
than at one stage. In steady state it disappears: three workers generating for 8 s produced 1872
columns at a mean 11.3 ms per column, the same as one worker (10.9 ms).

## Decision

Do not restructure the pools in this task.

- In every flow that exists today `createWorld` runs the phases one after another (gen, then one light
  job, then mesh), so the three pools are never busy together. Folding 9 workers into 3 does not change
  how many gen workers are busy, which is what the measurements show matters.
- With the cave fix, even full saturation of the other two pools costs 0.32 ms (+7 %) on `genMsP95`.
  Before the fix it cost 1.7 ms. That is not material against a 6 ms budget.
- A shared pool is a real refactor (a combined worker script, three facades, pool-size semantics for the
  `setWorkerPoolSize` debug call) with no measured benefit now, and `world-manager.ts` was to be touched
  for worker-pool construction only if this item needed it. It did not.

M04a will overlap generation, lighting and meshing while the player moves. That is the point where
SPEC §3.2's single pool of `max(2, hardwareConcurrency − 1)` workers matters, and M04a should make
that change then and re-measure with the same method (alternating fresh pages, idle vs saturated, 100
columns).
