# INFRA-ci — shard the Playwright suite across 4 CI jobs

Owner-requested infrastructure task (not in SPEC Appendix E). Goal: cut Verify wall-clock time (about 25–40 min) while SPEC §5.6 ("CI runs `npm run verify`") stays true and local `npm run verify` is unchanged.

## Decisions

1. `scripts/verify.mjs` reads two optional env vars.
   - `VERIFY_E2E_SHARD` (e.g. `2/4`) appends `--shard=2/4` to the e2e step.
   - `VERIFY_SKIP_STATIC=1` skips typecheck, lint, placeholders and unit. They show as `skipped (shard)` in the summary table.
   - With neither set, behaviour is identical to before.
2. `.github/workflows/verify.yml`
   - A matrix job over shard `[1, 2, 3, 4]` with `fail-fast: false`. Each job runs `npm run verify` with `VERIFY_E2E_SHARD=<n>/4`. Shard 1 also runs the static checks and unit tests; shards 2–4 set `VERIFY_SKIP_STATIC=1`.
   - Setup steps (Node 22, npm cache, `npm ci`, cached Playwright browsers) and the 90-minute timeout are kept per job.
   - Each shard uploads `artifacts/` and `playwright-report/` as `verification-artifacts-shard-<n>` (7 days, always).
   - A final job named exactly `verify` has `needs: shard` and `if: always()`, and fails unless every shard succeeded. The matrix jobs are named `verify (shard n/4)`, so the check called `verify` stays unique.
   - A concurrency group per PR/ref cancels superseded runs for `pull_request` events only; pushes to master are never cancelled.
3. `playwright.config.ts` (workers 1, retries 2), tests, `harness-guard.yml` and `package.json` scripts are untouched. The shard flag is passed through the existing `test:e2e` script.

## Notes

- This PR changes harness files (`scripts/verify.mjs`, workflow), so the harness guard fails until the owner adds the `harness-change` label.
- Playwright's `--shard` splits by test file or test count depending on `fullyParallel`; the list totals across shards must equal the full list (checked in progress/INFRA-ci.md).
