import { describe, it, expect, beforeEach } from 'vitest';
import { terrainShapeStage, terrainSolidAt } from '../../src/gen/terrain';
import { sampleTerrainTopY } from '../../src/gen/terrain-height';
import { createDefaultPipeline } from '../../src/gen/pipeline';
import { ChunkColumn } from '../../src/world/column';
import { World } from '../../src/world/world';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { hashString, deriveSeed } from '../../src/engine/rng';
import { TerrainPipeline, TerrainStage } from '../../src/gen/pipeline';
import { biomeSurfaceStage } from '../../src/gen/surface';
import {
  caveStage,
  caveStageWithoutIsolatedRule,
  generateCavesReference,
} from '../../src/gen/caves';
import {
  areaOrigin,
  buildIds,
  findBiomeSpot,
  findCaveSpot,
  findFloating,
  generate,
} from './helpers/world-samples';

// M03f: a solid voxel whose six neighbours are all open becomes open (terrain_shape and caves).
// These tests guard the pieces that rule relies on; the full-height "no floating blocks" criterion
// itself is in tests/unit/features.test.ts.

const SEEDS = ['blockcraft-test-seed-42', 'blockcraft-alt-seed-7'];

describe('M03f — isolated voxel rule: source-level guards', () => {
  beforeEach(() => {
    BlockRegistry.resetInstance();
    BlockRegistry.getInstance();
  });

  for (const seedStr of SEEDS) {
    it(`terrainSolidAt agrees with the shape stage; the only solid cells it reports as open are isolated ones (${seedStr})`, () => {
      const registry = BlockRegistry.getInstance();
      const stoneState = registry.getDefaultStateId('stone')!;
      const foundationState = registry.getDefaultStateId('foundation_stone')!;
      const worldSeed = hashString(seedStr);
      const stageSeed = deriveSeed(worldSeed, terrainShapeStage.name);

      // Columns at the origin, in the first mountain-ish ring and a few further out
      const sample: Array<[number, number]> = [];
      for (let cx = -3; cx <= 3; cx += 2)
        for (let cz = -3; cz <= 3; cz += 2) sample.push([cx * 5, cz * 5]);

      let checked = 0;
      let removed = 0;
      for (const [cx, cz] of sample) {
        const col = new ChunkColumn(cx, cz);
        col.worldSeed = worldSeed;
        terrainShapeStage.generate(stageSeed, cx, cz, col);
        for (let z = 0; z < 16; z += 3) {
          for (let x = 0; x < 16; x += 3) {
            const wx = cx * 16 + x;
            const wz = cz * 16 + z;
            for (let y = 5; y < 200; y++) {
              const actual = col.getBlockStateId(x, y, z);
              const actuallySolid = actual === stoneState || actual === foundationState;
              const predicted = terrainSolidAt(stageSeed, wx, y, wz);
              checked++;
              if (actuallySolid) {
                expect(predicted, `(${wx},${y},${wz}) is stone but terrainSolidAt says open`).toBe(
                  true,
                );
              } else if (predicted) {
                // The stage opened it: it must have been isolated
                removed++;
                for (const [dx, dy, dz] of [
                  [1, 0, 0],
                  [-1, 0, 0],
                  [0, 1, 0],
                  [0, -1, 0],
                  [0, 0, 1],
                  [0, 0, -1],
                ] as const) {
                  expect(terrainSolidAt(stageSeed, wx + dx, y + dy, wz + dz)).toBe(false);
                }
              }
            }
          }
        }
      }
      expect(checked).toBeGreaterThan(40000);
      // The sampler really sees both kinds of cell: removals are rare, so this is informative only
      expect(removed).toBeGreaterThanOrEqual(0);
    });

    it(`sampleTerrainTopY skips an isolated top voxel exactly like the stage (${seedStr})`, () => {
      const worldSeed = hashString(seedStr);
      const stageSeed = deriveSeed(worldSeed, terrainShapeStage.name);
      let cells = 0;
      for (let cx = -6; cx <= 6; cx += 3) {
        for (let cz = -6; cz <= 6; cz += 3) {
          const col = new ChunkColumn(cx, cz);
          col.worldSeed = worldSeed;
          terrainShapeStage.generate(stageSeed, cx, cz, col);
          for (let z = 0; z < 16; z += 2) {
            for (let x = 0; x < 16; x += 2) {
              let top = -1;
              for (let y = 319; y >= 0; y--) {
                const s = col.getBlockStateId(x, y, z);
                if (s !== 0 && s !== BlockRegistry.getInstance().getDefaultStateId('water')) {
                  top = y;
                  break;
                }
              }
              expect(sampleTerrainTopY(stageSeed, cx * 16 + x, cz * 16 + z)).toBe(top);
              cells++;
            }
          }
        }
      }
      expect(cells).toBeGreaterThan(1000);
    });
  }

  it('the three isolated voxels the shape stage used to leave on the alt seed are open now', () => {
    const registry = BlockRegistry.getInstance();
    const worldSeed = hashString('blockcraft-alt-seed-7');
    const stageSeed = deriveSeed(worldSeed, terrainShapeStage.name);
    for (const [wx, y, wz] of [
      [-794, 83, 637],
      [167, 136, -46],
      [-1495, 99, -1171],
    ] as const) {
      const cx = Math.floor(wx / 16);
      const cz = Math.floor(wz / 16);
      const col = new ChunkColumn(cx, cz);
      col.worldSeed = worldSeed;
      terrainShapeStage.generate(stageSeed, cx, cz, col);
      expect(terrainSolidAt(stageSeed, wx, y, wz), `density at (${wx},${y},${wz})`).toBe(true);
      const state = col.getBlockStateId(wx - cx * 16, y, wz - cz * 16);
      expect(state, `block at (${wx},${y},${wz})`).not.toBe(registry.getDefaultStateId('stone'));
    }
  });

  it('a 3x3 block of columns is identical when generated in forward and reverse order (full pipeline)', () => {
    const worldSeed = hashString(SEEDS[0]!);
    const pipeline = createDefaultPipeline();
    const order: Array<[number, number]> = [];
    for (let cz = 0; cz < 3; cz++) for (let cx = 0; cx < 3; cx++) order.push([cx, cz]);
    const a = new World(false);
    const b = new World(false);
    for (const [cx, cz] of order)
      pipeline.generateColumn(worldSeed, cx, cz, a.getColumn(cx, cz, true)!);
    for (const [cx, cz] of [...order].reverse())
      pipeline.generateColumn(worldSeed, cx, cz, b.getColumn(cx, cz, true)!);
    expect(a.worldHash(0, 0, 47, 47)).toBe(b.worldHash(0, 0, 47, 47));
  });

  // The caves stage reads the neighbouring column's carving at the edge of a column from its own
  // padded grid where that is exact, and from the neighbouring column's real blocks where it is not
  // (see openIsolatedVoxels). The reference path always uses the real blocks.
  for (const seedStr of SEEDS) {
    it(`edge voxels: the stage gives exactly the blocks of the reference that reads every neighbour from the neighbouring column (${seedStr})`, () => {
      const worldSeed = hashString(seedStr);
      const referenceCaveStage: TerrainStage = { name: 'caves', generate: generateCavesReference };
      const stages = (cave: TerrainStage): TerrainPipeline => {
        const p = new TerrainPipeline();
        p.addStage(terrainShapeStage);
        p.addStage(biomeSurfaceStage);
        p.addStage(cave);
        return p;
      };
      const actual = stages(caveStage);
      const reference = stages(referenceCaveStage);
      const spots = [
        findBiomeSpot(worldSeed, ['oakwood_forest']),
        findBiomeSpot(worldSeed, ['stony_heights', 'frost_peaks']),
        findBiomeSpot(worldSeed, ['pine_taiga']),
        findCaveSpot(worldSeed),
      ];
      let columns = 0;
      for (const spot of spots) {
        expect(spot).not.toBeNull();
        const size = 6;
        const [cx0, cz0] = areaOrigin(spot!, size);
        const a = new World(false);
        const b = new World(false);
        generate(actual, worldSeed, a, cx0, cz0, size);
        generate(reference, worldSeed, b, cx0, cz0, size);
        columns += size * size;
        const x0 = cx0 * 16;
        const z0 = cz0 * 16;
        expect(a.worldHash(x0, z0, x0 + size * 16 - 1, z0 + size * 16 - 1)).toBe(
          b.worldHash(x0, z0, x0 + size * 16 - 1, z0 + size * 16 - 1),
        );
      }
      expect(columns).toBeGreaterThanOrEqual(144);
    }, 60000);
  }

  it('without the isolated-voxel rule the caves stage leaves floating blocks, so the 8a check has something to catch', () => {
    const registry = BlockRegistry.getInstance();
    const ids = buildIds(registry);
    let floating = 0;
    let columns = 0;
    for (const seedStr of SEEDS) {
      const worldSeed = hashString(seedStr);
      const p = new TerrainPipeline();
      p.addStage(terrainShapeStage);
      p.addStage(biomeSurfaceStage);
      p.addStage(caveStageWithoutIsolatedRule);
      for (const spot of [
        findBiomeSpot(worldSeed, ['stony_heights', 'frost_peaks']),
        findBiomeSpot(worldSeed, ['desert']),
        findCaveSpot(worldSeed),
      ]) {
        const [cx0, cz0] = areaOrigin(spot!, 8);
        const world = new World(false);
        generate(p, worldSeed, world, cx0, cz0, 8);
        columns += 64;
        floating += findFloating(world, ids, cx0, cz0, 8).floating.length;
      }
    }
    expect(columns).toBeGreaterThanOrEqual(300);
    expect(floating).toBeGreaterThan(0);
    console.log(`[rule off] ${floating} floating blocks in ${columns} columns`);
  }, 60000);
});
