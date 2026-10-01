import { describe, it, expect } from 'vitest';
import { World } from '../../src/world/world';
import { BlockRegistry } from '../../src/world/blocks/registry';
import {
  LightEngine,
  buildLightLookupTables,
  computeRegionLight,
  LightStorage,
} from '../../src/world/lighting';
import { createDefaultPipeline } from '../../src/gen/pipeline';
import { hashString } from '../../src/engine/rng';

const DX = [1, -1, 0, 0, 0, 0];
const DY = [0, 0, 1, -1, 0, 0];
const DZ = [0, 0, 0, 0, 1, -1];

/**
 * Order-independent reference LightEngine algorithm in three phases:
 * Phase 1: Vertical sky pass for every column
 * Phase 2: Seeding pass for every column
 * Phase 3: Single queue processing pass for sky and block queues
 */
class ReferenceLightEngine extends LightEngine {
  constructor(tables: any) {
    super(tables);
    this['queueCapacity'] = 2097152; // Increase queue capacity to 2M for random test
  }

  public referenceInitializeRegionLight(world: World, radiusChunks: number): void {
    this['skyAddHead'] = 0;
    this['skyAddTail'] = 0;
    this['blockAddHead'] = 0;
    this['blockAddTail'] = 0;

    // Phase 1: Vertical sky pass for every column
    for (let cx = -radiusChunks; cx <= radiusChunks; cx++) {
      for (let cz = -radiusChunks; cz <= radiusChunks; cz++) {
        const col = world.getColumn(cx, cz, false);
        if (!col) continue;

        this.clearColumnCache(cx, cz);

        const skyCol = new Uint8Array(256);
        skyCol.fill(15);

        for (let sy = 19; sy >= 0; sy--) {
          const sec = col.getSection(sy);
          const isNullOrAir =
            !sec ||
            (sec.getBitsPerEntry() === 0 &&
              (this.tables.opacityTable[sec.uniformStateId] ?? 0) === 0);

          if (isNullOrAir) {
            let all15 = true;
            for (let i = 0; i < 256; i++) {
              if (skyCol[i]! !== 15) {
                all15 = false;
                break;
              }
            }

            if (all15) {
              let data = this.storage.getRawData(cx, sy, cz);
              if (!data) {
                data = new Uint8Array(4096);
                this.storage.setRawData(cx, sy, cz, data);
              }
              data.fill(0xf0);
              continue;
            }
          }

          for (let ly = 15; ly >= 0; ly--) {
            const y = (sy << 4) | ly;
            for (let lz = 0; lz < 16; lz++) {
              const z = cz * 16 + lz;
              const zOffset = lz << 4;
              for (let lx = 0; lx < 16; lx++) {
                const x = cx * 16 + lx;
                const colIdx = zOffset | lx;
                let currentSky = skyCol[colIdx]!;

                const st = sec ? sec.getBlockStateId(lx, ly, lz) : 0;
                const op = this.tables.opacityTable[st] ?? 0;
                const emit = this.tables.emissionTable[st] ?? 0;

                if (currentSky === 15 && op === 0) {
                  this.storage.setSkyLight(cx, sy, cz, lx, ly, lz, 15);
                } else {
                  if (currentSky === 15) {
                    currentSky = Math.max(0, 15 - op);
                  } else {
                    currentSky = Math.max(0, currentSky - 1 - op);
                  }
                  skyCol[colIdx] = currentSky;
                  this.storage.setSkyLight(cx, sy, cz, lx, ly, lz, currentSky);
                }

                if (emit > 0) {
                  this.storage.setBlockLight(cx, sy, cz, lx, ly, lz, emit);
                  this['pushBlockAdd'](x, y, z);
                }
              }
            }
          }
        }
      }
    }

    // Phase 2: Seeding pass for every column
    for (let cx = -radiusChunks; cx <= radiusChunks; cx++) {
      for (let cz = -radiusChunks; cz <= radiusChunks; cz++) {
        const col = world.getColumn(cx, cz, false);
        if (!col) continue;

        for (let sy = 0; sy < 20; sy++) {
          const data = this.storage.getRawData(cx, sy, cz);
          if (!data) continue;

          for (let ly = 0; ly < 16; ly++) {
            const y = (sy << 4) | ly;
            for (let lz = 0; lz < 16; lz++) {
              const z = cz * 16 + lz;
              for (let lx = 0; lx < 16; lx++) {
                const x = cx * 16 + lx;

                const idx = (ly << 8) | (lz << 4) | lx;
                const val = data[idx]!;
                const sky = (val >> 4) & 0x0f;
                const block = val & 0x0f;

                if (sky <= 1 && block <= 1) continue;

                const stSelf = world.getBlockStateId(x, y, z);
                const opSelf = this.tables.opacityTable[stSelf] ?? 0;
                const attenSelf = 1 + opSelf;

                for (let i = 0; i < 6; i++) {
                  const nx = x + DX[i]!;
                  const ny = y + DY[i]!;
                  const nz = z + DZ[i]!;
                  if (ny < 0 || ny > 319) continue;
                  const ncx = Math.floor(nx / 16);
                  const ncz = Math.floor(nz / 16);
                  if (!world.hasColumn(ncx, ncz)) continue;

                  const stN = world.getBlockStateId(nx, ny, nz);
                  const opN = this.tables.opacityTable[stN] ?? 0;
                  const attenN = 1 + opN;

                  const nLight = this.getLight(nx, ny, nz);

                  if (sky > 1 && opN < 15 && nLight.sky < sky - attenN) {
                    this['pushSkyAdd'](x, y, z);
                  }
                  if (nLight.sky > 1 && opSelf < 15 && sky < nLight.sky - attenSelf) {
                    this['pushSkyAdd'](nx, ny, nz);
                  }

                  if (block > 1 && opN < 15 && nLight.block < block - attenN) {
                    this['pushBlockAdd'](x, y, z);
                  }
                  if (nLight.block > 1 && opSelf < 15 && sky < nLight.block - attenSelf) {
                    this['pushBlockAdd'](nx, ny, nz);
                  }
                }
              }
            }
          }
        }
      }
    }

    // Phase 3: Process sky and block queues once
    this['processSkyAdd'](world);
    this['processBlockAdd'](world);
  }
}

