import { ChunkColumn } from './column';
import { BlockRegistry } from './blocks/registry';
import { LightEngine } from './lighting';
import { sampleBiome } from '../gen/biomes';

export class World {
  private columns: Map<string, ChunkColumn> = new Map();
  private registry: BlockRegistry;
  public lightEngine: LightEngine;
  public worldSeed: number = 42;
  public worldType: 'default' | 'flat' = 'default';

  private lastCX = 0x7fffffff;
  private lastCZ = 0x7fffffff;
  private lastCol: ChunkColumn | null = null;

  constructor(initLightEngine: boolean = true) {
    this.registry = BlockRegistry.getInstance();
    this.lightEngine = initLightEngine ? new LightEngine() : (null as unknown as LightEngine);
  }

  public getBiome(x: number, z: number): string {
    if (this.worldType === 'flat') {
      return 'plains';
    }
    // Block coordinates: a fractional position (the player's) is the block that contains it.
    x = Math.floor(x);
    z = Math.floor(z);
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const localX = ((x % 16) + 16) % 16;
    const localZ = ((z % 16) + 16) % 16;

    const col = this.getColumn(cx, cz, false);
    if (col && col.biomes) {
      const idx = localZ * 16 + localX;
      return col.biomes[idx] || 'plains';
    }

    return sampleBiome(this.worldSeed, x, z);
  }

  public static getChunkKey(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  // World to chunk coordinate math handling negative coordinates
  public static worldToChunk(
    x: number,
    z: number,
  ): {
    cx: number;
    cz: number;
    localX: number;
    localZ: number;
  } {
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const localX = ((x % 16) + 16) % 16;
    const localZ = ((z % 16) + 16) % 16;
    return { cx, cz, localX, localZ };
  }

  public hasColumn(cx: number, cz: number): boolean {
    if (cx === this.lastCX && cz === this.lastCZ && this.lastCol !== null) {
      return true;
    }
    const key = World.getChunkKey(cx, cz);
    return this.columns.has(key);
  }

  public getHeight(x: number, z: number): number {
    for (let y = 319; y >= 0; y--) {
      const stateId = this.getBlockStateId(x, y, z);
      if (stateId === 0) continue;
      const resolved = this.registry.getResolvedState(stateId);
      if (!resolved) continue;
      const blockId = resolved.blockId;
      if (blockId !== 'air' && blockId !== 'water' && blockId !== 'lava') {
        return y;
      }
    }
    return 0;
  }

  public worldHash(
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    onDemandGenerateColumn?: (cx: number, cz: number) => void,
  ): string {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minZ = Math.min(z1, z2);
    const maxZ = Math.max(z1, z2);

    let h = 0x811c9dc5;

    const minCX = Math.floor(minX / 16);
    const maxCX = Math.floor(maxX / 16);
    const minCZ = Math.floor(minZ / 16);
    const maxCZ = Math.floor(maxZ / 16);

    if (onDemandGenerateColumn) {
      for (let cz = minCZ; cz <= maxCZ; cz++) {
        for (let cx = minCX; cx <= maxCX; cx++) {
          if (!this.hasColumn(cx, cz)) {
            onDemandGenerateColumn(cx, cz);
          }
        }
      }
    }

    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const cx = Math.floor(x / 16);
        const cz = Math.floor(z / 16);
        const localX = ((x % 16) + 16) % 16;
        const localZ = ((z % 16) + 16) % 16;

        const col = this.getColumn(cx, cz, false);

        for (let y = 0; y < 320; y++) {
          const stateId = col ? col.getBlockStateId(localX, y, localZ) : 0;
          const bytes = this.registry.getStateHashBytes(stateId);

          for (let i = 0; i < bytes.length; i++) {
            h ^= bytes[i]!;
            h = Math.imul(h, 0x01000193);
          }
        }
      }
    }

