import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChunkColumn } from '../../src/world/column';
import { World } from '../../src/world/world';
import { BlockRegistry } from '../../src/world/blocks/registry';
import {
  serializeColumnBinary,
  deserializeColumnBinary,
  serializeColumn,
  deserializeColumn,
  calculateBitsPerEntry,
  HEADER_SIZE,
} from '../../src/persist/column-format';
import { migrations } from '../../src/persist/version';
import { PRNG } from '../../src/engine/rng';
import { OVERWORLD_BIOME_IDS } from '../../src/gen/biomes';
import { createDefaultPipeline } from '../../src/gen/pipeline';

describe('M17a — Column Serialization & Binary Format', () => {
  let stoneId: number;
  let dirtId: number;
  let grassBlockId: number;
  let cobblestoneId: number;
  let foundationStoneId: number;
  let sandId: number;
  let oakPlanksId: number;
  let glassId: number;
  const airId = 0;

  beforeEach(() => {
    migrations.clear();
    const registry = BlockRegistry.getInstance();
    stoneId = registry.getDefaultStateId('stone')!;
    dirtId = registry.getDefaultStateId('dirt')!;
    grassBlockId = registry.getDefaultStateId('grass_block')!;
    cobblestoneId = registry.getDefaultStateId('cobblestone')!;
    foundationStoneId = registry.getDefaultStateId('foundation_stone')!;
    sandId = registry.getDefaultStateId('sand')!;
    oakPlanksId = registry.getDefaultStateId('oak_planks')!;
    glassId = registry.getDefaultStateId('glass')!;
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

  it('round-trips uniform and null sections losslessly in uncompressed binary and deflate with custom tints', async () => {
    const col = new ChunkColumn(5, -7);
    // Section 0: uniform cobblestone
    const sec0 = col.getOrCreateSection(0);
    sec0!.fill(cobblestoneId);

    // Section 1: uniform dirt
    const sec1 = col.getOrCreateSection(1);
    sec1!.fill(dirtId);

    // Non-default grass and foliage tints
    for (let i = 0; i < 256 * 3; i++) {
      col.grassTints[i] = (i * 17 + 23) % 256;
      col.foliageTints[i] = (i * 31 + 7) % 256;
    }

    // Section 2..19: null (unallocated air)

    // Binary round-trip
    const binary = serializeColumnBinary(col);
    const restoredBinary = deserializeColumnBinary(binary);

    expect(restoredBinary.cx).toBe(5);
    expect(restoredBinary.cz).toBe(-7);
    expect(restoredBinary.getSection(0)?.getBitsPerEntry()).toBe(0);
    expect(restoredBinary.getSection(0)?.uniformStateId).toBe(cobblestoneId);
    expect(restoredBinary.getSection(1)?.getBitsPerEntry()).toBe(0);
    expect(restoredBinary.getSection(1)?.uniformStateId).toBe(dirtId);
    expect(restoredBinary.getSection(2)).toBeNull();

    expect(restoredBinary.grassTints).toEqual(col.grassTints);
    expect(restoredBinary.foliageTints).toEqual(col.foliageTints);

    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        expect(restoredBinary.getBlockStateId(x, 5, z)).toBe(cobblestoneId);
        expect(restoredBinary.getBlockStateId(x, 20, z)).toBe(dirtId);
        expect(restoredBinary.getBlockStateId(x, 40, z)).toBe(0);
      }
    }

    // Compressed deflate round-trip
    const compressed = await serializeColumn(col);
    const restoredCompressed = await deserializeColumn(compressed);

    expect(restoredCompressed.cx).toBe(5);
    expect(restoredCompressed.cz).toBe(-7);
    expect(restoredCompressed.grassTints).toEqual(col.grassTints);
    expect(restoredCompressed.foliageTints).toEqual(col.foliageTints);
    expect(restoredCompressed.getBlockStateId(8, 5, 8)).toBe(cobblestoneId);
    expect(restoredCompressed.getBlockStateId(8, 20, 8)).toBe(dirtId);
    expect(restoredCompressed.getBlockStateId(8, 40, 8)).toBe(0);
  });

  it('round-trips sections with 1-bit palette (2 entries) losslessly', async () => {
    const col = new ChunkColumn(0, 0);
    const sec = col.getOrCreateSection(0)!;
    // States air and cobblestone
    const states = [airId, cobblestoneId];
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) {
          sec.setBlockStateId(x, y, z, states[(x + y + z) % 2]!);
        }
      }
    }
    expect(sec.getBitsPerEntry()).toBe(1);

    // Non-default column tints
    for (let i = 0; i < 256 * 3; i++) {
      col.grassTints[i] = (i * 7 + 13) % 256;
      col.foliageTints[i] = (i * 11 + 17) % 256;
    }

    const compressed = await serializeColumn(col);
    const restored = await deserializeColumn(compressed);
    const restoredSec = restored.getSection(0)!;

    expect(restoredSec.getBitsPerEntry()).toBe(1);
    expect(restoredSec.getPalette()).toEqual(sec.getPalette());
    expect(restored.grassTints).toEqual(col.grassTints);
    expect(restored.foliageTints).toEqual(col.foliageTints);

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
    // States: air, cobblestone, dirt, grass_block
    const states = [airId, cobblestoneId, dirtId, grassBlockId];
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) {
          sec.setBlockStateId(x, y, z, states[(x * 3 + y * 7 + z) % 4]!);
        }
      }
    }
    expect(sec.getBitsPerEntry()).toBe(2);

    // Non-default column tints
    for (let i = 0; i < 256 * 3; i++) {
      col.grassTints[i] = (i * 13 + 3) % 256;
      col.foliageTints[i] = (i * 19 + 5) % 256;
    }

    const compressed = await serializeColumn(col);
    const restored = await deserializeColumn(compressed);
    const restoredSec = restored.getSection(0)!;

    expect(restoredSec.getBitsPerEntry()).toBe(2);
    expect(restoredSec.getPalette()).toEqual(sec.getPalette());
    expect(restored.grassTints).toEqual(col.grassTints);
    expect(restored.foliageTints).toEqual(col.foliageTints);

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
    const allRegistered = BlockRegistry.getInstance().getAllStateIds();
    const states = allRegistered.slice(0, 16);
    expect(states.length).toBe(16);

    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) {
          sec.setBlockStateId(x, y, z, states[(x * 5 + y * 11 + z * 13) % 16]!);
        }
      }
    }
    expect(sec.getBitsPerEntry()).toBe(4);

    // Non-default column tints
    for (let i = 0; i < 256 * 3; i++) {
      col.grassTints[i] = (i * 23 + 7) % 256;
      col.foliageTints[i] = (i * 29 + 11) % 256;
    }

    const compressed = await serializeColumn(col);
    const restored = await deserializeColumn(compressed);
    const restoredSec = restored.getSection(0)!;

    expect(restoredSec.getBitsPerEntry()).toBe(4);
    expect(restoredSec.getPalette()).toEqual(sec.getPalette());
    expect(restored.grassTints).toEqual(col.grassTints);
    expect(restored.foliageTints).toEqual(col.foliageTints);

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
    // 80 distinct registered state IDs
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

    // Non-default column tints
    for (let i = 0; i < 256 * 3; i++) {
      col.grassTints[i] = (i * 31 + 17) % 256;
      col.foliageTints[i] = (i * 37 + 19) % 256;
    }

    const compressed = await serializeColumn(col);
    const restored = await deserializeColumn(compressed);
    const restoredSec = restored.getSection(0)!;

    expect(restoredSec.getBitsPerEntry()).toBe(8);
    expect(restoredSec.getPalette()).toEqual(sec.getPalette());
    expect(restored.grassTints).toEqual(col.grassTints);
    expect(restored.foliageTints).toEqual(col.foliageTints);

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

    // Non-default column tints
    for (let i = 0; i < 256 * 3; i++) {
      col.grassTints[i] = (i * 41 + 23) % 256;
      col.foliageTints[i] = (i * 43 + 29) % 256;
    }

    // Serialize and deserialize with validateStateIds: false to allow synthetic 300 state IDs
    const binary = serializeColumnBinary(col);
    const restored = deserializeColumnBinary(binary, { validateStateIds: false });
    const restoredSec = restored.getSection(0)!;

    expect(restoredSec.getBitsPerEntry()).toBe(16);
    expect(restoredSec.getPalette()).toEqual(Array.from(palette));
    expect(restored.grassTints).toEqual(col.grassTints);
    expect(restored.foliageTints).toEqual(col.foliageTints);

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
    // - Section 0: uniform foundation_stone
    col.getOrCreateSection(0)!.fill(foundationStoneId);

    // - Section 1: 1-bit palette
    const sec1 = col.getOrCreateSection(1)!;
    const states1 = [cobblestoneId, dirtId];
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) {
          sec1.setBlockStateId(x, y, z, states1[Math.floor(rng.next() * states1.length)]!);
        }
      }
    }

    // - Section 2: 2-bit palette
    const sec2 = col.getOrCreateSection(2)!;
    const states2 = [airId, cobblestoneId, dirtId, grassBlockId];
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

    // Set custom biome indices and non-default tints
    const biomeIndices = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      biomeIndices[i] = i % OVERWORLD_BIOME_IDS.length;
    }
    col.setBiomeIndices(biomeIndices, OVERWORLD_BIOME_IDS);

    for (let i = 0; i < 256 * 3; i++) {
      col.grassTints[i] = (i * 19 + 5) % 256;
      col.foliageTints[i] = (i * 23 + 11) % 256;
    }

    const compressed = await serializeColumn(col);
    const restored = await deserializeColumn(compressed);

    expect(restored.cx).toBe(-12);
    expect(restored.cz).toBe(34);
    expect(restored.biomeIndices).toEqual(col.biomeIndices);
    expect(restored.biomes).toEqual(col.biomes);
    expect(restored.grassTints).toEqual(col.grassTints);
    expect(restored.foliageTints).toEqual(col.foliageTints);

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

  it('handles palette compaction, exact palette/refCounts/indices round-trip, and editing restored section', () => {
    const col = new ChunkColumn(2, 3);
    const sec = col.getOrCreateSection(0)!;

    // 1. Place 6 block types in section
    const blockTypes = [stoneId, dirtId, grassBlockId, cobblestoneId, sandId, oakPlanksId];
    for (let i = 0; i < blockTypes.length; i++) {
      sec.setBlockStateId(i, 0, 0, blockTypes[i]!);
    }
    expect(sec.palette?.length).toBe(7); // default air (0) + 6 blocks

    // 2. Remove 3 block types by overwriting with air to trigger compaction
    sec.setBlockStateId(3, 0, 0, airId); // remove cobblestone
    sec.setBlockStateId(4, 0, 0, airId); // remove sand
    sec.setBlockStateId(5, 0, 0, airId); // remove oak_planks

    // Palette compacted down to 4 entries
    expect(sec.palette?.length).toBe(4); // air + stone + dirt + grass_block

    // Non-default column tints
    for (let i = 0; i < 256 * 3; i++) {
      col.grassTints[i] = (i * 3 + 1) % 256;
      col.foliageTints[i] = (i * 5 + 2) % 256;
    }

    // 3. Serialize and restore
    const binary = serializeColumnBinary(col);
    const restored = deserializeColumnBinary(binary);
    const restoredSec = restored.getSection(0)!;

    // Exact comparison of palette, refCounts, indices, and tints
    expect(restoredSec.palette).toEqual(sec.palette);
    expect(restoredSec.refCounts).toEqual(sec.refCounts);
    expect(restoredSec.indices).toEqual(sec.indices);
    expect(restored.grassTints).toEqual(col.grassTints);
    expect(restored.foliageTints).toEqual(col.foliageTints);

    // 4. Edit restored section and check it behaves identically to editing original
    sec.setBlockStateId(8, 8, 8, glassId);
    restoredSec.setBlockStateId(8, 8, 8, glassId);

    expect(restoredSec.getBlockStateId(8, 8, 8)).toBe(sec.getBlockStateId(8, 8, 8));
    expect(restoredSec.palette).toEqual(sec.palette);
    expect(restoredSec.refCounts).toEqual(sec.refCounts);
    expect(restoredSec.indices).toEqual(sec.indices);

    // 5. Also edit both via World.setBlock('glass') and verify identical behavior
    const w1 = new World(false);
    w1.setColumn(col);
    const w2 = new World(false);
    w2.setColumn(restored);

    w1.setBlock(2 * 16 + 9, 0, 3 * 16 + 9, 'glass');
    w2.setBlock(2 * 16 + 9, 0, 3 * 16 + 9, 'glass');

    expect(w2.getBlock(2 * 16 + 9, 0, 3 * 16 + 9)).toEqual({ id: 'glass', state: {} });
    expect(w2.getBlockStateId(2 * 16 + 9, 0, 3 * 16 + 9)).toBe(
      w1.getBlockStateId(2 * 16 + 9, 0, 3 * 16 + 9),
    );
    expect(restoredSec.palette).toEqual(sec.palette);
    expect(restoredSec.refCounts).toEqual(sec.refCounts);
    expect(restoredSec.indices).toEqual(sec.indices);
  });

  it('fails clearly on unknown state ID (does not silently become air)', () => {
    const col = new ChunkColumn(0, 0);
    const binary = serializeColumnBinary(col);
    // Put unknown state ID into a uniform section at section 0
    const corrupted = new Uint8Array(binary);
    const view = new DataView(corrupted.buffer);
    // Offset HEADER_SIZE: section 0 paletteSize = 1, followed by stateId = 9999
    view.setUint16(HEADER_SIZE, 1, true); // paletteSize = 1
    view.setUint16(HEADER_SIZE + 2, 9999, true); // unknown stateId

    expect(() => deserializeColumnBinary(corrupted)).toThrowError(/Unknown block state ID: 9999/);
  });

  it('fails clearly on out-of-range packed palette index across 2-bit, 4-bit, 8-bit, and 16-bit palettes', () => {
    // Case 1: 2-bit palette (3 entries). pIdx = 3 >= 3
    {
      const col = new ChunkColumn(0, 0);
      const sec = col.getOrCreateSection(0)!;
      sec.fill(stoneId);
      sec.setBlockStateId(0, 0, 0, dirtId);
      sec.setBlockStateId(1, 0, 0, sandId);
      expect(sec.getPaletteSize()).toBe(3);
      expect(sec.getBitsPerEntry()).toBe(2);

      const binary = serializeColumnBinary(col);
      const corrupted = new Uint8Array(binary);
      // Index at block 0 has value 3 >= 3
      corrupted[HEADER_SIZE + 2 + 3 * 2] = 0x03;

      expect(() => deserializeColumnBinary(corrupted)).toThrowError(
        /Palette index out of bounds: 3 >= 3/,
      );
    }

    // Case 2: 4-bit palette (5 entries). pIdx = 10 >= 5
    {
      const col = new ChunkColumn(0, 0);
      const sec = col.getOrCreateSection(0)!;
      sec.fill(stoneId);
      sec.setBlockStateId(0, 0, 0, dirtId);
      sec.setBlockStateId(1, 0, 0, grassBlockId);
      sec.setBlockStateId(2, 0, 0, cobblestoneId);
      sec.setBlockStateId(3, 0, 0, sandId);
      expect(sec.getPaletteSize()).toBe(5);
      expect(sec.getBitsPerEntry()).toBe(4);

      const binary = serializeColumnBinary(col);
      const corrupted = new Uint8Array(binary);
      // Index at block 0 has value 10 >= 5
      corrupted[HEADER_SIZE + 2 + 5 * 2] = 0x0a;

      expect(() => deserializeColumnBinary(corrupted)).toThrowError(
        /Palette index out of bounds: 10 >= 5/,
      );
    }

    // Case 3: 8-bit palette (20 entries). pIdx = 50 >= 20
    {
      const col = new ChunkColumn(0, 0);
      const sec = col.getOrCreateSection(0)!;
      const allStates = BlockRegistry.getInstance().getAllStateIds();
      sec.fill(stoneId);
      for (let i = 0; i < 19; i++) {
        sec.setBlockStateId(i, 0, 0, allStates[i]!);
      }
      expect(sec.getPaletteSize()).toBe(20);
      expect(sec.getBitsPerEntry()).toBe(8);

      const binary = serializeColumnBinary(col);
      const corrupted = new Uint8Array(binary);
      // Index at block 0 has value 50 >= 20
      corrupted[HEADER_SIZE + 2 + 20 * 2] = 50;

      expect(() => deserializeColumnBinary(corrupted)).toThrowError(
        /Palette index out of bounds: 50 >= 20/,
      );
    }

    // Case 4: 16-bit palette (300 entries). pIdx = 400 >= 300
    {
      const col = new ChunkColumn(0, 0);
      const sec = col.getOrCreateSection(0)!;
      const palette = new Uint16Array(300);
      for (let i = 0; i < 300; i++) palette[i] = i + 1;
      const indices = new Uint16Array(4096);
      const refCounts = new Uint16Array(300);
      for (let i = 0; i < 4096; i++) {
        indices[i] = i % 300;
        refCounts[i % 300]!++;
      }
      sec.adoptPackedStorage({
        uniformStateId: 1,
        bits: 16,
        palette,
        refCounts,
        indices,
      });

      const binary = serializeColumnBinary(col);
      const corrupted = new Uint8Array(binary);
      const view = new DataView(corrupted.buffer);
      // Corrupt first 16-bit index to 400 >= 300
      view.setUint16(HEADER_SIZE + 2 + 300 * 2, 400, true);

      expect(() => deserializeColumnBinary(corrupted, { validateStateIds: false })).toThrowError(
        /Palette index out of bounds: 400 >= 300/,
      );
    }
  });

  it('fails clearly when palette size exceeds section block count (4096)', () => {
    const col = new ChunkColumn(0, 0);
    const binary = serializeColumnBinary(col);
    const corrupted = new Uint8Array(binary);
    const view = new DataView(corrupted.buffer);
    view.setUint16(HEADER_SIZE, 5000, true); // paletteSize = 5000 > 4096

    expect(() => deserializeColumnBinary(corrupted)).toThrowError(/exceeds section block count/);
  });

  it('fails clearly on trailing bytes after last section', () => {
    const col = new ChunkColumn(0, 0);
    const binary = serializeColumnBinary(col);
    const withTrailing = new Uint8Array(binary.length + 5);
    withTrailing.set(binary);
    withTrailing.set([1, 2, 3, 4, 5], binary.length);

    expect(() => deserializeColumnBinary(withTrailing)).toThrowError(
      /Unexpected trailing data: 5 extra bytes/,
    );
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
    col.getOrCreateSection(0)!.fill(cobblestoneId);
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
    expect(restored.getBlockStateId(0, 0, 0)).toBe(cobblestoneId);
  });

  it('fails clearly when migration returns truncated column data smaller than header', () => {
    const col = new ChunkColumn(1, 1);
    const binary = serializeColumnBinary(col);
    const v0Data = new Uint8Array(binary);
    new DataView(v0Data.buffer).setUint16(4, 0, true);

    migrations.registerColumn(0, () => {
      // Return a truncated buffer with only 10 bytes
      return new Uint8Array(10);
    });

    expect(() => deserializeColumnBinary(v0Data)).toThrowError(
      /Invalid column binary: data too short for header/,
    );
  });

  it('compresses all-air column to a small size and reports typical column size from pipeline', async () => {
    // 1. All-air column
    const airCol = new ChunkColumn(0, 0);
    const compressedAir = await serializeColumn(airCol);

    // Report exact size
    console.log(`[Report] All-air column compressed size: ${compressedAir.length} bytes`);
    expect(compressedAir.length).toBeLessThan(100);

    // 2. Real pipeline-generated column (terrain shape, surface tints/rules, caves, ores, features)
    const pipeline = createDefaultPipeline();
    const pipelineCol = new ChunkColumn(0, 0);
    pipeline.generateColumn(12345, 0, 0, pipelineCol);

    const compressedPipeline = await serializeColumn(pipelineCol);
    console.log(
      `[Report] Pipeline generated column compressed size: ${compressedPipeline.length} bytes`,
    );

    // Verify round trip of the pipeline generated column
    const restoredPipeline = await deserializeColumn(compressedPipeline);
    expect(restoredPipeline.cx).toBe(pipelineCol.cx);
    expect(restoredPipeline.cz).toBe(pipelineCol.cz);
    expect(restoredPipeline.biomeIndices).toEqual(pipelineCol.biomeIndices);
    expect(restoredPipeline.grassTints).toEqual(pipelineCol.grassTints);
    expect(restoredPipeline.foliageTints).toEqual(pipelineCol.foliageTints);

    for (let sy = 0; sy < ChunkColumn.SECTION_COUNT; sy++) {
      const origSec = pipelineCol.getSection(sy);
      const restSec = restoredPipeline.getSection(sy);
      if (!origSec) {
        expect(restSec).toBeNull();
      } else {
        expect(restSec).not.toBeNull();
        expect(restSec!.getBitsPerEntry()).toBe(origSec.getBitsPerEntry());
      }
    }
  });
});
