import { BlockRegistry } from './blocks/registry';
import { World } from './world';

export interface LightLookupTables {
  opacityTable: Uint8Array;
  emissionTable: Uint8Array;
}

export function buildLightLookupTables(registry: BlockRegistry): LightLookupTables {
  const maxStateId = registry.getMaxStateId();
  const opacityTable = new Uint8Array(maxStateId + 1);
  const emissionTable = new Uint8Array(maxStateId + 1);

  for (let s = 0; s <= maxStateId; s++) {
    const resolved = registry.getResolvedState(s);
    if (!resolved) {
      opacityTable[s] = 0;
      emissionTable[s] = 0;
      continue;
    }
    const def = resolved.definition;
    const blockId = resolved.blockId;

    let opacity: number;
    if (def.fullOpaqueCube) {
      opacity = 15;
    } else if (
      blockId === 'air' ||
      blockId === 'glass' ||
      blockId.startsWith('stained_glass') ||
      blockId === 'ice'
    ) {
      opacity = 0;
    } else if (blockId.includes('leaves')) {
      opacity = 1;
    } else if (blockId === 'water') {
      opacity = 2;
    } else {
      opacity = 0;
    }

    let emission = def.lightEmission ?? 0;
    if (blockId === 'lava') {
      emission = 15;
    }

    opacityTable[s] = opacity;
    emissionTable[s] = emission;
  }

  return { opacityTable, emissionTable };
}

export class LightStorage {
  // Map numeric section key to Uint8Array (4096 bytes)
  private sections: Map<number, Uint8Array> = new Map();
  public touchedSections: Set<number> = new Set();

  /**
   * Arithmetic section key packing (cx, sy, cz).
   * Formula: ((cx + 32768) * 65536 + (cz + 32768)) * 32 + sy
   * Range supported: |cx|, |cz| <= 32767, sy 0..31 (exact up to 2^53 in JS numbers).
   */
  public static getSectionKey(cx: number, sy: number, cz: number): number {
    if (cx < -32767 || cx > 32767 || cz < -32767 || cz > 32767) {
      throw new Error(
        `Chunk coordinates (${cx}, ${cz}) out of supported key range [-32767, 32767].`,
      );
    }
    if (sy < 0 || sy > 31) {
      throw new Error(`Section Y coordinate ${sy} out of supported range [0, 31].`);
    }
    return ((cx + 32768) * 65536 + (cz + 32768)) * 32 + sy;
  }

  public getRawData(cx: number, sy: number, cz: number): Uint8Array | undefined {
    return this.sections.get(LightStorage.getSectionKey(cx, sy, cz));
  }

  public getRawDataByKey(key: number): Uint8Array | undefined {
    return this.sections.get(key);
  }

  public setRawData(cx: number, sy: number, cz: number, data: Uint8Array): void {
    const key = LightStorage.getSectionKey(cx, sy, cz);
    this.sections.set(key, data);
    this.touchedSections.add(key);
  }

  public setRawDataByKey(key: number, data: Uint8Array): void {
    this.sections.set(key, data);
    this.touchedSections.add(key);
  }

  public getSkyLight(
    cx: number,
    sy: number,
    cz: number,
    lx: number,
    ly: number,
    lz: number,
  ): number {
    const data = this.sections.get(LightStorage.getSectionKey(cx, sy, cz));
    if (!data) return 0;
    const idx = (ly << 8) | (lz << 4) | lx;
    return (data[idx]! >> 4) & 0x0f;
  }

  public getBlockLight(
    cx: number,
    sy: number,
    cz: number,
    lx: number,
    ly: number,
    lz: number,
  ): number {
    const data = this.sections.get(LightStorage.getSectionKey(cx, sy, cz));
    if (!data) return 0;
    const idx = (ly << 8) | (lz << 4) | lx;
    return data[idx]! & 0x0f;
  }

  public setLight(
    cx: number,
    sy: number,
    cz: number,
    lx: number,
    ly: number,
    lz: number,
    sky: number,
    block: number,
  ): boolean {
    const key = LightStorage.getSectionKey(cx, sy, cz);
    let data = this.sections.get(key);
    if (!data) {
      if (sky === 0 && block === 0) return false;
      data = new Uint8Array(4096);
      this.sections.set(key, data);
    }
    const idx = (ly << 8) | (lz << 4) | lx;
    const oldVal = data[idx]!;
    const newVal = ((sky & 0x0f) << 4) | (block & 0x0f);
    if (oldVal !== newVal) {
      data[idx] = newVal;
      this.touchedSections.add(key);
      return true;
    }
    return false;
  }

  public setSkyLight(
    cx: number,
    sy: number,
    cz: number,
    lx: number,
    ly: number,
    lz: number,
    sky: number,
  ): boolean {
    const block = this.getBlockLight(cx, sy, cz, lx, ly, lz);
    return this.setLight(cx, sy, cz, lx, ly, lz, sky, block);
  }

  public setBlockLight(
    cx: number,
    sy: number,
    cz: number,
    lx: number,
    ly: number,
    lz: number,
    block: number,
  ): boolean {
    const sky = this.getSkyLight(cx, sy, cz, lx, ly, lz);
    return this.setLight(cx, sy, cz, lx, ly, lz, sky, block);
  }

  public resetTouched(): void {
    this.touchedSections.clear();
  }

  public clear(): void {
    this.sections.clear();
    this.touchedSections.clear();
  }
}

const DEFAULT_QUEUE_CAPACITY = 524288;

const DX = [1, -1, 0, 0, 0, 0];
const DY = [0, 0, 1, -1, 0, 0];
const DZ = [0, 0, 0, 0, 1, -1];

export class LightEngine {
  public storage: LightStorage = new LightStorage();
  public tables: LightLookupTables;

  // Lazy BFS Queues
  private queueCapacity = DEFAULT_QUEUE_CAPACITY;

  private blockRemX: Int32Array | null = null;
  private blockRemY: Int32Array | null = null;
  private blockRemZ: Int32Array | null = null;
  private blockRemVal: Uint8Array | null = null;
  private blockRemHead = 0;
  private blockRemTail = 0;

