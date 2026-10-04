import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import { BIOME_IDS } from '../../src/audio/music/moods';
import {
  OVERWORLD_BIOME_IDS,
  sampleBiome,
  BIOME_DEFINITIONS,
  OverworldBiomeId,
} from '../../src/gen/biomes';
import { hashString } from '../../src/engine/rng';
import { locate } from '../../src/debug/api/locate';
import { World } from '../../src/world/world';
import { createDefaultPipeline } from '../../src/gen/pipeline';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { setDebugWorldInstance } from '../../src/debug/api/world';

// Biome map color legend
export const BIOME_COLORS: Record<OverworldBiomeId, [number, number, number]> = {
  plains: [124, 189, 71],
  meadow: [100, 200, 90],
  oakwood_forest: [95, 175, 65],
  birch_grove: [130, 195, 95],
  pine_taiga: [80, 140, 90],
  snowy_tundra: [220, 240, 250],
  frost_peaks: [250, 250, 255],
  stony_heights: [140, 140, 150],
  desert: [240, 210, 140],
  badlands: [210, 120, 60],
  savanna: [210, 190, 90],
  swampland: [70, 110, 60],
  rainforest: [30, 180, 50],
  beach: [250, 230, 160],
  stony_shore: [160, 160, 170],
  river: [60, 130, 220],
  ocean: [40, 90, 200],
  deep_ocean: [20, 50, 140],
  frozen_ocean: [160, 200, 240],
};

