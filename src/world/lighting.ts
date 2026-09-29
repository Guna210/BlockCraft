import { World } from './world';
import { ChunkColumn } from './column';
import { BlockRegistry } from './blocks/registry';

export interface LightLookupTables {
  opacity: Uint8Array; // stateId -> 0..15
  emission: Uint8Array; // stateId -> 0..15
}

export function buildLightLookupTables(
  registry: BlockRegistry,
  customEmission?: Map<number, number>,
  customOpacity?: Map<number, number>,
): LightLookupTables {
  let maxStateId = Math.max(...registry.getAllStateIds(), 0);
  if (customEmission) {
    for (const id of customEmission.keys()) {
      if (id > maxStateId) maxStateId = id;
    }
  }
  if (customOpacity) {
    for (const id of customOpacity.keys()) {
      if (id > maxStateId) maxStateId = id;
    }
  }
  maxStateId += 1;

  const opacity = new Uint8Array(maxStateId);
  const emission = new Uint8Array(maxStateId);

  for (const stateId of registry.getAllStateIds()) {
    const resolved = registry.getResolvedState(stateId);
    if (!resolved) continue;
    const def = resolved.definition;

    const baseEmission = customEmission?.has(stateId)
      ? customEmission.get(stateId)!
      : def.lightEmission || 0;
    emission[stateId] = Math.min(15, Math.max(0, baseEmission));

    const baseOpacity = customOpacity?.has(stateId)
      ? customOpacity.get(stateId)!
      : def.fullOpaqueCube
        ? 15
        : def.id === 'air' || def.id === 'glass'
          ? 0
          : def.id === 'water' || def.id.endsWith('_leaves')
            ? 2
            : 1;

    opacity[stateId] = Math.min(15, Math.max(0, baseOpacity));
  }

  if (customEmission) {
    for (const [id, em] of customEmission.entries()) {
      if (id < emission.length) {
        emission[id] = Math.min(15, Math.max(0, em));
      }
    }
  }

  if (customOpacity) {
    for (const [id, op] of customOpacity.entries()) {
      if (id < opacity.length) {
        opacity[id] = Math.min(15, Math.max(0, op));
      }
    }
  }

  return { opacity, emission };
}

export class LightStorage {
  // Collision-free numeric key: ((cx + 32768) * 65536 + (cz + 32768)) * 32 + sy
  private sections: Map<number, Uint8Array> = new Map();

  // Fast single-entry cache for inner loop access
  private lastKey = -1;
  private lastSec: Uint8Array | undefined = undefined;

  public static getSectionKey(cx: number, sy: number, cz: number): number {
    return ((cx + 32768) * 65536 + (cz + 32768)) * 32 + sy;
  }

  public getSection(cx: number, sy: number, cz: number): Uint8Array | undefined {
    const key = LightStorage.getSectionKey(cx, sy, cz);
    if (key === this.lastKey) {
      return this.lastSec;
    }
    const sec = this.sections.get(key);
    this.lastKey = key;
    this.lastSec = sec;
    return sec;
  }

  public getOrCreateSection(
    cx: number,
    sy: number,
    cz: number,
    defaultSky: number = 0,
  ): Uint8Array {
    const key = LightStorage.getSectionKey(cx, sy, cz);
    if (key === this.lastKey && this.lastSec) {
      return this.lastSec;
    }
    let sec = this.sections.get(key);
    if (!sec) {
      sec = new Uint8Array(4096);
      if (defaultSky > 0) {
        sec.fill(defaultSky & 0x0f);
      }
      this.sections.set(key, sec);
    }
    this.lastKey = key;
    this.lastSec = sec;
    return sec;
  }

  public clear(): void {
    this.sections.clear();
    this.lastKey = -1;
    this.lastSec = undefined;
  }

  public getSkyLight(x: number, y: number, z: number, defaultSky: number = 0): number {
    if (y < ChunkColumn.MIN_Y || y > ChunkColumn.MAX_Y) return 15;
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const sy = y >> 4;
    const localX = ((x % 16) + 16) % 16;
    const localY = y & 15;
    const localZ = ((z % 16) + 16) % 16;

    const sec = this.getSection(cx, sy, cz);
    if (!sec) return defaultSky;
    const idx = (localY << 8) | (localZ << 4) | localX;
    return sec[idx]! & 0x0f;
  }

