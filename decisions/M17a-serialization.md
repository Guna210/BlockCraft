# M17a — Serialization: Architectural & Technical Decisions

## 1. Location & Module Boundaries

Serialization and persistence utilities reside under `src/persist/`:
- `compress.ts`: Asynchronous Web Streams compression/decompression wrappers using standard `CompressionStream('deflate')` and `DecompressionStream('deflate')`.
- `version.ts`: Format versioning constants (`FORMAT_VERSION = 1`) and the migration registry (`MigrationRegistry` and singleton `migrations`).
- `column-format.ts`: Binary format for chunk columns (`serializeColumnBinary`, `deserializeColumnBinary`) and deflated wrappers (`serializeColumn`, `deserializeColumn`).
- `serializers.ts`: Specialized serializers for block entities, inventories, item entities, player data, world metadata, and the unified world container (`serializeWorld`, `deserializeWorld`).
- `index.ts`: Unified re-exports for the `src/persist/` domain.

## 2. Binary Column Format & Lighting Decision

Each chunk column is serialized into a self-describing binary format:
- **Header (271 bytes)**:
  - Magic bytes: 4 bytes `0x42, 0x43, 0x43, 0x46` (ASCII `'BCCF'`, Little-Endian `0x46434342`).
  - Format version: uint16 (current version `1`).
  - Column coordinates: `cx: int32`, `cz: int32` (8 bytes total).
  - Section count: uint8 (20 sections, covering heights 0..319).
  - Biome indices: 256 bytes (raw uint8 biome indices, restoring column biomes and foliage/grass tints).
- **Per-Section Layout (20 sections, y = 0..19)**:
  - `paletteSize: uint16`:
    - `0`: Unallocated section (null section, representing implicit air).
    - `1`: Uniform section (bits-per-entry = 0), followed by 2 bytes: `stateId: uint16`.
    - `>1`: Palette-indexed section (bits-per-entry > 0). Followed by `paletteSize * 2` bytes (uint16 state IDs), followed by the bit-packed indices matching `src/world/chunk.ts`:
      - 1 bit per entry (paletteSize ≤ 2): 512 bytes (4096 / 8).
      - 2 bits per entry (paletteSize ≤ 4): 1024 bytes (4096 / 4).
      - 4 bits per entry (paletteSize ≤ 16): 2048 bytes (4096 / 2).
      - 8 bits per entry (paletteSize ≤ 256): 4096 bytes (4096 * 1).
      - 16 bits per entry (paletteSize > 256): 8192 bytes (4096 * 2, uint16 array).
- **Lighting**: Light data is not serialized into the column. In BlockCraft, lighting is computed dynamically via BFS in `LightEngine` (and worker lighting pipelines) when chunks load. Omitting the 2048 bytes of sky/block light per section saves 40 KB of raw uncompressed data per column without visual degradation.

## 3. Compression

Compression uses the standard web API `CompressionStream('deflate')` and `DecompressionStream('deflate')`.
- Supported natively in modern browsers, Node 22 (CI), and Node 24 (laptop).
- The public column and world serialization APIs are asynchronous (`Promise<Uint8Array>`), allowing streaming and worker-friendly execution.
- Synchronous binary serialization and deserialization functions (`serializeColumnBinary`, `deserializeColumnBinary`) are also exported for testing, lower-level plumbing, and inspection.

## 4. State ID Persistence & Validation

- Columns store numeric state IDs matching the append-only `data/block-state-ids.json` table.
- On deserialization, every state ID (both uniform and in palettes) is validated against `BlockRegistry.getInstance().getResolvedState(stateId)`.
- If an unknown state ID is encountered, deserialization throws a clear descriptive error (`Unknown block state ID: <id>`), rather than silently converting the block to air.

## 5. Scope: Serialize Only Existing Game State (No Forward Stubs)

We serialize only what exists in the codebase today:
- **Columns**: 20 sections, palette + bit-packed indices, and 256 biome indices.
- **Block entities**: The M10a framework's plain-JSON state (`{ blockId, x, y, z, state }`), verified with `isPlainJsonObject`.
- **Inventory**: All 41 slots (hotbar 0..8, main 9..35, armor 36..39, offhand 40) plus the cursor stack and `selectedSlot` (0..8).
- **Item entities**: Ground drops (`id, count, position, velocity, pickupDelay, age`).
- **Player data**: Existing player fields (`position, rotation, mode, selectedSlot`).
  - *Note for M11a*: Player health, hunger, XP, and spawn point do not exist in the player model yet. They will be added in M11a through a format-version bump.
- **World metadata**: `seed`, `timeOfDay`, `weather`, and `world.breakCount` (the M10a break counter ensuring deterministic loot rolls persist across saves).

## 6. Versioning & Migration Registry

- Constant `FORMAT_VERSION = 1`.
- A migration registry (`MigrationRegistry`, exported as `migrations`) supports registering version transformation functions `(v -> v+1)`.
- On deserialization, if the input data version is less than the current format version, registered migrations are executed in sequence. If an unsupported future version or missing migration step is detected, a clear error is thrown.
- No fake or stub migrations are defined in `src/`. Migrations are registered in tests only to verify the migration hook mechanism.

## 7. Verification & Lossless Guarantees

Unit tests (`tests/unit/m17a-*.test.ts`) verify that:
- Random columns round-trip with 100% losslessness across all bits-per-entry widths (1, 2, 4, 8, 16), uniform sections, and unallocated null sections.
- Every block state ID at every `(x, y, z)` matches the original.
- Block entities, full inventories (with empty slots, unstackables, full stacks, offhand, armor, and cursor), item entities, player data, and world metadata round-trip with deep-equal losslessness.
- Unknown state IDs, corrupted/invalid magic bytes, and unsupported versions trigger clear errors.
- The migration hook runs and updates older payloads.
- An all-air column compresses to a minimal size (well under 100 bytes).

## 8. Non-Interference with Game Runtime

None of the existing gameplay or rendering systems are modified; no existing test is deleted, skipped, or weakened. The serializers exist as modular persistence primitives ready for M17b (IndexedDB & autosave) and M17c (world management UI).

## 9. Unified World Packaging (`serializeWorld` / `deserializeWorld`)

A self-describing container format packs complete world save data into a single `Uint8Array`:
- Header: Magic bytes `0x42, 0x43, 0x57, 0x44` (`'BCWD'`), format version uint16 (`1`).
- Table of contents: Byte lengths of metadata, player, inventory, block entities, item entities, and the column count.
- Column table: For each column, records `cx`, `cz`, compressed byte length, and deflated column payload.
- Provides a unified package format for future world file export/import (`.save`) and IndexedDB storage.
