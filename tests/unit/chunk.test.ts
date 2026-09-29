import { describe, it, expect, beforeEach } from 'vitest';
import { ChunkSection } from '../../src/world/chunk';
import { World } from '../../src/world/world';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { PRNG, hashString } from '../../src/engine/rng';

describe('ChunkSection & World Unit Tests', () => {
  beforeEach(() => {
    BlockRegistry.resetInstance();
  });

  it('all-air section byte size is <= 64 bytes', () => {
    const section = new ChunkSection(0);
    expect(section.getByteSize()).toBeLessThanOrEqual(64);
  });

  it('palette grows (1->2->4->8->16 bits) and compacts back when entries are replaced', () => {
    const section = new ChunkSection(0); // 0 bits per entry, uniform
    expect(section.getBitsPerEntry()).toBe(0);

    // Write 2 block states
    section.setBlockStateId(0, 0, 0, 1);
    expect(section.getBitsPerEntry()).toBe(1); // 2 entries -> 1 bit

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
    expect(section.getBitsPerEntry()).toBe(0); // Uniform section, no index array!
  });

  it('10,000 random writes round-trip losslessly (seeded PRNG)', () => {
    const world = new World();
    const rng = new PRNG(hashString('chunk-test-seed-12345'));

    function nextInt(min: number, max: number): number {
      return Math.floor(rng.next() * (max - min + 1)) + min;
    }

    const coords: [number, number, number][] = [];
    const expectedStates: number[] = [];

    const numWrites = 10000;
    const maxStateId = 15; // random state IDs between 0 and 15

    for (let i = 0; i < numWrites; i++) {
      // Pick random coordinates within bounds (including negative world coords)
      const x = nextInt(-100, 100);
      const y = nextInt(0, 319);
      const z = nextInt(-100, 100);
      const stateId = nextInt(0, maxStateId);

      world.setBlockStateId(x, y, z, stateId);

      // Save a sample of coordinate/state pairs to check later
      if (i % 5 === 0) {
        coords.push([x, y, z]);
        expectedStates.push(stateId);
      }
    }

    // Verify written values
    for (let i = 0; i < coords.length; i++) {
      const [x, y, z] = coords[i]!;
      const state = world.getBlockStateId(x, y, z);
      expect(state).toBe(expectedStates[i]);
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