  public getBlockLight(x: number, y: number, z: number): number {
    if (y < ChunkColumn.MIN_Y || y > ChunkColumn.MAX_Y) return 0;
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const sy = y >> 4;
    const localX = ((x % 16) + 16) % 16;
    const localY = y & 15;
    const localZ = ((z % 16) + 16) % 16;

    const sec = this.getSection(cx, sy, cz);
    if (!sec) return 0;
    const idx = (localY << 8) | (localZ << 4) | localX;
    return (sec[idx]! >> 4) & 0x0f;
  }

  public setSkyLight(
    x: number,
    y: number,
    z: number,
    sky: number,
    defaultSkyForNewSection: number = 0,
  ): void {
    if (y < ChunkColumn.MIN_Y || y > ChunkColumn.MAX_Y) return;
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const sy = y >> 4;
    const localX = ((x % 16) + 16) % 16;
    const localY = y & 15;
    const localZ = ((z % 16) + 16) % 16;

    const sec = this.getOrCreateSection(cx, sy, cz, defaultSkyForNewSection);
    const idx = (localY << 8) | (localZ << 4) | localX;
    const cur = sec[idx]!;
    sec[idx] = (cur & 0xf0) | (Math.min(15, Math.max(0, sky)) & 0x0f);
  }

  public setBlockLight(
    x: number,
    y: number,
    z: number,
    block: number,
    defaultSkyForNewSection: number = 0,
  ): void {
    if (y < ChunkColumn.MIN_Y || y > ChunkColumn.MAX_Y) return;
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const sy = y >> 4;
    const localX = ((x % 16) + 16) % 16;
    const localY = y & 15;
    const localZ = ((z % 16) + 16) % 16;

    const sec = this.getOrCreateSection(cx, sy, cz, defaultSkyForNewSection);
    const idx = (localY << 8) | (localZ << 4) | localX;
    const cur = sec[idx]!;
    const b = Math.min(15, Math.max(0, block)) & 0x0f;
    sec[idx] = (cur & 0x0f) | (b << 4);
  }
}

const INITIAL_QUEUE_CAPACITY = 131072;

export class LightEngine {
  public storage: LightStorage = new LightStorage();
  public tables: LightLookupTables;

  private suspended = false;
  private pendingChangesCount = 0;

  // Real instrumentation for touched sections
  private touchedSectionsSet: Set<number> = new Set();

  // Preallocated queues for BFS Add & Remove
  private addX = new Int32Array(INITIAL_QUEUE_CAPACITY);
  private addY = new Int32Array(INITIAL_QUEUE_CAPACITY);
  private addZ = new Int32Array(INITIAL_QUEUE_CAPACITY);
  private addHead = 0;
  private addTail = 0;

  private removeX = new Int32Array(INITIAL_QUEUE_CAPACITY);
  private removeY = new Int32Array(INITIAL_QUEUE_CAPACITY);
  private removeZ = new Int32Array(INITIAL_QUEUE_CAPACITY);
  private removeVal = new Uint8Array(INITIAL_QUEUE_CAPACITY);
  private removeHead = 0;
  private removeTail = 0;

  constructor(tables?: LightLookupTables) {
    if (tables) {
      this.tables = tables;
    } else {
      this.tables = buildLightLookupTables(BlockRegistry.getInstance());
    }
  }

  public suspendUpdates(): void {
    this.suspended = true;
    this.pendingChangesCount = 0;
  }

  public resumeUpdates(
    world: World,
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
  ): void {
    this.suspended = false;
    if (this.pendingChangesCount === 0) return;

    const minCx = Math.floor(Math.min(minX, maxX) / 16);
    const maxCx = Math.floor(Math.max(minX, maxX) / 16);
    const minCz = Math.floor(Math.min(minZ, maxZ) / 16);
    const maxCz = Math.floor(Math.max(minZ, maxZ) / 16);

    this.bulkPropagateRegion(world, minCx, minCz, maxCx, maxCz);
    this.pendingChangesCount = 0;
  }

