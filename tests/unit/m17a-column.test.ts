import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChunkColumn } from '../../src/world/column';
import { BlockRegistry } from '../../src/world/blocks/registry';
import {
  serializeColumnBinary,
  deserializeColumnBinary,
  serializeColumn,
  deserializeColumn,
  calculateBitsPerEntry,
} from '../../src/persist/column-format';
import { migrations } from '../../src/persist/version';
import { PRNG } from '../../src/engine/rng';
import { OVERWORLD_BIOME_IDS } from '../../src/gen/biomes';

describe('M17a — Column Serialization & Binary Format', () => {
  beforeEach(() => {
    migrations.clear();
    BlockRegistry.getInstance();
  });

  afterEach(() => {
    migrations.clear();
  });

  it('calculates correct bits-per-entry steps for palette sizes', () => {
    expect(calculateBitsPerEntry(0)).toBe(0);
    expect(calculateBitsPerEntry(1)).toBe(0);
    expect(calculateBitsPerEntry(2)).toBe(1);
    expect(calculateBitsPerEntry(3)).toBe(2);
    expect(calculateBitsPerEntry(4)).toBe(2);
    expect(calculateBitsPerEntry(5)).toBe(4);
    expect(calculateBitsPerEntry(16)).toBe(4);
    expect(calculateBitsPerEntry(17)).toBe(8);
    expect(calculateBitsPerEntry(256)).toBe(8);
    expect(calculateBitsPerEntry(257)).toBe(16);
    expect(calculateBitsPerEntry(4096)).toBe(16);
  });

  it('round-trips uniform and null sections losslessly in uncompressed binary and deflate', async () => {
    const col = new ChunkColumn(5, -7);
    // Section 0: uniform stone (stateId 24)
    const sec0 = col.getOrCreateSection(0);
    sec0!.fill(24);

    // Section 1: uniform dirt (stateId 27)
    const sec1 = col.getOrCreateSection(1);
    sec1!.fill(27);

    // Section 2..19: null (unallocated air)

    // Binary round-trip
    const binary = serializeColumnBinary(col);
    const restoredBinary = deserializeColumnBinary(binary);

    expect(restoredBinary.cx).toBe(5);
    expect(restoredBinary.cz).toBe(-7);
    expect(restoredBinary.getSection(0)?.getBitsPerEntry()).toBe(0);
    expect(restoredBinary.getSection(0)?.uniformStateId).toBe(24);
    expect(restoredBinary.getSection(1)?.getBitsPerEntry()).toBe(0);
    expect(restoredBinary.getSection(1)?.uniformStateId).toBe(27);
    expect(restoredBinary.getSection(2)).toBeNull();

    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        expect(restoredBinary.getBlockStateId(x, 5, z)).toBe(24);
        expect(restoredBinary.getBlockStateId(x, 20, z)).toBe(27);
        expect(restoredBinary.getBlockStateId(x, 40, z)).toBe(0);
      }
    }

    // Compressed deflate round-trip
    const compressed = await serializeColumn(col);
    const restoredCompressed = await deserializeColumn(compressed);

    expect(restoredCompressed.cx).toBe(5);
    expect(restoredCompressed.cz).toBe(-7);
    expect(restoredCompressed.getBlockStateId(8, 5, 8)).toBe(24);
    expect(restoredCompressed.getBlockStateId(8, 20, 8)).toBe(27);
    expect(restoredCompressed.getBlockStateId(8, 40, 8)).toBe(0);
  });

  it('round-trips sections with 1-bit palette (2 entries) losslessly', async () => {
    const col = new ChunkColumn(0, 0);
    const sec = col.getOrCreateSection(0)!;
    // States 0 (air) and 24 (cobblestone)
    const states = [0, 24];
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) {
          sec.setBlockStateId(x, y, z, states[(x + y + z) % 2]!);
        }
      }
    }
    expect(sec.getBitsPerEntry()).toBe(1);

    const compressed = await serializeColumn(col);
    const restored = await deserializeColumn(compressed);
    const restoredSec = restored.getSection(0)!;

    expect(restoredSec.getBitsPerEntry()).toBe(1);
    expect(restoredSec.getPalette()).toEqual(sec.getPalette());

    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) {
          expect(restored.getBlockStateId(x, y, z)).toBe(sec.getBlockStateId(x, y, z));
        }
      }
    }
  });

  it('round-trips sections with 2-bit palette (3-4 entries) losslessly', async () => {
    const col = new ChunkColumn(1, 2);
    const sec = col.getOrCreateSection(0)!;
    // States: 0 (air), 24 (cobblestone), 27 (dirt), 31 (grass_block)
    const states = [0, 24, 27, 31];
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) {
          sec.setBlockStateId(x, y, z, states[(x * 3 + y * 7 + z) % 4]!);
        }
      }
    }
    expect(sec.getBitsPerEntry()).toBe(2);

    const compressed = await serializeColumn(col);
    const restored = await deserializeColumn(compressed);
    const restoredSec = restored.getSection(0)!;

    expect(restoredSec.getBitsPerEntry()).toBe(2);
    expect(restoredSec.getPalette()).toEqual(sec.getPalette());

    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) {
          expect(restored.getBlockStateId(x, y, z)).toBe(sec.getBlockStateId(x, y, z));
        }
      }
    }
  });

  it('round-trips sections with 4-bit palette (5-16 entries) losslessly', async () => {
    const col = new ChunkColumn(-3, 4);
    const sec = col.getOrCreateSection(0)!;
    // 16 distinct registered state IDs
    const states = [0, 1, 2, 5, 6, 9, 10, 11, 12, 13, 14, 23, 24, 25, 27, 31];
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) {
          sec.setBlockStateId(x, y, z, states[(x * 5 + y * 11 + z * 13) % 16]!);
        }
      }
    }
    expect(sec.getBitsPerEntry()).toBe(4);

    const compressed = await serializeColumn(col);
    const restored = await deserializeColumn(compressed);
    const restoredSec = restored.getSection(0)!;

    expect(restoredSec.getBitsPerEntry()).toBe(4);
    expect(restoredSec.getPalette()).toEqual(sec.getPalette());

    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) {
          expect(restored.getBlockStateId(x, y, z)).toBe(sec.getBlockStateId(x, y, z));
        }
      }
    }
  });

  it('round-trips sections with 8-bit palette (17-256 entries) losslessly', async () => {
    const col = new ChunkColumn(10, 20);
    const sec = col.getOrCreateSection(0)!;
    // 80 distinct registered state IDs from 0 to 120
    const allRegistered = BlockRegistry.getInstance().getAllStateIds();
    const states = allRegistered.slice(0, 80);
    expect(states.length).toBe(80);

    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) {
          sec.setBlockStateId(x, y, z, states[(x * 17 + y * 23 + z * 29) % states.length]!);
        }
      }
    }
    expect(sec.getBitsPerEntry()).toBe(8);

    const compressed = await serializeColumn(col);
    const restored = await deserializeColumn(compressed);
    const restoredSec = restored.getSection(0)!;

    expect(restoredSec.getBitsPerEntry()).toBe(8);
    expect(restoredSec.getPalette()).toEqual(sec.getPalette());

    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) {
          expect(restored.getBlockStateId(x, y, z)).toBe(sec.getBlockStateId(x, y, z));
        }
      }
    }
  });

  it('round-trips sections with 16-bit palette (>256 entries) losslessly', () => {
    const col = new ChunkColumn(7, -8);
    const sec = col.getOrCreateSection(0)!;

    // Adopt a packed storage with 300 palette entries (16-bit indices)
    const palette = new Uint16Array(300);
    for (let i = 0; i < 300; i++) {
      palette[i] = i + 1;
    }
    const indices = new Uint16Array(4096);
    const refCounts = new Uint16Array(300);
    for (let i = 0; i < 4096; i++) {
      const pIdx = i % 300;
      indices[i] = pIdx;
      refCounts[pIdx]!++;
    }

    sec.adoptPackedStorage({
      uniformStateId: 1,
      bits: 16,
      palette,
      refCounts,
      indices,
    });
    expect(sec.getBitsPerEntry()).toBe(16);

    // Serialize and deserialize with validateStateIds: false to allow synthetic 300 state IDs
    const binary = serializeColumnBinary(col);
    const restored = deserializeColumnBinary(binary, { validateStateIds: false });
    const restoredSec = restored.getSection(0)!;

    expect(restoredSec.getBitsPerEntry()).toBe(16);
    expect(restoredSec.getPalette()).toEqual(Array.from(palette));

    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) {
          expect(restored.getBlockStateId(x, y, z)).toBe(sec.getBlockStateId(x, y, z));
        }
      }
    }
  });

  it('round-trips a fully randomized multi-section column with 100% losslessness', async () => {
    const rng = new PRNG(1337);
    const col = new ChunkColumn(-12, 34);

    const registered = BlockRegistry.getInstance().getAllStateIds();

    // Populate various sections across y=0..19:
    // - Section 0: uniform bedrock/foundation (state 28)
    col.getOrCreateSection(0)!.fill(28);

    // - Section 1: 1-bit palette
    const sec1 = col.getOrCreateSection(1)!;
    const states1 = [24, 27];
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) {
          sec1.setBlockStateId(x, y, z, states1[Math.floor(rng.next() * states1.length)]!);
        }
      }
    }

    // - Section 2: 2-bit palette
    const sec2 = col.getOrCreateSection(2)!;
    const states2 = [0, 24, 27, 31];
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) {
          sec2.setBlockStateId(x, y, z, states2[Math.floor(rng.next() * states2.length)]!);
        }
      }
    }

    // - Section 3: 4-bit palette (12 entries)
    const sec3 = col.getOrCreateSection(3)!;
    const states3 = registered.slice(0, 12);
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) {
          sec3.setBlockStateId(x, y, z, states3[Math.floor(rng.next() * states3.length)]!);
        }
      }
    }

    // - Section 4: 8-bit palette (30 entries)
    const sec4 = col.getOrCreateSection(4)!;
    const states4 = registered.slice(0, 30);
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) {
          sec4.setBlockStateId(x, y, z, states4[Math.floor(rng.next() * states4.length)]!);
        }
      }
    }

    // - Sections 5..19: null (air)

    // Set custom biome indices
    const biomeIndices = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      biomeIndices[i] = i % OVERWORLD_BIOME_IDS.length;
    }
    col.setBiomeIndices(biomeIndices, OVERWORLD_BIOME_IDS);

    const compressed = await serializeColumn(col);
    const restored = await deserializeColumn(compressed);

    expect(restored.cx).toBe(-12);
    expect(restored.cz).toBe(34);
    expect(restored.biomeIndices).toEqual(col.biomeIndices);
    expect(restored.biomes).toEqual(col.biomes);

    // Verify all 81,920 blocks match exactly
    for (let sy = 0; sy < ChunkColumn.SECTION_COUNT; sy++) {
      const origSec = col.getSection(sy);
      const restSec = restored.getSection(sy);

      if (!origSec) {
        expect(restSec).toBeNull();
      } else {
        expect(restSec).not.toBeNull();
        expect(restSec!.getBitsPerEntry()).toBe(origSec.getBitsPerEntry());
        expect(restSec!.getPalette()).toEqual(origSec.getPalette());
      }

      for (let ly = 0; ly < 16; ly++) {
        const y = (sy << 4) | ly;
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) {
            const expected = col.getBlockStateId(x, y, z);
            const actual = restored.getBlockStateId(x, y, z);
            if (actual !== expected) {
              throw new Error(`Mismatch at (${x},${y},${z}): expected ${expected}, got ${actual}`);
            }
          }
        }
      }
    }
  });

  it('fails clearly on unknown state ID (does not silently become air)', () => {
    const col = new ChunkColumn(0, 0);
    // Construct binary data directly with an unknown state ID: 99999
    const binary = serializeColumnBinary(col);
    // Put unknown state ID into a uniform section at section 0
    const corrupted = new Uint8Array(binary.length + 2);
    corrupted.set(binary);
    const view = new DataView(corrupted.buffer);
    // Offset 271: section 0 paletteSize = 1, followed by stateId = 9999
    view.setUint16(271, 1, true); // paletteSize = 1
    view.setUint16(273, 9999, true); // unknown stateId

    expect(() => deserializeColumnBinary(corrupted)).toThrowError(/Unknown block state ID: 9999/);
  });

  it('fails clearly on wrong magic bytes', () => {
    const col = new ChunkColumn(0, 0);
    const binary = serializeColumnBinary(col);
    binary[0] = 0x00; // Corrupt magic byte

    expect(() => deserializeColumnBinary(binary)).toThrowError(/Invalid column format magic bytes/);
  });

  it('fails clearly on unsupported format version when no migration registered', () => {
    const col = new ChunkColumn(0, 0);
    const binary = serializeColumnBinary(col);
    const view = new DataView(binary.buffer);
    view.setUint16(4, 99, true); // Future version 99

    expect(() => deserializeColumnBinary(binary)).toThrowError(
      /Cannot migrate column from future version 99 to 1/,
    );
  });

  it('executes migration hook when format version is older', () => {
    const col = new ChunkColumn(3, 4);
    col.getOrCreateSection(0)!.fill(24);
    const binary = serializeColumnBinary(col);

    // Mock an older format version: version 0
    const v0Data = new Uint8Array(binary);
    new DataView(v0Data.buffer).setUint16(4, 0, true);

    // Without migration registered, loading version 0 should fail
    expect(() => deserializeColumnBinary(v0Data)).toThrowError(
      /No migration registered for column version 0 -> 1/,
    );

    // Register a migration 0 -> 1 that updates the version header
    let migrationCalled = false;
    migrations.registerColumn(0, (data) => {
      migrationCalled = true;
      const upgraded = new Uint8Array(data);
      new DataView(upgraded.buffer).setUint16(4, 1, true);
      return upgraded;
    });

    const restored = deserializeColumnBinary(v0Data);
    expect(migrationCalled).toBe(true);
    expect(restored.cx).toBe(3);
    expect(restored.cz).toBe(4);
    expect(restored.getBlockStateId(0, 0, 0)).toBe(24);
  });

  it('compresses all-air column to a small size and reports typical column size', async () => {
    // 1. All-air column
    const airCol = new ChunkColumn(0, 0);
    const compressedAir = await serializeColumn(airCol);

    // Report exact size
    console.log(`[Report] All-air column compressed size: ${compressedAir.length} bytes`);
    expect(compressedAir.length).toBeLessThan(100);

    // 2. Typical generated column (terrain: foundation stone at bottom, stone, dirt, grass top, air above)
    const genCol = new ChunkColumn(0, 0);
    // y=0: foundation stone (28)
    genCol.getOrCreateSection(0)!.fill(28);
    // y=1..3 (heights 16..63): stone (24)
    genCol.getOrCreateSection(1)!.fill(24);
    genCol.getOrCreateSection(2)!.fill(24);
    genCol.getOrCreateSection(3)!.fill(24);
    // y=4 (heights 64..79): dirt (27) with top layer grass_block (31)
    const sec4 = genCol.getOrCreateSection(4)!;
    for (let x = 0; x < 16; x++) {
      for (let ly = 0; ly < 16; ly++) {
        for (let z = 0; z < 16; z++) {
          if (ly < 10)
            sec4.setBlockStateId(x, ly, z, 27); // dirt
          else if (ly === 10)
            sec4.setBlockStateId(x, ly, z, 31); // grass
          else sec4.setBlockStateId(x, ly, z, 0); // air
        }
      }
    }
    // y=5..19: air (null)

    const compressedGen = await serializeColumn(genCol);
    console.log(`[Report] Typical generated column compressed size: ${compressedGen.length} bytes`);

    // Verify round trip of the generated column
    const restoredGen = await deserializeColumn(compressedGen);
    expect(restoredGen.getBlockStateId(0, 0, 0)).toBe(28);
    expect(restoredGen.getBlockStateId(5, 30, 5)).toBe(24);
    expect(restoredGen.getBlockStateId(5, 64 + 8, 5)).toBe(27);
    expect(restoredGen.getBlockStateId(5, 64 + 10, 5)).toBe(31);
    expect(restoredGen.getBlockStateId(5, 64 + 12, 5)).toBe(0);
  });
});
