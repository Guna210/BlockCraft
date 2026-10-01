import { describe, it, expect, beforeEach } from 'vitest';
import { createDefaultPipeline } from '../../src/gen/pipeline';
import { World } from '../../src/world/world';
import { hashString } from '../../src/engine/rng';
import { deriveSeed } from '../../src/engine/rng';
import { sampleTerrainClimate, TerrainClimate } from '../../src/gen/terrain';
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

  it('Terrain proportions meet requirements for standard and alt seed', () => {
    function evaluateSeed(seedStr: string, isAlt: boolean) {
      const worldSeed = hashString(seedStr);
      const terrainStageSeed = deriveSeed(worldSeed, 'terrain_shape');
      const windows = [
        { x1: -1024, x2: 1024, z1: -1024, z2: 1024 },
        { x1: 4096, x2: 6144, z1: 4096, z2: 6144 },
        { x1: -6144, x2: -4096, z1: -6144, z2: -4096 },
      ];

      const out: TerrainClimate = {
        continentalness: 0,
        erosion: 0,
        peaks: 0,
        river: 0,
        surfaceHeight: 0,
      };

      let totalColumns = 0;
      let totalOcean = 0;
      let totalRiver = 0;
      const landHeights: number[] = [];
      let above120 = 0;
      let maxH = -1000;

      const windowOceans = [0, 0, 0];
      const windowColumns = [0, 0, 0];

      for (let w = 0; w < windows.length; w++) {
        const win = windows[w]!;
        for (let x = win.x1; x < win.x2; x += 8) {
          for (let z = win.z1; z < win.z2; z += 8) {
            sampleTerrainClimate(terrainStageSeed, x, z, out);

            const isRiver = out.river > 0;
            const isOcean = out.surfaceHeight <= 64 && !isRiver;

            if (isRiver) totalRiver++;
            if (isOcean) {
              totalOcean++;
              windowOceans[w] = windowOceans[w]! + 1;
            } else if (!isRiver) {
              landHeights.push(out.surfaceHeight);
            }

            if (out.surfaceHeight >= 120) above120++;
            if (out.surfaceHeight > maxH) maxH = out.surfaceHeight;

            totalColumns++;
            windowColumns[w] = windowColumns[w]! + 1;
          }
        }
      }

      landHeights.sort((a, b) => a - b);
      const medianLand = landHeights[Math.floor(landHeights.length / 2)]!;

      const oceanCombined = totalOcean / totalColumns;
      const riverCombined = totalRiver / totalColumns;

      if (!isAlt) {
        expect(oceanCombined).toBeGreaterThanOrEqual(0.25);
        expect(oceanCombined).toBeLessThanOrEqual(0.45);

        for (let w = 0; w < windows.length; w++) {
          const wO = windowOceans[w]! / windowColumns[w]!;
          expect(wO).toBeGreaterThanOrEqual(0.1);
          expect(wO).toBeLessThanOrEqual(0.7);
        }

        expect(riverCombined).toBeGreaterThanOrEqual(0.01);
        expect(riverCombined).toBeLessThanOrEqual(0.06);

        expect(medianLand).toBeGreaterThanOrEqual(66);
        expect(medianLand).toBeLessThanOrEqual(90);

        expect(above120 / totalColumns).toBeGreaterThanOrEqual(0.02);
        expect(maxH).toBeGreaterThanOrEqual(150);
      } else {
        expect(oceanCombined).toBeGreaterThanOrEqual(0.15);
        expect(oceanCombined).toBeLessThanOrEqual(0.55);
      }
    }

    evaluateSeed('blockcraft-test-seed-42', false);
    evaluateSeed('blockcraft-alt-seed-7', true);
  });

  it('sampler classification agrees with real column top block >= 95% of the time', () => {
    const worldSeed = hashString('blockcraft-test-seed-42');
    const terrainStageSeed = deriveSeed(worldSeed, 'terrain_shape');
    const pipeline = createDefaultPipeline();
    const world = new World();

    let totalMatched = 0;
    let totalChecked = 0;

    const out: TerrainClimate = {
      continentalness: 0,
      erosion: 0,
      peaks: 0,
      river: 0,
      surfaceHeight: 0,
    };

    for (let cx = 0; cx < 4; cx++) {
      for (let cz = 0; cz < 4; cz++) {
        const col = world.getColumn(cx, cz, true)!;
        pipeline.generateColumn(worldSeed, cx, cz, col);

        for (let x = 0; x < 16; x++) {
          for (let z = 0; z < 16; z += 4) {
            // don't need all 256 per chunk, 4x16 is 64
            const wx = cx * 16 + x;
            const wz = cz * 16 + z;
            sampleTerrainClimate(terrainStageSeed, wx, wz, out);

            let topBlock = 'air';
            for (let y = 319; y >= 0; y--) {
              const b = world.getBlock(wx, y, wz).id;
              if (b !== 'air') {
                topBlock = b;
                break;
              }
            }

            const isWater = topBlock === 'water';
            const samplerIsWater = out.surfaceHeight <= 64;

            if (isWater === samplerIsWater) {
              totalMatched++;
            }
            totalChecked++;
          }
        }
      }
    }

    expect(totalChecked).toBeGreaterThanOrEqual(200);
    expect(totalMatched / totalChecked).toBeGreaterThanOrEqual(0.95);
  });

  it('River shapes are narrow, winding, and connected', () => {
    function evaluateRiverShape(seedStr: string, _isAlt: boolean) {
      const worldSeed = hashString(seedStr);
      const terrainStageSeed = deriveSeed(worldSeed, 'terrain_shape');
      const out = { continentalness: 0, erosion: 0, peaks: 0, river: 0, surfaceHeight: 0 };

      const width = 512;
      const height = 512;

      const windows = [
        { x1: -256, z1: -256, x2: -256 + width, z2: -256 + height },
        { x1: 1024, z1: 1024, x2: 1024 + width, z2: 1024 + height },
        { x1: -2048, z1: -1536, x2: -2048 + width, z2: -1536 + height },
      ];

      let totalRiverCount = 0;
      let totalLandCount = 0;
      let totalPondRiverCount = 0;
      let maxRiverWidth = 0;
      const allWidths: number[] = [];

      for (const win of windows) {
        const grid = new Int32Array(width * height);

        for (let x = win.x1; x < win.x2; x++) {
          for (let z = win.z1; z < win.z2; z++) {
            sampleTerrainClimate(terrainStageSeed, x, z, out);
            const isRiver = out.river > 0 && out.surfaceHeight < 64; // SEA_LEVEL is 64
            const isLand = out.surfaceHeight >= 64 || isRiver;

            if (isLand) totalLandCount++;

            if (isRiver) {
              grid[(z - win.z1) * width + (x - win.x1)] = 1;
              totalRiverCount++;
            }
          }
        }

        const dist = new Int32Array(width * height);
        dist.fill(9999);
        const qx: number[] = [];
        const qz: number[] = [];

        for (let x = 0; x < width; x++) {
          for (let z = 0; z < height; z++) {
            if (grid[z * width + x] === 0) {
              dist[z * width + x] = 0;
              qx.push(x);
              qz.push(z);
            } else if (x === 0 || x === width - 1 || z === 0 || z === height - 1) {
              dist[z * width + x] = 1;
              qx.push(x);
              qz.push(z);
            }
          }
        }

        let head = 0;
        const dx = [-1, 1, 0, 0];
        const dz = [0, 0, -1, 1];
        while (head < qx.length) {
          const cx = qx[head]!;
          const cz = qz[head]!;
          head++;
          const cd = dist[cz * width + cx]!;
          for (let i = 0; i < 4; i++) {
            const nx = cx + dx[i]!;
            const nz = cz + dz[i]!;
            if (nx >= 0 && nx < width && nz >= 0 && nz < height) {
              if (dist[nz * width + nx]! > cd + 1) {
                dist[nz * width + nx] = cd + 1;
                qx.push(nx);
                qz.push(nz);
              }
            }
          }
        }

        const visited = new Uint8Array(width * height);

        // 8-connected BFS over river cells for components
        const cdx = [-1, 1, 0, 0, -1, 1, -1, 1];
        const cdz = [0, 0, -1, 1, -1, -1, 1, 1];

        for (let x = 0; x < width; x++) {
          for (let z = 0; z < height; z++) {
            if (grid[z * width + x] === 1 && visited[z * width + x] === 0) {
              let compSize = 0;
              let minX = x,
                maxX = x,
                minZ = z,
                maxZ = z;
              let maxDist = 0;

              const cqx = [x];
              const cqz = [z];
              visited[z * width + x] = 1;
              let chead = 0;

              while (chead < cqx.length) {
                const cx = cqx[chead]!;
                const cz = cqz[chead]!;
                chead++;
                compSize++;
                if (cx < minX) minX = cx;
                if (cx > maxX) maxX = cx;
                if (cz < minZ) minZ = cz;
                if (cz > maxZ) maxZ = cz;

                const d = dist[cz * width + cx]!;
                if (d > maxDist) maxDist = d;

                for (let i = 0; i < 8; i++) {
                  const nx = cx + cdx[i]!;
                  const nz = cz + cdz[i]!;
                  if (nx >= 0 && nx < width && nz >= 0 && nz < height) {
                    if (grid[nz * width + nx] === 1 && visited[nz * width + nx] === 0) {
                      visited[nz * width + nx] = 1;
                      cqx.push(nx);
                      cqz.push(nz);
                    }
                  }
                }
              }

              const compW = maxX - minX + 1;
              const compH = maxZ - minZ + 1;
              const longSide = Math.max(compW, compH);
              const maxWidth = 2 * maxDist;

              if (maxWidth > 0) {
                const elongation = longSide / maxWidth;
                if (elongation < 4) {
                  totalPondRiverCount += compSize;
                }
              }
            }
          }
        }

        for (let i = 0; i < width * height; i++) {
          if (grid[i] === 1) {
            const cellWidth = 2 * dist[i]!;
            allWidths.push(cellWidth);
            if (cellWidth > maxRiverWidth) maxRiverWidth = cellWidth;
          }
        }
      }

      if (totalLandCount > 0) {
        const riverRatio = totalRiverCount / totalLandCount;
        expect(riverRatio).toBeGreaterThanOrEqual(0.015);
        expect(riverRatio).toBeLessThanOrEqual(0.05);
      }

      if (allWidths.length > 0) {
        allWidths.sort((a, b) => a - b);
        const p50 = allWidths[Math.floor(allWidths.length * 0.5)]!;
        const p90 = allWidths[Math.floor(allWidths.length * 0.9)]!;

        expect(p50).toBeGreaterThanOrEqual(3);
        expect(p50).toBeLessThanOrEqual(12);

        expect(p90).toBeLessThanOrEqual(20);
        expect(maxRiverWidth).toBeLessThanOrEqual(32);
      }

      if (totalRiverCount > 0) {
        const pondRatio = totalPondRiverCount / totalRiverCount;
        expect(pondRatio).toBeLessThanOrEqual(0.1);
      }
    }

    const t0 = performance.now();
    evaluateRiverShape('blockcraft-test-seed-42', false);
    evaluateRiverShape('blockcraft-alt-seed-7', true);
    const t1 = performance.now();
    console.log(`River shape test duration: ${t1 - t0} ms`);
  }, 20000);
});