  public getOpacity(stateId: number): number {
    if (stateId < this.tables.opacity.length) {
      return this.tables.opacity[stateId]!;
    }
    return 15; // Default full opacity for unknown state IDs
  }

  public getEmission(stateId: number): number {
    if (stateId < this.tables.emission.length) {
      return this.tables.emission[stateId]!;
    }
    return 0;
  }

  public resetTouchedSections(): void {
    this.touchedSectionsSet.clear();
  }

  public getTouchedSectionsCount(): number {
    return this.touchedSectionsSet.size;
  }

  private markTouched(x: number, y: number, z: number): void {
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const sy = y >> 4;
    this.touchedSectionsSet.add(LightStorage.getSectionKey(cx, sy, cz));
  }

  // Preallocated Queue Push / Pop
  private pushAdd(x: number, y: number, z: number): void {
    if (this.addTail >= this.addX.length) {
      const newCap = this.addX.length * 2;
      const nx = new Int32Array(newCap);
      nx.set(this.addX);
      this.addX = nx;
      const ny = new Int32Array(newCap);
      ny.set(this.addY);
      this.addY = ny;
      const nz = new Int32Array(newCap);
      nz.set(this.addZ);
      this.addZ = nz;
    }
    this.addX[this.addTail] = x;
    this.addY[this.addTail] = y;
    this.addZ[this.addTail] = z;
    this.addTail++;
  }

  private pushRemove(x: number, y: number, z: number, val: number): void {
    if (this.removeTail >= this.removeX.length) {
      const newCap = this.removeX.length * 2;
      const nx = new Int32Array(newCap);
      nx.set(this.removeX);
      this.removeX = nx;
      const ny = new Int32Array(newCap);
      ny.set(this.removeY);
      this.removeY = ny;
      const nz = new Int32Array(newCap);
      nz.set(this.removeZ);
      this.removeZ = nz;
      const nv = new Uint8Array(newCap);
      nv.set(this.removeVal);
      this.removeVal = nv;
    }
    this.removeX[this.removeTail] = x;
    this.removeY[this.removeTail] = y;
    this.removeZ[this.removeTail] = z;
    this.removeVal[this.removeTail] = val;
    this.removeTail++;
  }

  public getLight(world: World, x: number, y: number, z: number): { sky: number; block: number } {
    if (y < ChunkColumn.MIN_Y || y > ChunkColumn.MAX_Y) {
      return { sky: 15, block: 0 };
    }
    return {
      sky: this.storage.getSkyLight(x, y, z),
      block: this.storage.getBlockLight(x, y, z),
    };
  }

  /**
   * Propagates block light for a set of changed blocks or emitters.
   */
  public propagateBlockLight(
    world: World,
    sources: Array<{ x: number; y: number; z: number }>,
  ): void {
    this.addHead = 0;
    this.addTail = 0;

    for (const src of sources) {
      const stateId = world.getBlockStateId(src.x, src.y, src.z);
      const em = this.getEmission(stateId);
      if (em > 0) {
        this.storage.setBlockLight(src.x, src.y, src.z, em);
        this.markTouched(src.x, src.y, src.z);
        this.pushAdd(src.x, src.y, src.z);
      }
    }

    this.processBlockLightAddQueue(world);
  }

