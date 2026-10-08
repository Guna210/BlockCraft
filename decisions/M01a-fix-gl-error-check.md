# M01a-fix — WebGL errors are read once per frame

Status: accepted
Task: M01a-fix (owner-sanctioned fix task, not in SPEC.md Appendix E; changes code owned by M01a)

## Problem

In debug mode `GLWrapper.drawElements` called `gl.getError()` after every draw, about 840 times per frame
near spawn in the default world. Each call is a synchronous round trip to the browser's GPU process. On the
owner's PC with a dedicated GPU, `?debug=1` ran at 22 FPS and switching the check off in the console made it
smooth. SPEC §3.2 and the M01a scope now say: debug mode reads WebGL errors once per frame, or after every
draw call when the URL also has `&glcheck=draw`.

## Decisions

1. **`GLWrapper` is unchanged except for one new public method.** Its constructor, `drawArrays` and
   `drawElements` behave exactly as before, so `tests/unit/gl.test.ts` passes unchanged: the boolean
   argument now means "check after every draw". `drainErrors()` reads `gl.getError()` until `NO_ERROR` and
   calls the error callback once per error, whatever that boolean is. The per-draw check calls it too.
2. **`main.ts`.** With `?debug=1`, the wrapper is constructed with per-draw checks on only if `glcheck=draw`
   is also in the URL. In debug mode every frame callback calls `drainErrors()` as its last step, after the
   frame CPU timer has stopped: the check is neither update nor draw submission (SPEC §2.3), so it is not
   part of `frameCpuMsP95`. Without `?debug=1` the wrapper is built with `false`, no drain is registered
   and nothing runs that did not run before.
3. **Two more drain points, so no error goes uncounted while a test holds `requestAnimationFrame`**
   (`holdFrames` in m02c-fix and m03c): the end of `WorldManager`'s synchronous terrain frame (the frame
   `createWorld` draws, decisions/M02c-fix-load-path.md), and `getRenderStats()` before it returns. Both go
   through a hook that `main.ts` sets only in debug mode (`WorldManager.drainGlErrors` and
   `setGlErrorDrain` in `src/debug/api/core.ts`), so `WorldManager` and `core.ts` do not need to know the URL.
4. **Nothing else changes:** no other renderer code, no existing test, no harness file.

## What a per-frame check cannot do

An error is no longer attributed to the draw that caused it; the count in `glErrors` is correct, the
location is not. To find the offending call, open the page with `&glcheck=draw`. Errors are still counted
before the harness fixture's final `getRenderStats()` (fixture rule "glErrors > 0 fails the test"), because
`getRenderStats()` drains.

## Options considered

- **Check every N-th draw.** Still costs round trips per frame, and N depends on the scene. Rejected.
- **Use `EXT_disjoint_timer_query` or `KHR_debug`** to report errors without a round trip. Not available in
  every browser and not needed. Rejected.
