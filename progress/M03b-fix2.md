# M03b-fix2 — e2e headroom for tests/e2e/m03.spec.ts

Status: verified
Depends on: M03b

## Summary

Reduced redundant worker pool generation cycles in `tests/e2e/m03.spec.ts` from 9 cycles (3 runs each across worker counts 1, 2, 4) to 4 cycles (2 runs for worker count 1, 1 run each for worker counts 2 and 4). This change is an owner-approved change to an existing test.

## Per-test execution times (raw)

- **Before change (9 cycles)**:
  - Test 1 (`worldHash of region...`): 2.9m (~174s, or timed out at 180s)
  - Test 2 (`default world spawns...`): 48.9s
- **After change (4 cycles)**:
  - Test 1 (`worldHash of region...`): 1.0m (~60s)
  - Test 2 (`default world spawns...`): 47.4s

**Speedup**: Test 1 runtime reduced by ~65.5% (from ~174s to ~60s), exceeding the required 50% speedup.

*Note: Local VM execution speed differs from GitHub Actions CI runners.*

## Cycle counts

- Previous cycles: 9 (3 runs × 3 worker counts [1, 2, 4])
- New cycles: 4 (2 runs × worker count 1 + 1 run × worker count 2 + 1 run × worker count 4)

## Assertions maintained

- Kept main-thread baseline hash evaluation over region (0,0)-(64,64).
- Kept zero main-thread generation assertion (`mainGenCount === 0`) for every worker run.
- Kept equality check comparing every worker run's hash to main-thread baseline hash.
- Kept hash equality assertion for repeat runs.
