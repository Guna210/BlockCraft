import { ChunkColumn } from './column';
import { BlockRegistry } from './blocks/registry';
import { LightEngine, buildLightLookupTables } from './lighting';

export class World {
  private columns: Map<string, ChunkColumn> = new Map();
  private registry: BlockRegistry;
  private lightEngine: LightEngine;

  constructor() {
    this.registry = BlockRegistry.getInstance();
    this.lightEngine = new LightEngine(buildLightLookupTables(this.registry));
  }

  public getLightEngine(): LightEngine {
    return this.lightEngine;
  }

  public setLightEngine(engine: LightEngine): void {
    this.lightEngine = engine;
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

    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const cx = Math.floor(x / 16);
        const cz = Math.floor(z / 16);

        if (!this.hasColumn(cx, cz) && onDemandGenerateColumn) {
          onDemandGenerateColumn(cx, cz);
        }

        for (let y = 0; y < 320; y++) {
          const stateId = this.getBlockStateId(x, y, z);
          if (stateId === 0) {
            // Fast path for air (stateId 0)
            h ^= 97;
            h = Math.imul(h, 0x01000193);
            h ^= 105;
            h = Math.imul(h, 0x01000193);
            h ^= 114;
            h = Math.imul(h, 0x01000193);
            h ^= 44;
            h = Math.imul(h, 0x01000193);
            continue;
          }

          const resolved = this.registry.getResolvedState(stateId);
          const blockId = resolved ? resolved.blockId : 'air';

          for (let i = 0; i < blockId.length; i++) {
            h ^= blockId.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
          }

          if (resolved && resolved.properties) {
            const keys = Object.keys(resolved.properties).sort();
            for (const k of keys) {
              const v = String(resolved.properties[k]);
              h ^= 0x3a; // ':'
              h = Math.imul(h, 0x01000193);
              for (let i = 0; i < k.length; i++) {
                h ^= k.charCodeAt(i);
                h = Math.imul(h, 0x01000193);
              }
              h ^= 0x3d; // '='
              h = Math.imul(h, 0x01000193);
              for (let i = 0; i < v.length; i++) {
                h ^= v.charCodeAt(i);
                h = Math.imul(h, 0x01000193);
              }
            }
          }

          h ^= 0x2c; // ','
          h = Math.imul(h, 0x01000193);
        }
      }
    }

    return (h >>> 0).toString(16).padStart(8, '0');
  }

  public getColumn(cx: number, cz: number, createIfMissing: boolean = true): ChunkColumn | null {
    const key = World.getChunkKey(cx, cz);
    let col = this.columns.get(key);
    if (!col && createIfMissing) {
      col = new ChunkColumn(cx, cz, 0);
      this.columns.set(key, col);
    }
    return col || null;
  }

  public getBlockStateId(x: number, y: number, z: number): number {
    if (y < ChunkColumn.MIN_Y || y > ChunkColumn.MAX_Y) {
      return 0; // Air for y out of bounds
    }

    const { cx, cz, localX, localZ } = World.worldToChunk(x, z);
    const col = this.getColumn(cx, cz, false);
    if (!col) return 0; // Unloaded chunks default to air

    return col.getBlockStateId(localX, y, localZ);
  }

  public setBlockStateId(x: number, y: number, z: number, stateId: number): void {
    if (y < ChunkColumn.MIN_Y || y > ChunkColumn.MAX_Y) {
      return; // Ignore writes out of y bounds
    }

    const { cx, cz, localX, localZ } = World.worldToChunk(x, z);
    const col = this.getColumn(cx, cz, true)!;
    const oldStateId = col.getBlockStateId(localX, y, localZ);
    if (oldStateId === stateId) return;

    col.setBlockStateId(localX, y, localZ, stateId);
    this.lightEngine.onBlockChange(this, x, y, z, oldStateId, stateId);
  }

  public getLight(x: number, y: number, z: number): { sky: number; block: number } {
    return this.lightEngine.getLight(this, x, y, z);
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

    this.lightEngine.suspendUpdates();

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          this.setBlockStateId(x, y, z, stateId);
        }
      }
    }

    this.lightEngine.resumeUpdates(this, minX, minY, minZ, maxX, maxY, maxZ);
  }
}