  private blockAddX: Int32Array | null = null;
  private blockAddY: Int32Array | null = null;
  private blockAddZ: Int32Array | null = null;
  private blockAddHead = 0;
  private blockAddTail = 0;

  private skyRemX: Int32Array | null = null;
  private skyRemY: Int32Array | null = null;
  private skyRemZ: Int32Array | null = null;
  private skyRemVal: Uint8Array | null = null;
  private skyRemHead = 0;
  private skyRemTail = 0;

  private skyAddX: Int32Array | null = null;
  private skyAddY: Int32Array | null = null;
  private skyAddZ: Int32Array | null = null;
  private skyAddHead = 0;
  private skyAddTail = 0;

  // Key: (cx + 32768) * 65536 + (cz + 32768)
  private heightmaps: Map<number, Int16Array> = new Map();

  constructor(tables?: LightLookupTables) {
    if (tables) {
      this.tables = tables;
    } else {
      this.tables = buildLightLookupTables(BlockRegistry.getInstance());
    }
  }

  private static getColumnKey(cx: number, cz: number): number {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  private ensureBlockRemQueue(): void {
    if (!this.blockRemX) {
      this.blockRemX = new Int32Array(this.queueCapacity);
      this.blockRemY = new Int32Array(this.queueCapacity);
      this.blockRemZ = new Int32Array(this.queueCapacity);
      this.blockRemVal = new Uint8Array(this.queueCapacity);
    }
  }

  private ensureBlockAddQueue(): void {
    if (!this.blockAddX) {
      this.blockAddX = new Int32Array(this.queueCapacity);
      this.blockAddY = new Int32Array(this.queueCapacity);
      this.blockAddZ = new Int32Array(this.queueCapacity);
    }
  }

  private ensureSkyRemQueue(): void {
    if (!this.skyRemX) {
      this.skyRemX = new Int32Array(this.queueCapacity);
      this.skyRemY = new Int32Array(this.queueCapacity);
      this.skyRemZ = new Int32Array(this.queueCapacity);
      this.skyRemVal = new Uint8Array(this.queueCapacity);
    }
  }

  private ensureSkyAddQueue(): void {
    if (!this.skyAddX) {
      this.skyAddX = new Int32Array(this.queueCapacity);
      this.skyAddY = new Int32Array(this.queueCapacity);
      this.skyAddZ = new Int32Array(this.queueCapacity);
    }
  }

  public setCustomEmission(stateId: number, emission: number): void {
    if (stateId >= this.tables.emissionTable.length) {
      const newEmit = new Uint8Array(stateId + 1);
      newEmit.set(this.tables.emissionTable);
      this.tables.emissionTable = newEmit;
      const newOp = new Uint8Array(stateId + 1);
      newOp.set(this.tables.opacityTable);
      this.tables.opacityTable = newOp;
    }
    this.tables.emissionTable[stateId] = emission;
  }

  public setCustomOpacity(stateId: number, opacity: number): void {
    if (stateId >= this.tables.opacityTable.length) {
      const newEmit = new Uint8Array(stateId + 1);
      newEmit.set(this.tables.emissionTable);
      this.tables.emissionTable = newEmit;
      const newOp = new Uint8Array(stateId + 1);
      newOp.set(this.tables.opacityTable);
      this.tables.opacityTable = newOp;
    }
    this.tables.opacityTable[stateId] = opacity;
  }

  public getLight(x: number, y: number, z: number): { sky: number; block: number } {
    if (y < 0 || y > 319) {
      return { sky: y > 319 ? 15 : 0, block: 0 };
    }
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const localX = ((x % 16) + 16) % 16;
    const localZ = ((z % 16) + 16) % 16;
    const sy = y >> 4;
    const ly = y & 15;
    return {
      sky: this.storage.getSkyLight(cx, sy, cz, localX, ly, localZ),
      block: this.storage.getBlockLight(cx, sy, cz, localX, ly, localZ),
    };
  }

  public getHighestOpaqueY(world: World, x: number, z: number): number {
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const localX = ((x % 16) + 16) % 16;
    const localZ = ((z % 16) + 16) % 16;
    const key = LightEngine.getColumnKey(cx, cz);
    let hm = this.heightmaps.get(key);
    if (!hm) {
      hm = new Int16Array(256);
      hm.fill(-2);
      this.heightmaps.set(key, hm);
    }
    const idx = (localZ << 4) | localX;
    if (hm[idx]! !== -2) {
      return hm[idx]!;
    }
    let h = -1;
    for (let y = 319; y >= 0; y--) {
      const stateId = world.getBlockStateId(x, y, z);
      const op = this.tables.opacityTable[stateId] ?? 0;
      if (op > 0) {
        h = y;
        break;
      }
    }
    hm[idx] = h;
    return h;
  }

  public updateHighestOpaqueYOnBlockChange(
    world: World,
    x: number,
    z: number,
    y: number,
    oldOp: number,
    newOp: number,
  ): { oldHighestY: number; newHighestY: number } {
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const localX = ((x % 16) + 16) % 16;
    const localZ = ((z % 16) + 16) % 16;
    const key = LightEngine.getColumnKey(cx, cz);
    let hm = this.heightmaps.get(key);
    if (!hm) {
      hm = new Int16Array(256);
      hm.fill(-2);
      this.heightmaps.set(key, hm);
    }
    const idx = (localZ << 4) | localX;

    let oldHighestY = -1;
    if (hm[idx]! !== -2) {
      oldHighestY = hm[idx]!;
    } else {
      for (let cy = 319; cy >= 0; cy--) {
        const cop =
          cy === y ? oldOp : (this.tables.opacityTable[world.getBlockStateId(x, cy, z)] ?? 0);
        if (cop > 0) {
          oldHighestY = cy;
          break;
        }
      }
    }

    let newHighestY = oldHighestY;
    if (newOp > 0) {
      if (y > oldHighestY) {
        newHighestY = y;
      }
    } else if (oldOp > 0 && newOp === 0) {
      if (y === oldHighestY) {
        let h = -1;
        for (let cy = y - 1; cy >= 0; cy--) {
          const cop = this.tables.opacityTable[world.getBlockStateId(x, cy, z)] ?? 0;
          if (cop > 0) {
            h = cy;
            break;
          }
        }
        newHighestY = h;
      }
    }

    hm[idx] = newHighestY;
    return { oldHighestY, newHighestY };
  }

  public clearColumnCache(cx: number, cz: number): void {
    this.heightmaps.delete(LightEngine.getColumnKey(cx, cz));
  }

  public initializeColumnLight(world: World, cx: number, cz: number): void {
    const col = world.getColumn(cx, cz, false);
    if (!col) return;

    this.clearColumnCache(cx, cz);

    this.skyAddHead = 0;
    this.skyAddTail = 0;
    this.blockAddHead = 0;
    this.blockAddTail = 0;

    // Track sky light per x-z column (16x16 = 256 values)
    const skyCol = new Uint8Array(256);
    skyCol.fill(15);

    // Fast vertical pass section by section (from sy=19 down to 0)
    for (let sy = 19; sy >= 0; sy--) {
      const sec = col.getSection(sy);
      const isNullOrAir =
        !sec ||
        (sec.getBitsPerEntry() === 0 && (this.tables.opacityTable[sec.uniformStateId] ?? 0) === 0);

      if (isNullOrAir) {
        // Check if all columns currently have sky = 15
        let all15 = true;
        for (let i = 0; i < 256; i++) {
          if (skyCol[i]! !== 15) {
            all15 = false;
            break;
          }
        }

        if (all15) {
          // Fast path: entire section is uniform sky light 15
          let data = this.storage.getRawData(cx, sy, cz);
          if (!data) {
            data = new Uint8Array(4096);
            this.storage.setRawData(cx, sy, cz, data);
          }
          data.fill(0xf0);
          continue;
        }
      }

      // Non-uniform or non-15 sky section
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
              // Direct vertical sky beam
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
              this.pushBlockAdd(x, y, z);
            }
          }
        }
      }
    }

    // Push propagation candidates for sky light and block light across loaded neighbor boundaries
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
                this.pushSkyAdd(x, y, z);
              }
              if (nLight.sky > 1 && opSelf < 15 && sky < nLight.sky - attenSelf) {
                this.pushSkyAdd(nx, ny, nz);
              }

              if (block > 1 && opN < 15 && nLight.block < block - attenN) {
                this.pushBlockAdd(x, y, z);
              }
              if (nLight.block > 1 && opSelf < 15 && block < nLight.block - attenSelf) {
                this.pushBlockAdd(nx, ny, nz);
              }
            }
          }
        }
      }
    }

    // Process BFS for initial light
    this.processSkyAdd(world);
    this.processBlockAdd(world);
  }

  public onBlockChanged(
    world: World,
    x: number,
    y: number,
    z: number,
    oldStateId: number,
    newStateId: number,
  ): void {
    if (y < 0 || y > 319) return;

    this.storage.resetTouched();

    const oldOp = this.tables.opacityTable[oldStateId] ?? 0;
    const newOp = this.tables.opacityTable[newStateId] ?? 0;
    const oldEmit = this.tables.emissionTable[oldStateId] ?? 0;
    const newEmit = this.tables.emissionTable[newStateId] ?? 0;

    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const localX = ((x % 16) + 16) % 16;
    const localZ = ((z % 16) + 16) % 16;
    const sy = y >> 4;
    const ly = y & 15;

    // --- Block Light ---
    this.blockRemHead = 0;
    this.blockRemTail = 0;
    this.blockAddHead = 0;
    this.blockAddTail = 0;

    const currentBL = this.storage.getBlockLight(cx, sy, cz, localX, ly, localZ);

    if (oldEmit > 0 && oldEmit !== newEmit) {
      this.pushBlockRem(x, y, z, currentBL);
      this.storage.setBlockLight(cx, sy, cz, localX, ly, localZ, 0);
    } else if (newOp > oldOp && currentBL > 0) {
      this.pushBlockRem(x, y, z, currentBL);
      this.storage.setBlockLight(cx, sy, cz, localX, ly, localZ, 0);
    }

    this.processBlockRem(world);

    if (newEmit > 0) {
      this.storage.setBlockLight(cx, sy, cz, localX, ly, localZ, newEmit);
      this.pushBlockAdd(x, y, z);
    } else if (newOp < oldOp) {
      // Light from neighbors could enter
      for (let i = 0; i < 6; i++) {
        const nx = x + DX[i]!;
        const ny = y + DY[i]!;
        const nz = z + DZ[i]!;
        if (ny >= 0 && ny <= 319) {
          const ncx = Math.floor(nx / 16);
          const ncz = Math.floor(nz / 16);
          if (world.hasColumn(ncx, ncz)) {
            const nBL = this.getLight(nx, ny, nz).block;
            if (nBL > 1) {
              this.pushBlockAdd(nx, ny, nz);
            }
          }
        }
      }
    }

    this.processBlockAdd(world);

    // --- Sky Light ---
    this.skyRemHead = 0;
    this.skyRemTail = 0;
    this.skyAddHead = 0;
    this.skyAddTail = 0;

    const { oldHighestY, newHighestY } = this.updateHighestOpaqueYOnBlockChange(
      world,
      x,
      z,
      y,
      oldOp,
      newOp,
    );

    if (newOp > oldOp) {
      // Block became more opaque / roof added / fluid or leaves placed
      const oldSky = this.storage.getSkyLight(cx, sy, cz, localX, ly, localZ);
      this.storage.setSkyLight(cx, sy, cz, localX, ly, localZ, 0);
      if (oldSky > 0) {
        this.pushSkyRem(x, y, z, oldSky);
      }

      // Clear vertical beam below (x, y, z) down to the first full opaque block
      if (y >= oldHighestY) {
        for (let cy = y - 1; cy >= 0; cy--) {
          const ccx = Math.floor(x / 16);
          const ccz = Math.floor(z / 16);
          const clx = ((x % 16) + 16) % 16;
          const clz = ((z % 16) + 16) % 16;
          const csy = cy >> 4;
          const cly = cy & 15;
          const cst = world.getBlockStateId(x, cy, z);
          const cop = this.tables.opacityTable[cst] ?? 0;
          const belowSky = this.storage.getSkyLight(ccx, csy, ccz, clx, cly, clz);

          if (belowSky > 0) {
            this.storage.setSkyLight(ccx, csy, ccz, clx, cly, clz, 0);
            this.pushSkyRem(x, cy, z, belowSky);
          }
          if (cop === 15) break;
        }
      }

      this.processSkyRem(world);
      this.processSkyAdd(world);
    } else if (newOp < oldOp) {
      // Block opened
      const isExposed = y > newHighestY;
      if (isExposed) {
        this.storage.setSkyLight(cx, sy, cz, localX, ly, localZ, 15);
        this.pushSkyAdd(x, y, z);

        for (let cy = y - 1; cy >= 0; cy--) {
          const ccx = Math.floor(x / 16);
          const ccz = Math.floor(z / 16);
          const clx = ((x % 16) + 16) % 16;
          const clz = ((z % 16) + 16) % 16;
          const csy = cy >> 4;
          const cly = cy & 15;
          const cst = world.getBlockStateId(x, cy, z);
          const cop = this.tables.opacityTable[cst] ?? 0;
          if (cop === 15) break;

          const target = cop === 0 ? 15 : Math.max(0, 15 - cop);
          this.storage.setSkyLight(ccx, csy, ccz, clx, cly, clz, target);
          this.pushSkyAdd(x, cy, z);
          if (cop > 0) break;
        }
      }

      // Check all 6 neighbors for incoming sky light
      for (let i = 0; i < 6; i++) {
        const nx = x + DX[i]!;
        const ny = y + DY[i]!;
        const nz = z + DZ[i]!;
        if (ny >= 0 && ny <= 319) {
          const ncx = Math.floor(nx / 16);
          const ncz = Math.floor(nz / 16);
          if (world.hasColumn(ncx, ncz)) {
            const nSky = this.getLight(nx, ny, nz).sky;
            if (nSky > 1) {
              this.pushSkyAdd(nx, ny, nz);
            }
          }
        }
      }

      this.processSkyAdd(world);
    }
  }

  // --- Queue push / pop / process helpers ---

  private pushBlockRem(x: number, y: number, z: number, val: number): void {
    if (this.blockRemTail >= this.queueCapacity) {
      throw new Error(`LightEngine blockRem queue capacity (${this.queueCapacity}) exceeded`);
    }
    this.ensureBlockRemQueue();
    this.blockRemX![this.blockRemTail] = x;
    this.blockRemY![this.blockRemTail] = y;
    this.blockRemZ![this.blockRemTail] = z;
    this.blockRemVal![this.blockRemTail] = val;
    this.blockRemTail++;
  }

  private pushBlockAdd(x: number, y: number, z: number): void {
    if (this.blockAddTail >= this.queueCapacity) {
      throw new Error(`LightEngine blockAdd queue capacity (${this.queueCapacity}) exceeded`);
    }
    this.ensureBlockAddQueue();
    this.blockAddX![this.blockAddTail] = x;
    this.blockAddY![this.blockAddTail] = y;
    this.blockAddZ![this.blockAddTail] = z;
    this.blockAddTail++;
  }

  private pushSkyRem(x: number, y: number, z: number, val: number): void {
    if (this.skyRemTail >= this.queueCapacity) {
      throw new Error(`LightEngine skyRem queue capacity (${this.queueCapacity}) exceeded`);
    }
    this.ensureSkyRemQueue();
    this.skyRemX![this.skyRemTail] = x;
    this.skyRemY![this.skyRemTail] = y;
    this.skyRemZ![this.skyRemTail] = z;
    this.skyRemVal![this.skyRemTail] = val;
    this.skyRemTail++;
  }

  private pushSkyAdd(x: number, y: number, z: number): void {
    if (this.skyAddTail >= this.queueCapacity) {
      throw new Error(`LightEngine skyAdd queue capacity (${this.queueCapacity}) exceeded`);
    }
    this.ensureSkyAddQueue();
    this.skyAddX![this.skyAddTail] = x;
    this.skyAddY![this.skyAddTail] = y;
    this.skyAddZ![this.skyAddTail] = z;
    this.skyAddTail++;
  }

  private processBlockRem(world: World): void {
    if (!this.blockRemX || !this.blockRemY || !this.blockRemZ || !this.blockRemVal) return;
    while (this.blockRemHead < this.blockRemTail) {
      const rx = this.blockRemX[this.blockRemHead]!;
      const ry = this.blockRemY[this.blockRemHead]!;
      const rz = this.blockRemZ[this.blockRemHead]!;
      const val = this.blockRemVal[this.blockRemHead]!;
      this.blockRemHead++;

      for (let i = 0; i < 6; i++) {
        const nx = rx + DX[i]!;
        const ny = ry + DY[i]!;
        const nz = rz + DZ[i]!;
        if (ny < 0 || ny > 319) continue;

        const ncx = Math.floor(nx / 16);
        const ncz = Math.floor(nz / 16);
        const nlx = ((nx % 16) + 16) % 16;
        const nlz = ((nz % 16) + 16) % 16;
        if (!world.hasColumn(ncx, ncz)) continue;

        const nsy = ny >> 4;
        const nly = ny & 15;
        const nBL = this.storage.getBlockLight(ncx, nsy, ncz, nlx, nly, nlz);
        if (nBL === 0) continue;

        const st = world.getBlockStateId(nx, ny, nz);
        const emit = this.tables.emissionTable[st] ?? 0;
        const isEmitter = emit > 0 && emit === nBL;

        if (nBL < val || (nBL === val && !isEmitter)) {
          this.storage.setBlockLight(ncx, nsy, ncz, nlx, nly, nlz, 0);
          this.pushBlockRem(nx, ny, nz, nBL);
        } else if (nBL >= val) {
          this.pushBlockAdd(nx, ny, nz);
        }
      }
    }
  }

  private processBlockAdd(world: World): void {
    if (!this.blockAddX || !this.blockAddY || !this.blockAddZ) return;
    while (this.blockAddHead < this.blockAddTail) {
      const ax = this.blockAddX[this.blockAddHead]!;
      const ay = this.blockAddY[this.blockAddHead]!;
      const az = this.blockAddZ[this.blockAddHead]!;
      this.blockAddHead++;

      const acx = Math.floor(ax / 16);
      const acz = Math.floor(az / 16);
      const alx = ((ax % 16) + 16) % 16;
      const alz = ((az % 16) + 16) % 16;
      const asy = ay >> 4;
      const aly = ay & 15;
      const curBL = this.storage.getBlockLight(acx, asy, acz, alx, aly, alz);
      if (curBL <= 1) continue;

      for (let i = 0; i < 6; i++) {
        const nx = ax + DX[i]!;
        const ny = ay + DY[i]!;
        const nz = az + DZ[i]!;
        if (ny < 0 || ny > 319) continue;

        const ncx = Math.floor(nx / 16);
        const ncz = Math.floor(nz / 16);
        const nlx = ((nx % 16) + 16) % 16;
        const nlz = ((nz % 16) + 16) % 16;
        if (!world.hasColumn(ncx, ncz)) continue;

        const st = world.getBlockStateId(nx, ny, nz);
        const op = this.tables.opacityTable[st] ?? 0;
        if (op === 15) continue;

        const attenuation = 1 + op;
        const target = curBL - attenuation;

        const nsy = ny >> 4;
        const nly = ny & 15;
        const existingBL = this.storage.getBlockLight(ncx, nsy, ncz, nlx, nly, nlz);

        if (target > existingBL) {
          this.storage.setBlockLight(ncx, nsy, ncz, nlx, nly, nlz, target);
          this.pushBlockAdd(nx, ny, nz);
        }
      }
    }
  }

  private processSkyRem(world: World): void {
    if (!this.skyRemX || !this.skyRemY || !this.skyRemZ || !this.skyRemVal) return;
    while (this.skyRemHead < this.skyRemTail) {
      const rx = this.skyRemX[this.skyRemHead]!;
      const ry = this.skyRemY[this.skyRemHead]!;
      const rz = this.skyRemZ[this.skyRemHead]!;
      const val = this.skyRemVal[this.skyRemHead]!;
      this.skyRemHead++;

      for (let i = 0; i < 6; i++) {
        const nx = rx + DX[i]!;
        const ny = ry + DY[i]!;
        const nz = rz + DZ[i]!;
        if (ny < 0 || ny > 319) continue;

        const ncx = Math.floor(nx / 16);
        const ncz = Math.floor(nz / 16);
        const nlx = ((nx % 16) + 16) % 16;
        const nlz = ((nz % 16) + 16) % 16;
        if (!world.hasColumn(ncx, ncz)) continue;

        const nsy = ny >> 4;
        const nly = ny & 15;
        const nSky = this.storage.getSkyLight(ncx, nsy, ncz, nlx, nly, nlz);

        if (nSky !== 0 && nSky < val) {
          this.storage.setSkyLight(ncx, nsy, ncz, nlx, nly, nlz, 0);
          this.pushSkyRem(nx, ny, nz, nSky);
        } else if (nSky >= val) {
          this.pushSkyAdd(nx, ny, nz);
        }
      }
    }
  }

  private processSkyAdd(world: World): void {
    if (!this.skyAddX || !this.skyAddY || !this.skyAddZ) return;
    while (this.skyAddHead < this.skyAddTail) {
      const ax = this.skyAddX[this.skyAddHead]!;
      const ay = this.skyAddY[this.skyAddHead]!;
      const az = this.skyAddZ[this.skyAddHead]!;
      this.skyAddHead++;

      const acx = Math.floor(ax / 16);
      const acz = Math.floor(az / 16);
      const alx = ((ax % 16) + 16) % 16;
      const alz = ((az % 16) + 16) % 16;
      const asy = ay >> 4;
      const aly = ay & 15;
      const curSky = this.storage.getSkyLight(acx, asy, acz, alx, aly, alz);
      if (curSky <= 1) continue;

      const highestY = this.getHighestOpaqueY(world, ax, az);
      const isBeam = curSky === 15 && ay > highestY;

      for (let i = 0; i < 6; i++) {
        const nx = ax + DX[i]!;
        const ny = ay + DY[i]!;
        const nz = az + DZ[i]!;
        if (ny < 0 || ny > 319) continue;

        const ncx = Math.floor(nx / 16);
        const ncz = Math.floor(nz / 16);
        const nlx = ((nx % 16) + 16) % 16;
        const nlz = ((nz % 16) + 16) % 16;
        if (!world.hasColumn(ncx, ncz)) continue;

        const st = world.getBlockStateId(nx, ny, nz);
        const op = this.tables.opacityTable[st] ?? 0;
        if (op === 15) continue;

        let target: number;
        if (isBeam && ny === ay - 1 && nx === ax && nz === az) {
          target = op === 0 ? 15 : Math.max(0, 15 - op);
        } else {
          const attenuation = 1 + op;
          target = curSky - attenuation;
        }

        const nsy = ny >> 4;
        const nly = ny & 15;
        const existingSky = this.storage.getSkyLight(ncx, nsy, ncz, nlx, nly, nlz);

        if (target > existingSky) {
          this.storage.setSkyLight(ncx, nsy, ncz, nlx, nly, nlz, target);
          this.pushSkyAdd(nx, ny, nz);
        }
      }
    }
  }
}

