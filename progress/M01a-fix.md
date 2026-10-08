# M01a-fix — GL error checks once per frame

Status: verified
Depends on: M01a
Full verify (this session): typecheck ✓ · lint ✓ · placeholders ✓ · unit 223 passed · e2e 39 passed · console errors 0

Owner-sanctioned fix task (not in SPEC.md Appendix E). It changes code owned by M01a and follows SPEC §3.2:
debug mode reads WebGL errors once per frame, or after every draw call when the URL also has `&glcheck=draw`.

## Acceptance criteria owned

- [x] No criterion in SPEC; the task's own tests:
  - drain method, per-frame mode, `getRenderStats()` drain, `createWorld` terrain-frame drain → tests/unit/gl-error-check.test.ts
  - at most 2 `getError` calls per frame with `?debug=1`, at least one per draw with `&glcheck=draw` → tests/e2e/m01a-fix.spec.ts

## Screenshots (docs/screenshots/M01a-fix/)

- None. The task has no Visual Review.

## What was built

- `GLWrapper.drainErrors()` (`src/render/gl.ts`): reads `getError()` until `NO_ERROR`, one callback per error, regardless of the per-draw flag. Constructor and per-draw behaviour unchanged.
- `src/main.ts`: `?debug=1` turns per-draw checks on only with `&glcheck=draw`; in debug mode every frame callback drains once after the frame CPU timer stops.
- `WorldManager.drawTerrainFrame()` drains at its end and `api.getRenderStats()` drains before returning, both through hooks that `main.ts` sets only in debug mode (`WorldManager.drainGlErrors`, `setGlErrorDrain` in `src/debug/api/core.ts`).
- Each new test was checked by removing its behaviour: the drain in `getRenderStats`, in `drawTerrainFrame`, in `drainErrors` itself, the per-draw flag, the per-frame drain in `main.ts`, and the `glcheck=draw` switch. Every removal made at least one test fail.

## Measurements (this VM, 4 vCPU, SwiftShader, no GPU)

Default world right after `createWorld`, `?debug=1`, 5 s steady, 1280×720; `getError` calls counted over about 10 frames by wrapping `WebGL2RenderingContext.prototype.getError`; 841 draw calls per frame. Probe script is not part of the repository.

| | master `2be70f2` (3 runs) | branch (3 runs) | branch, `&glcheck=draw` (2 runs) |
| --- | --- | --- | --- |
| `getError` calls per frame | 841, 841, 841 | 1, 1, 1 | 842, 842 |
| `frameCpuMsP95` (ms) | 673.8, 600, 349 | 3.6, 2.6, 1.3 | 332.6, 649 |
| `fps` from `getRenderStats` | 2, 3, 4 | 4, 3, 4 | 3, 3 |

Full `npm run verify`, one run each, same VM: master 203 s (214 unit, 37 e2e), branch 234 s (223 unit, 39 e2e). The branch has 9 more unit and 2 more e2e tests; I did not repeat the runs, so I cannot say how much of the 31 s is run-to-run variation.

## Decisions (links to decisions/ files)

- decisions/M01a-fix-gl-error-check.md

## Known limitations

- FPS did not change in this VM: software rendering of 841 draws is the limit here, not GPU round trips. The 22 FPS → smooth result on a dedicated GPU is the owner's observation and could not be reproduced here. Only the `getError` calls per frame and `frameCpuMsP95` show the change.
- A per-frame check cannot say which draw raised an error; use `&glcheck=draw` for that.
- `progress/M01a.md` still says draw calls "continuously query `gl.getError()`"; that is its record of M01a and was not edited.

## Notes for dependent tasks

- New renderer code that issues draws through `GLWrapper` needs no error handling: the frame loop drains. Code that runs outside the frame loop (a test that holds `requestAnimationFrame`) is covered by the `getRenderStats()` drain.
- `drainErrors()` always calls `gl.getError()`. Only call it from debug-mode paths.
