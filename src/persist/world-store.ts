import { SaveDb, type DbWrite } from './idb';
import { FORMAT_VERSION, migrations } from './version';
import type { WorldOptions, WorldType } from '../gen/world-options';

/** Columns per region side: a region record groups 32×32 columns. */
export const REGION_SIZE = 32;
export const PLAYER_ID = 'local';
export const DEFAULT_DIMENSION = 'overworld';

export function regionOf(cx: number, cz: number): { rx: number; rz: number } {
  return { rx: Math.floor(cx / REGION_SIZE), rz: Math.floor(cz / REGION_SIZE) };
}

const columnKey = (cx: number, cz: number): string => `${cx},${cz}`;
const regionKey = (rx: number, rz: number): string => `${rx},${rz}`;

/** `worlds` record: everything about a world that is not terrain, entities or the player. */
export interface WorldRecord {
  name: string;
  formatVersion: number;
  /** The seed text the player typed; `seed` below is its hash. */
  seedString: string;
  worldType: WorldType;
  /** Create World toggles (and the Single Biome biome). Records written without them load with defaults. */
  options?: WorldOptions;
  createdAt: number;
  lastPlayed: number;
  /** A 160×90 PNG of the last rendered game view, captured when this world saves. */
  thumbnail?: Blob;
  /** `serializeWorldMetadata` bytes: seed hash, world time, weather, break counter. */
  meta: Uint8Array;
  /** The scheduled-block-tick clock. Saved ticks are re-based against it (see `BlockTicks.addRebased`). */
  ticksTime: number;
}

export interface PlayerRecord {
  world: string;
  player: string;
  formatVersion: number;
  /** `serializePlayerData` bytes. */
  data: Uint8Array;
  /** `serializeInventory` bytes. */
  inventory: Uint8Array;
}

export interface EntityRecord {
  world: string;
  dim: string;
  formatVersion: number;
  /** `serializeItemEntities` bytes. */
  items: Uint8Array;
}

/** One saved column with the state that belongs to it. */
export interface StoredColumn {
  cx: number;
  cz: number;
  /** Uncompressed column bytes while compression is pending; null once `data` is set. */
  raw: Uint8Array | null;
  /** Deflated column bytes. */
  data: Uint8Array | null;
  /** `serializeBlockTicks` bytes of the column's pending ticks, with the clock they were saved at. */
  ticks: Uint8Array | null;
  /** Powered doors and trapdoors (the engine's edge memory), as `[x, y, z]`. */
  doors: number[][];
  /** `serializeBlockEntities` bytes. */
  blockEntities: Uint8Array | null;
}

interface RegionRecord {
  world: string;
  dim: string;
  rx: number;
  rz: number;
  formatVersion: number;
  columns: Array<{
    cx: number;
    cz: number;
    data: Uint8Array;
    ticks: Uint8Array | null;
    doors: number[][];
  }>;
}

interface BlockEntityRecord {
  world: string;
  dim: string;
  rx: number;
  rz: number;
  formatVersion: number;
  columns: Array<{ cx: number; cz: number; data: Uint8Array }>;
}

/** Brings a record read from the database to the current format, or fails clearly. */
function upgrade<T extends { formatVersion: number }>(domain: string, record: T): T {
  if (record.formatVersion === FORMAT_VERSION) return record;
  return migrations.migrate(domain, record, record.formatVersion, FORMAT_VERSION);
}

/**
 * The saved state of one world and dimension: an in-memory index of its modified columns over the
 * database. Columns are put here as they are captured; `flushRegion` writes a region's columns and
 * block entities in one transaction. Only columns that differ from generation are ever put.
 */
export class WorldStore {
  private readonly columns = new Map<string, StoredColumn>();
  private readonly dirtyRegions = new Set<string>();

  constructor(
    readonly db: SaveDb,
    readonly world: string,
    readonly dim: string = DEFAULT_DIMENSION,
  ) {}

  /** Reads every region and block-entity record of the world into memory. */
  static async load(
    db: SaveDb,
    world: string,
    dim: string = DEFAULT_DIMENSION,
  ): Promise<WorldStore> {
    const store = new WorldStore(db, world, dim);
    const regions = await db.getByPrefix<RegionRecord>('regions', [world, dim]);
    const blockEntities = await db.getByPrefix<BlockEntityRecord>('blockEntities', [world, dim]);
    for (const record of regions) {
      for (const c of upgrade('regions', record).columns) {
        store.columns.set(columnKey(c.cx, c.cz), {
          cx: c.cx,
          cz: c.cz,
          raw: null,
          data: c.data,
          ticks: c.ticks,
          doors: c.doors,
          blockEntities: null,
        });
      }
    }
    for (const record of blockEntities) {
      for (const c of upgrade('blockEntities', record).columns) {
        const column = store.columns.get(columnKey(c.cx, c.cz));
        if (column) column.blockEntities = c.data;
      }
    }
    return store;
  }

  all(): IterableIterator<StoredColumn> {
    return this.columns.values();
  }

  get size(): number {
    return this.columns.size;
  }

