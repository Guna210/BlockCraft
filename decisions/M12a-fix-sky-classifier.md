# M12a-fix — Sky classifier and full fog fade

## Owner decisions

- Initial owner decision retained legacy SKY_RGB `(102,204,255)` at Euclidean radius 16. The subsequent [Orchestrator] decision approved Option B: remove that check and use only the noon curve, with at least 2 RGB units of terrain-sweep clearance.
- Replace the broad band with a tight distance to the sky pass's actual noon RGB curve. Change classification only; preserve hole flood fill, thresholds, camera positions, timing and test flow.
- Permanently sweep generated block colours, lighting, foliage/water tints and fog 0–0.6; explicitly cover packed ice, snow and blue flowers, and accept sampled sky-curve points.
- Fog blends to 100% sky; calculate horizontal distance per fragment from interpolated world position. Fog colour may stay per vertex. End at `(renderDistance - 1) * 16`; start between 60–75% of that distance. Last ring hiding is accepted; M04 budgets and existing M04/M12 tests remain unchanged.

## Implementation in progress

- Noon factors are day=1, twilight=0, night=0. `sky.ts` computes `h=clamp(dir.y,0,1)` and `t=h*(2-h)`, then mixes `(132,212,255)` to `(72,168,248)`. The curve's locus is exactly a line segment, so clamped projection gives distance to every point without sampling error.
- Radius 8 admits fogged lumite colours. The sweep minimum is **3.7349279324637985** RGB units: lumite `(159,244,255)`, light=1, white tint, h=1, fog=0.6 -> framebuffer `(107,198,251)`. Chosen radius **1.73** is the largest at 0.01-unit precision leaving at least 2 units of clearance (**2.0049279324637985**). It exceeds framebuffer rounding error (at most sqrt(3)/2 RGB units). The permanent test asserts this margin.
- Fog starts at 70% of fogEnd, preserving nearby detail with a 30% smooth transition. One horizontal length and smoothstep per fragment; atmosphere remains per vertex. Always compute vertex fog colour, including inside fogStart, to avoid dark interpolated colours on quads crossing the boundary.

## Resolved owner decision: legacy collision

The permanent sweep includes 3 seeds, all generated block textures and fluid animation frames, light levels 0.2/0.6/1, untinted and all biome grass/foliage tints, sky ray heights 0/0.25/0.5/0.75/1, and fog at 0.01 increments through 0.6. Water tint is baked into generated water frames.

Generated lumite RGB `(159,244,255)` with light=1, white tint, h=0.5 (t=0.75), and fog=0.58 blends toward sky `(87,179,249.75)` to rounded framebuffer RGB `(117,206,252)`. Its squared distance to legacy `(102,204,255)` is 238, below 256. Thus preserving the exact legacy test conflicts with rejecting every shader-fogged terrain colour. Reducing the new curve radius cannot fix this legacy collision.

Initial focused test: 1 failed, 11 passed (12), isolating the legacy collision. The owner approved removing the legacy classifier branch. Final focused sweep at radius 1.73: 12 passed (12), 5.41s, margin 2.0049279324637985. All synthetic hole fixtures now use the real noon horizon colour; every existing flood-fill assertion and pixel limit remains identical. Legacy clear colour has its own explicit rejection assertion. Temporary probe removed.

The owner also required a real RD8 horizontal-frame assertion: at least 98% of the top-quarter pixels must match at ticks 6000 and 10000. Added as a separate M12 spec test without altering the existing noon/sunset/midnight flow. At tick 10000, sin(5*pi/6)=0.5: dayFactor remains 1, twilightFactor=0 and nightFactor=0, so the atmosphere formula is unchanged throughout this M04 drift interval. Both times are tested anyway.

## Historical record correction

Master Verify #161 on 5a73d9a: 62 unit files, 430 unit tests, 56 Playwright tests (14.0m), all stages pass. Logs retrieved in this session. Maximum consecutive sky-light tick step recomputed in this session: 0.0006283182938655596; progress/M12a.md now agrees with the original decision's approximately 0.000628. Original M12a broad-band and legacy-colour descriptions corrected in progress/M12a.md.

## Verification and visual result

Full verification completed with 62 unit files / 433 unit tests passing and Playwright 55 passed, 2 failed (13.5m), exit 1. Only the owner's known M01a GL-check count and M04a streaming-pump failures occur. RD12 horizon (largest hole 10px ≤64), fast-flight and original M12 tests pass unchanged. Real RD8 top-quarter coverage is 230400/230400 (100%) at both ticks 6000 and 10000.

All three requested screenshots from the full run were opened. The horizontal high overlook used for pure-sky classification contains only sky, so the visual fog-edge capture uses a separate lower local overlook looking down 20°. It shows detailed nearby grass/stone/tree terrain grading smoothly into the horizon blue, with no visible hard render-distance cutoff. Sunset and midnight use the original M12 test's unchanged viewpoints. See the handoff for descriptions, measurements and local failure details.