describe('Region Lighting Correctness vs Reference Implementation', () => {
  const registry = BlockRegistry.getInstance();
  const tables = buildLightLookupTables(registry);

  it('(a) standard seed radius-2 region gives identical sky and block light for every cell', () => {
    const radiusChunks = 2;
    const seedStr = 'blockcraft-test-seed-42';
    const seed = hashString(seedStr);
    const pipeline = createDefaultPipeline();

    // 1. Build world and regionColumns
    const world = new World(false);
    const regionColumns: Record<string, (Uint16Array | number)[]> = {};

    for (let cx = -radiusChunks; cx <= radiusChunks; cx++) {
      for (let cz = -radiusChunks; cz <= radiusChunks; cz++) {
        const col = world.getColumn(cx, cz, true)!;
        pipeline.generateColumn(seed, cx, cz, col);

        const secArray: (Uint16Array | number)[] = [];
        for (let sy = 0; sy < 20; sy++) {
          const sec = col.getSection(sy);
          if (!sec) {
            secArray.push(0);
          } else if (sec.getBitsPerEntry() === 0) {
            secArray.push(sec.uniformStateId);
          } else {
            const arr = new Uint16Array(4096);
            sec.copyBlockStatesTo(arr);
            secArray.push(arr);
          }
        }
        regionColumns[`${cx},${cz}`] = secArray;
      }
    }

    // 2. Compute reference lighting using three-phase referenceInitializeRegionLight
    const refEngine = new ReferenceLightEngine(tables);
    refEngine.referenceInitializeRegionLight(world, radiusChunks);

    // 3. Compute region lighting using computeRegionLight
    const regionMap = computeRegionLight(radiusChunks, regionColumns, tables);

    // 4. Compare every cell across the entire region
    for (let cx = -radiusChunks; cx <= radiusChunks; cx++) {
      for (let cz = -radiusChunks; cz <= radiusChunks; cz++) {
        for (let sy = 0; sy < 20; sy++) {
          const secKey = LightStorage.getSectionKey(cx, sy, cz);
          const regionData = regionMap.get(secKey);
          const refData = refEngine.storage.getRawData(cx, sy, cz);

          for (let ly = 0; ly < 16; ly++) {
            for (let lz = 0; lz < 16; lz++) {
              for (let lx = 0; lx < 16; lx++) {
                const idx = (ly << 8) | (lz << 4) | lx;
                const refVal = refData ? refData[idx]! : 0;
                const regVal = regionData ? regionData[idx]! : 0;

                const refSky = (refVal >> 4) & 0x0f;
                const refBlock = refVal & 0x0f;
                const regSky = (regVal >> 4) & 0x0f;
                const regBlock = regVal & 0x0f;

                const x = cx * 16 + lx;
                const y = sy * 16 + ly;
                const z = cz * 16 + lz;

                expect(regSky, `Sky light mismatch at (${x},${y},${z})`).toBe(refSky);
                expect(regBlock, `Block light mismatch at (${x},${y},${z})`).toBe(refBlock);
              }
            }
          }
        }
      }
    }
  }, 60000);

  it('(b) seeded random block data containing air, stone, glass, leaves, water and lava gives identical light', () => {
    const radiusChunks = 1;
    const availableBlockNames = ['air', 'stone', 'glass', 'oak_leaves', 'water', 'lava'];
    const availableStateIds = availableBlockNames.map(
      (name) => registry.getDefaultStateId(name) ?? 0,
    );

    // LCG PRNG for reproducible random block data
    let lcgState = 987654321;
    const nextRandom = () => {
      lcgState = (Math.imul(lcgState, 1664525) + 1013904223) | 0;
      return (lcgState >>> 0) / 4294967296;
    };

    const world = new World(false);
    const regionColumns: Record<string, (Uint16Array | number)[]> = {};

    for (let cx = -radiusChunks; cx <= radiusChunks; cx++) {
      for (let cz = -radiusChunks; cz <= radiusChunks; cz++) {
        const col = world.getColumn(cx, cz, true)!;
        const secArray: (Uint16Array | number)[] = [];

        for (let sy = 0; sy < 20; sy++) {
          const sec = col.getOrCreateSection(sy)!;
          const arr = new Uint16Array(4096);

          for (let i = 0; i < 4096; i++) {
            const stateIdx = Math.floor(nextRandom() * availableStateIds.length);
            const stateId = availableStateIds[stateIdx]!;
            arr[i] = stateId;
          }

          sec.loadBlockStatesFrom(arr);
          secArray.push(arr);
        }

        regionColumns[`${cx},${cz}`] = secArray;
      }
    }

    // Compute reference lighting
    const refEngine = new ReferenceLightEngine(tables);
    refEngine.referenceInitializeRegionLight(world, radiusChunks);

    // Compute region lighting
    const regionMap = computeRegionLight(radiusChunks, regionColumns, tables);

    // Compare cell by cell
    for (let cx = -radiusChunks; cx <= radiusChunks; cx++) {
      for (let cz = -radiusChunks; cz <= radiusChunks; cz++) {
        for (let sy = 0; sy < 20; sy++) {
          const secKey = LightStorage.getSectionKey(cx, sy, cz);
          const regionData = regionMap.get(secKey);
          const refData = refEngine.storage.getRawData(cx, sy, cz);

          for (let ly = 0; ly < 16; ly++) {
            for (let lz = 0; lz < 16; lz++) {
              for (let lx = 0; lx < 16; lx++) {
                const idx = (ly << 8) | (lz << 4) | lx;
                const refVal = refData ? refData[idx]! : 0;
                const regVal = regionData ? regionData[idx]! : 0;

                const refSky = (refVal >> 4) & 0x0f;
                const refBlock = refVal & 0x0f;
                const regSky = (regVal >> 4) & 0x0f;
                const regBlock = regVal & 0x0f;

                const x = cx * 16 + lx;
                const y = sy * 16 + ly;
                const z = cz * 16 + lz;

                expect(regSky, `Random data sky mismatch at (${x},${y},${z})`).toBe(refSky);
                expect(regBlock, `Random data block mismatch at (${x},${y},${z})`).toBe(refBlock);
              }
            }
          }
        }
      }
    }
  }, 60000);

  it('(c) cross-column overhang cavity lighting correctness', () => {
    const radiusChunks = 1;
    const world = new World(false);
    const regionColumns: Record<string, (Uint16Array | number)[]> = {};

    // Stone state ID
    const stoneState = registry.getDefaultStateId('stone') ?? 1;

    // Fill stone to y=63 everywhere in radius 1
    for (let cx = -radiusChunks; cx <= radiusChunks; cx++) {
      for (let cz = -radiusChunks; cz <= radiusChunks; cz++) {
        const col = world.getColumn(cx, cz, true)!;
        for (let y = 0; y <= 63; y++) {
          for (let zLocal = 0; zLocal < 16; zLocal++) {
            for (let xLocal = 0; xLocal < 16; xLocal++) {
              col.getOrCreateSection(y >> 4)!.setBlockStateId(xLocal, y & 15, zLocal, stoneState);
            }
          }
        }
      }
    }

    // In column cx=1, a stone roof at y 70-72 over x 16-31, z 0-15
    // and an air cavity at y 64-69 beneath it, walled at x=31, z=0 and z=15, open only at x=16 toward cx=0.
    const col1_0 = world.getColumn(1, 0, true)!;
    for (let z = 0; z <= 15; z++) {
      for (let x = 16; x <= 31; x++) {
        const lx = x - 16;
        // Stone roof at y 70-72
        for (let y = 70; y <= 72; y++) {
          col1_0.getOrCreateSection(y >> 4)!.setBlockStateId(lx, y & 15, z, stoneState);
        }
        // Cavity walls at z=0, z=15, x=31
        for (let y = 64; y <= 69; y++) {
          if (z === 0 || z === 15 || x === 31) {
            col1_0.getOrCreateSection(y >> 4)!.setBlockStateId(lx, y & 15, z, stoneState);
          }
        }
      }
    }

    // Mirrored case: in cx=-1, a stone roof at y 70-72 over x -16..-1, z 0-15
    // and an air cavity at y 64-69 beneath it, walled at x=-16, z=0 and z=15, open only at x=-1 toward cx=0.
    const colNeg1_0 = world.getColumn(-1, 0, true)!;
    for (let z = 0; z <= 15; z++) {
      for (let x = -16; x <= -1; x++) {
        const lx = x - -16;
        // Stone roof at y 70-72
        for (let y = 70; y <= 72; y++) {
          colNeg1_0.getOrCreateSection(y >> 4)!.setBlockStateId(lx, y & 15, z, stoneState);
        }
        // Cavity walls at z=0, z=15, x=-16
        for (let y = 64; y <= 69; y++) {
          if (z === 0 || z === 15 || x === -16) {
            colNeg1_0.getOrCreateSection(y >> 4)!.setBlockStateId(lx, y & 15, z, stoneState);
          }
        }
      }
    }

    // Build regionColumns
    for (let cx = -radiusChunks; cx <= radiusChunks; cx++) {
      for (let cz = -radiusChunks; cz <= radiusChunks; cz++) {
        const col = world.getColumn(cx, cz, false)!;
        const secArray: (Uint16Array | number)[] = [];
        for (let sy = 0; sy < 20; sy++) {
          const sec = col.getSection(sy);
          if (!sec) {
            secArray.push(0);
          } else if (sec.getBitsPerEntry() === 0) {
            secArray.push(sec.uniformStateId);
          } else {
            const arr = new Uint16Array(4096);
            sec.copyBlockStatesTo(arr);
            secArray.push(arr);
          }
        }
        regionColumns[`${cx},${cz}`] = secArray;
      }
    }

    // Compute reference lighting using order-independent engine
    const refEngine = new ReferenceLightEngine(tables);
    refEngine.referenceInitializeRegionLight(world, radiusChunks);

    // Compute region light using computeRegionLight
    const regionMap = computeRegionLight(radiusChunks, regionColumns, tables);

    // Assert sky light 14 at (16,66,8), 13 at (17,66,8) and 10 at (20,66,8),
    // and 14, 13, 10 at (-1,66,8), (-2,66,8), (-5,66,8).
    const getSkyLightFromRegionMap = (x: number, y: number, z: number) => {
      const cx = Math.floor(x / 16);
      const cz = Math.floor(z / 16);
      const sy = Math.floor(y / 16);
      const lx = ((x % 16) + 16) % 16;
      const ly = ((y % 16) + 16) % 16;
      const lz = ((z % 16) + 16) % 16;
      const key = LightStorage.getSectionKey(cx, sy, cz);
      const data = regionMap.get(key);
      if (!data) return 0;
      const idx = (ly << 8) | (lz << 4) | lx;
      return (data[idx]! >> 4) & 0x0f;
    };

    expect(getSkyLightFromRegionMap(16, 66, 8)).toBe(14);
    expect(getSkyLightFromRegionMap(17, 66, 8)).toBe(13);
    expect(getSkyLightFromRegionMap(20, 66, 8)).toBe(10);

    expect(getSkyLightFromRegionMap(-1, 66, 8)).toBe(14);
    expect(getSkyLightFromRegionMap(-2, 66, 8)).toBe(13);
    expect(getSkyLightFromRegionMap(-5, 66, 8)).toBe(10);

    // Assert the reference equals computeRegionLight for every cell.
    for (let cx = -radiusChunks; cx <= radiusChunks; cx++) {
      for (let cz = -radiusChunks; cz <= radiusChunks; cz++) {
        for (let sy = 0; sy < 20; sy++) {
          const secKey = LightStorage.getSectionKey(cx, sy, cz);
          const regionData = regionMap.get(secKey);
          const refData = refEngine.storage.getRawData(cx, sy, cz);

          for (let ly = 0; ly < 16; ly++) {
            for (let lz = 0; lz < 16; lz++) {
              for (let lx = 0; lx < 16; lx++) {
                const idx = (ly << 8) | (lz << 4) | lx;
                const refVal = refData ? refData[idx]! : 0;
                const regVal = regionData ? regionData[idx]! : 0;

                const refSky = (refVal >> 4) & 0x0f;
                const refBlock = refVal & 0x0f;
                const regSky = (regVal >> 4) & 0x0f;
                const regBlock = regVal & 0x0f;

                const x = cx * 16 + lx;
                const y = sy * 16 + ly;
                const z = cz * 16 + lz;

                expect(regSky, `Cavity sky mismatch at (${x},${y},${z})`).toBe(refSky);
                expect(regBlock, `Cavity block mismatch at (${x},${y},${z})`).toBe(refBlock);
              }
            }
          }
        }
      }
    }
  }, 60000);
});
