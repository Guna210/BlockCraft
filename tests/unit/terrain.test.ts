import { describe, it, expect, beforeEach } from 'vitest';
import { createDefaultPipeline } from '../../src/gen/pipeline';
import { World } from '../../src/world/world';
import { hashString } from '../../src/engine/rng';
import { BlockRegistry } from '../../src/world/blocks/registry';

describe('Terrain Pipeline & Generator Unit Tests (M03b)', () => {
  beforeEach(() => {
    BlockRegistry.resetInstance();
    BlockRegistry.getInstance();
  });

  it('pipeline derives stageSeed and executes pure stages deterministically', () => {
    const pipeline = createDefaultPipeline();
    const worldSeed = hashString('blockcraft-test-seed-42');

    const world1 = new World();
    const world2 = new World();

    const col1 = world1.getColumn(0, 0, true)!;
    const col2 = world2.getColumn(0, 0, true)!;

    pipeline.generateColumn(worldSeed, 0, 0, col1);
    pipeline.generateColumn(worldSeed, 0, 0, col2);

    const hash1 = world1.worldHash(0, 0, 15, 15);
    const hash2 = world2.worldHash(0, 0, 15, 15);

    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(8);
  });

  it('Foundation Stone fills y=0 100% and y=1..4 with a noisy transition', () => {
    const worldSeed = hashString('blockcraft-test-seed-42');
    const world = new World();
    const col = world.getColumn(0, 0, true)!;

    const pipeline = createDefaultPipeline();
    pipeline.generateColumn(worldSeed, 0, 0, col);

    // Check y=0 is 100% foundation_stone across 16x16 column
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        expect(world.getBlock(x, 0, z).id).toBe('foundation_stone');
      }
    }

    // Check y=1..4 has foundation_stone
    let foundationCount = 0;
    for (let y = 1; y <= 4; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          if (world.getBlock(x, y, z).id === 'foundation_stone') {
            foundationCount++;
          }
        }
      }
    }
    expect(foundationCount).toBeGreaterThan(0);

    // Check y=10 has no foundation_stone
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        expect(world.getBlock(x, 10, z).id).not.toBe('foundation_stone');
      }
    }
  });

  it('M03b terrain produces only stone, water, foundation_stone and air', () => {
    const worldSeed = hashString('blockcraft-test-seed-42');
    const world = new World();
    const col = world.getColumn(0, 0, true)!;

    const pipeline = createDefaultPipeline();
    pipeline.generateColumn(worldSeed, 0, 0, col);

    const allowedBlocks = new Set(['air', 'stone', 'water', 'foundation_stone']);

    for (let y = 0; y < 320; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const block = world.getBlock(x, y, z);
          expect(
            allowedBlocks.has(block.id),
            `Unexpected block '${block.id}' at (${x},${y},${z})`,
          ).toBe(true);
        }
      }
    }
  });

  it('getHeight returns highest non-air, non-fluid block', () => {
    const world = new World();
    world.setBlock(5, 10, 5, 'stone');
    world.setBlock(5, 11, 5, 'water');
    world.setBlock(5, 12, 5, 'air');

    expect(world.getHeight(5, 5)).toBe(10);
  });

  it('worldHash is stable across identical world states and depends on block state props', () => {
    const world1 = new World();
    const world2 = new World();

    world1.setBlock(0, 10, 0, 'oak_log', { axis: 'x' });
    world2.setBlock(0, 10, 0, 'oak_log', { axis: 'x' });

    expect(world1.worldHash(0, 0, 10, 10)).toBe(world2.worldHash(0, 0, 10, 10));

    // Changing state property changes hash
    world2.setBlock(0, 10, 0, 'oak_log', { axis: 'y' });
    expect(world1.worldHash(0, 0, 10, 10)).not.toBe(world2.worldHash(0, 0, 10, 10));
  });
});
