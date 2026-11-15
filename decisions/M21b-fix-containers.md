# M21b-fix — Multiplayer container windows

This owner-added follow-up extends M21b and M21c outside SPEC Appendix E. The
owner fixed the scope and verification policy: `MILESTONE=M21 npm run
verify:quick`, affected inventory/chest/kiln/crafting E2E specs, and PR CI for
the full verify. Publishing waits for the evidence gate in the task request.

## Protocol v5

Existing message ids and InventoryAction meanings stay unchanged. The four
window messages are appended after v4. `WindowOpen` ids use the nonzero u8
range and wrap from 255 to 1; `WindowClose` also permits id 0 to report closing
the implicit inventory screen. `WindowProperty` names are the kiln fields the
existing screen displays: `burnRemaining`, `burnTotal` and `cookProgress`.
Recipe-book fill uses the shared recipe registry's stable insertion-order index.
The M21a fixture map gains only the four message fixtures and the FillRecipe
action round-trip; the fuzz loop stays byte-for-byte unchanged.

InventorySync and InventorySlot indexes match the screen coordinates consumed
by `UiManager.clickSlot`: chest indices start at 0, crafting-table result is 9
and inventory starts at 10, kiln slots are 0–38, and inventory crafting starts
at 41 with result at 45. Result slots are derived from the authoritative shared
grid and are not writable. Window zero syncs the existing 41 inventory slots,
four 2x2 grid slots and its derived result position.

## Server ownership and close behavior

Each peer preallocates one reusable window record, slot snapshot, message and
property set at connection time. The record owns its id/kind/position/revision
and 3x3 grid. The inventory's four-slot craft grid is likewise per peer.
Container reach/block checks and shared slot/property bookkeeping visit only
open windows; the peer and window buffers are preallocated, and the normal
inventory snapshot still runs each peer tick without allocating bookkeeping.
Open and every action validate life, block kind, revision, shared
block-action reach plus one and the existing chest pairing/block-entity rules.
Shared `fillRecipe`, `takeCraftingOutput`, Inventory slot operations and the
shared external-slot/kiln helpers apply game rules.

Container viewers receive changed `InventorySlot`s; kiln fuel/cook properties
are sent only when their scalar value changes. Block-entity state remains in
the existing save format; container edits increment the owning column revision
so autosave and shutdown include them. Breaking either half of a large chest
closes all viewers before the existing spill hook runs. Close, out-of-reach,
block replacement, death, travel, and disconnect return cursor/grid contents
with the existing inventory-capacity-first then item-drop behavior.

## Multiplayer client

Only the dynamically imported RemoteSession installs remote UI callbacks. The
existing UI draws chest, kiln, crafting, and inventory screens using server
snapshots. One serialized request queue carries each screen's clickSlot index;
accepted/rejected snapshots replace local mirrors and revisions gate subsequent
requests. The inventory grid snapshot travels as extra window-zero slots.
Opening is server-driven, Esc/E requests the server close, and the existing
kiln canvas reads the three synchronized properties. The single-player UI
continues using its local screen state and frame path.

## Verification fixture setup

The new Node integration tests use the existing `startServer`, headless client,
shared persistence serializers and temporary worlds. The owned E2E starts its
own port-zero server process and prepares ordinary serialized world data in its
artifact directory before launch; it adds no server flags or runtime test path.
