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
  private sections: Map<string, Uint8Array> = new Map();
  public touchedSections: Set<string> = new Set();

  public static getSectionKey(cx: number, sy: number, cz: number): string {
    return `${cx},${sy},${cz}`;
  }

  public getRawData(cx: number, sy: number, cz: number): Uint8Array | undefined {
    return this.sections.get(LightStorage.getSectionKey(cx, sy, cz));
  }

  public setRawData(cx: number, sy: number, cz: number, data: Uint8Array): void {
    const key = LightStorage.getSectionKey(cx, sy, cz);
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

  private heightmaps: Map<string, Int16Array> = new Map();

  constructor(tables?: LightLookupTables) {
    if (tables) {
      this.tables = tables;
    } else {
      this.tables = buildLightLookupTables(BlockRegistry.getInstance());
    }
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
    const { cx, cz, localX, localZ } = World.worldToChunk(x, z);
    const sy = y >> 4;
    const ly = y & 15;
    return {
      sky: this.storage.getSkyLight(cx, sy, cz, localX, ly, localZ),
      block: this.storage.getBlockLight(cx, sy, cz, localX, ly, localZ),
    };
  }

  public getHighestOpaqueY(world: World, x: number, z: number): number {
    const { cx, cz, localX, localZ } = World.worldToChunk(x, z);
    const key = `${cx},${cz}`;
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
    const { cx, cz, localX, localZ } = World.worldToChunk(x, z);
    const key = `${cx},${cz}`;
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
    this.heightmaps.delete(`${cx},${cz}`);
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
              const { cx: ncx, cz: ncz } = World.worldToChunk(nx, nz);
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

    const { cx, cz, localX, localZ } = World.worldToChunk(x, z);
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
          const { cx: ncx, cz: ncz } = World.worldToChunk(nx, nz);
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
          const { cx: ccx, cz: ccz, localX: clx, localZ: clz } = World.worldToChunk(x, z);
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
          const { cx: ccx, cz: ccz, localX: clx, localZ: clz } = World.worldToChunk(x, z);
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
          const { cx: ncx, cz: ncz } = World.worldToChunk(nx, nz);
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

        const { cx: ncx, cz: ncz, localX: nlx, localZ: nlz } = World.worldToChunk(nx, nz);
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

      const { cx: acx, cz: acz, localX: alx, localZ: alz } = World.worldToChunk(ax, az);
      const asy = ay >> 4;
      const aly = ay & 15;
      const curBL = this.storage.getBlockLight(acx, asy, acz, alx, aly, alz);
      if (curBL <= 1) continue;

      for (let i = 0; i < 6; i++) {
        const nx = ax + DX[i]!;
        const ny = ay + DY[i]!;
        const nz = az + DZ[i]!;
        if (ny < 0 || ny > 319) continue;

        const { cx: ncx, cz: ncz, localX: nlx, localZ: nlz } = World.worldToChunk(nx, nz);
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

        const { cx: ncx, cz: ncz, localX: nlx, localZ: nlz } = World.worldToChunk(nx, nz);
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

      const { cx: acx, cz: acz, localX: alx, localZ: alz } = World.worldToChunk(ax, az);
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

        const { cx: ncx, cz: ncz, localX: nlx, localZ: nlz } = World.worldToChunk(nx, nz);
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
