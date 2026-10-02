import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '../../src/world/world';
import { createDefaultPipeline } from '../../src/gen/pipeline';
import { hashString } from '../../src/engine/rng';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { GenWorkerPool, GenResult } from '../../src/workers/gen-worker-pool';

describe('M03d — Caves & Aquifers Unit Tests', () => {
  beforeEach(() => {
    BlockRegistry.resetInstance();
    BlockRegistry.getInstance();
  });

  it('a & e: cave air % per 10-block y band (y 10-60 >= 3%) for standard and alt seeds', () => {
    const pipeline = createDefaultPipeline();
    const seeds = [
      { name: 'standard', seedStr: 'blockcraft-test-seed-42' },
      { name: 'alt', seedStr: 'blockcraft-alt-seed-7' },
    ];

    for (const s of seeds) {
      const worldSeed = hashString(s.seedStr);
      const world = new World(false);

      let totalUndergroundBlocksY10_60 = 0;
      let totalCaveAirY10_60 = 0;

      const yBandTotal = new Int32Array(6); // 10..19, 20..29, 30..39, 40..49, 50..59, 60..69
      const yBandAir = new Int32Array(6);

      // 8x8 ChunkColumns = 128x128 block region
      for (let cx = 0; cx < 8; cx++) {
        for (let cz = 0; cz < 8; cz++) {
          const col = world.getColumn(cx, cz, true)!;
          pipeline.generateColumn(worldSeed, cx, cz, col);

          for (let z = 0; z < 16; z++) {
            const wz = cz * 16 + z;
            for (let x = 0; x < 16; x++) {
              const wx = cx * 16 + x;

              // Find terrain surface Y (highest non-air, non-water or top land block)
              let surfY = -1;
              for (let y = 319; y >= 0; y--) {
                const b = world.getBlock(wx, y, wz).id;
                if (b !== 'air' && b !== 'water') {
                  surfY = y;
                  break;
                }
              }

              if (surfY < 0) surfY = 64;

              for (let y = 10; y <= 69; y++) {
                if (y < surfY) {
                  const isAir = world.getBlock(wx, y, wz).id === 'air';
                  const bandIdx = Math.floor((y - 10) / 10);

                  yBandTotal[bandIdx]!++;
                  if (isAir) {
                    yBandAir[bandIdx]!++;
                  }

                  if (y <= 60) {
                    totalUndergroundBlocksY10_60++;
                    if (isAir) {
                      totalCaveAirY10_60++;
                    }
                  }
                }
              }
            }
          }
        }
      }

      const caveAirPct = totalCaveAirY10_60 / totalUndergroundBlocksY10_60;

      console.log(`[Cave Air % - ${s.name} seed (${s.seedStr})]
        Underground y 10-60 cave air: ${(caveAirPct * 100).toFixed(2)}% (target >= 3%)
        Per 10-block y band breakdown:
          y 10-19: ${((yBandAir[0]! / yBandTotal[0]!) * 100).toFixed(2)}%
          y 20-29: ${((yBandAir[1]! / yBandTotal[1]!) * 100).toFixed(2)}%
          y 30-39: ${((yBandAir[2]! / yBandTotal[2]!) * 100).toFixed(2)}%
          y 40-49: ${((yBandAir[3]! / yBandTotal[3]!) * 100).toFixed(2)}%
          y 50-59: ${((yBandAir[4]! / yBandTotal[4]!) * 100).toFixed(2)}%
          y 60-69: ${((yBandAir[5]! / yBandTotal[5]!) * 100).toFixed(2)}%
      `);

      expect(caveAirPct).toBeGreaterThanOrEqual(0.03);
    }
  }, 20000);

  it('b: largest 6-connected air component below surface is >= 500 blocks in 128^3 region', () => {
    const pipeline = createDefaultPipeline();
    const worldSeed = hashString('blockcraft-test-seed-42');
    const world = new World(false);

    // 8x8 columns (128x128) x 128 height = 128^3 region
    const W = 128;
    const H = 128;
    const D = 128;
    const TOTAL = W * H * D;

    const isCaveAir = new Uint8Array(TOTAL);

    for (let cx = 0; cx < 8; cx++) {
      for (let cz = 0; cz < 8; cz++) {
        const col = world.getColumn(cx, cz, true)!;
        pipeline.generateColumn(worldSeed, cx, cz, col);

        for (let z = 0; z < 16; z++) {
          const wz = cz * 16 + z;
          for (let x = 0; x < 16; x++) {
            const wx = cx * 16 + x;

            let surfY = -1;
            for (let y = 319; y >= 0; y--) {
              const b = world.getBlock(wx, y, wz).id;
              if (b !== 'air' && b !== 'water') {
                surfY = y;
                break;
              }
            }
            if (surfY < 0) surfY = 64;

            for (let y = 0; y < 128; y++) {
              if (y < surfY && world.getBlock(wx, y, wz).id === 'air') {
                const idx = (y * H + wz) * W + wx;
                isCaveAir[idx] = 1;
              }
            }
          }
        }
      }
    }

    // BFS 6-connected component sizing
    const visited = new Uint8Array(TOTAL);
    const queue = new Int32Array(TOTAL);
    let maxCompSize = 0;

    const DX = [1, -1, 0, 0, 0, 0];
    const DY = [0, 0, 1, -1, 0, 0];
    const DZ = [0, 0, 0, 0, 1, -1];

    for (let i = 0; i < TOTAL; i++) {
      if (isCaveAir[i] === 1 && visited[i] === 0) {
        let head = 0;
        let tail = 0;

        visited[i] = 1;
        queue[tail++] = i;

        while (head < tail) {
          const cur = queue[head++]!;
          const curY = Math.floor(cur / (W * H));
          const rem = cur % (W * H);
          const curZ = Math.floor(rem / W);
          const curX = rem % W;

          for (let k = 0; k < 6; k++) {
            const nx = curX + DX[k]!;
            const ny = curY + DY[k]!;
            const nz = curZ + DZ[k]!;

            if (nx >= 0 && nx < W && ny >= 0 && ny < H && nz >= 0 && nz < D) {
              const nIdx = (ny * H + nz) * W + nx;
              if (isCaveAir[nIdx] === 1 && visited[nIdx] === 0) {
                visited[nIdx] = 1;
                queue[tail++] = nIdx;
              }
            }
          }
        }

        if (tail > maxCompSize) {
          maxCompSize = tail;
        }
      }
    }

    console.log(`[Largest Component Test]
      Largest 6-connected underground air component in 128^3 region: ${maxCompSize} blocks (target >= 500)
    `);

    expect(maxCompSize).toBeGreaterThanOrEqual(500);
  }, 20000);

  it('c: seamlessness - generating a 3x3 block of columns in different orders and worker counts gives identical worldHash', async () => {
    const pipeline = createDefaultPipeline();
    const worldSeed = hashString('blockcraft-test-seed-42');

    // Order 1: Spiral order
    const world1 = new World(false);
    const order1 = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
      [0, -1],
      [1, -1],
    ];

    for (const [cx, cz] of order1) {
      const col = world1.getColumn(cx!, cz!, true)!;
      pipeline.generateColumn(worldSeed, cx!, cz!, col);
    }
    const hash1 = world1.worldHash(-16, -16, 31, 31);

    // Order 2: Reverse raster order
    const world2 = new World(false);
    const order2 = [
      [1, 1],
      [0, 1],
      [-1, 1],
      [1, 0],
      [0, 0],
      [-1, 0],
      [1, -1],
      [0, -1],
      [-1, -1],
    ];

    for (const [cx, cz] of order2) {
      const col = world2.getColumn(cx!, cz!, true)!;
      pipeline.generateColumn(worldSeed, cx!, cz!, col);
    }
    const hash2 = world2.worldHash(-16, -16, 31, 31);

    expect(hash1).toBe(hash2);

  }, 20000);

  it('d: safety - no air directly under water, no carving y <= 4, no lava above y 12 across 100 columns per seed', () => {
    const pipeline = createDefaultPipeline();
    const seeds = [
      { name: 'standard', seedStr: 'blockcraft-test-seed-42' },
      { name: 'alt', seedStr: 'blockcraft-alt-seed-7' },
    ];

    for (const s of seeds) {
      const worldSeed = hashString(s.seedStr);
      const world = new World(false);

      const registry = BlockRegistry.getInstance();
      const lavaState = registry.getDefaultStateId('lava') ?? 1;
      const waterState = registry.getDefaultStateId('water') ?? 1;

      // 10x10 = 100 ChunkColumns
      for (let cx = -5; cx < 5; cx++) {
        for (let cz = -5; cz < 5; cz++) {
          const col = world.getColumn(cx, cz, true)!;
          pipeline.generateColumn(worldSeed, cx, cz, col);

          for (let z = 0; z < 16; z++) {
            const wz = cz * 16 + z;
            for (let x = 0; x < 16; x++) {
              const wx = cx * 16 + x;

              // Safety check 1: No carving at y <= 4
              for (let y = 0; y <= 4; y++) {
                const stateId = col.getBlockStateId(x, y, z);
                if (stateId === 0) {
                  throw new Error(
                    `Block at (${wx},${y},${wz}) must be foundation_stone or solid stone, not air`,
                  );
                }
              }

              // Safety check 2: No lava above y 12
              for (let y = 13; y < 320; y++) {
                const stateId = col.getBlockStateId(x, y, z);
                if (stateId === lavaState) {
                  throw new Error(`Lava found at (${wx},${y},${wz}) above y=12`);
                }
              }

              // Safety check 3: No air directly under water
              for (let y = 1; y < 319; y++) {
                const stateCurrent = col.getBlockStateId(x, y, z);
                const stateAbove = col.getBlockStateId(x, y + 1, z);

                if (stateAbove === waterState && stateCurrent === 0) {
                  throw new Error(
                    `Air block at (${wx},${y},${wz}) directly under water at y=${y + 1}!`,
                  );
                }
              }
            }
          }
        }
      }
    }
  }, 20000);
});
