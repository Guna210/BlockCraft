import { describe, it, expect, beforeEach } from 'vitest';
import { ChunkSection } from '../../src/world/chunk';
import { World } from '../../src/world/world';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { PRNG, hashString } from '../../src/engine/rng';

describe('ChunkSection & World Unit Tests', () => {
  beforeEach(() => {
    BlockRegistry.resetInstance();
  });

  it('all-air section and all-stone section have null palette, refCounts and indices, and getByteSize() == 4', () => {
    const airSection = new ChunkSection(0); // all-air
    expect(airSection.palette).toBeNull();
    expect(airSection.refCounts).toBeNull();
    expect(airSection.indices).toBeNull();
    expect(airSection.getBitsPerEntry()).toBe(0);
    expect(airSection.getByteSize()).toBe(4);

    const stoneSection = new ChunkSection(1); // all-stone
    expect(stoneSection.palette).toBeNull();
    expect(stoneSection.refCounts).toBeNull();
    expect(stoneSection.indices).toBeNull();
    expect(stoneSection.getBitsPerEntry()).toBe(0);
    expect(stoneSection.getByteSize()).toBe(4);
  });

  it('palette grows through 1, 2, 4, 8, 16 bits and compacts back when entries are replaced', () => {
    const section = new ChunkSection(0); // 0 bits per entry, uniform (null buffers)
    expect(section.palette).toBeNull();
    expect(section.refCounts).toBeNull();
    expect(section.indices).toBeNull();

    // Write 2 block states
    section.setBlockStateId(0, 0, 0, 1);
    expect(section.getBitsPerEntry()).toBe(1); // 2 entries -> 1 bit
    expect(section.palette).not.toBeNull();

    // Write up to 4 block states
    section.setBlockStateId(1, 0, 0, 2);
    section.setBlockStateId(2, 0, 0, 3);
    expect(section.getBitsPerEntry()).toBe(2); // 4 entries -> 2 bits

    // Write up to 16 block states (ids 4 to 15)
    for (let i = 4; i < 16; i++) {
      section.setBlockStateId(i & 15, (i >> 4) & 15, 0, i);
    }
    expect(section.getBitsPerEntry()).toBe(4); // 16 entries -> 4 bits

    // Write 20 total block types (ids 16 to 19)
    for (let i = 16; i < 20; i++) {
      section.setBlockStateId(i & 15, (i >> 4) & 15, 0, i);
    }
    expect(section.getBitsPerEntry()).toBe(8); // 20 entries -> 8 bits

    // Overwrite ALL blocks in the 16x16x16 section except at (0,0,0) and (1,0,0) to state ID 1
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) {
          if (x === 0 && y === 0 && z === 0) continue; // state ID 1
          if (x === 1 && y === 0 && z === 0) continue; // state ID 2
          section.setBlockStateId(x, y, z, 1);
        }
      }
    }

    // Only state ID 1 (at almost all positions) and state ID 2 (at 1,0,0) remain
    expect(section.getPaletteSize()).toBe(2);
    expect(section.getBitsPerEntry()).toBe(1); // Real shrink to 1 bit per entry!

    // Overwrite (1,0,0) to state ID 1 so only a single state remains
    section.setBlockStateId(1, 0, 0, 1);
    expect(section.getPaletteSize()).toBe(1);
    expect(section.getBitsPerEntry()).toBe(0); // Uniform section
    expect(section.palette).toBeNull();
    expect(section.refCounts).toBeNull();
    expect(section.indices).toBeNull();
  });

  it('grows palette past 256 distinct states (16-bit path), verifies all 4096 blocks against reference array, then compacts back', () => {
    const section = new ChunkSection(0);
    const rng = new PRNG(hashString('16-bit-palette-test-seed'));
    const expectedBlocks = new Uint16Array(4096);

    // Populate all 4096 blocks with 300 distinct state IDs (ids 1 to 300)
    let blockCount = 0;
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) {
          const stateId = (blockCount % 300) + 1;
          section.setBlockStateId(x, y, z, stateId);
          const idx = (y << 8) | (z << 4) | x;
          expectedBlocks[idx] = stateId;
          blockCount++;
        }
      }
    }

    expect(section.getPaletteSize()).toBe(300);
    expect(section.getBitsPerEntry()).toBe(16); // 300 entries > 256 -> 16 bits per entry

    // Perform random overwrites with state IDs up to 350
    for (let i = 0; i < 2000; i++) {
      const rx = Math.floor(rng.next() * 16);
      const ry = Math.floor(rng.next() * 16);
      const rz = Math.floor(rng.next() * 16);
      const newStateId = Math.floor(rng.next() * 350) + 1;

      section.setBlockStateId(rx, ry, rz, newStateId);
      const idx = (ry << 8) | (rz << 4) | rx;
      expectedBlocks[idx] = newStateId;
    }

    // Verify all 4096 blocks match reference array
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) {
          const actual = section.getBlockStateId(x, y, z);
          const idx = (y << 8) | (z << 4) | x;
          expect(actual).toBe(expectedBlocks[idx]);
        }
      }
    }

    // Overwrite all blocks down to 2 state IDs
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) {
          const state = x === 0 && y === 0 && z === 0 ? 999 : 888;
          section.setBlockStateId(x, y, z, state);
        }
      }
    }

    expect(section.getPaletteSize()).toBe(2);
    expect(section.getBitsPerEntry()).toBe(1);

    // Overwrite all blocks down to 1 state ID
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) {
          section.setBlockStateId(x, y, z, 888);
        }
      }
    }

    expect(section.getPaletteSize()).toBe(1);
    expect(section.getBitsPerEntry()).toBe(0);
    expect(section.palette).toBeNull();
    expect(section.refCounts).toBeNull();
    expect(section.indices).toBeNull();
  });

  it('10,000 random writes round-trip losslessly using state IDs beyond 16 and verifying against reference Map', () => {
    const world = new World();
    const rng = new PRNG(hashString('chunk-test-seed-12345'));

    function nextInt(min: number, max: number): number {
      return Math.floor(rng.next() * (max - min + 1)) + min;
    }

    const referenceMap = new Map<string, number>();

    const numWrites = 10000;
    const maxStateId = 300; // Exercises 1, 2, 4, 8, 16 bits

    for (let i = 0; i < numWrites; i++) {
      const x = nextInt(-100, 100);
      const y = nextInt(0, 319);
      const z = nextInt(-100, 100);
      const stateId = nextInt(0, maxStateId);

      world.setBlockStateId(x, y, z, stateId);
      referenceMap.set(`${x},${y},${z}`, stateId);
    }

    // Verify all written coordinates match their latest value from referenceMap
    for (const [key, expectedState] of referenceMap.entries()) {
      const [x, y, z] = key.split(',').map(Number);
      const actualState = world.getBlockStateId(x!, y!, z!);
      expect(actualState).toBe(expectedState);
    }
  });

  it('world-to-chunk coordinate math handles negative coordinates and cross-boundary reads/writes', () => {
    const world = new World();

    // Cross-boundary write at negative coordinates
    world.setBlock(-1, 0, -1, 'stone');
    world.setBlock(0, 0, 0, 'dirt');
    world.setBlock(-16, 319, -16, 'cobblestone');

    expect(world.getBlock(-1, 0, -1).id).toBe('stone');
    expect(world.getBlock(0, 0, 0).id).toBe('dirt');
    expect(world.getBlock(-16, 319, -16).id).toBe('cobblestone');

    // Cross section edges within column (y = 0..319)
    for (let y = 0; y < 320; y += 15) {
      world.setBlock(5, y, 5, 'sand');
    }
    for (let y = 0; y < 320; y += 15) {
      expect(world.getBlock(5, y, 5).id).toBe('sand');
    }
  });
});
