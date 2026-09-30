import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '../../src/world/world';
import { BlockRegistry } from '../../src/world/blocks/registry';

describe('M05a — Light Engine Unit Tests', () => {
  let world: World;
  let registry: BlockRegistry;

  beforeEach(() => {
    registry = BlockRegistry.getInstance();
    world = new World();
  });

  it('31³ dark room with torch stand-in (level 14 emitter): 14 at torch, 13 at Manhattan dist 1, 0 at ≥ 14', () => {
    // Build 31³ dark room with walls at x in [0, 32], y in [0, 32], z in [0, 32]
    // Inner room bounds: x in [1, 31], y in [1, 31], z in [1, 31]
    world.fill(0, 0, 0, 32, 32, 32, 'stone');
    world.fill(1, 1, 1, 31, 31, 31, 'air');

    // Register a torch stand-in state (level 14 emission)
    const torchStandInState = 999;
    world.lightEngine.setCustomEmission(torchStandInState, 14);

    const tx = 16;
    const ty = 16;
    const tz = 16;

    // Place torch stand-in at center
    world.setBlockStateId(tx, ty, tz, torchStandInState);

    // Verify torch location block light = 14
    expect(world.getLight(tx, ty, tz).block).toBe(14);

    // Verify Manhattan distance 1 = 13
    expect(world.getLight(tx + 1, ty, tz).block).toBe(13);
    expect(world.getLight(tx - 1, ty, tz).block).toBe(13);
    expect(world.getLight(tx, ty + 1, tz).block).toBe(13);
    expect(world.getLight(tx, ty - 1, tz).block).toBe(13);
    expect(world.getLight(tx, ty, tz + 1).block).toBe(13);
    expect(world.getLight(tx, ty, tz - 1).block).toBe(13);

    // Verify Manhattan distance >= 14 is 0
    expect(world.getLight(tx + 14, ty, tz).block).toBe(0);
    expect(world.getLight(tx + 15, ty, tz).block).toBe(0);
    expect(world.getLight(tx, ty + 14, tz).block).toBe(0);
  });

  it('torch removal returns the room to block light 0', () => {
    world.fill(0, 0, 0, 32, 32, 32, 'stone');
    world.fill(1, 1, 1, 31, 31, 31, 'air');

    const torchStandInState = 999;
    world.lightEngine.setCustomEmission(torchStandInState, 14);

    const tx = 16;
    const ty = 16;
    const tz = 16;

    world.setBlockStateId(tx, ty, tz, torchStandInState);
    expect(world.getLight(tx, ty, tz).block).toBe(14);

    // Remove torch stand-in
    world.setBlockStateId(tx, ty, tz, registry.getDefaultStateId('air')!);

    // All positions in room should be 0
    expect(world.getLight(tx, ty, tz).block).toBe(0);
    expect(world.getLight(tx + 1, ty, tz).block).toBe(0);
    expect(world.getLight(tx + 5, ty, tz).block).toBe(0);
    expect(world.getLight(tx + 10, ty, tz).block).toBe(0);
  });

  it('light correctly crosses chunk borders (torch at x=15 lights x=16)', () => {
    // x=15 is local x=15 in chunk 0; x=16 is local x=0 in chunk 1
    world.fill(-10, 0, -10, 30, 30, 30, 'stone');
    world.fill(-9, 1, -9, 29, 29, 29, 'air');

    const torchStandInState = 999;
    world.lightEngine.setCustomEmission(torchStandInState, 14);

    world.setBlockStateId(15, 10, 10, torchStandInState);

    expect(world.getLight(15, 10, 10).block).toBe(14);
    expect(world.getLight(16, 10, 10).block).toBe(13);
    expect(world.getLight(17, 10, 10).block).toBe(12);
  });

  it('roof on removes sky light below; roof off restores 15', () => {
    for (let cx = -1; cx <= 1; cx++) {
      for (let cz = -1; cz <= 1; cz++) {
        world.getColumn(cx, cz, true);
        world.lightEngine.initializeColumnLight(world, cx, cz);
      }
    }

    const checkY = 100;
    const roofY = 105;

    // Initially with no roof, sky light at checkY = (0, 100, 0) should be 15
    expect(world.getLight(0, checkY, 0).sky).toBe(15);

    // Build roof across (-15, 105, -15) to (15, 105, 15)
    world.fill(-15, roofY, -15, 15, roofY, 15, 'stone');

    // Directly below the roof at center (0, 100, 0), sky light is 0
    expect(world.getLight(0, checkY, 0).sky).toBe(0);

    // Remove roof
    world.fill(-15, roofY, -15, 15, roofY, 15, 'air');

    // Sky light should be restored to 15
    expect(world.getLight(0, checkY, 0).sky).toBe(15);
  }, 30000);

  it('single edit touches ≤ 3 sections unless light actually spreads further', () => {
    world.fill(-10, 0, -10, 30, 30, 30, 'stone');
    world.fill(-9, 1, -9, 29, 29, 29, 'air');

    // Single edit in dark room without light source
    world.lightEngine.storage.resetTouched();
    world.setBlock(10, 10, 10, 'stone');

    const touchedCount = world.lightEngine.storage.touchedSections.size;
    expect(touchedCount).toBeLessThanOrEqual(3);
  });

  it('bulk propagation and incremental edits give identical light for the same block data', () => {
    // World A: built incrementally
    const worldA = new World();
    worldA.getColumn(0, 0, true);
    worldA.getColumn(1, 0, true);
    worldA.lightEngine.initializeColumnLight(worldA, 0, 0);
    worldA.lightEngine.initializeColumnLight(worldA, 1, 0);

    const lavaState = registry.getDefaultStateId('lava')!;
    worldA.setBlockStateId(5, 10, 5, lavaState);

    // World B: initialized in bulk
    const worldB = new World();
    worldB.getColumn(0, 0, true);
    worldB.getColumn(1, 0, true);
    worldB.setBlockStateId(5, 10, 5, lavaState);
    worldB.lightEngine.initializeColumnLight(worldB, 0, 0);
    worldB.lightEngine.initializeColumnLight(worldB, 1, 0);

    // Compare light values across both chunks
    for (let x = 0; x < 32; x++) {
      for (let y = 0; y < 30; y++) {
        for (let z = 0; z < 16; z++) {
          const lA = worldA.getLight(x, y, z);
          const lB = worldB.getLight(x, y, z);
          expect(lA.block).toBe(lB.block);
          expect(lA.sky).toBe(lB.sky);
        }
      }
    }
  });

  it('light propagation stops at unloaded column borders without creating unneeded columns', () => {
    const worldTest = new World();
    // Only load chunk (0,0)
    worldTest.getColumn(0, 0, true);

    const torchStandInState = 999;
    worldTest.lightEngine.setCustomEmission(torchStandInState, 14);

    // Place torch at x=15 (edge of loaded column (0,0))
    worldTest.setBlockStateId(15, 10, 5, torchStandInState);

    // Column (1,0) should NOT have been created by light propagation
    expect(worldTest.hasColumn(1, 0)).toBe(false);

    // getLight in unloaded column returns 0 block light
    expect(worldTest.getLight(16, 10, 5).block).toBe(0);
  });
});
