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

const QUEUE_CAPACITY = 262144;

const DX = [1, -1, 0, 0, 0, 0];
const DY = [0, 0, 1, -1, 0, 0];
const DZ = [0, 0, 0, 0, 1, -1];

export class LightEngine {
  public storage: LightStorage = new LightStorage();
  public tables: LightLookupTables;

  // Preallocated BFS Queues
  private blockRemX = new Int32Array(QUEUE_CAPACITY);
  private blockRemY = new Int32Array(QUEUE_CAPACITY);
  private blockRemZ = new Int32Array(QUEUE_CAPACITY);
  private blockRemVal = new Uint8Array(QUEUE_CAPACITY);
  private blockRemHead = 0;
  private blockRemTail = 0;

  private blockAddX = new Int32Array(QUEUE_CAPACITY);
  private blockAddY = new Int32Array(QUEUE_CAPACITY);
  private blockAddZ = new Int32Array(QUEUE_CAPACITY);
  private blockAddHead = 0;
  private blockAddTail = 0;

  private skyRemX = new Int32Array(QUEUE_CAPACITY);
  private skyRemY = new Int32Array(QUEUE_CAPACITY);
  private skyRemZ = new Int32Array(QUEUE_CAPACITY);
  private skyRemVal = new Uint8Array(QUEUE_CAPACITY);
  private skyRemHead = 0;
  private skyRemTail = 0;

