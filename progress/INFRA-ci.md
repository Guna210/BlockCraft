# INFRA-ci — shard the Playwright suite across 4 CI jobs

Status: incomplete (CI timing section to be filled in after the PR's CI run)
Depends on: none (owner-requested infrastructure task)
Full verify (this session): typecheck ✓ · lint ✓ · placeholders ✓ · unit 748 passed (94 files) · e2e 101 passed (23.3m) · console errors 0

## Evidence (local)

- `npx playwright test --list`: Total: 101 tests in 29 files
- `--shard=n/4 --list`: 26 + 25 + 25 + 25 = 101 (shard 1: 26 in 8 files, shard 2: 25 in 10, shard 3: 25 in 7, shard 4: 25 in 6)
- `VERIFY_E2E_SHARD=1/4 npm run verify`: all five steps passed, e2e 26 passed (3.2m)
- Plain `npm run verify`: all five steps passed, none of the known 2-core failures occurred

## CI results (fill in after the PR's CI finishes)

- Per-shard duration: TBD
- Total wall-clock: TBD
- Recent single-job Verify run for comparison: TBD
- Per-shard e2e pass counts (must sum to 101): TBD

## What was built

`VERIFY_E2E_SHARD` / `VERIFY_SKIP_STATIC` in `scripts/verify.mjs`; matrix + aggregate `verify` job + concurrency in `.github/workflows/verify.yml`. See `decisions/INFRA-ci.md`.

## Known limitations

- Harness guard fails until the owner adds the `harness-change` label.
- Local test runs rewrite committed PNGs under `docs/screenshots/`; I reverted those and did not commit them.