/**
 * Bulk Region Lighting on flat typed arrays.
 * Accepts a grid of columns defined by radiusChunks (-radiusChunks..+radiusChunks).
 * Flat array layout per column:
 *   Width W = (2 * radiusChunks + 1) * 16, Depth D = (2 * radiusChunks + 1) * 16, Height H = 320.
 *   Total region dimensions: dimX x 320 x dimZ.
 *   Coordinates mapped to local 3D index: idx = y * (dimX * dimZ) + z * dimX + x.
 */
export function computeRegionLight(
  radiusChunks: number,
  regionColumns: Record<string, (Uint16Array | number)[]>,
  tables: LightLookupTables,
): Map<number, Uint8Array> {
  const sideChunks = 2 * radiusChunks + 1;
  const dimX = sideChunks * 16;
  const dimZ = sideChunks * 16;
  const areaXZ = dimX * dimZ;
  const totalVolume = areaXZ * 320;

  const opacityTable = tables.opacityTable;
  const emissionTable = tables.emissionTable;

  // 1. Unpack block states, opacity, and emission into flat typed arrays for the region
  const opacityGrid = new Uint8Array(totalVolume);
  const skyGrid = new Uint8Array(totalVolume);
  const blockGrid = new Uint8Array(totalVolume);

  // Buffer for block emitters to seed block BFS later: [xLocal, y, zLocal] packed or flat indices
  // Using a flat Int32Array queue for block BFS seeding and propagation
  let blockAddQueue = new Int32Array(524288);
  let blockAddHead = 0;
  let blockAddTail = 0;

  for (let cx = -radiusChunks; cx <= radiusChunks; cx++) {
    const minX = (cx + radiusChunks) * 16;
    for (let cz = -radiusChunks; cz <= radiusChunks; cz++) {
      const minZ = (cz + radiusChunks) * 16;
      const key = `${cx},${cz}`;
      const secArray = regionColumns[key];
      if (!secArray) continue;

      for (let sy = 0; sy < 20; sy++) {
        const secData = secArray[sy];
        const minY = sy * 16;

        if (typeof secData === 'number') {
          const stateId = secData;
          const op = opacityTable[stateId] ?? 0;
          const emit = emissionTable[stateId] ?? 0;

          for (let ly = 0; ly < 16; ly++) {
            const y = minY + ly;
            const yOffset = y * areaXZ;
            for (let lz = 0; lz < 16; lz++) {
              const zLocal = minZ + lz;
              const zOffset = yOffset + zLocal * dimX;
              for (let lx = 0; lx < 16; lx++) {
                const xLocal = minX + lx;
                const idx = zOffset + xLocal;
                opacityGrid[idx] = op;
                if (emit > 0) {
                  blockGrid[idx] = emit;
                  if (blockAddTail >= blockAddQueue.length) {
                    const newQ = new Int32Array(blockAddQueue.length * 2);
                    newQ.set(blockAddQueue);
                    blockAddQueue = newQ;
                  }
                  blockAddQueue[blockAddTail++] = idx;
                }
              }
            }
          }
        } else if (secData instanceof Uint16Array) {
          for (let ly = 0; ly < 16; ly++) {
            const y = minY + ly;
            const yOffset = y * areaXZ;
            for (let lz = 0; lz < 16; lz++) {
              const zLocal = minZ + lz;
              const zOffset = yOffset + zLocal * dimX;
              const secZOffset = (ly << 8) | (lz << 4);
              for (let lx = 0; lx < 16; lx++) {
                const xLocal = minX + lx;
                const idx = zOffset + xLocal;
                const stateId = secData[secZOffset | lx]!;
                const op = opacityTable[stateId] ?? 0;
                const emit = emissionTable[stateId] ?? 0;

                opacityGrid[idx] = op;
                if (emit > 0) {
                  blockGrid[idx] = emit;
                  if (blockAddTail >= blockAddQueue.length) {
                    const newQ = new Int32Array(blockAddQueue.length * 2);
                    newQ.set(blockAddQueue);
                    blockAddQueue = newQ;
                  }
                  blockAddQueue[blockAddTail++] = idx;
                }
              }
            }
          }
        }
      }
    }
  }

  // 2. Vertical Sky Light Pass for every column in region
  // Beam mask per column (dimX * dimZ): stores current sky light at the column top or ray front
  const skyCol = new Uint8Array(areaXZ);
  skyCol.fill(15);

  for (let y = 319; y >= 0; y--) {
    const yOffset = y * areaXZ;
    for (let xz = 0; xz < areaXZ; xz++) {
      const idx = yOffset + xz;
      const op = opacityGrid[idx]!;
      let currentSky = skyCol[xz]!;

      if (currentSky === 15 && op === 0) {
        skyGrid[idx] = 15;
      } else {
        if (currentSky === 15) {
          currentSky = Math.max(0, 15 - op);
        } else {
          currentSky = Math.max(0, currentSky - 1 - op);
        }
        skyCol[xz] = currentSky;
        skyGrid[idx] = currentSky;
      }
    }
  }

  // 3. Seed Sky BFS Queue selectively
  // Seed only cells whose sky light can actually spread to a neighbor inside the region
  let skyAddQueue = new Int32Array(524288);
  let skyAddHead = 0;
  let skyAddTail = 0;

  for (let y = 0; y < 320; y++) {
    const yOffset = y * areaXZ;
    for (let zLocal = 0; zLocal < dimZ; zLocal++) {
      const zOffset = yOffset + zLocal * dimX;
      for (let xLocal = 0; xLocal < dimX; xLocal++) {
        const idx = zOffset + xLocal;
        const sky = skyGrid[idx]!;
        if (sky <= 1) continue;

        const opSelf = opacityGrid[idx]!;

        // Check 6 neighbors in region
        // +X
        if (xLocal + 1 < dimX) {
          const nIdx = idx + 1;
          if (opacityGrid[nIdx]! < 15 && skyGrid[nIdx]! < sky - (1 + opacityGrid[nIdx]!)) {
            if (skyAddTail >= skyAddQueue.length) {
              const newQ = new Int32Array(skyAddQueue.length * 2);
              newQ.set(skyAddQueue);
              skyAddQueue = newQ;
            }
            skyAddQueue[skyAddTail++] = idx;
            continue;
          }
        }
        // -X
        if (xLocal - 1 >= 0) {
          const nIdx = idx - 1;
          if (opacityGrid[nIdx]! < 15 && skyGrid[nIdx]! < sky - (1 + opacityGrid[nIdx]!)) {
            if (skyAddTail >= skyAddQueue.length) {
              const newQ = new Int32Array(skyAddQueue.length * 2);
              newQ.set(skyAddQueue);
              skyAddQueue = newQ;
            }
            skyAddQueue[skyAddTail++] = idx;
            continue;
          }
        }
        // +Z
        if (zLocal + 1 < dimZ) {
          const nIdx = idx + dimX;
          if (opacityGrid[nIdx]! < 15 && skyGrid[nIdx]! < sky - (1 + opacityGrid[nIdx]!)) {
            if (skyAddTail >= skyAddQueue.length) {
              const newQ = new Int32Array(skyAddQueue.length * 2);
              newQ.set(skyAddQueue);
              skyAddQueue = newQ;
            }
            skyAddQueue[skyAddTail++] = idx;
            continue;
          }
        }
        // -Z
        if (zLocal - 1 >= 0) {
          const nIdx = idx - dimX;
          if (opacityGrid[nIdx]! < 15 && skyGrid[nIdx]! < sky - (1 + opacityGrid[nIdx]!)) {
            if (skyAddTail >= skyAddQueue.length) {
              const newQ = new Int32Array(skyAddQueue.length * 2);
              newQ.set(skyAddQueue);
              skyAddQueue = newQ;
            }
            skyAddQueue[skyAddTail++] = idx;
            continue;
          }
        }
        // +Y
        if (y + 1 < 320) {
          const nIdx = idx + areaXZ;
          if (opacityGrid[nIdx]! < 15 && skyGrid[nIdx]! < sky - (1 + opacityGrid[nIdx]!)) {
            if (skyAddTail >= skyAddQueue.length) {
              const newQ = new Int32Array(skyAddQueue.length * 2);
              newQ.set(skyAddQueue);
              skyAddQueue = newQ;
            }
            skyAddQueue[skyAddTail++] = idx;
            continue;
          }
        }
        // -Y
        if (y - 1 >= 0) {
          const nIdx = idx - areaXZ;
          const opN = opacityGrid[nIdx]!;
          const target =
            sky === 15 && opSelf === 0 ? (opN === 0 ? 15 : Math.max(0, 15 - opN)) : sky - (1 + opN);
          if (opN < 15 && skyGrid[nIdx]! < target) {
            if (skyAddTail >= skyAddQueue.length) {
              const newQ = new Int32Array(skyAddQueue.length * 2);
              newQ.set(skyAddQueue);
              skyAddQueue = newQ;
            }
            skyAddQueue[skyAddTail++] = idx;
            continue;
          }
        }
      }
    }
  }

  // 4. Run Sky BFS across the region
  while (skyAddHead < skyAddTail) {
    const curIdx = skyAddQueue[skyAddHead++]!;
    const curSky = skyGrid[curIdx]!;
    if (curSky <= 1) continue;

    // Decode flat coordinate
    const curY = Math.floor(curIdx / areaXZ);
    const rem = curIdx % areaXZ;
    const curZ = Math.floor(rem / dimX);
    const curX = rem % dimX;

    const opSelf = opacityGrid[curIdx]!;
    const isBeam = curSky === 15 && opSelf === 0;

    // Check 6 directions
    // 0: +X
    if (curX + 1 < dimX) {
      const nIdx = curIdx + 1;
      const opN = opacityGrid[nIdx]!;
      if (opN < 15) {
        const target = curSky - (1 + opN);
        if (target > skyGrid[nIdx]!) {
          skyGrid[nIdx] = target;
          if (skyAddTail >= skyAddQueue.length) {
            const newQ = new Int32Array(skyAddQueue.length * 2);
            newQ.set(skyAddQueue);
            skyAddQueue = newQ;
          }
          skyAddQueue[skyAddTail++] = nIdx;
        }
      }
    }
    // 1: -X
    if (curX - 1 >= 0) {
      const nIdx = curIdx - 1;
      const opN = opacityGrid[nIdx]!;
      if (opN < 15) {
        const target = curSky - (1 + opN);
        if (target > skyGrid[nIdx]!) {
          skyGrid[nIdx] = target;
          if (skyAddTail >= skyAddQueue.length) {
            const newQ = new Int32Array(skyAddQueue.length * 2);
            newQ.set(skyAddQueue);
            skyAddQueue = newQ;
          }
          skyAddQueue[skyAddTail++] = nIdx;
        }
      }
    }
    // 2: +Y
    if (curY + 1 < 320) {
      const nIdx = curIdx + areaXZ;
      const opN = opacityGrid[nIdx]!;
      if (opN < 15) {
        const target = curSky - (1 + opN);
        if (target > skyGrid[nIdx]!) {
          skyGrid[nIdx] = target;
          if (skyAddTail >= skyAddQueue.length) {
            const newQ = new Int32Array(skyAddQueue.length * 2);
            newQ.set(skyAddQueue);
            skyAddQueue = newQ;
          }
          skyAddQueue[skyAddTail++] = nIdx;
        }
      }
    }
    // 3: -Y
    if (curY - 1 >= 0) {
      const nIdx = curIdx - areaXZ;
      const opN = opacityGrid[nIdx]!;
      if (opN < 15) {
        const target = isBeam ? (opN === 0 ? 15 : Math.max(0, 15 - opN)) : curSky - (1 + opN);
        if (target > skyGrid[nIdx]!) {
          skyGrid[nIdx] = target;
          if (skyAddTail >= skyAddQueue.length) {
            const newQ = new Int32Array(skyAddQueue.length * 2);
            newQ.set(skyAddQueue);
            skyAddQueue = newQ;
          }
          skyAddQueue[skyAddTail++] = nIdx;
        }
      }
    }
    // 4: +Z
    if (curZ + 1 < dimZ) {
      const nIdx = curIdx + dimX;
      const opN = opacityGrid[nIdx]!;
      if (opN < 15) {
        const target = curSky - (1 + opN);
        if (target > skyGrid[nIdx]!) {
          skyGrid[nIdx] = target;
          if (skyAddTail >= skyAddQueue.length) {
            const newQ = new Int32Array(skyAddQueue.length * 2);
            newQ.set(skyAddQueue);
            skyAddQueue = newQ;
          }
          skyAddQueue[skyAddTail++] = nIdx;
        }
      }
    }
    // 5: -Z
    if (curZ - 1 >= 0) {
      const nIdx = curIdx - dimX;
      const opN = opacityGrid[nIdx]!;
      if (opN < 15) {
        const target = curSky - (1 + opN);
        if (target > skyGrid[nIdx]!) {
          skyGrid[nIdx] = target;
          if (skyAddTail >= skyAddQueue.length) {
            const newQ = new Int32Array(skyAddQueue.length * 2);
            newQ.set(skyAddQueue);
            skyAddQueue = newQ;
          }
          skyAddQueue[skyAddTail++] = nIdx;
        }
      }
    }
  }

  // 5. Run Block BFS across the region
  while (blockAddHead < blockAddTail) {
    const curIdx = blockAddQueue[blockAddHead++]!;
    const curBL = blockGrid[curIdx]!;
    if (curBL <= 1) continue;

    const curY = Math.floor(curIdx / areaXZ);
    const rem = curIdx % areaXZ;
    const curZ = Math.floor(rem / dimX);
    const curX = rem % dimX;

    // Check 6 directions
    // +X
    if (curX + 1 < dimX) {
      const nIdx = curIdx + 1;
      const opN = opacityGrid[nIdx]!;
      if (opN < 15) {
        const target = curBL - (1 + opN);
        if (target > blockGrid[nIdx]!) {
          blockGrid[nIdx] = target;
          if (blockAddTail >= blockAddQueue.length) {
            const newQ = new Int32Array(blockAddQueue.length * 2);
            newQ.set(blockAddQueue);
            blockAddQueue = newQ;
          }
          blockAddQueue[blockAddTail++] = nIdx;
        }
      }
    }
    // -X
    if (curX - 1 >= 0) {
      const nIdx = curIdx - 1;
      const opN = opacityGrid[nIdx]!;
      if (opN < 15) {
        const target = curBL - (1 + opN);
        if (target > blockGrid[nIdx]!) {
          blockGrid[nIdx] = target;
          if (blockAddTail >= blockAddQueue.length) {
            const newQ = new Int32Array(blockAddQueue.length * 2);
            newQ.set(blockAddQueue);
            blockAddQueue = newQ;
          }
          blockAddQueue[blockAddTail++] = nIdx;
        }
      }
    }
    // +Y
    if (curY + 1 < 320) {
      const nIdx = curIdx + areaXZ;
      const opN = opacityGrid[nIdx]!;
      if (opN < 15) {
        const target = curBL - (1 + opN);
        if (target > blockGrid[nIdx]!) {
          blockGrid[nIdx] = target;
          if (blockAddTail >= blockAddQueue.length) {
            const newQ = new Int32Array(blockAddQueue.length * 2);
            newQ.set(blockAddQueue);
            blockAddQueue = newQ;
          }
          blockAddQueue[blockAddTail++] = nIdx;
        }
      }
    }
    // -Y
    if (curY - 1 >= 0) {
      const nIdx = curIdx - areaXZ;
      const opN = opacityGrid[nIdx]!;
      if (opN < 15) {
        const target = curBL - (1 + opN);
        if (target > blockGrid[nIdx]!) {
          blockGrid[nIdx] = target;
          if (blockAddTail >= blockAddQueue.length) {
            const newQ = new Int32Array(blockAddQueue.length * 2);
            newQ.set(blockAddQueue);
            blockAddQueue = newQ;
          }
          blockAddQueue[blockAddTail++] = nIdx;
        }
      }
    }
    // +Z
    if (curZ + 1 < dimZ) {
      const nIdx = curIdx + dimX;
      const opN = opacityGrid[nIdx]!;
      if (opN < 15) {
        const target = curBL - (1 + opN);
        if (target > blockGrid[nIdx]!) {
          blockGrid[nIdx] = target;
          if (blockAddTail >= blockAddQueue.length) {
            const newQ = new Int32Array(blockAddQueue.length * 2);
            newQ.set(blockAddQueue);
            blockAddQueue = newQ;
          }
          blockAddQueue[blockAddTail++] = nIdx;
        }
      }
    }
    // -Z
    if (curZ - 1 >= 0) {
      const nIdx = curIdx - dimX;
      const opN = opacityGrid[nIdx]!;
      if (opN < 15) {
        const target = curBL - (1 + opN);
        if (target > blockGrid[nIdx]!) {
          blockGrid[nIdx] = target;
          if (blockAddTail >= blockAddQueue.length) {
            const newQ = new Int32Array(blockAddQueue.length * 2);
            newQ.set(blockAddQueue);
            blockAddQueue = newQ;
          }
          blockAddQueue[blockAddTail++] = nIdx;
        }
      }
    }
  }

  // 6. Pack sky and block light into section Uint8Arrays
  const resultMap = new Map<number, Uint8Array>();

  for (let cx = -radiusChunks; cx <= radiusChunks; cx++) {
    const minX = (cx + radiusChunks) * 16;
    for (let cz = -radiusChunks; cz <= radiusChunks; cz++) {
      const minZ = (cz + radiusChunks) * 16;

      for (let sy = 0; sy < 20; sy++) {
        const minY = sy * 16;
        const lightData = new Uint8Array(4096);
        let nonZero = false;

        for (let ly = 0; ly < 16; ly++) {
          const y = minY + ly;
          const yOffset = y * areaXZ;
          const secYOffset = ly << 8;

          for (let lz = 0; lz < 16; lz++) {
            const zLocal = minZ + lz;
            const zOffset = yOffset + zLocal * dimX;
            const secZOffset = secYOffset | (lz << 4);

            for (let lx = 0; lx < 16; lx++) {
              const xLocal = minX + lx;
              const idx = zOffset + xLocal;
              const sky = skyGrid[idx]!;
              const block = blockGrid[idx]!;
              const val = (sky << 4) | block;

              if (val !== 0) {
                nonZero = true;
                lightData[secZOffset | lx] = val;
              }
            }
          }
        }

        if (nonZero) {
          const secKey = LightStorage.getSectionKey(cx, sy, cz);
          resultMap.set(secKey, lightData);
        }
      }
    }
  }

  return resultMap;
}