  private skyAddX = new Int32Array(QUEUE_CAPACITY);
  private skyAddY = new Int32Array(QUEUE_CAPACITY);
  private skyAddZ = new Int32Array(QUEUE_CAPACITY);
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
    newOp: number,
  ): { oldHighestY: number; newHighestY: number } {
    const oldHighestY = this.getHighestOpaqueY(world, x, z);
    let newHighestY = oldHighestY;

    if (newOp > 0) {
      if (y > oldHighestY) {
        newHighestY = y;
      }
    } else {
      if (y === oldHighestY) {
        let h = -1;
        for (let cy = y - 1; cy >= 0; cy--) {
          const stateId = world.getBlockStateId(x, cy, z);
          const op = this.tables.opacityTable[stateId] ?? 0;
          if (op > 0) {
            h = cy;
            break;
          }
        }
        newHighestY = h;
      }
    }

    const { cx, cz, localX, localZ } = World.worldToChunk(x, z);
    const key = `${cx},${cz}`;
    let hm = this.heightmaps.get(key);
    if (!hm) {
      hm = new Int16Array(256);
      this.heightmaps.set(key, hm);
    }
    hm[(localZ << 4) | localX] = newHighestY;

    return { oldHighestY, newHighestY };
  }

  public clearColumnCache(cx: number, cz: number): void {
    this.heightmaps.delete(`${cx},${cz}`);
  }

  public initializeColumnLight(world: World, cx: number, cz: number): void {
    if (!world.hasColumn(cx, cz)) return;

    this.clearColumnCache(cx, cz);

    // 1. Initial Sky Light
    this.skyAddHead = 0;
    this.skyAddTail = 0;

    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const x = cx * 16 + lx;
        const z = cz * 16 + lz;
        let sky = 15;
        for (let y = 319; y >= 0; y--) {
          const sy = y >> 4;
          const ly = y & 15;
          const st = world.getBlockStateId(x, y, z);
          const op = this.tables.opacityTable[st] ?? 0;

          if (sky === 15 && op === 0) {
            this.storage.setSkyLight(cx, sy, cz, lx, ly, lz, 15);
          } else {
            if (sky === 15) {
              sky = Math.max(0, 15 - op);
            } else {
              sky = Math.max(0, sky - 1 - op);
            }
            this.storage.setSkyLight(cx, sy, cz, lx, ly, lz, sky);
          }
        }
      }
    }

    // Push sky light sources that can propagate to neighbors
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const x = cx * 16 + lx;
        const z = cz * 16 + lz;
        for (let y = 0; y < 320; y++) {
          const sy = y >> 4;
          const ly = y & 15;
          const sky = this.storage.getSkyLight(cx, sy, cz, lx, ly, lz);
          if (sky <= 1) continue;

          let canPropagate = false;
          for (let i = 0; i < 6; i++) {
            const nx = x + DX[i]!;
            const ny = y + DY[i]!;
            const nz = z + DZ[i]!;
            if (ny < 0 || ny > 319) continue;
            const { cx: ncx, cz: ncz, localX: nlx, localZ: nlz } = World.worldToChunk(nx, nz);
            if (!world.hasColumn(ncx, ncz)) continue;
            const nsy = ny >> 4;
            const nly = ny & 15;
            const nSky = this.storage.getSkyLight(ncx, nsy, ncz, nlx, nly, nlz);
            if (nSky < sky - 1) {
              canPropagate = true;
              break;
            }
          }
          if (canPropagate) {
            this.pushSkyAdd(x, y, z);
          }
        }
      }
    }

    // 2. Initial Block Light
    this.blockAddHead = 0;
    this.blockAddTail = 0;

    for (let sy = 0; sy < 20; sy++) {
      for (let ly = 0; ly < 16; ly++) {
        const y = (sy << 4) | ly;
        for (let lz = 0; lz < 16; lz++) {
          for (let lx = 0; lx < 16; lx++) {
            const x = cx * 16 + lx;
            const z = cz * 16 + lz;
            const st = world.getBlockStateId(x, y, z);
            const emit = this.tables.emissionTable[st] ?? 0;
            if (emit > 0) {
              this.storage.setBlockLight(cx, sy, cz, lx, ly, lz, emit);
              this.pushBlockAdd(x, y, z);
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
      newOp,
    );

    if (newOp > oldOp) {
      // Block became more opaque / roof added
      const oldSky = this.storage.getSkyLight(cx, sy, cz, localX, ly, localZ);
      this.storage.setSkyLight(cx, sy, cz, localX, ly, localZ, 0);
      if (oldSky > 0) {
        this.pushSkyRem(x, y, z, oldSky);
      }

      // If cut vertical beam below
      if (y > oldHighestY || oldSky === 15) {
        for (let cy = y - 1; cy >= 0; cy--) {
          const { cx: ccx, cz: ccz, localX: clx, localZ: clz } = World.worldToChunk(x, z);
          const csy = cy >> 4;
          const cly = cy & 15;
          const cst = world.getBlockStateId(x, cy, z);
          const cop = this.tables.opacityTable[cst] ?? 0;
          const belowSky = this.storage.getSkyLight(ccx, csy, ccz, clx, cly, clz);

          this.storage.setSkyLight(ccx, csy, ccz, clx, cly, clz, 0);
          if (belowSky > 0) {
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
      } else {
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
      }

      this.processSkyAdd(world);
    }
  }

  // --- Queue push / pop / process helpers ---

  private pushBlockRem(x: number, y: number, z: number, val: number): void {
    if (this.blockRemTail >= QUEUE_CAPACITY) return;
    this.blockRemX[this.blockRemTail] = x;
    this.blockRemY[this.blockRemTail] = y;
    this.blockRemZ[this.blockRemTail] = z;
    this.blockRemVal[this.blockRemTail] = val;
    this.blockRemTail++;
  }

  private pushBlockAdd(x: number, y: number, z: number): void {
    if (this.blockAddTail >= QUEUE_CAPACITY) return;
    this.blockAddX[this.blockAddTail] = x;
    this.blockAddY[this.blockAddTail] = y;
    this.blockAddZ[this.blockAddTail] = z;
    this.blockAddTail++;
  }

  private pushSkyRem(x: number, y: number, z: number, val: number): void {
    if (this.skyRemTail >= QUEUE_CAPACITY) return;
    this.skyRemX[this.skyRemTail] = x;
    this.skyRemY[this.skyRemTail] = y;
    this.skyRemZ[this.skyRemTail] = z;
    this.skyRemVal[this.skyRemTail] = val;
    this.skyRemTail++;
  }

  private pushSkyAdd(x: number, y: number, z: number): void {
    if (this.skyAddTail >= QUEUE_CAPACITY) return;
    this.skyAddX[this.skyAddTail] = x;
    this.skyAddY[this.skyAddTail] = y;
    this.skyAddZ[this.skyAddTail] = z;
    this.skyAddTail++;
  }

  private processBlockRem(world: World): void {
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

        if (nBL !== 0 && nBL < val) {
          this.storage.setBlockLight(ncx, nsy, ncz, nlx, nly, nlz, 0);
          this.pushBlockRem(nx, ny, nz, nBL);
        } else if (nBL >= val) {
          this.pushBlockAdd(nx, ny, nz);
        }
      }
    }
  }

  private processBlockAdd(world: World): void {
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