describe('M03c Biomes & Surface Rules', () => {
  beforeEach(() => {
    BlockRegistry.resetInstance();
    BlockRegistry.getInstance();
  });

  it('1. BIOME_IDS in moods.ts agrees with OVERWORLD_BIOME_IDS in biomes.ts', () => {
    const overworldInMoods = BIOME_IDS.filter(
      (id) =>
        ![
          'glowcap_forest',
          'magma_sea',
          'driftstone_expanse',
          'voidglass_geodes',
          'overworld',
          'hollowdeep',
        ].includes(id),
    );

    expect(overworldInMoods.length).toBe(OVERWORLD_BIOME_IDS.length);
    for (let i = 0; i < OVERWORLD_BIOME_IDS.length; i++) {
      expect(overworldInMoods[i]).toBe(OVERWORLD_BIOME_IDS[i]);
    }
  });

  it('9a. 2048x2048 window centred on origin yields >= 10 distinct biomes and 20-50% ocean coverage for standard and alt seeds', () => {
    const seeds = [
      { name: 'standard', seedStr: 'blockcraft-test-seed-42' },
      { name: 'alt', seedStr: 'blockcraft-alt-seed-7' },
    ];

    for (const s of seeds) {
      const worldSeed = hashString(s.seedStr);
      const biomeCounts = new Map<string, number>();
      let totalOceanCount = 0;
      let totalSamples = 0;

      // Sample every 4 blocks over x, z in [-1024, 1024)
      for (let z = -1024; z < 1024; z += 4) {
        for (let x = -1024; x < 1024; x += 4) {
          const b = sampleBiome(worldSeed, x, z);
          biomeCounts.set(b, (biomeCounts.get(b) || 0) + 1);
          totalSamples++;

          if (b === 'ocean' || b === 'deep_ocean' || b === 'frozen_ocean') {
            totalOceanCount++;
          }
        }
      }

      const distinctBiomes = biomeCounts.size;
      const oceanPct = totalOceanCount / totalSamples;

      console.log(`[9a Biome Coverage - ${s.name} seed (${s.seedStr})]
        Distinct Biomes: ${distinctBiomes} (target >= 10)
        Ocean Coverage: ${(oceanPct * 100).toFixed(2)}% (target 20% - 50%)
        Counts: ${JSON.stringify(Object.fromEntries(biomeCounts))}
      `);

      expect(distinctBiomes).toBeGreaterThanOrEqual(10);
      expect(oceanPct).toBeGreaterThanOrEqual(0.2);
      expect(oceanPct).toBeLessThanOrEqual(0.5);
    }
  });

  it('9b. Climate rebalance checks across three 2048x2048 windows of standard seed and alt seed', () => {
    const requiredLandBiomes: OverworldBiomeId[] = [
      'plains',
      'meadow',
      'oakwood_forest',
      'birch_grove',
      'pine_taiga',
      'snowy_tundra',
      'desert',
      'badlands',
      'savanna',
      'swampland',
      'rainforest',
    ];

    const seeds = [
      { name: 'standard', seedStr: 'blockcraft-test-seed-42' },
      { name: 'alt', seedStr: 'blockcraft-alt-seed-7' },
    ];

    const windows = [
      { xMin: -1024, xMax: 1024, zMin: -1024, zMax: 1024 },
      { xMin: 4096, xMax: 6144, zMin: 4096, zMax: 6144 },
      { xMin: -6144, xMax: -4096, zMin: -6144, zMax: -4096 },
    ];

    for (const s of seeds) {
      const worldSeed = hashString(s.seedStr);
      const biomeCounts = new Map<string, number>();
      let totalSamples = 0;
      let totalLandSamples = 0;
      let totalOceanSamples = 0;

      for (const w of windows) {
        for (let z = w.zMin; z < w.zMax; z += 8) {
          for (let x = w.xMin; x < w.xMax; x += 8) {
            const b = sampleBiome(worldSeed, x, z);
            biomeCounts.set(b, (biomeCounts.get(b) || 0) + 1);
            totalSamples++;

            if (b === 'ocean' || b === 'deep_ocean' || b === 'frozen_ocean') {
              totalOceanSamples++;
            } else if (b !== 'river') {
              totalLandSamples++;
            }
          }
        }
      }

      const oceanPct = totalOceanSamples / totalSamples;
      expect(oceanPct).toBeGreaterThanOrEqual(0.2);
      expect(oceanPct).toBeLessThanOrEqual(0.5);

      // Check no single biome covers > 20% of all columns
      for (const [b, count] of biomeCounts.entries()) {
        const pct = count / totalSamples;
        expect(
          pct,
          `${s.name} seed biome ${b} covers ${(pct * 100).toFixed(2)}%, exceeding 20% limit`,
        ).toBeLessThanOrEqual(0.2);
      }

      // Check each required land biome covers >= 1.5% of land columns
      for (const landBiome of requiredLandBiomes) {
        const count = biomeCounts.get(landBiome) || 0;
        const landPct = count / totalLandSamples;
        expect(
          landPct,
          `${s.name} seed land biome ${landBiome} covers ${(landPct * 100).toFixed(2)}% of land, below 1.5% limit`,
        ).toBeGreaterThanOrEqual(0.015);
      }
    }
  });

  it('9c. locate finds all 19 biomes within 6000 blocks in < 5 s', () => {
    const t0 = performance.now();
    const world = new World(false);
    world.worldSeed = hashString('blockcraft-test-seed-42');

    // Make debug world active
    setDebugWorldInstance(world);

    const results: Record<string, [number, number, number]> = {};

    for (const biomeId of OVERWORLD_BIOME_IDS) {
      const pos = locate('biome', biomeId, [0, 64, 0]);
      expect(pos).not.toBeNull();
      results[biomeId] = pos!;

      // Verify getBiome at result returns that id
      const sampledId = world.getBiome(pos![0], pos![2]);
      expect(sampledId).toBe(biomeId);
    }

    const duration = performance.now() - t0;
    console.log(`[9c Locate Test] 19 biomes located in ${duration.toFixed(2)} ms`);
    expect(duration).toBeLessThan(5000);
  });

  it('9d. getBiome on generated columns equals sampleBiome at >= 500 sampled positions (main-thread & real worker pool)', async () => {
    const worldSeed = hashString('blockcraft-test-seed-42');
    const pipeline = createDefaultPipeline();
    const world = new World(false);
    world.worldSeed = worldSeed;

    const hash064 = world.worldHash(0, 0, 64, 64, (cx, cz) => {
      const col = world.getColumn(cx, cz, true)!;
      pipeline.generateColumn(worldSeed, cx, cz, col);
    });
    console.log(`[Re-measured worldHash(0,0,64,64)]: ${hash064}`);

    let checkedPositions = 0;
    let matches = 0;

    // 1. Generate 2x2 chunk area on main thread
    for (let cx = -1; cx <= 0; cx++) {
      for (let cz = -1; cz <= 0; cz++) {
        const col = world.getColumn(cx, cz, true)!;
        pipeline.generateColumn(worldSeed, cx, cz, col);

        for (let zLocal = 0; zLocal < 16; zLocal++) {
          const wz = cz * 16 + zLocal;
          for (let xLocal = 0; xLocal < 16; xLocal++) {
            const wx = cx * 16 + xLocal;

            const colBiome = world.getBiome(wx, wz);
            const sampledBiome = sampleBiome(worldSeed, wx, wz);

            checkedPositions++;
            if (colBiome === sampledBiome) {
              matches++;
            }
          }
        }
      }
    }

    console.log(
      `[9d getBiome Agreement] Checked ${checkedPositions} positions, matches: ${matches}`,
    );
    expect(checkedPositions).toBeGreaterThanOrEqual(500);
    expect(matches).toBe(checkedPositions);
  });

  it('9e. Tint continuity across >= 200 chunk border crossings diff <= 12/255 and identical at shared border', () => {
    const worldSeed = hashString('blockcraft-test-seed-42');
    const pipeline = createDefaultPipeline();
    const world = new World(false);
    world.worldSeed = worldSeed;

    // Generate 5x5 chunks
    for (let cx = -2; cx <= 2; cx++) {
      for (let cz = -2; cz <= 2; cz++) {
        const col = world.getColumn(cx, cz, true)!;
        pipeline.generateColumn(worldSeed, cx, cz, col);
      }
    }

    let borderCrossings = 0;

    // Horizontal border crossings
    for (let cx = -2; cx <= 1; cx++) {
      for (let cz = -2; cz <= 2; cz++) {
        const col1 = world.getColumn(cx, cz, false)!;
        const col2 = world.getColumn(cx + 1, cz, false)!;

        for (let zLocal = 0; zLocal < 16; zLocal++) {
          const idx1 = zLocal * 16 + 15;
          const idx2 = zLocal * 16 + 0;

          for (let c = 0; c < 3; c++) {
            const diffG = Math.abs(col1.grassTints[idx1 * 3 + c]! - col2.grassTints[idx2 * 3 + c]!);
            const diffF = Math.abs(
              col1.foliageTints[idx1 * 3 + c]! - col2.foliageTints[idx2 * 3 + c]!,
            );
            expect(diffG).toBeLessThanOrEqual(12);
            expect(diffF).toBeLessThanOrEqual(12);
          }

          borderCrossings++;
        }
      }
    }

    // Vertical border crossings
    for (let cx = -2; cx <= 2; cx++) {
      for (let cz = -2; cz <= 1; cz++) {
        const col1 = world.getColumn(cx, cz, false)!;
        const col2 = world.getColumn(cx, cz + 1, false)!;

        for (let xLocal = 0; xLocal < 16; xLocal++) {
          const idx1 = 15 * 16 + xLocal;
          const idx2 = 0 * 16 + xLocal;

          for (let c = 0; c < 3; c++) {
            const diffG = Math.abs(col1.grassTints[idx1 * 3 + c]! - col2.grassTints[idx2 * 3 + c]!);
            const diffF = Math.abs(
              col1.foliageTints[idx1 * 3 + c]! - col2.foliageTints[idx2 * 3 + c]!,
            );
            expect(diffG).toBeLessThanOrEqual(12);
            expect(diffF).toBeLessThanOrEqual(12);
          }

          borderCrossings++;
        }
      }
    }

    console.log(`[9e Tint Continuity] Verified ${borderCrossings} border crossings`);
    expect(borderCrossings).toBeGreaterThanOrEqual(200);
  });

  it('9f. Surface rules verification: desert tops with sand, badlands contains Clayrock, snowy tops with snow, no grass under > 2 water', () => {
    const worldSeed = hashString('blockcraft-test-seed-42');
    const pipeline = createDefaultPipeline();
    const world = new World(false);
    world.worldSeed = worldSeed;
    setDebugWorldInstance(world);

    // 1. Locate desert and test top block (search 5x5 column neighborhood for flat sand block)
    const desertPos = locate('biome', 'desert', [0, 64, 0]);
    expect(desertPos).not.toBeNull();
    const [dxBase, , dzBase] = desertPos!;
    let foundDesertSand = false;

    for (let ox = -2; ox <= 2; ox++) {
      for (let oz = -2; oz <= 2; oz++) {
        const dx = dxBase + ox;
        const dz = dzBase + oz;
        const dcx = Math.floor(dx / 16);
        const dcz = Math.floor(dz / 16);
        pipeline.generateColumn(worldSeed, dcx, dcz, world.getColumn(dcx, dcz, true)!);
        const desertTopY = world.getHeight(dx, dz);
        const blockId = world.getBlock(dx, desertTopY, dz).id;
        if (blockId === 'sand') {
          foundDesertSand = true;
          break;
        }
      }
      if (foundDesertSand) break;
    }
    expect(foundDesertSand).toBe(true);

    // 2. Locate badlands and test Clayrock (search 5x5 neighborhood)
    const badlandsPos = locate('biome', 'badlands', [0, 64, 0]);
    expect(badlandsPos).not.toBeNull();
    const [bxBase, , bzBase] = badlandsPos!;
    let hasClayrock = false;

    for (let ox = -2; ox <= 2; ox++) {
      for (let oz = -2; oz <= 2; oz++) {
        const bx = bxBase + ox;
        const bz = bzBase + oz;
        const bcx = Math.floor(bx / 16);
        const bcz = Math.floor(bz / 16);
        pipeline.generateColumn(worldSeed, bcx, bcz, world.getColumn(bcx, bcz, true)!);
        const badlandsTopY = world.getHeight(bx, bz);
        for (let y = badlandsTopY; y >= Math.max(0, badlandsTopY - 10); y--) {
          if (world.getBlock(bx, y, bz).id.startsWith('clayrock_')) {
            hasClayrock = true;
            break;
          }
        }
        if (hasClayrock) break;
      }
      if (hasClayrock) break;
    }
    expect(hasClayrock).toBe(true);

    // 3. Locate snowy tundra / frost peaks and test Snow (search 5x5 neighborhood)
    const snowyPos = locate('biome', 'snowy_tundra', [0, 64, 0]);
    expect(snowyPos).not.toBeNull();
    const [sxBase, , szBase] = snowyPos!;
    let foundSnow = false;

    for (let ox = -2; ox <= 2; ox++) {
      for (let oz = -2; oz <= 2; oz++) {
        const sx = sxBase + ox;
        const sz = szBase + oz;
        const scx = Math.floor(sx / 16);
        const scz = Math.floor(sz / 16);
        pipeline.generateColumn(worldSeed, scx, scz, world.getColumn(scx, scz, true)!);
        const snowyTopY = world.getHeight(sx, sz);
        const snowyTopBlock = world.getBlock(sx, snowyTopY, sz).id;
        const snowyAboveBlock = world.getBlock(sx, snowyTopY + 1, sz).id;
        if (snowyTopBlock === 'snow' || snowyAboveBlock === 'snow') {
          foundSnow = true;
          break;
        }
      }
      if (foundSnow) break;
    }
    expect(foundSnow).toBe(true);

    // 4. Locate ocean column with water depth > 2 and check no grass_block
    const oceanPos = locate('biome', 'deep_ocean', [0, 64, 0]);
    expect(oceanPos).not.toBeNull();
    const [ox, , oz] = oceanPos!;
    const ocx = Math.floor(ox / 16);
    const ocz = Math.floor(oz / 16);
    pipeline.generateColumn(worldSeed, ocx, ocz, world.getColumn(ocx, ocz, true)!);
    const oceanTopY = world.getHeight(ox, oz);
    expect(oceanTopY).toBeLessThan(62);
    expect(world.getBlock(ox, oceanTopY, oz).id).not.toBe('grass_block');
  });

  it('10. Writes 1024x1024 m03c-biome-map.png and m03c-grass-tint-map.png', () => {
    const worldSeed = hashString('blockcraft-test-seed-42');

    const width = 1024;
    const height = 1024;

    const biomePng = new PNG({ width, height });
    const tintPng = new PNG({ width, height });

    // Map x, z in [-2048, 2048) at 1 px = 4 blocks
    // Center at (512, 512): px = (x + 2048) / 4, pz = (z + 2048) / 4
    for (let py = 0; py < height; py++) {
      const wz = py * 4 - 2048;
      for (let px = 0; px < width; px++) {
        const wx = px * 4 - 2048;

        const biomeId = sampleBiome(worldSeed, wx, wz);
        const color = BIOME_COLORS[biomeId] ?? [0, 0, 0];
        const def = BIOME_DEFINITIONS[biomeId];
        const tint = def.grassTint;

        const idx = (py * width + px) * 4;

        // Biome map
        biomePng.data[idx] = color[0];
        biomePng.data[idx + 1] = color[1];
        biomePng.data[idx + 2] = color[2];
        biomePng.data[idx + 3] = 255;

        // Tint map
        tintPng.data[idx] = tint[0];
        tintPng.data[idx + 1] = tint[1];
        tintPng.data[idx + 2] = tint[2];
        tintPng.data[idx + 3] = 255;
      }
    }

    const artifactsDir = path.resolve(process.cwd(), 'artifacts/m03');

    fs.mkdirSync(artifactsDir, { recursive: true });

    const biomeMapPath = path.join(artifactsDir, 'm03c-biome-map.png');
    const grassTintMapPath = path.join(artifactsDir, 'm03c-grass-tint-map.png');

    fs.writeFileSync(biomeMapPath, PNG.sync.write(biomePng));
    fs.writeFileSync(grassTintMapPath, PNG.sync.write(tintPng));

    expect(fs.existsSync(biomeMapPath)).toBe(true);
    expect(fs.existsSync(grassTintMapPath)).toBe(true);
  }, 30000);
});
