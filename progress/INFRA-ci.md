# INFRA-ci — shard the Playwright suite across 4 CI jobs

Status: verified
Depends on: none (owner-requested infrastructure task)
Full verify (this session): typecheck ✓ · lint ✓ · placeholders ✓ · unit 748 passed (94 files) · e2e 101 passed (23.3m) · console errors 0

## Evidence (local)

- `npx playwright test --list`: Total: 101 tests in 29 files
- `--shard=n/4 --list`: 26 + 25 + 25 + 25 = 101 (shard 1: 26 in 8 files, shard 2: 25 in 10, shard 3: 25 in 7, shard 4: 25 in 6)
- `VERIFY_E2E_SHARD=1/4 npm run verify`: all five steps passed, e2e 26 passed (3.2m)
- Plain `npm run verify`: all five steps passed, none of the known 2-core failures occurred

## CI results (run https://github.com/Guna210/BlockCraft/actions/runs/39058618292, head f78d161)

All four shards and the aggregate `verify` job succeeded. Durations are job start to completion as reported by the GitHub API.

| Job | Duration | e2e passed (from job log) |
|---|---|---|
| verify (shard 1/4), also static checks + unit | 8m 19s | 26 (4.5m) |
| verify (shard 2/4) | 12m 46s | 25 (12.3m) |
| verify (shard 3/4) | 5m 12s | 25 (4.7m) |
| verify (shard 4/4) | 7m 17s | 25 (6.8m) |
| verify (aggregate) | 3s | n/a |

- Per-shard e2e pass counts: 26 + 25 + 25 + 25 = 101, which equals the full count.
- Total wall-clock for the run: 12m 56s (18:33:26 to 18:46:22 UTC). Shard 2 is the critical path: `m04.spec.ts` alone took 8.3m in that job, so shard 2 will stay the slowest shard.
- Single-job comparison: Verify run https://github.com/Guna210/BlockCraft/actions/runs/39054376303 (master push of PR #51), job 42m 29s. An earlier master run, https://github.com/Guna210/BlockCraft/actions/runs/39040208868 (PR #52), took 29m 30s.
- Sharded run vs the 42m 29s single job: 12m 56s, about 3.3 times faster. Against the 29m 30s run: about 2.3 times faster.

## What was built

`VERIFY_E2E_SHARD` / `VERIFY_SKIP_STATIC` in `scripts/verify.mjs`; matrix + aggregate `verify` job + concurrency in `.github/workflows/verify.yml`. See `decisions/INFRA-ci.md`.

## Known limitations

- Harness guard fails until the owner adds the `harness-change` label.
- Local test runs rewrite committed PNGs under `docs/screenshots/`; I reverted those and did not commit them.
