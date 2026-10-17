# M17a — Serialization: Architectural & Technical Decisions

## 1. Location & Module Boundaries

Serialization and persistence utilities reside under `src/persist/`:
- `compress.ts`: Asynchronous Web Streams compression/decompression wrappers using standard `CompressionStream('deflate')` and `DecompressionStream('deflate')`.
- `version.ts`: Format versioning constants (`FORMAT_VERSION = 1`) and the migration registry (`MigrationRegistry` and singleton `migrations`).
- `column-format.ts`: Binary format for chunk columns (`serializeColumnBinary`, `deserializeColumnBinary`) and deflated wrappers (`serializeColumn`, `deserializeColumn`).
- `serializers.ts`: Specialized serializers for block entities, inventories, item entities, player data, world metadata, scheduled block ticks, and the unified world container (`serializeWorld`, `deserializeWorld`).
- `index.ts`: Unified re-exports for the `src/persist/` domain.

## 2. Binary Column Format & Tint / Lighting Decisions

Each chunk column is serialized into a self-describing binary format:
- **Header (1807 bytes)**:
  - Magic bytes: 4 bytes `0x42, 0x43, 0x43, 0x46` (ASCII `'BCCF'`, Little-Endian `0x46434342`).
  - Format version: uint16 (current version `1`).
  - Column coordinates: `cx: int32`, `cz: int32` (8 bytes total).
  - Section count: uint8 (20 sections, covering heights 0..319).
  - Biome indices: 256 bytes (raw uint8 biome indices, restoring column biomes).
  - Grass tints: 768 bytes (256 * 3 bytes RGB).
  - Foliage tints: 768 bytes (256 * 3 bytes RGB).
- **Tints Decision**: Grass and foliage tints are blended across neighboring columns in `src/gen/surface.ts` via an expanded grid filter. They cannot be computed from `biomeIndices` alone in isolation without cross-chunk generation contexts. Saving both 768-byte arrays in the column header preserves smooth foliage and grass color gradients across reloads.
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

## 4. State ID Persistence & Corrupt Data Validation

- Columns store numeric state IDs matching the append-only `data/block-state-ids.json` table.
- On deserialization, every state ID (both uniform and in palettes) is validated against `BlockRegistry.getInstance().getResolvedState(stateId)`. If an unknown state ID is encountered, deserialization throws a clear descriptive error (`Unknown block state ID: <id>`), rather than silently converting the block to air.
- Palette indices are strictly validated during unpacking: if any packed index is `>= paletteSize`, deserialization throws a clear error (`Palette index out of bounds: <idx> >= <size>`).
- Trailing data verification: if unconsumed bytes remain after reading the 20 sections, deserialization throws a clear error (`Unexpected trailing data: <count> extra bytes`).

## 5. Scope: Complete Game State Serialization (No Forward Stubs)

We serialize existing game state across all active domains:
- **Columns**: 20 sections, palette + bit-packed indices, 256 biome indices, 768-byte grass tints, and 768-byte foliage tints.
- **Block entities**: The M10a framework's plain-JSON state (`{ blockId, x, y, z, state }`), verified with `isPlainJsonObject`.
- **Inventory**: All 41 slots (hotbar 0..8, main 9..35, armor 36..39, offhand 40) plus the cursor stack and `selectedSlot` (0..8).
- **Item entities**: Ground drops (`id, count, position, velocity, pickupDelay, age`).
- **Player data**: All existing player fields from `src/entity/player.ts`: `position`, `rotation`, `mode`, `selectedSlot`, `health`, `hunger`, `saturation`, `air`, `flying`, and `dimension`. (Experience points / XP do not exist in the player model yet and are omitted).
- **World metadata**: `seed`, `timeOfDay`, `breakCount` (the M10a break counter ensuring deterministic loot rolls persist across saves), optional `worldType`, and complete weather state (`weather`, `manualOverride`, `strikeCounter`, `lastTick`, `elapsed`).
- **Scheduled block ticks**: Pending block ticks (`x, y, z, type, due, priority, order`) and the time counter from `BlockTicks` in `src/world/ticks.ts`, allowing fluid flows and timed block updates to resume seamlessly across world saves.

## 6. Versioning & Migration Registry

- Constant `FORMAT_VERSION = 1`.
- A migration registry (`MigrationRegistry`, exported as `migrations`) supports registering version transformation functions `(v -> v+1)`.
- On deserialization, if the input data version is less than the current format version, registered migrations are executed in sequence. If an unsupported future version or missing migration step is detected, a clear error is thrown.
- No fake or stub migrations are defined in `src/`. Migrations are registered in tests only to verify the migration hook mechanism.

## 7. Verification & Lossless Guarantees

Unit tests (`tests/unit/m17a-*.test.ts`) verify that:
- Random columns round-trip with 100% losslessness across all bits-per-entry widths (1, 2, 4, 8, 16), uniform sections, unallocated null sections, and custom grass/foliage tints.
- Palette compaction correctly resizes palettes upon block removal, and round-trips palette, refCounts, and index arrays identically.
- Editing a restored column section with `setBlockStateId` produces identical storage and state as editing the original.
- Water mid-flow saved during active simulation continues flowing identically upon restore.
- Complete world saves truncate cleanly: truncated world buffers at arbitrary cutoffs fail with a clear "truncated world data" error rather than throwing unexpected RangeErrors or JSON parse errors.

## 8. Non-Interference with Game Runtime

Existing gameplay and rendering systems remain untouched; no existing test is deleted, skipped, or weakened. The serializers exist as modular persistence primitives ready for M17b (IndexedDB & autosave) and M17c (world management UI).

## 9. Unified World Packaging (`serializeWorld` / `deserializeWorld`)

A self-describing container format packs complete world save data into a single `Uint8Array`:
- Header: Magic bytes `0x42, 0x43, 0x57, 0x44` (`'BCWD'`), format version uint16 (`1`).
- Table of contents: Byte lengths of metadata, player, inventory, block entities, item entities, block ticks, and the column count (34 bytes header).
- Column table: For each column, records `cx`, `cz`, compressed byte length, and deflated column payload.
- Every segment is bounds-checked against `data.length` on load to guarantee safe error handling on corrupt or truncated saves.