  has(cx: number, cz: number): boolean {
    return this.columns.has(columnKey(cx, cz));
  }

  get(cx: number, cz: number): StoredColumn | undefined {
    return this.columns.get(columnKey(cx, cz));
  }

  put(column: StoredColumn): void {
    this.columns.set(columnKey(column.cx, column.cz), column);
    const { rx, rz } = regionOf(column.cx, column.cz);
    this.dirtyRegions.add(regionKey(rx, rz));
  }

  /** Regions with columns not yet written, in a stable order. */
  pendingRegions(): Array<{ rx: number; rz: number }> {
    return [...this.dirtyRegions]
      .map((key) => {
        const [rx, rz] = key.split(',').map(Number);
        return { rx: rx!, rz: rz! };
      })
      .sort((a, b) => a.rz - b.rz || a.rx - b.rx);
  }

  private regionColumns(rx: number, rz: number): StoredColumn[] {
    const out: StoredColumn[] = [];
    for (const column of this.columns.values()) {
      const r = regionOf(column.cx, column.cz);
      if (r.rx === rx && r.rz === rz) out.push(column);
    }
    return out.sort((a, b) => a.cz - b.cz || a.cx - b.cx);
  }

  /** The writes that bring one region's records up to date; every column must be compressed. */
  regionWrites(rx: number, rz: number): DbWrite[] {
    const columns = this.regionColumns(rx, rz);
    for (const column of columns) {
      if (!column.data) throw new Error(`Column ${column.cx},${column.cz} is not compressed yet`);
    }
    const base = { world: this.world, dim: this.dim, rx, rz, formatVersion: FORMAT_VERSION };
    const regionRecord: RegionRecord = {
      ...base,
      columns: columns.map((c) => ({
        cx: c.cx,
        cz: c.cz,
        data: c.data!,
        ticks: c.ticks,
        doors: c.doors,
      })),
    };
    const withEntities = columns.filter((c) => c.blockEntities);
    const regionKeyValue = [this.world, this.dim, rx, rz];
    return [
      { op: 'put', store: 'regions', value: regionRecord },
      withEntities.length > 0
        ? {
            op: 'put',
            store: 'blockEntities',
            value: {
              ...base,
              columns: withEntities.map((c) => ({ cx: c.cx, cz: c.cz, data: c.blockEntities! })),
            } satisfies BlockEntityRecord,
          }
        : { op: 'delete', store: 'blockEntities', key: regionKeyValue },
    ];
  }

  /**
   * Writes one region's records in one transaction. `pause` runs between building the records and
   * handing them to the database, so a caller can spread the two over separate time slices.
   */
  async flushRegion(rx: number, rz: number, pause?: () => Promise<void>): Promise<void> {
    // Cleared before anything else so a column put while this runs marks the region dirty again.
    this.dirtyRegions.delete(regionKey(rx, rz));
    try {
      const writes = this.regionWrites(rx, rz);
      await pause?.();
      await this.db.write(writes);
    } catch (error) {
      this.dirtyRegions.add(regionKey(rx, rz));
      throw error;
    }
  }

  /** Storage a region's records take, counting payload bytes plus a fixed per-record overhead. */
  regionBytes(rx: number, rz: number): number {
    const columns = this.regionColumns(rx, rz);
    if (columns.length === 0) return 0;
    let bytes = 64;
    for (const c of columns) {
      bytes += 16 + (c.data?.byteLength ?? c.raw?.byteLength ?? 0) + (c.ticks?.byteLength ?? 0);
      bytes += c.doors.length * 24 + (c.blockEntities?.byteLength ?? 0);
    }
    return bytes;
  }
}

/** Reads and upgrades the `worlds` record, or returns undefined when there is none. */
export async function readWorldRecord(db: SaveDb, name: string): Promise<WorldRecord | undefined> {
  const record = await db.get<WorldRecord>('worlds', name);
  return record ? upgrade('worlds', record) : undefined;
}

export async function readPlayerRecord(
  db: SaveDb,
  world: string,
): Promise<PlayerRecord | undefined> {
  const record = await db.get<PlayerRecord>('players', [world, PLAYER_ID]);
  return record ? upgrade('players', record) : undefined;
}

export async function readEntityRecord(
  db: SaveDb,
  world: string,
  dim: string,
): Promise<EntityRecord | undefined> {
  const record = await db.get<EntityRecord>('entities', [world, dim]);
  return record ? upgrade('entities', record) : undefined;
}

/** Approximate bytes a stored value takes: typed-array payloads, strings and 8 bytes per number. */
export function recordBytes(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (typeof value === 'string') return value.length;
  if (typeof value === 'number') return 8;
  if (typeof value === 'boolean') return 1;
  if (Array.isArray(value)) return value.reduce((sum: number, v) => sum + recordBytes(v), 0);
  if (typeof value === 'object')
    return Object.entries(value as Record<string, unknown>).reduce(
      (sum, [key, v]) => sum + key.length + recordBytes(v),
      0,
    );
  return 0;
}
