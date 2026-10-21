# INFRA-stream — Streaming headroom for M04b

Status: incomplete (see "Known limitations": no game-code fix found; CI evidence pending)
Depends on: M18a (master cf97712)
Full verify: PR CI
Quick verify (this session, `MILESTONE=M04 npm run verify:quick`): typecheck ✓ · lint ✓ (0 errors; 2 existing `no-explicit-any` warnings) · placeholders ✓ · unit 1008 passed (115 files) · e2e M04: re-run pending (the first run was cut off when the container paused after 2 of 5 tests)

Not a SPEC task; the owner requested it. No acceptance criteria are owned.

## Acceptance criteria owned

None. This task keeps the existing M04b tests (`tests/e2e/m04.spec.ts:221` heap, `:276` RD12 horizon) from failing on the first attempt on GitHub CI.

## Screenshots (docs/screenshots/INFRA-stream/)

None: no rendering change.

## What was built

- `decisions/INFRA-stream.md`: every measurement and A/B (including the negative ones), the profile, and the GPU-backpressure analysis of why uploads defer.
- **Owner-approved edit to `tests/e2e/m04.spec.ts`, time limits only** (no assertion, threshold, render distance, GC handling, helper, config or harness change; the file is not a SPEC §5.7 harness path):

  | Test | Before | After |
  | --- | --- | --- |
  | heap (`:221`) | default 180 s test timeout; `waitForStreamingIdle` 60 s ×3 | `test.setTimeout(420_000)`; 120 s ×3 |
  | RD12 horizon (`:276`) | default 180 s; `waitForStreamingIdle` 120 s | `test.setTimeout(420_000)`; 300 s |

- No game code changed.

## Decisions (links to decisions/ files)

- `decisions/INFRA-stream.md`

## Known limitations

- No game-code fix gave a clear, repeatable gain, so none is included (one candidate, a discard-free opaque shader plus nearest-first column order, was measurably worse and was reverted before any push). The timeout edit is a margin, not a performance fix. Shard 2 duration is unchanged by this PR.
- The container does not reproduce the CI failure (all three M04b tests pass on master here, 6.0 min), so the first-attempt result can only be judged on CI. Needed: two clean CI runs with no "flaky" in the shard 2 log; shard 2 durations to be reported.
- Remaining levers are on the harness side (SwiftShader flags, CI runner size), or SPEC M22a (culling, smaller upload units).

## Notes for dependent tasks

- Uploads defer because frames arrive slowly under SwiftShader backpressure (GPU process, 1–3 s per frame at RD 12), not because the 3 ms upload budget is eaten by other work. Time to idle ≈ (sections to upload ÷ uploads per frame) × frame time. Details and numbers are in `decisions/INFRA-stream.md`.
- Extra main-thread or CPU cost still matters indirectly on a 2-core runner, because it takes CPU from SwiftShader.
