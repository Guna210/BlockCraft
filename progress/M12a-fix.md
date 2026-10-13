# M12a-fix — Sky classifier and full fog fade

Status: verified — source Verify #162 is green; the owner explicitly accepts the two listed local container failures and authorizes verified/ready promotion after green CI. The documentation follow-up must pass its checks before the PR is marked ready.
Depends on: M12a (`5a73d9a` on master), M04b, M05b
Full verify (this session): typecheck ✓ · lint ✓ · placeholders ✓ · unit 433 passed (62 files) · e2e 55 passed, 2 failed (13.5m) · exit 1 · unexpected console/page/network/WebGL guard errors 0. Entire output read; no retry or master comparison run.
Source CI: [Verify #162](https://github.com/Guna210/BlockCraft/actions/runs/38369388366) on `c873ccda8177fcfdbbcbadeb2c08574e7705175f`: typecheck ✓ · lint ✓ · placeholders ✓ · unit 433 passed (62 files) · e2e 57 passed (12.7m) · exit 0 · no failed/flaky tests or retries. [Harness Guard](https://github.com/Guna210/BlockCraft/actions/runs/38369389244) also passed.
PR: https://github.com/Guna210/BlockCraft/pull/38
Quick verify (this session): typecheck ✓ · lint ✓ · placeholders ✓ · unit 433 passed (62 files) · e2e 2 passed (48.1s) · exit 0 · console/page/network/WebGL fixture errors 0

## Acceptance criteria owned

- [x] Classify noon sky using its actual horizon→zenith curve; reject the old flat clear colour and all swept terrain colours at fog 0–0.6 → `tests/unit/sky-holes.test.ts`, curve regression and generated-colour sweep.
- [x] Explicit packed ice at fog 0, snow at fog 0.54 and blue-flower regressions; sampled noon-curve points accepted → `tests/unit/sky-holes.test.ts`.
- [x] Closest terrain distance 3.7349279324637985; radius 1.73; margin 2.0049279324637985 ≥ 2, permanently asserted in the sweep.
- [x] Real RD8 horizontal-frame top-quarter sky classification ≥98% at ticks 6000 and 10000 → `tests/e2e/m12.spec.ts`, new M12a-fix test. Both are **230400/230400 = 100%** in quick, local full and source CI verification.
- [x] Original noon/sunset/midnight and moon-phase assertions pass unchanged in quick, local full and source CI verification.
- [x] Unchanged M04 RD12 horizon and fast-flight screenshot tests pass in full verification.
- [x] M04 flight overall budget check passes first attempt on source CI: frame CPU max 10.5ms, streaming pump max 12.799999999988358ms, both ≤50ms. The local listed streaming-pump failure remains recorded below.
- [x] Full verification ran to completion; failures recorded below.
- [x] Source full Verify exits 0 / PR CI green, including M01a, M04 and M12; local exit 1 is retained under the owner’s explicit container exception.

## Screenshots (docs/screenshots/M12a-fix/)

- `m12-sunset.png`: Opened; a golden pixel sun sits in a vivid orange horizon glow grading into a purple-grey upper sky. A green terrace with two torches fills the foreground; stepped stone on the left fades into orange fog.
- `m12-midnight.png`: Opened; the same terrace is dimly green with warm light near both torches. Hundreds of separated small stars appear in the navy upper sky; the stepped stone on the left fades into dark navy fog.
- `m12a-fix-fog-edge.png`: Opened from the full run; nearby grass hills, trees, stepped grey stone and a narrow water-filled ravine remain detailed. Distant slopes and trees fade smoothly to the blue horizon colour; no hard square render-distance cutoff or straight fog wedge is visible in this view. RD8, noon, looking down 20° from a local overlook.

## What was built

- Replaced the broad noon colour band with clamped projection onto the actual noon RGB curve in `tests/e2e/helpers/sky-holes.ts`. Removed the legacy-radius branch per the owner's subsequent Option B approval. Flood fill, hole limits and M04 camera/timing/flow remain unchanged.
- Added a permanent sweep across all block texture generators, all generated fluid animation frames, seeds 0/42/12006, light 0.2/0.6/1, white plus all biome grass/foliage tints, 5 sky-ray heights and fog 0–0.6 in 0.01 increments. Water colour is baked into generated water frames. Fully transparent texels are excluded except grass-side dirt, which the shader draws opaquely. Translucent coloured texels are included.
- Synthetic hole fixtures use actual noon horizon RGB `(132,212,255)`; every flood-fill geometry, expected count and hole limit remains unchanged. Added explicit legacy clear-colour rejection.
- In `src/render/chunk-renderer.ts`, interpolate world position, then evaluate horizontal fog distance and smoothstep per fragment. Sky atmosphere colour remains per vertex and is evaluated even inside fogStart so a crossing quad cannot interpolate from black. Removed the 0.95 colour scale.
- In `src/world/world-manager.ts`, fogEnd is `(RD-1)*16`, fogStart is 0.7*fogEnd (RD8: 78.4→112 blocks). Last ring/corners fully disappear into sky; per-fragment cost adds one horizontal length plus smoothstep.
- Added an independent M12 RD8 horizontal sky-coverage test at ticks 6000/10000, followed by a lower view for the fog-edge screenshot. The original M12 test's assertions and camera/time flow remain unchanged.
- Corrected `progress/M12a.md`: actual original band, legacy `(102,204,255)`, green master Verify #161 with 430 unit/56 e2e passes, and maximum tick-step 0.0006283182938655596. Historical local laptop failures are retained as historical evidence. The original decisions file is historical; the new record supersedes its fog and classification decisions.

## Decisions

- [M12a-fix sky classifier](../decisions/M12a-fix-sky-classifier.md): owner decisions, legacy-collision evidence and Option B approval, exact curve distance/radius/margin, 70% fog start, per-fragment cost and unchanged noon factors through tick 10000.

## Known limitations

- Terrain and holes at/after fogEnd become invisible, as explicitly accepted by the owner. The terrain-rejection sweep stops at fog 0.6; it does not claim that near-fully-fogged terrain is distinguishable from sky.
- Closest distance and margin describe the recorded finite sweep, not all possible RGB mixtures. Sky colour stays per vertex, an owner-accepted approximation; fog factor is per fragment.
- Local full Verify exits 1 solely for two owner-listed container failures on confirmed cgroup quota `200000 100000` (2 cores):
  - M01a GL-check count (`tests/e2e/m01a-fix.spec.ts:69`): expected ≥1449, received 1446.
  - M04a streaming pump (`tests/e2e/m04.spec.ts:100`): 57.10000000009313ms >50ms.
- Per the owner's instructions, neither local failure was investigated or retried and master was not re-run. The owner approved the publish gate, the draft PR was opened, and source CI #162 passes both checks first attempt. CI counts are now recorded; the documentation-only follow-up is checked before retitling `M12a-fix: sky classifier and full fog fade — verified` and marking ready for review.
- Existing M04 fast-flight reports remain informational: enclosed sky 97979px (largest 92713), open 0, fading 11, queued generation 165; this task does not claim those loading openings vanish. The unchanged screenshot test passes.

## Full-run measurements

| Check | Output |
| --- | --- |
| M04 frames | 67 |
| Frame CPU p95 / max | 10.299999999813735 / 40.4000000001397ms |
| Upload p95 / max | 3.1000000000931323 / 39.5ms |
| GL check p95 / max | 1496 / 2193.3000000000466ms |
| Streaming pump p95 / max | 1.6000000000931323 / 57.10000000009313ms |
| Heap baseline → end; growth | 26946323 → 28334770 bytes; 5.15% (PASS) |
| RD12 horizon | largest hole 10px ≤64; enclosed 98px; open sky 597684px; top tenth 100.0% (PASS) |
| Noon upper region | hue 205.65983880175327°, luminance 168.14895934606483 (PASS) |
| Sunset horizon | hue 27.008208161574203° (PASS) |
| Midnight upper region / stars | luminance 8.493349616608796 / 227 isolated stars (PASS) |
| Full / new moon centre luminance | 192.30623046875 / 55.146335546875 (PASS) |
| RD8 top-quarter noon / tick10000 | 230400/230400 each, fraction 1 (PASS against unchanged new ≥0.98 assertion) |

These are this session's local output, not CI numbers or claims that every local frame budget passes.

## Source CI measurements — Verify #162

The source-head run completed successfully without failed/flaky tests or retries; numbers below are copied from its job logs retrieved in this session. No test thresholds, timing, cameras or M04 flow were changed.

| Check | CI output |
| --- | --- |
| Unit files / tests | 62 / 433 passed |
| Playwright | 57 passed (12.7m) |
| M04 frames | 72 |
| Frame CPU p95 / max | 6.599999999976717 / 10.5ms |
| Upload p95 / max | 3.7999999999883585 / 6.900000000023283ms |
| GL check p95 / max | 1317.9000000000233 / 1583.9999999999418ms |
| Streaming pump p95 / max | 1.1999999999534339 / 12.799999999988358ms |
| Heap baseline → end; growth | 27557435 → 27971070 bytes; 1.50% (PASS) |
| RD12 horizon | largest hole 8px ≤64; enclosed 101px; open sky 611911px; top tenth 100.0% (PASS) |
| Noon upper region | hue 205.65983880175327°, luminance 168.14895934606483 (PASS) |
| Sunset horizon | hue 27.008208161574203° (PASS) |
| Midnight upper region / stars | luminance 8.493349616608796 / 227 isolated stars (PASS) |
| RD8 top-quarter noon / tick10000 | 230400/230400 each, fraction 1 (PASS) |

M01a GL-check count, M04 flight/culling/heap/horizon/fast-flight, original M12 sky/moon checks, and the new RD8 coverage check all pass first attempt on CI. The guard fixture reports no unexpected console/page/network/WebGL/missing-texture failure. The committed screenshots remain the already-opened local full-run images. This documentation-only follow-up changes no source, tests or images; its automatically triggered CI must finish green before ready-for-review promotion.

## Notes for dependent tasks

- `NOON_SKY_RADIUS` and the classifier mirror `GLSL_SKY_ATMOSPHERE` at day=1, twilight=0, night=0. Unit assertions guard its endpoints/easing. Revisit classifier and terrain clearance if the sky palette changes.
- At ticks 6000–10000, dayFactor=1 and twilight/nightFactor=0, so the classifier remains valid throughout the specified M04 drift interval. It is deliberately a noon classifier, not a sunset/night detector.
- Historical `SKY_RGB` remains exported for the rejection regression; it is no longer accepted. Missing holes remain detected by the same 4-neighbour flood fill from the top row.