    return (h >>> 0).toString(16).padStart(8, '0');
  }

  public getColumn(cx: number, cz: number, createIfMissing: boolean = true): ChunkColumn | null {
    if (cx === this.lastCX && cz === this.lastCZ) {
      if (this.lastCol !== null || !createIfMissing) {
        return this.lastCol;
      }
    }

    const key = World.getChunkKey(cx, cz);
    let col = this.columns.get(key);
    if (!col && createIfMissing) {
      col = new ChunkColumn(cx, cz, 0);
      this.columns.set(key, col);
    }

    this.lastCX = cx;
    this.lastCZ = cz;
    this.lastCol = col || null;

    return this.lastCol;
  }

  public getBlockStateId(x: number, y: number, z: number): number {
    if (y < ChunkColumn.MIN_Y || y > ChunkColumn.MAX_Y) {
      return 0; // Air for y out of bounds
    }

    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const localX = ((x % 16) + 16) % 16;
    const localZ = ((z % 16) + 16) % 16;

    const col = this.getColumn(cx, cz, false);
    if (!col) return 0; // Unloaded chunks default to air

    return col.getBlockStateId(localX, y, localZ);
  }

  public getLight(x: number, y: number, z: number): { sky: number; block: number } {
    return this.lightEngine.getLight(x, y, z);
  }

  public setBlockStateId(x: number, y: number, z: number, stateId: number): void {
    if (y < ChunkColumn.MIN_Y || y > ChunkColumn.MAX_Y) {
      return; // Ignore writes out of y bounds
    }

    const oldStateId = this.getBlockStateId(x, y, z);
    if (oldStateId === stateId) return;

    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const localX = ((x % 16) + 16) % 16;
    const localZ = ((z % 16) + 16) % 16;

    const col = this.getColumn(cx, cz, true)!;
    col.setBlockStateId(localX, y, localZ, stateId);

    if (this.lightEngine) {
      this.lightEngine.onBlockChanged(this, x, y, z, oldStateId, stateId);
    }
  }

  public getBlock(
    x: number,
    y: number,
    z: number,
  ): { id: string; state: Record<string, string | number> } {
    if (y < ChunkColumn.MIN_Y || y > ChunkColumn.MAX_Y) {
      return { id: 'air', state: {} };
    }

    const stateId = this.getBlockStateId(x, y, z);
    const resolved = this.registry.getResolvedState(stateId);

    if (!resolved) {
      return { id: 'air', state: {} };
    }

    return {
      id: resolved.blockId,
      state: { ...resolved.properties },
    };
  }

  public setBlock(
    x: number,
    y: number,
    z: number,
    blockId: string,
    stateProps?: Record<string, string | number>,
  ): void {
    if (y < ChunkColumn.MIN_Y || y > ChunkColumn.MAX_Y) {
      throw new Error(`Invalid y coordinate ${y}. Must be in range [0, 319].`);
    }

    const def = this.registry.getBlockDefinition(blockId);
    if (!def) {
      throw new Error(`Unknown block ID '${blockId}'.`);
    }

    const stateId = this.registry.getStateId(blockId, stateProps);
    if (stateId === undefined) {
      throw new Error(`Invalid block state for '${blockId}': ${JSON.stringify(stateProps)}.`);
    }

    this.setBlockStateId(x, y, z, stateId);
  }

  public fill(
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
    blockId: string,
  ): void {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    const minZ = Math.min(z1, z2);
    const maxZ = Math.max(z1, z2);

    if (minY < ChunkColumn.MIN_Y || maxY > ChunkColumn.MAX_Y) {
      throw new Error(`Fill y range [${minY}, ${maxY}] out of bounds [0, 319].`);
    }

    const def = this.registry.getBlockDefinition(blockId);
    if (!def) {
      throw new Error(`Unknown block ID '${blockId}'.`);
    }

    const stateId = this.registry.getDefaultStateId(blockId);
    if (stateId === undefined) {
      throw new Error(`Unknown block ID '${blockId}'.`);
    }

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          this.setBlockStateId(x, y, z, stateId);
        }
      }
    }
  }
}