  /**
   * Remove block light starting from a set of sources whose emission was removed or reduced.
   */
  public removeBlockLight(
    world: World,
    sources: Array<{ x: number; y: number; z: number; oldLight: number }>,
  ): void {
    this.removeHead = 0;
    this.removeTail = 0;
    this.addHead = 0;
    this.addTail = 0;

    for (const src of sources) {
      this.storage.setBlockLight(src.x, src.y, src.z, 0);
      this.markTouched(src.x, src.y, src.z);
      this.pushRemove(src.x, src.y, src.z, src.oldLight);
    }

    const dx = [1, -1, 0, 0, 0, 0];
    const dy = [0, 0, 1, -1, 0, 0];
    const dz = [0, 0, 0, 0, 1, -1];

    while (this.removeHead < this.removeTail) {
      const x = this.removeX[this.removeHead]!;
      const y = this.removeY[this.removeHead]!;
      const z = this.removeZ[this.removeHead]!;
      const val = this.removeVal[this.removeHead]!;
      this.removeHead++;

      for (let i = 0; i < 6; i++) {
        const nx = x + dx[i]!;
        const ny = y + dy[i]!;
        const nz = z + dz[i]!;

        if (ny < ChunkColumn.MIN_Y || ny > ChunkColumn.MAX_Y) continue;

        const nCx = Math.floor(nx / 16);
        const nCz = Math.floor(nz / 16);
        if (!world.hasColumn(nCx, nCz)) continue;

        const nLight = this.storage.getBlockLight(nx, ny, nz);
        if (nLight > 0 && nLight < val) {
          this.storage.setBlockLight(nx, ny, nz, 0);
          this.markTouched(nx, ny, nz);
          this.pushRemove(nx, ny, nz, nLight);
        } else if (nLight >= val) {
          this.pushAdd(nx, ny, nz);
        }
      }
    }

    this.processBlockLightAddQueue(world);
  }

  private processBlockLightAddQueue(world: World): void {
    const dx = [1, -1, 0, 0, 0, 0];
    const dy = [0, 0, 1, -1, 0, 0];
    const dz = [0, 0, 0, 0, 1, -1];

    while (this.addHead < this.addTail) {
      const x = this.addX[this.addHead]!;
      const y = this.addY[this.addHead]!;
      const z = this.addZ[this.addHead]!;
      this.addHead++;

      const light = this.storage.getBlockLight(x, y, z);
      if (light <= 1) continue;

      for (let i = 0; i < 6; i++) {
        const nx = x + dx[i]!;
        const ny = y + dy[i]!;
        const nz = z + dz[i]!;

        if (ny < ChunkColumn.MIN_Y || ny > ChunkColumn.MAX_Y) continue;

        const nCx = Math.floor(nx / 16);
        const nCz = Math.floor(nz / 16);
        if (!world.hasColumn(nCx, nCz)) continue; // Never spread into unloaded columns

        const nStateId = world.getBlockStateId(nx, ny, nz);
        const op = this.getOpacity(nStateId);
        if (op >= 15) continue; // Opaque block

        const targetLight = light - Math.max(1, op);
        if (targetLight > this.storage.getBlockLight(nx, ny, nz)) {
          this.storage.setBlockLight(nx, ny, nz, targetLight);
          this.markTouched(nx, ny, nz);
          this.pushAdd(nx, ny, nz);
        }
      }
    }
  }

  /**
   * Recalculate sky light for a column.
   */
  public propagateSkyLightColumn(world: World, cx: number, cz: number): void {
    if (!world.hasColumn(cx, cz)) return;

    this.addHead = 0;
    this.addTail = 0;

    const startX = cx * 16;
    const startZ = cz * 16;

    for (let lx = 0; lx < 16; lx++) {
      for (let lz = 0; lz < 16; lz++) {
        const x = startX + lx;
        const z = startZ + lz;

        // Find highest non-transparent block
        let yOpaque = -1;
        for (let y = ChunkColumn.MAX_Y; y >= ChunkColumn.MIN_Y; y--) {
          const stateId = world.getBlockStateId(x, y, z);
          const op = this.getOpacity(stateId);
          if (op > 0) {
            yOpaque = y;
            break;
          }
        }

        // Fill sky light 15 directly down to yOpaque + 1
        for (let y = ChunkColumn.MAX_Y; y > yOpaque; y--) {
          this.storage.setSkyLight(x, y, z, 15);
          this.markTouched(x, y, z);
          this.pushAdd(x, y, z);
        }

        // Calculate sky light decay through yOpaque and below
        if (yOpaque >= ChunkColumn.MIN_Y) {
          let curSky = 15;
          for (let y = yOpaque; y >= ChunkColumn.MIN_Y; y--) {
            const stateId = world.getBlockStateId(x, y, z);
            const op = this.getOpacity(stateId);
            curSky = Math.max(0, curSky - Math.max(1, op));
            this.storage.setSkyLight(x, y, z, curSky);
            this.markTouched(x, y, z);
            if (curSky > 0) {
              this.pushAdd(x, y, z);
            }
          }
        }
      }
    }

    this.processSkyLightAddQueue(world);
  }

