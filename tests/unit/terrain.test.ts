import { describe, it, expect, beforeEach } from 'vitest';
import { createDefaultPipeline } from '../../src/gen/pipeline';
import { World } from '../../src/world/world';
import { hashString, deriveSeed } from '../../src/engine/rng';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { sampleTerrainClimate, SEA_LEVEL } from '../../src/gen/terrain';

describe('Terrain Pipeline & Generator Unit Tests (M03b)', () => {
  beforeEach(() => {
    BlockRegistry.resetInstance();
    BlockRegistry.getInstance();
  });

  it('overhangs test on mountain columns', () => {
    const t0 = performance.now();
    const worldSeed = hashString('blockcraft-test-seed-42');
    const pipeline = createDefaultPipeline();
    const world = new World(false);

    let totalColumnsSampled = 0;
    let mountainColumnsCount = 0;
    let overhangMountainColumnsCount = 0;

    // Generate columns in a radius around origin to collect >= 250 real generated columns
    for (let cx = -3; cx <= 3; cx++) {
      for (let cz = -3; cz <= 3; cz++) {
        const col = world.getColumn(cx, cz, true)!;
        pipeline.generateColumn(worldSeed, cx, cz, col);

        for (let zLocal = 0; zLocal < 16; zLocal++) {
          const wz = cz * 16 + zLocal;
          for (let xLocal = 0; xLocal < 16; xLocal++) {
            const wx = cx * 16 + xLocal;
            totalColumnsSampled++;

            // Find top block Y
            let topY = -1;
            for (let y = 319; y >= 0; y--) {
              if (world.getBlock(wx, y, wz).id !== 'air') {
                topY = y;
                break;
              }
            }

            if (topY >= 110) {
              mountainColumnsCount++;
              // Check if column has an overhang above y=70 (stone above air)
              let hasAirBelowStone = false;
              let foundStoneAbove = false;
              for (let y = topY; y > 70; y--) {
                const id = world.getBlock(wx, y, wz).id;
                if (id === 'stone') {
                  foundStoneAbove = true;
                } else if (foundStoneAbove && id === 'air') {
                  hasAirBelowStone = true;
                  break;
                }
              }

              if (hasAirBelowStone) {
                overhangMountainColumnsCount++;
              }
            }
          }
        }
      }
    }

    const overhangRate =
      mountainColumnsCount > 0 ? overhangMountainColumnsCount / mountainColumnsCount : 0;

    console.log(`[Overhangs Test]
      Total Real Generated Columns: ${totalColumnsSampled} (target >= 250)
      Mountain Columns (top >= y110): ${mountainColumnsCount}
      Overhang Mountain Columns: ${overhangMountainColumnsCount} (${(overhangRate * 100).toFixed(2)}%, target >= 3%)
      Duration: ${(performance.now() - t0).toFixed(2)} ms
    `);

    expect(totalColumnsSampled).toBeGreaterThanOrEqual(250);
    expect(mountainColumnsCount).toBeGreaterThan(0);
    expect(overhangRate).toBeGreaterThanOrEqual(0.03);
  });

  it('proportions test over sample windows for standard and alt seeds', () => {
    const t0 = performance.now();
    const sample = { continentalness: 0, erosion: 0, peaks: 0, river: 0, surfaceHeight: 0 };

    const seeds = [
      { name: 'standard', seedStr: 'blockcraft-test-seed-42', oceanMin: 0.25, oceanMax: 0.45 },
      { name: 'alt', seedStr: 'blockcraft-alt-seed-7', oceanMin: 0.15, oceanMax: 0.55 },
    ];

    const windows = [
      { xMin: -1024, xMax: 1024, zMin: -1024, zMax: 1024 },
      { xMin: 4096, xMax: 6144, zMin: 4096, zMax: 6144 },
      { xMin: -6144, xMax: -4096, zMin: -6144, zMax: -4096 },
    ];

    for (const s of seeds) {
      const stageSeed = deriveSeed(hashString(s.seedStr), 'terrain_shape');
      let totalSamples = 0;
      let totalOcean = 0;
      let totalRiverChannel = 0;
      let totalGte120 = 0;
      let maxHeight = 0;
      const landHeights: number[] = [];
      const windowOceanPcts: number[] = [];

      for (const w of windows) {
        let winSamples = 0;
        let winOcean = 0;

        for (let z = w.zMin; z < w.zMax; z += 8) {
          for (let x = w.xMin; x < w.xMax; x += 8) {
            sampleTerrainClimate(stageSeed, x, z, sample);
            winSamples++;
            totalSamples++;

            const isRiverChannel = sample.river > 0;
            const isOcean = sample.surfaceHeight < SEA_LEVEL && !isRiverChannel;
            const isLand = sample.surfaceHeight >= SEA_LEVEL || isRiverChannel;

            if (isOcean) {
              winOcean++;
              totalOcean++;
            }
            if (isRiverChannel) {
              totalRiverChannel++;
            }
            if (isLand) {
              landHeights.push(sample.surfaceHeight);
            }
            if (sample.surfaceHeight >= 120) {
              totalGte120++;
            }
            if (sample.surfaceHeight > maxHeight) {
              maxHeight = sample.surfaceHeight;
            }
          }
        }

        const winOceanPct = winOcean / winSamples;
        windowOceanPcts.push(winOceanPct);
        expect(winOceanPct).toBeGreaterThanOrEqual(0.1);
        expect(winOceanPct).toBeLessThanOrEqual(0.7);
      }

      const combinedOceanPct = totalOcean / totalSamples;
      const riverPct = totalRiverChannel / totalSamples;

      landHeights.sort((a, b) => a - b);
      const medianLandH = landHeights[Math.floor(landHeights.length / 2)]!;
      const gte120Pct = totalGte120 / totalSamples;

      console.log(`[Proportions Test - ${s.name} seed (${s.seedStr})]
        Combined Ocean: ${(combinedOceanPct * 100).toFixed(2)}% (target ${s.oceanMin * 100}% - ${s.oceanMax * 100}%)
        Window Oceans: ${windowOceanPcts.map((p) => (p * 100).toFixed(2) + '%').join(', ')} (target 10% - 70%)
        River Channels: ${(riverPct * 100).toFixed(2)}% (target 1% - 6%)
        Land Median Height: ${medianLandH.toFixed(1)} (target 66 - 90)
        Columns >= y 120: ${(gte120Pct * 100).toFixed(2)}% (target >= 2%)
        Max Height: ${maxHeight.toFixed(1)} (target >= 150)
      `);

      expect(combinedOceanPct).toBeGreaterThanOrEqual(s.oceanMin);
      expect(combinedOceanPct).toBeLessThanOrEqual(s.oceanMax);
      expect(riverPct).toBeGreaterThanOrEqual(0.01);
      expect(riverPct).toBeLessThanOrEqual(0.06);
      expect(medianLandH).toBeGreaterThanOrEqual(66);
      expect(medianLandH).toBeLessThanOrEqual(90);
      expect(gte120Pct).toBeGreaterThanOrEqual(0.02);
      expect(maxHeight).toBeGreaterThanOrEqual(150);
    }

    console.log(`Proportions test duration: ${(performance.now() - t0).toFixed(2)} ms`);
  });

  it('agreement test between sampler and real generated columns', () => {
    const t0 = performance.now();
    const sample = { continentalness: 0, erosion: 0, peaks: 0, river: 0, surfaceHeight: 0 };
    const seeds = ['blockcraft-test-seed-42', 'blockcraft-alt-seed-7'];
    const pipeline = createDefaultPipeline();

    let totalClassifiedColumns = 0;
    let agreementMatches = 0;

    let totalRiverSampled = 0;
    let riverWaterTopMatches = 0;

    for (const seedStr of seeds) {
      const worldSeed = hashString(seedStr);
      const stageSeed = deriveSeed(worldSeed, 'terrain_shape');
      const world = new World(false);

      // Generate a 4x4 grid of columns (16 columns per seed = 32 total ChunkColumns)
      for (let cx = -2; cx <= 1; cx++) {
        for (let cz = -2; cz <= 1; cz++) {
          const col = world.getColumn(cx, cz, true)!;
          pipeline.generateColumn(worldSeed, cx, cz, col);

          // Sample every column in chunk (256 columns per ChunkColumn, total 8192 columns)
          for (let zLocal = 0; zLocal < 16; zLocal++) {
            const wz = cz * 16 + zLocal;
            for (let xLocal = 0; xLocal < 16; xLocal++) {
              const wx = cx * 16 + xLocal;

              sampleTerrainClimate(stageSeed, wx, wz, sample);

              // Find real top block in world at (wx, wz)
              let topBlockId = 'air';
              for (let y = 319; y >= 0; y--) {
                const block = world.getBlock(wx, y, wz);
                if (block.id !== 'air') {
                  topBlockId = block.id;
                  break;
                }
              }

              // Classification agreement check:
              // Sampler predicts water top block if surfaceHeight < SEA_LEVEL; real is water top block if topBlockId === 'water'.
              const samplerWaterTop = sample.surfaceHeight < SEA_LEVEL;
              const realWaterTop = topBlockId === 'water';

              totalClassifiedColumns++;
              if (samplerWaterTop === realWaterTop) {
                agreementMatches++;
              }

              // River channel top block water check
              if (sample.river > 0) {
                totalRiverSampled++;
                if (topBlockId === 'water') {
                  riverWaterTopMatches++;
                }
              }
            }
          }
        }
      }
    }

    const agreementPct = agreementMatches / totalClassifiedColumns;
    const riverWaterPct = riverWaterTopMatches / totalRiverSampled;

    console.log(`[Agreement Test]
        Total Real Columns Sampled: ${totalClassifiedColumns} (target >= 300)
        Agreement Match Rate: ${(agreementPct * 100).toFixed(2)}% (target >= 95%)
        River Channel Columns Sampled: ${totalRiverSampled} (target >= 100)
        River Top Block Water Rate: ${(riverWaterPct * 100).toFixed(2)}% (target >= 90%)
      `);

    expect(totalClassifiedColumns).toBeGreaterThanOrEqual(300);
    expect(agreementPct).toBeGreaterThanOrEqual(0.95);
    expect(totalRiverSampled).toBeGreaterThanOrEqual(100);
    expect(riverWaterPct).toBeGreaterThanOrEqual(0.9);

    console.log(`Agreement test duration: ${(performance.now() - t0).toFixed(2)} ms`);
  }, 20000);

  it('river shape test over 512x512 windows for both seeds', () => {
    const t0 = performance.now();
    const sample = { continentalness: 0, erosion: 0, peaks: 0, river: 0, surfaceHeight: 0 };

    const seeds = [
      { name: 'standard', seedStr: 'blockcraft-test-seed-42' },
      { name: 'alt', seedStr: 'blockcraft-alt-seed-7' },
    ];

    const windowOrigins = [
      { x: -256, z: -256 },
      { x: 1024, z: 1024 },
      { x: -2048, z: -1536 },
    ];

    const W = 512;
    const H = 512;
    const N = W * H;

    const DX4 = [1, -1, 0, 0];
    const DZ4 = [0, 0, 1, -1];

    const DX8 = [1, -1, 0, 0, 1, -1, 1, -1];
    const DZ8 = [0, 0, 1, -1, 1, -1, -1, 1];

    const riverGrid = new Uint8Array(N);
    const landGrid = new Uint8Array(N);
    const distGrid = new Int32Array(N);
    const queue = new Int32Array(N);
    const visitedComp = new Uint8Array(N);
    const compQueue = new Int32Array(N);

    for (const s of seeds) {
      const stageSeed = deriveSeed(hashString(s.seedStr), 'terrain_shape');

      let combinedRiverCells = 0;
      let combinedLandCells = 0;
      const combinedRiverDistances: number[] = [];
      let combinedRiverCellsInShortComponents = 0;

      for (const origin of windowOrigins) {
        riverGrid.fill(0);
        landGrid.fill(0);

        for (let lz = 0; lz < H; lz++) {
          const wz = origin.z + lz;
          const zOff = lz * W;
          for (let lx = 0; lx < W; lx++) {
            const wx = origin.x + lx;
            const idx = zOff + lx;

            sampleTerrainClimate(stageSeed, wx, wz, sample);

            const isRiver = sample.river > 0 && sample.surfaceHeight < SEA_LEVEL;
            const isLand = sample.surfaceHeight >= SEA_LEVEL || isRiver;

            if (isRiver) riverGrid[idx] = 1;
            if (isLand) landGrid[idx] = 1;
          }
        }

        let winRiverCount = 0;
        let winLandCount = 0;

        for (let i = 0; i < N; i++) {
          if (riverGrid[i] === 1) winRiverCount++;
          if (landGrid[i] === 1) winLandCount++;
        }

        combinedRiverCells += winRiverCount;
        combinedLandCells += winLandCount;

        // Multi-source 4-neighbour BFS from non-river cells (distance 0)
        distGrid.fill(-1);
        let head = 0;
        let tail = 0;

        for (let i = 0; i < N; i++) {
          if (riverGrid[i] === 0) {
            distGrid[i] = 0;
            queue[tail++] = i;
          }
        }

        while (head < tail) {
          const cur = queue[head++]!;
          const curDist = distGrid[cur]!;
          const cx = cur % W;
          const cz = Math.floor(cur / W);

          for (let k = 0; k < 4; k++) {
            const nx = cx + DX4[k]!;
            const nz = cz + DZ4[k]!;
            if (nx >= 0 && nx < W && nz >= 0 && nz < H) {
              const nIdx = nz * W + nx;
              if (distGrid[nIdx] === -1) {
                distGrid[nIdx] = curDist + 1;
                queue[tail++] = nIdx;
              }
            }
          }
        }

        // For river cells, width = 2 * distGrid[i]
        for (let i = 0; i < N; i++) {
          if (riverGrid[i] === 1) {
            let d = distGrid[i]!;
            const lx = i % W;
            const lz = Math.floor(i / W);
            const distToBorder = Math.min(lx + 1, W - lx, lz + 1, H - lz);
            if (d === -1 || distToBorder < d) {
              d = distToBorder;
            }
            combinedRiverDistances.push(d);
          }
        }

        // 8-connected BFS over river cells for components
        visitedComp.fill(0);

        for (let i = 0; i < N; i++) {
          if (riverGrid[i] === 1 && visitedComp[i] === 0) {
            // New component
            let minX = W,
              maxX = -1,
              minZ = H,
              maxZ = -1;
            let maxDistInComp = 0;
            let compCellCount = 0;

            let chead = 0;
            let ctail = 0;

            visitedComp[i] = 1;
            compQueue[ctail++] = i;

            while (chead < ctail) {
              const cur = compQueue[chead++]!;
              compCellCount++;

              const cx = cur % W;
              const cz = Math.floor(cur / W);

              if (cx < minX) minX = cx;
              if (cx > maxX) maxX = cx;
              if (cz < minZ) minZ = cz;
              if (cz > maxZ) maxZ = cz;

              let d = distGrid[cur]!;
              const distToBorder = Math.min(cx + 1, W - cx, cz + 1, H - cz);
              if (d === -1 || distToBorder < d) d = distToBorder;
              if (d > maxDistInComp) maxDistInComp = d;

              for (let k = 0; k < 8; k++) {
                const nx = cx + DX8[k]!;
                const nz = cz + DZ8[k]!;
                if (nx >= 0 && nx < W && nz >= 0 && nz < H) {
                  const nIdx = nz * W + nx;
                  if (riverGrid[nIdx] === 1 && visitedComp[nIdx] === 0) {
                    visitedComp[nIdx] = 1;
                    compQueue[ctail++] = nIdx;
                  }
                }
              }
            }

            const longSide = Math.max(maxX - minX + 1, maxZ - minZ + 1);
            const elongation = longSide / (2 * maxDistInComp);

            if (elongation < 4) {
              combinedRiverCellsInShortComponents += compCellCount;
            }
          }
        }
      }

      // Assertions per seed over combined 3 windows
      const riverLandRatio = combinedRiverCells / combinedLandCells;

      // River widths = 2 * dist
      const riverWidths = combinedRiverDistances.map((d) => 2 * d).sort((a, b) => a - b);
      const p50 = riverWidths[Math.floor(riverWidths.length * 0.5)] ?? 0;
      const p90 = riverWidths[Math.floor(riverWidths.length * 0.9)] ?? 0;
      const maxW = riverWidths[riverWidths.length - 1] ?? 0;

      const shortCompCellRatio = combinedRiverCellsInShortComponents / combinedRiverCells;

      console.log(`[River-Shape Test - ${s.name} seed (${s.seedStr})]
        River/Land Ratio: ${(riverLandRatio * 100).toFixed(2)}% (target 1.5% - 5%)
        Width p50: ${p50} (target 3 - 12)
        Width p90: ${p90} (target <= 20)
        Width max: ${maxW} (target <= 32)
        Elongation < 4 Cell Ratio: ${(shortCompCellRatio * 100).toFixed(2)}% (target <= 10%)
      `);

      expect(riverLandRatio).toBeGreaterThanOrEqual(0.015);
      expect(riverLandRatio).toBeLessThanOrEqual(0.05);
      expect(p50).toBeGreaterThanOrEqual(3);
      expect(p50).toBeLessThanOrEqual(12);
      expect(p90).toBeLessThanOrEqual(20);
      expect(maxW).toBeLessThanOrEqual(32);
      expect(shortCompCellRatio).toBeLessThanOrEqual(0.1);
    }

    console.log(`River-shape test duration: ${(performance.now() - t0).toFixed(2)} ms`);
  }, 20000);

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
