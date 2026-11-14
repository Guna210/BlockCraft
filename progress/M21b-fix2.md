# M21b-fix2 — Multiplayer player vitals, death and respawn

Status: incomplete — implementation and local verification complete; PR CI pending
Depends on: M21b, M21c (master `ff53966`, including PR #85)
Full verify: PR CI

## Verification

- Focused gameplay browser test: **1 passed (1.7m)**, including actual nonzero
  reduced-health HUD pixels, server-snapshot agreement, drowning death, respawn,
  second-client entity removal/reappearance and zero browser/WebGL errors.
- Final `MILESTONE=M21 npm run verify:quick`: **typecheck ✓ · lint ✓ ·
  placeholders ✓ · unit 157 files / 1520 tests passed (479.07s) · Playwright
  9 passed (5.6m)**. No retries, skipped tests or filtered counters.
- Delayed walk: **0 counted corrections**, **38.300000000000004 blocks**,
  **159.89999999990687 ms RTT**; next-frame x **0.5 → 0.6**. Block replication:
  **103 ms**, below the unchanged 500 ms limit. Browser fixtures recorded zero
  console errors, uncaught errors, failed requests and WebGL errors.
- Affected/shared-code browser regressions:
  `npm run test:e2e -- 'tests/e2e/m(06|09|11|16|18|20).*\.spec\.ts' --reporter=line`:
  **71 passed (20.5m)** across 15 files. No retries or failures; fixture error and
  WebGL checks passed. Physics/camera, inventory/HUD, hazards/death/bed respawn,
  audio, menus/settings/chat and dimension travel/persistence remain intact.
- Full verify: PR CI. No local full verify was run under the owner's override.
  The owner approved the explicit publish gate; head CI must be green with
  every M21 test passing on its first attempt before final verified handoff.

## Acceptance criteria owned

- [x] Protocol v4 appends PlayerVitals, RespawnRequest and PlayerRespawn with
      round-trip fixtures; existing fuzz test unchanged →
      `tests/unit/m21a-protocol.test.ts`.
- [x] Join/change/20-tick refresh, death cause/inventory drop/EntityRemove,
      ignored alive respawn, dead movement/block rejection with acknowledgements,
      dead reconnect, world/bed respawn and EntitySpawn →
      `tests/unit/m21b-fix2-vitals.test.ts`.
- [x] Portal vitals and cross-dimension respawn through replacement ServerHello →
      same integration file.
- [x] Live/checkpoint vitals, moving refresh with zero counted corrections,
      fresh prediction reset and locally predicted lethal landing preservation →
      `tests/unit/m21b-fix2-prediction.test.ts`.
- [x] Server-cause death UI, request-only respawn and original-handler restoration →
      `tests/unit/m21b-fix2-session.test.ts`.
- [x] Dead movement clock stops, independent keep-alive replies continue and fresh
      respawn resumes sequenced input → `tests/unit/m21b-fix2-worker.test.ts`.
- [x] Real server drowning reduces browser HUD hearts; death cause/RESPAWN and
      second-browser removal/reappearance; zero browser/WebGL errors →
      `tests/e2e/m21b-fix2-vitals.spec.ts`.

## Screenshots (docs/screenshots/M21b-fix2/)

- `m21b-fix2-death.png`: VIEWED. A centered gray-violet panel shows pink
  “YOU DIED”, white “DROWNED” cause text, and a large outlined “RESPAWN” button.
  Dim block terrain remains visible behind a dark red overlay.

## What was built

- A reusable per-peer authoritative vitals snapshot, immediate death notification,
  saved death cause, validated respawn, and live-only player entity replication.
- Bed resolution uses the single-player helper and collision checks. Missing beds
  fall back to Overworld world spawn. Cross-dimension respawn and portal travel
  share actor replacement and ServerHello. Respawn resets movement silence while
  preserving the server's elapsed-time movement credit.
- Multiplayer snapshots own HUD and prediction survival state. Only authoritative
  health loss invokes existing hurt feedback. Server death stops worker movement,
  opens the existing death UI and replaces the RESPAWN handler with a request.
  Respawn resets prediction as a fresh spawn without counting a correction.
- Worker keep-alive replies continue while movement is stopped; lifecycle paths
  close the death overlay and restore the original single-player respawn handler.

Shared changes are limited to checkpoint slots in Player (M21c), extracting the
existing event-only damage feedback method in PlayerController (M11/M16), and an
event-only death-overlay close method in UiManager (M11). No new World/Player
fields, single-player tick/frame branches or server tick bookkeeping allocations.

## Decisions

[Protocol, server lifecycle, prediction, performance and gameplay-only test decisions](../decisions/M21b-fix2-vitals.md).

## Known limitations

- Implementation and local verification are complete. PR CI is the remaining
  verification gate. Full verify: PR CI.
- Existing tests are unchanged except the three pre-approved M21a round-trip
  fixtures. No harness changes, test-only server behavior or relaxed thresholds.

## Notes for dependent tasks

- Protocol **v4** rejects older clients. PlayerVitals follows every ServerHello,
  including dead reconnects and dimension replacement.
- Prediction slots 33–37 retain their meanings; 38–42 hold air, burning, creative
  flag, XP level and XP progress. A vitals packet updates the authoritative and
  provisional checkpoint as well as the live player.
- Dead acknowledgements continue, but no movement intent is emitted. Respawn
  preserves input sequence continuity while clearing pending/provisional frames;
  it never calls local PlayerController.respawn in an active remote session.