  /**
   * BFS Add Queue for Sky Light
   */
  private processSkyLightAddQueue(world: World): void {
    const dx = [1, -1, 0, 0, 0, 0];
    const dy = [0, 0, 1, -1, 0, 0];
    const dz = [0, 0, 0, 0, 1, -1];

    while (this.addHead < this.addTail) {
      const x = this.addX[this.addHead]!;
      const y = this.addY[this.addHead]!;
      const z = this.addZ[this.addHead]!;
      this.addHead++;

      const light = this.storage.getSkyLight(x, y, z);
      if (light <= 0) continue;

      for (let i = 0; i < 6; i++) {
        const nx = x + dx[i]!;
        const ny = y + dy[i]!;
        const nz = z + dz[i]!;

        if (ny < ChunkColumn.MIN_Y || ny > ChunkColumn.MAX_Y) continue;

        const nCx = Math.floor(nx / 16);
        const nCz = Math.floor(nz / 16);
        if (!world.hasColumn(nCx, nCz)) continue; // Never spread into unloaded columns

        const nStateId = world.getBlockStateId(nx, ny, nz);
        const op = this.getOpacity(nStateId);
        if (op >= 15) continue;

        let targetLight: number;
        // Downward neighbor receives 15 if parent is 15 and neighbor opacity is 0
        if (i === 3 && light === 15 && op === 0) {
          targetLight = 15;
        } else {
          targetLight = light - Math.max(1, op);
        }

        if (targetLight > this.storage.getSkyLight(nx, ny, nz)) {
          this.storage.setSkyLight(nx, ny, nz, targetLight);
          this.markTouched(nx, ny, nz);
          this.pushAdd(nx, ny, nz);
        }
      }
    }
  }

  /**
   * Handle incremental light update when a single block changes.
   */
  public onBlockChange(
    world: World,
    x: number,
    y: number,
    z: number,
    oldStateId: number,
    newStateId: number,
  ): void {
    this.markTouched(x, y, z);

    if (this.suspended) {
      this.pendingChangesCount++;
      return;
    }

    const oldOp = this.getOpacity(oldStateId);
    const newOp = this.getOpacity(newStateId);

    const oldEm = this.getEmission(oldStateId);
    const newEm = this.getEmission(newStateId);

    // 1. Block Light Updates
    const oldBlockLight = this.storage.getBlockLight(x, y, z);
    if (newEm > oldEm) {
      this.propagateBlockLight(world, [{ x, y, z }]);
    } else if (newEm < oldEm || (newOp > oldOp && oldBlockLight > 0)) {
      this.removeBlockLight(world, [{ x, y, z, oldLight: oldBlockLight }]);
      if (newEm > 0) {
        this.propagateBlockLight(world, [{ x, y, z }]);
      }
    } else if (newOp < oldOp) {
      // Opacity decreased: re-propagate block light from neighbors
      this.repropagateBlockLightAround(world, x, y, z);
    }

    // 2. Sky Light Updates
    const oldSky = this.storage.getSkyLight(x, y, z);
    if (newOp > oldOp) {
      // Opacity increased (e.g. roof placed)
      this.removeSkyLightAt(world, x, y, z, oldSky, newOp);
    } else if (newOp < oldOp) {
      // Opacity decreased (e.g. roof removed)
      this.repropagateSkyLightAt(world, x, y, z);
    }
  }

  private repropagateBlockLightAround(world: World, x: number, y: number, z: number): void {
    this.addHead = 0;
    this.addTail = 0;

    const dx = [0, 1, -1, 0, 0, 0, 0];
    const dy = [0, 0, 0, 1, -1, 0, 0];
    const dz = [0, 0, 0, 0, 0, 1, -1];

    for (let i = 0; i < 7; i++) {
      const nx = x + dx[i]!;
      const ny = y + dy[i]!;
      const nz = z + dz[i]!;
      if (ny < ChunkColumn.MIN_Y || ny > ChunkColumn.MAX_Y) continue;
      const bl = this.storage.getBlockLight(nx, ny, nz);
      if (bl > 0) {
        this.pushAdd(nx, ny, nz);
      }
    }

    this.processBlockLightAddQueue(world);
  }

