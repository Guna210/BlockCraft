# Decision: M00b Harness Guard Configuration

To ensure the integrity of the test harness across milestones, the `.github/workflows/harness-guard.yml` enforces the `harness-change` label for PRs that modify protected files.

The final protected patterns list includes:
- `^tests/harness/`
- `^\.github/workflows/`
- `^playwright\.config\.`
- `^scripts/verify` (which covers both `scripts/verify.mjs` and `scripts/verify-quick.mjs`)
- `^scripts/lint-placeholders\.`
- `^vitest\.config\.`
- `^SPEC\.md$`
- `^AGENTS\.md$`

Additionally, `package.json` modifications are strictly validated for core scripts. The action retrieves the `base` and `head` versions via `github.rest.repos.getContent` and specifically checks if the following script commands have been altered:
- `typecheck`
- `lint`
- `lint:placeholders`
- `test:unit`
- `test:e2e`
- `verify`
- `verify:quick`

This robust guard verifies file renames (`previous_filename`) and utilizes `github.paginate` to handle large PRs accurately without checking out PR code.