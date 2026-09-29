import { describe, test, expect, beforeEach } from 'vitest';
import { World } from '../../src/world/world';
import {
  LightEngine,
  buildLightLookupTables,
  setLightEngineInstance,
} from '../../src/world/lighting';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { performBulkLightPropagation } from '../../src/workers/light.worker';

describe('M05a — Light Engine', () => {
  let registry: BlockRegistry;

  beforeEach(() => {
    registry = BlockRegistry.getInstance();
  });

  test('31³ dark room with torch stand-in (level 14) and removal queue returning to 0', () => {
    const world = new World();
    const airStateId = registry.getDefaultStateId('air')!;
    const stoneStateId = registry.getDefaultStateId('stone')!;

    // Torch stand-in: state ID 9999 with emission level 14
    const torchStandInStateId = 9999;
    const customEmission = new Map<number, number>([[torchStandInStateId, 14]]);
    const tables = buildLightLookupTables(registry, customEmission);
    const engine = new LightEngine(tables);
    setLightEngineInstance(engine);

    // Build 31³ dark room centered at (0, 64, 0): x, z in [-15, 15], y in [49, 79]
    // Shell of stone, interior of air
    for (let x = -15; x <= 15; x++) {
      for (let y = 49; y <= 79; y++) {
        for (let z = -15; z <= 15; z++) {
          const isShell = x === -15 || x === 15 || y === 49 || y === 79 || z === -15 || z === 15;
          world.setBlockStateId(x, y, z, isShell ? stoneStateId : airStateId);
        }
      }
    }

    // Ensure all sky light inside dark room is 0
    expect(world.getLight(0, 64, 0).sky).toBe(0);
    expect(world.getLight(0, 64, 0).block).toBe(0);

    // Place level-14 torch stand-in at center (0, 64, 0)
    world.setBlockStateId(0, 64, 0, torchStandInStateId);

    // Assert level 14 at torch
    expect(world.getLight(0, 64, 0).block).toBe(14);

    // Assert level 13 at Manhattan distance 1
    expect(world.getLight(1, 64, 0).block).toBe(13);
    expect(world.getLight(-1, 64, 0).block).toBe(13);
    expect(world.getLight(0, 65, 0).block).toBe(13);
    expect(world.getLight(0, 63, 0).block).toBe(13);
    expect(world.getLight(0, 64, 1).block).toBe(13);
    expect(world.getLight(0, 64, -1).block).toBe(13);

    // Assert level 0 at Manhattan distance >= 14 inside room
    expect(world.getLight(14, 64, 0).block).toBe(0);
    expect(world.getLight(0, 64, 14).block).toBe(0);
    expect(world.getLight(10, 64, 4).block).toBe(0); // Manhattan dist = 14

    // Remove torch stand-in (replace with air)
    world.setBlockStateId(0, 64, 0, airStateId);

    // Assert removal returns all block light in the room to 0
    for (let x = -14; x <= 14; x++) {
      for (let y = 50; y <= 78; y++) {
        for (let z = -14; z <= 14; z++) {
          expect(world.getLight(x, y, z).block).toBe(0);
        }
      }
    }
  });

  test('Lava emission (15) comes from real registry', () => {
    const world = new World();
    const airStateId = registry.getDefaultStateId('air')!;
    const stoneStateId = registry.getDefaultStateId('stone')!;
    const lavaStateId = registry.getDefaultStateId('lava')!;

    const engine = new LightEngine(buildLightLookupTables(registry));
    setLightEngineInstance(engine);

    // Enclosed 11³ room around (0, 64, 0)
    for (let x = -5; x <= 5; x++) {
      for (let y = 59; y <= 69; y++) {
        for (let z = -5; z <= 5; z++) {
          const isShell = x === -5 || x === 5 || y === 59 || y === 69 || z === -5 || z === 5;
          world.setBlockStateId(x, y, z, isShell ? stoneStateId : airStateId);
        }
      }
    }

    // Place lava block from real registry at (0, 64, 0)
    world.setBlockStateId(0, 64, 0, lavaStateId);

    // Assert level 15 at lava and 14 at Manhattan distance 1
    expect(world.getLight(0, 64, 0).block).toBe(15);
    expect(world.getLight(1, 64, 0).block).toBe(14);
    expect(world.getLight(0, 63, 0).block).toBe(14);
  });

  test('Light correctly crosses chunk/column borders (torch at x=15 lights x=16)', () => {
    const world = new World();
    const torchStandInStateId = 9999;
    const customEmission = new Map<number, number>([[torchStandInStateId, 14]]);
    const tables = buildLightLookupTables(registry, customEmission);
    const engine = new LightEngine(tables);
    setLightEngineInstance(engine);

    // Initialize columns (0, 0) [x: 0..15] and (1, 0) [x: 16..31]
    world.getColumn(0, 0, true);
    world.getColumn(1, 0, true);

    // Place torch at x=15 (right edge of column 0)
    world.setBlockStateId(15, 64, 0, torchStandInStateId);

    // Assert light at x=15 is 14 and at x=16 (left edge of column 1) is 13
    expect(world.getLight(15, 64, 0).block).toBe(14);
    expect(world.getLight(16, 64, 0).block).toBe(13);
  });

  test('Roof on removes sky light below, roof off restores 15', () => {
    const world = new World();

    const engine = new LightEngine(buildLightLookupTables(registry));
    setLightEngineInstance(engine);

    // Create a 16x16 column (0,0) exposed to sky
    world.getColumn(0, 0, true);
    engine.propagateSkyLightColumn(world, 0, 0);

    // Initial sky light at y=100 and below is 15
    expect(world.getLight(8, 100, 8).sky).toBe(15);
    expect(world.getLight(8, 90, 8).sky).toBe(15);

    // Place a 16x16 roof of stone at y=100
    world.fill(0, 100, 0, 15, 100, 15, 'stone');

    // Sky light directly under roof (y=99..0) is removed to 0
    expect(world.getLight(8, 99, 8).sky).toBe(0);
    expect(world.getLight(8, 50, 8).sky).toBe(0);

    // Remove the roof (fill with air)
    world.fill(0, 100, 0, 15, 100, 15, 'air');

    // Sky light at y=99..0 is restored to 15
    expect(world.getLight(8, 99, 8).sky).toBe(15);
    expect(world.getLight(8, 50, 8).sky).toBe(15);
  });

  test('Single edit touches <= 3 sections unless light spreads further', () => {
    const world = new World();
    const airStateId = registry.getDefaultStateId('air')!;

    const engine = new LightEngine(buildLightLookupTables(registry));
    setLightEngineInstance(engine);

    // Pre-populate column (0,0) filled with stone
    world.getColumn(0, 0, true);
    world.fill(0, 0, 0, 15, 319, 15, 'stone');

    // Reset touched sections instrumentation
    engine.resetTouchedSections();

    // Perform a single non-emitting block edit in solid stone (change stone at (8, 16, 8) to air)
    world.setBlockStateId(8, 16, 8, airStateId);

    // Instrumentation count check: edit in solid enclosed stone touches <= 3 sections
    const touchedCount = engine.getTouchedSectionsCount();
    expect(touchedCount).toBeGreaterThan(0);
    expect(touchedCount).toBeLessThanOrEqual(3);
  });

  test('At the edge of loaded columns, light never spreads into unloaded columns', () => {
    const world = new World();
    const torchStandInStateId = 9999;
    const customEmission = new Map<number, number>([[torchStandInStateId, 14]]);
    const tables = buildLightLookupTables(registry, customEmission);
    const engine = new LightEngine(tables);
    setLightEngineInstance(engine);

    // Only load column (0, 0) [x: 0..15]
    world.getColumn(0, 0, true);
    expect(world.hasColumn(1, 0)).toBe(false);

    // Place torch at x=15 (border of loaded column 0)
    world.setBlockStateId(15, 64, 0, torchStandInStateId);

    // Light at x=15 is 14
    expect(world.getLight(15, 64, 0).block).toBe(14);

    // Column (1, 0) was NOT loaded or created by propagation
    expect(world.hasColumn(1, 0)).toBe(false);
  });

  test('Bulk propagation and incremental edits give identical light for the same block data', () => {
    const lavaStateId = registry.getDefaultStateId('lava')!;
    const waterStateId = registry.getDefaultStateId('water')!;

    const tables = buildLightLookupTables(registry);

    // --- Method A: Incremental Edits ---
    const worldInc = new World();
    const engineInc = new LightEngine(tables);
    setLightEngineInstance(engineInc);

    // Initialize 2x2 column region: (0,0), (1,0), (0,1), (1,1)
    for (let cx = 0; cx <= 1; cx++) {
      for (let cz = 0; cz <= 1; cz++) {
        worldInc.getColumn(cx, cz, true);
        engineInc.propagateSkyLightColumn(worldInc, cx, cz);
      }
    }

    // Build stone floor at y=60
    worldInc.fill(0, 60, 0, 31, 60, 31, 'stone');
    // Place lava emitter at (5, 61, 5)
    worldInc.setBlockStateId(5, 61, 5, lavaStateId);
    // Place glass roof at y=100
    worldInc.fill(0, 100, 0, 15, 100, 15, 'glass');
    // Place water at (10, 62, 10)
    worldInc.setBlockStateId(10, 62, 10, waterStateId);

    // --- Method B: Bulk Worker Propagation ---
    const columnsData = [];
    for (let cx = 0; cx <= 1; cx++) {
      for (let cz = 0; cz <= 1; cz++) {
        const sections = [];
        for (let sy = 0; sy < 20; sy++) {
          const states = new Uint16Array(4096);
          let idx = 0;
          for (let ly = 0; ly < 16; ly++) {
            const y = (sy << 4) + ly;
            for (let lz = 0; lz < 16; lz++) {
              const z = cz * 16 + lz;
              for (let lx = 0; lx < 16; lx++) {
                const x = cx * 16 + lx;
                states[idx++] = worldInc.getBlockStateId(x, y, z);
              }
            }
          }
          sections.push({ sy, states });
        }
        columnsData.push({ cx, cz, sections });
      }
    }

    const { world: worldBulk, lightEngine: engineBulk } = performBulkLightPropagation(
      0,
      0,
      1,
      1,
      columnsData,
      tables,
    );

    // Fast comparison without 262,144 individual Vitest matcher calls
    let mismatches = 0;
    for (let x = 0; x < 32; x++) {
      for (let z = 0; z < 32; z++) {
        for (let y = 0; y < 128; y++) {
          const lightA = engineInc.getLight(worldInc, x, y, z);
          const lightB = engineBulk.getLight(worldBulk, x, y, z);
          if (lightA.sky !== lightB.sky || lightA.block !== lightB.block) {
            mismatches++;
          }
        }
      }
    }
    expect(mismatches).toBe(0);
  }, 15000);

  test('Opacity rules: air and glass pass sky light at 15 straight down; water and leaves attenuate by 2', () => {
    const world = new World();

    const engine = new LightEngine(buildLightLookupTables(registry));
    setLightEngineInstance(engine);

    // Column (0,0)
    world.getColumn(0, 0, true);

    // 5x5 Glass roof at y=200 so center (2,2) receives no side sky light
    world.fill(0, 200, 0, 4, 200, 4, 'glass');

    // Propagate sky light
    engine.propagateSkyLightColumn(world, 0, 0);

    // Air above glass is 15
    expect(world.getLight(2, 201, 2).sky).toBe(15);
    // Glass itself passes sky light 15 straight down without loss
    expect(world.getLight(2, 200, 2).sky).toBe(15);
    // Air below glass is 15
    expect(world.getLight(2, 199, 2).sky).toBe(15);

    // Place 5x5 water layer at y=150
    world.fill(0, 150, 0, 4, 150, 4, 'water');

    // Sky light above water is 15
    expect(world.getLight(2, 151, 2).sky).toBe(15);
    // Water attenuates by 2: 15 - 2 = 13
    expect(world.getLight(2, 150, 2).sky).toBe(13);
    // Air below water center (2,149,2) is 12 (13 - 1)
    expect(world.getLight(2, 149, 2).sky).toBe(12);

    // Place 5x5 leaves layer at y=100
    world.fill(0, 100, 0, 4, 100, 4, 'oak_leaves');
    // Leaves attenuate by 2
    expect(world.getLight(2, 100, 2).sky).toBe(world.getLight(2, 101, 2).sky - 2);
  });
});