  private removeSkyLightAt(
    world: World,
    x: number,
    y: number,
    z: number,
    oldSky: number,
    newOp: number,
  ): void {
    this.removeHead = 0;
    this.removeTail = 0;
    this.addHead = 0;
    this.addTail = 0;

    // Set new sky light at (x,y,z) based on light coming from above
    const skyAbove = y < ChunkColumn.MAX_Y ? this.storage.getSkyLight(x, y + 1, z) : 15;
    const newSkyTarget = Math.max(0, skyAbove - Math.max(1, newOp));
    this.storage.setSkyLight(x, y, z, newSkyTarget);
    this.markTouched(x, y, z);
    if (oldSky > 0) {
      this.pushRemove(x, y, z, oldSky);
    }

    // Direct sky light column below (x,y,z)
    let checkY = y - 1;
    while (checkY >= ChunkColumn.MIN_Y) {
      const curSky = this.storage.getSkyLight(x, checkY, z);
      if (curSky === 0) break;
      this.storage.setSkyLight(x, checkY, z, 0);
      this.markTouched(x, checkY, z);
      this.pushRemove(x, checkY, z, curSky);

      const checkState = world.getBlockStateId(x, checkY, z);
      const checkOp = this.getOpacity(checkState);
      if (checkOp > 0) {
        break;
      }
      checkY--;
    }

    const dx = [1, -1, 0, 0, 0, 0];
    const dy = [0, 0, 1, -1, 0, 0];
    const dz = [0, 0, 0, 0, 1, -1];

    while (this.removeHead < this.removeTail) {
      const rx = this.removeX[this.removeHead]!;
      const ry = this.removeY[this.removeHead]!;
      const rz = this.removeZ[this.removeHead]!;
      const val = this.removeVal[this.removeHead]!;
      this.removeHead++;

      for (let i = 0; i < 6; i++) {
        const nx = rx + dx[i]!;
        const ny = ry + dy[i]!;
        const nz = rz + dz[i]!;

        if (ny < ChunkColumn.MIN_Y || ny > ChunkColumn.MAX_Y) continue;
        const nCx = Math.floor(nx / 16);
        const nCz = Math.floor(nz / 16);
        if (!world.hasColumn(nCx, nCz)) continue;

        const nSky = this.storage.getSkyLight(nx, ny, nz);
        if (nSky > 0 && nSky < val) {
          this.storage.setSkyLight(nx, ny, nz, 0);
          this.markTouched(nx, ny, nz);
          this.pushRemove(nx, ny, nz, nSky);
        } else if (nSky >= val) {
          this.pushAdd(nx, ny, nz);
        }
      }
    }

    this.processSkyLightAddQueue(world);
  }

  private repropagateSkyLightAt(world: World, x: number, y: number, z: number): void {
    const skyAbove = y < ChunkColumn.MAX_Y ? this.storage.getSkyLight(x, y + 1, z) : 15;
    const hitsSky15 = skyAbove === 15;

    this.addHead = 0;
    this.addTail = 0;

    if (hitsSky15) {
      let curY = y;
      while (curY >= ChunkColumn.MIN_Y) {
        const stateId = world.getBlockStateId(x, curY, z);
        const op = this.getOpacity(stateId);
        if (op === 0) {
          this.storage.setSkyLight(x, curY, z, 15);
          this.markTouched(x, curY, z);
          this.pushAdd(x, curY, z);
          curY--;
        } else {
          const l = Math.max(0, 15 - Math.max(1, op));
          this.storage.setSkyLight(x, curY, z, l);
          this.markTouched(x, curY, z);
          if (l > 0) this.pushAdd(x, curY, z);
          break;
        }
      }
    } else {
      // Re-propagate from neighbors around (x,y,z)
      const dx = [0, 1, -1, 0, 0, 0, 0];
      const dy = [0, 0, 0, 1, -1, 0, 0];
      const dz = [0, 0, 0, 0, 0, 1, -1];

      for (let i = 0; i < 7; i++) {
        const nx = x + dx[i]!;
        const ny = y + dy[i]!;
        const nz = z + dz[i]!;
        if (ny < ChunkColumn.MIN_Y || ny > ChunkColumn.MAX_Y) continue;
        const sl = this.storage.getSkyLight(nx, ny, nz);
        if (sl > 0) {
          this.pushAdd(nx, ny, nz);
        }
      }
    }

    this.processSkyLightAddQueue(world);
  }

