import { describe, it, expect, beforeEach } from 'vitest';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { World } from '../../src/world/world';
import { textureGenerators } from '../../src/render/textures/index';

describe('BlockRegistry Unit Tests', () => {
  let registry: BlockRegistry;

  beforeEach(() => {
    BlockRegistry.resetInstance();
    registry = BlockRegistry.getInstance();
  });

  it('assigns stable state IDs starting with air = 0', () => {
    const airStateId = registry.getStateId('air');
    expect(airStateId).toBe(0);

    const resolvedAir = registry.getResolvedState(0);
    expect(resolvedAir).toBeDefined();
    expect(resolvedAir?.blockId).toBe('air');

    // Pinned known state IDs based on alphabetical sort order
    // 0: air
    // 5: birch_leaves (shifted from 1 by acacia_leaves and acacia_log[x3] in M03f)
    // 6: birch_log[axis=y]
    // 7: birch_log[axis=x]
    // 8: birch_log[axis=z]
    // ...
    // 28: foundation_stone (shifted from 19 by the 9 M03f blocks that sort before it)
    expect(registry.getStateId('birch_leaves')).toBe(5);
    expect(registry.getStateId('birch_log', { axis: 'y' })).toBe(6);
    expect(registry.getStateId('birch_log', { axis: 'x' })).toBe(7);
    expect(registry.getStateId('birch_log', { axis: 'z' })).toBe(8);
    expect(registry.getStateId('foundation_stone')).toBe(28);
  });

  it('all block IDs and texture names are unique and known', () => {
    const blockIds = registry.getAllBlockIds();
    const uniqueIds = new Set(blockIds);
    expect(uniqueIds.size).toBe(blockIds.length);

    // Check texture names exist in textureGenerators
    for (const blockId of blockIds) {
      if (blockId === 'air') continue;
      const def = registry.getBlockDefinition(blockId)!;
      expect(def.textures).toBeDefined();
      for (const texName of Object.values(def.textures!)) {
        expect(textureGenerators[texName!]).toBeDefined();
      }
    }
  });

  it('declares expected render layers for all registered blocks', () => {
    expect(registry.getBlockDefinition('oak_leaves')?.renderLayer).toBe('cutout');
    expect(registry.getBlockDefinition('birch_leaves')?.renderLayer).toBe('cutout');
    expect(registry.getBlockDefinition('pine_leaves')?.renderLayer).toBe('cutout');

    expect(registry.getBlockDefinition('glass')?.renderLayer).toBe('translucent');
    expect(registry.getBlockDefinition('water')?.renderLayer).toBe('translucent');

    expect(registry.getBlockDefinition('grass_block')?.renderLayer).toBe('opaque');
    expect(registry.getBlockDefinition('stone')?.renderLayer).toBe('opaque');
    expect(registry.getBlockDefinition('oak_log')?.renderLayer).toBe('opaque');
  });

  it('rotates log face textures according to axis state', () => {
    const oakLogY = registry.getStateId('oak_log', { axis: 'y' })!;
    const oakLogX = registry.getStateId('oak_log', { axis: 'x' })!;
    const oakLogZ = registry.getStateId('oak_log', { axis: 'z' })!;

    // Y axis: top/bottom are oak_log_top, side faces are oak_log_side
    expect(registry.getFaceTexture(oakLogY, 'top')).toBe('oak_log_top');
    expect(registry.getFaceTexture(oakLogY, 'bottom')).toBe('oak_log_top');
    expect(registry.getFaceTexture(oakLogY, 'north')).toBe('oak_log_side');

    // X axis: east/west are oak_log_top, other faces oak_log_side
    expect(registry.getFaceTexture(oakLogX, 'east')).toBe('oak_log_top');
    expect(registry.getFaceTexture(oakLogX, 'west')).toBe('oak_log_top');
    expect(registry.getFaceTexture(oakLogX, 'top')).toBe('oak_log_side');

    // Z axis: north/south are oak_log_top, other faces oak_log_side
    expect(registry.getFaceTexture(oakLogZ, 'north')).toBe('oak_log_top');
    expect(registry.getFaceTexture(oakLogZ, 'south')).toBe('oak_log_top');
    expect(registry.getFaceTexture(oakLogZ, 'top')).toBe('oak_log_side');
  });

  it('validates debug API error handling and boundary conditions on world', () => {
    const world = new World();

    // Unknown block ID throws
    expect(() => world.setBlock(0, 10, 0, 'invalid_block_xyz')).toThrow(/Unknown block ID/);
    expect(() => world.fill(0, 10, 0, 5, 10, 5, 'invalid_block_xyz')).toThrow(/Unknown block ID/);

    // Invalid state props throws
    expect(() => world.setBlock(0, 10, 0, 'oak_log', { axis: 'invalid_axis' })).toThrow(
      /Invalid block state/,
    );

    // Out of bounds Y on setBlock/fill throws
    expect(() => world.setBlock(0, -1, 0, 'stone')).toThrow(/Invalid y coordinate/);
    expect(() => world.setBlock(0, 320, 0, 'stone')).toThrow(/Invalid y coordinate/);
    expect(() => world.fill(0, -5, 0, 5, 10, 5, 'stone')).toThrow(/out of bounds/);

    // Out of bounds Y on getBlock returns air
    expect(world.getBlock(0, -1, 0).id).toBe('air');
    expect(world.getBlock(0, 320, 0).id).toBe('air');

    // Fill bounds inclusive and accepts corners in any order
    world.fill(10, 20, 10, 5, 15, 5, 'dirt');
    expect(world.getBlock(5, 15, 5).id).toBe('dirt');
    expect(world.getBlock(10, 20, 10).id).toBe('dirt');
    expect(world.getBlock(7, 18, 7).id).toBe('dirt');
  });
});
