# INFRA-win — Plain-Node placeholder lint and LF line endings

Status: verified — latest GitHub Verify #158 passed all five steps; PR #37 is ready for review.
Depends on: Owner-requested infrastructure task; based on `origin/master` at `b18882bcdfca9cac6ba9a444df81da2f6e0b94c6`.
Full verify (this session): typecheck ✓ · lint ✓ (2 pre-existing warnings) · placeholders ✓ · unit 424 passed (61 files) · e2e 51 passed / 4 failed (25.4m) · exit 1.
PR CI (first attempt, GitHub Actions [Verify #156](https://github.com/Guna210/BlockCraft/actions/runs/38278666721), head `d752c253782e0e7375af6bda4e5cb4516429c6bb`): typecheck ✓ · lint ✓ · placeholders ✓ · unit 424 passed (61 files, 151.07s) · e2e 55 passed (13.1m) · exit 0. The Verify summary table reports all five steps passed. PR: [#37](https://github.com/Guna210/BlockCraft/pull/37).
PR CI after isolated-fixture fix, GitHub Actions [Verify #158](https://github.com/Guna210/BlockCraft/actions/runs/38295950319), head `fc2fef73c45eaf5166a2654261d96ccebfee7be7`: typecheck ✓ · lint ✓ · placeholders ✓ · unit 425 passed (61 files, 124.24s) · e2e 55 passed (12.0m) · exit 0. The Verify summary table reports all five steps passed. The focused Vitest pair and `npm run lint` also passed locally.

## Acceptance criteria owned

- [x] `scripts/lint-placeholders.mjs` uses plain Node filesystem APIs to scan files recursively under `src/` and `server/`, skips a missing root, preserves the case-sensitive substring patterns, reports path:line:text, and exits 2 on unexpected errors.
- [x] `tests/unit/lint-placeholders.test.ts` covers every forbidden pattern in nested files under both roots, a clean tree, mixed-case `todo`, a missing `server/` root, and cleanup in `finally` blocks. Fixtures run in isolated temporary directories. Existing `tests/unit/lint.test.ts` is unchanged.
- [x] Old/new equivalence: both scripts exited 0 on the current tree. With a planted TODO, both exited 1 and printed the same line: `src/.lint-equivalence.pq0VAu/probe.any:1:TODO: INFRA-win equivalence`.
- [x] `.gitattributes` contains exactly the requested two lines. `git add --renormalize .` staged the modified script and no other tracked files; the new attributes, tests, and handoff were then staged explicitly.

## Screenshots (docs/screenshots/INFRA-win/)

- None; this is an infrastructure task with no visual review.

## What was built

Replaced the shell-based placeholder scan with recursive Node filesystem traversal and added cross-platform unit coverage. Added the root `.gitattributes` rule to normalize text files to LF. No package scripts, application code, thresholds, or existing tests changed.

This changes the verification harness file `scripts/lint-placeholders.mjs`; the PR has the `harness-change` label.

## Decisions (links to decisions/ files)

- None.

## Known limitations

The full `npm run verify` exited 1. Vitest passed all 424 tests in 61 files. Playwright reported 51 passed and 4 failed: M02 mesh p95 (9.8 ms against 6 ms), M04a streaming pump max (51.8 ms against 50 ms), M04b heap-growth timeout, and M04b mid-flight screenshot blank-color assertion (100%). The M02 and two M04b failures are on the owner's known container-only list. The M04b RD12 horizon test passed; no M01a GL-check-count failure occurred.

The extra M04a failure was checked on an `origin/master` archive in the same container using only that test. It also failed the unchanged 50 ms pump limit there (62.8 ms); frame CPU max was 39.3 ms. This task changes no application code or e2e tests. The local full verify remains red, while GitHub Verify #156 and the latest Verify #158 passed all steps; #158 passed all 425 unit tests and all 55 browser tests. The owner authorized promotion after green CI, so this handoff is verified for review with the local failures retained as container evidence.

## Notes for dependent tasks

- The placeholder test runner is `npm run lint:placeholders`; its package script remains unchanged.
- The script prints the existing `Found placeholders in <root>:` header followed by grep-style paths, line numbers, and line text.
- The workspace has no `server/` directory by default; the new test creates and removes it for coverage.
