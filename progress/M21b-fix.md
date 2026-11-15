# M21b-fix — Multiplayer container windows

Status: verified
Depends on: M21b, M21c, M21b-fix2
Full verify: PR CI

## Acceptance criteria owned

- [x] Protocol v5 appends container/window messages and recipe-book fill; the
  M21a fixture map covers each addition and the existing fuzz loop is unchanged
  → `tests/unit/m21a-protocol.test.ts`.
- [x] Inventory window helpers write slot changes through `set()` even when
  `get()` returns a copy; copied chest, drag, crafting-grid, kiln and quick-move
  paths are covered → `src/gameplay/inventory-window.ts`,
  `tests/unit/m21b-fix-copy-slots.test.ts`.
- [x] The server owns one reusable window per peer and validates life, block,
  reach and revision on open and transaction; nonzero IDs wrap; shared inventory,
  chest, kiln, crafting and recipe-book operations apply → `server/server.ts`,
  `src/gameplay/inventory-window.ts`.
- [x] Container and kiln slots/properties update every viewer; close, reach,
  break, death, travel and disconnect return cursor/grid contents; chest and
  kiln block-entity state persists → `tests/unit/m21b-fix-containers.test.ts`.
- [x] Window 0 includes the 2×2 crafting grid and returns it on close. Remote
  inventory, chest, kiln and crafting screens use server snapshots and
  serialized prediction/reconciliation; recipe-book fill and Esc/E close are
  server actions → `src/game/net/inventory.ts`, `src/game/net/session.ts`,
  `src/ui/ui-manager.ts`.
- [x] Two-browser E2E covers shared chest contents, recipe-book crafting,
  captured search input, server-initiated close on chest break with cursor return
  and spills, zero console/WebGL errors and the reviewed screenshot
  → `tests/e2e/m21b-fix-containers.spec.ts`.

## Verification

- `MILESTONE=M21 npm run verify:quick`: typecheck ✓ · lint ✓ · placeholders ✓ ·
  unit **159 files / 1,537 tests passed** · Playwright **10 passed**.
- Affected E2E specs `m09a`, `m09b`, `m09c`, `m10b`, `m10c` and `m14`:
  **29 passed**.
- M21c delayed walk: **0 corrections** (38.38 blocks, RTT 154.7 ms). Block
  replication: **57 ms**.
- PR CI Verify [run 43688521527](https://github.com/Guna210/BlockCraft/actions/runs/43688521527):
  **passed** all four shards. Playwright per shard: shard 1 **48 passed, 1
  flaky** (M02:54 mesh p95); shard 2 **49 passed**; shard 3 **49 passed**;
  shard 4 **48 passed, 1 flaky** (`m21c-world`). Total: **194 passed, 2
  flaky**. Both flaky tests passed on retry. Typecheck, lint and placeholders
  passed; unit **159 files / 1,537 tests passed**.
- On CI shard 4, M21c delayed walk had **0 corrections** (37.5 blocks, RTT
  159.3 ms). Block replication passed on retry at **137 ms** after the first
  attempt missed its 500 ms limit.
- The owner designated PR CI as the full verify; no local full verify was run.

## Screenshots (docs/screenshots/M21b-fix/)

- `m21b-fix-chest.png`: VIEWED. Bea's view shows the shared chest after A put
  oak planks into its first slot; the stack count **2** is visible, with Bea's
  inventory grid below.

## What was built

- Protocol v5 support for container open requests, server-assigned windows,
  closes, kiln properties and recipe-book fill.
- Peer-owned window records and craft grids, shared transaction helpers,
  authoritative revisions, multi-viewer slot updates, close/return behavior,
  and block-entity persistence through existing saves.
- Remote UI wiring for chest, large chest, kiln, workbench and 2×2 inventory
  crafting. Multiplayer windows capture gameplay input while open, matching
  single-player; the single-player render/tick path gains no per-frame bookkeeping.
- Integration coverage and a port-zero owned-server browser test seeded through
  the shared world persistence serializers.

## Decisions

[Protocol, ownership, lifecycle, performance and test decisions](../decisions/M21b-fix-containers.md).

## Known limitations

- No known functional limitations. Full verify runs in PR CI per the owner
  override.

## Notes for dependent tasks

- Protocol v5 preserves earlier message IDs. Container IDs are 1–255 and wrap;
  window 0 is the inventory screen. Inventory slot indices match
  `UiManager.clickSlot`, including inventory-grid slots 41–45.
- Server window state is attached to each peer in `server/server.ts`; no fields
  were added to `World` or `Player`. Shared click, drag, quick-move, kiln and
  crafting rules live in `src/gameplay/inventory-window.ts`.
- Chest and kiln contents remain in their existing block-entity save format.