  /**
   * Clears old light in region and removes spilling light from adjacent columns.
   */
  public clearRegionLightAndRemoveSpill(
    world: World,
    minCx: number,
    minCz: number,
    maxCx: number,
    maxCz: number,
  ): void {
    const minX = minCx * 16;
    const maxX = maxCx * 16 + 15;
    const minZ = minCz * 16;
    const maxZ = maxCz * 16 + 15;

    // Collect block light sources on outer boundary
    const boundarySpillBlockSources: Array<{ x: number; y: number; z: number; oldLight: number }> =
      [];

    const checkBoundaryShaft = (bx: number, bz: number) => {
      const bCx = Math.floor(bx / 16);
      const bCz = Math.floor(bz / 16);
      if (!world.hasColumn(bCx, bCz)) return;

      for (let y = ChunkColumn.MIN_Y; y <= ChunkColumn.MAX_Y; y++) {
        const bl = this.storage.getBlockLight(bx, y, bz);
        if (bl > 0) {
          boundarySpillBlockSources.push({ x: bx, y, z: bz, oldLight: bl });
        }
      }
    };

    // Check boundary shafts on North/South edges
    for (let bx = minX - 1; bx <= maxX + 1; bx++) {
      checkBoundaryShaft(bx, minZ - 1);
      checkBoundaryShaft(bx, maxZ + 1);
    }

    // Check boundary shafts on East/West edges
    for (let bz = minZ; bz <= maxZ; bz++) {
      checkBoundaryShaft(minX - 1, bz);
      checkBoundaryShaft(maxX + 1, bz);
    }

    // Clear all section light storage inside region
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        for (let sy = 0; sy < 20; sy++) {
          const sec = this.storage.getSection(cx, sy, cz);
          if (sec) {
            sec.fill(0);
          }
        }
      }
    }

    // Remove spilling block light if sources were removed
    if (boundarySpillBlockSources.length > 0) {
      this.removeBlockLight(world, boundarySpillBlockSources);
    }
  }

  /**
   * Bulk initial light propagation for a loaded region of chunk columns.
   */
  public bulkPropagateRegion(
    world: World,
    minCx: number,
    minCz: number,
    maxCx: number,
    maxCz: number,
  ): void {
    // 0. Clear stale light in region and remove spilling light
    this.clearRegionLightAndRemoveSpill(world, minCx, minCz, maxCx, maxCz);

    // 1. Initial sky light columns
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        if (world.hasColumn(cx, cz)) {
          this.propagateSkyLightColumn(world, cx, cz);
        }
      }
    }

    // 2. Initial block light emitters
    const sources: Array<{ x: number; y: number; z: number }> = [];
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        if (!world.hasColumn(cx, cz)) continue;
        const startX = cx * 16;
        const startZ = cz * 16;
        for (let lx = 0; lx < 16; lx++) {
          for (let lz = 0; lz < 16; lz++) {
            const x = startX + lx;
            const z = startZ + lz;
            for (let y = ChunkColumn.MIN_Y; y <= ChunkColumn.MAX_Y; y++) {
              const stateId = world.getBlockStateId(x, y, z);
              const em = this.getEmission(stateId);
              if (em > 0) {
                sources.push({ x, y, z });
              }
            }
          }
        }
      }
    }

    if (sources.length > 0) {
      this.propagateBlockLight(world, sources);
    }
  }
}
