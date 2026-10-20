import type { ItemEntityManager } from '../entity/item-entity';
import type { Player } from '../entity/player';
import { PISTON_LAND_TICK } from '../gameplay/mechanics';
import type { BlockPosition } from '../gameplay/current/types';
import { ChunkColumn } from '../world/column';
import { getWorldTime } from '../world/time';
import type { World } from '../world/world';
import { weatherManager } from '../world/weather';
import { deserializeColumnBinary, serializeColumnBinary } from './column-format';
import { deflate, inflate } from './compress';
import { browserIdb, SaveDb, type DbWrite, type IdbEnvironment } from './idb';
import {
  deserializeBlockEntities,
  deserializeBlockTicks,
  serializeBlockEntities,
  serializeBlockTicks,
  serializeInventory,
  serializeItemEntities,
  serializePlayerData,
  serializeWorldMetadata,
  type SerializedBlockTicks,
} from './serializers';
import { FORMAT_VERSION } from './version';
import {
  DEFAULT_DIMENSION,
  PLAYER_ID,
  WorldStore,
  readEntityRecord,
  readPlayerRecord,
  readWorldRecord,
  recordBytes,
  regionOf,
  type EntityRecord,
  type PlayerRecord,
  type StoredColumn,
  type WorldRecord,
} from './world-store';
import type { BlockEntityInstance } from '../world/block-entities';

/** Time between incremental autosaves (SPEC M17). */
export const AUTOSAVE_INTERVAL_MS = 60_000;
/** Main-thread time one slice of a save may use before it yields to the next frame. */
export const SLICE_BUDGET_MS = 2;
/** An autosave slice waits for a frame; if frames stop (a hidden tab) it carries on after this. */
const FRAME_WAIT_FALLBACK_MS = 100;
/** A thumbnail save waits briefly for one rendered frame, then keeps its previous thumbnail. */
const THUMBNAIL_FRAME_WAIT_FALLBACK_MS = 500;

export type SaveReason = 'autosave' | 'pause' | 'hidden' | 'exit' | 'manual';

/** What is being saved: the world and the player and entities that live in it. */
export interface SaveSession {
  name: string;
  seedString: string;
  worldType: 'default' | 'flat';
  world: World;
  player(): Player | null;
  items(): ItemEntityManager | null;
}

/** A column read back from the database, with everything that has to be re-attached to it. */
export interface RestoredColumn {
  column: ChunkColumn;
  ticks: SerializedBlockTicks | null;
  blockEntities: BlockEntityInstance[];
  doors: BlockPosition[];
}

export interface LoadedWorld {
  record: WorldRecord;
  store: WorldStore;
  player: PlayerRecord | undefined;
  entities: EntityRecord | undefined;
}

export interface SaveStats {
  /** Whether a world is attached and being saved. */
  active: boolean;
  runs: number;
  autosaves: number;
  failures: number;
  columnsCaptured: number;
  /** Longest uninterrupted main-thread stretch of any save step, in ms. */
  maxSliceMs: number;
  /** Longest stretch of the most recent run. */
  lastRunMaxSliceMs: number;
  /** The step that ended the longest stretch of the most recent run. */
  lastRunSlowestStep: string;
  lastRunMs: number;
  /** Modified columns held by the store. */
  storedColumns: number;
  /** Bytes the stored regions take, summed. */
  storedBytes: number;
}

export interface SaveManagerOptions {
  env?: () => IdbEnvironment;
  now?: () => number;
  autosaveIntervalMs?: number;
  sliceBudgetMs?: number;
}

interface ActiveSession {
  session: SaveSession;
  store: WorldStore;
  createdAt: number;
  thumbnail?: Blob;
}

type RunMode = 'frames' | 'timers';

/**
 * Saves a world to IndexedDB and gives its columns back. Only columns that changed since
 * generation are stored; the rest regenerate from the seed. A save is cut into slices that each
 * stay under a time budget: the autosave run takes one slice per frame, the others one per
 * timer turn.
 */
export class SaveManager {
  private readonly env: () => IdbEnvironment;
  private readonly now: () => number;
  private readonly autosaveIntervalMs: number;
  private readonly sliceBudgetMs: number;
  private db: SaveDb | null = null;
  private active: ActiveSession | null = null;
  private lastAutosave = 0;
  private running: Promise<void> | null = null;
  private queued: Promise<void> | null = null;
  private frameWaiters: Array<() => void> = [];
  private readonly compressing = new Set<Promise<void>>();
  private thumbnailCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private thumbnailWorker: Worker | null = null;
  private thumbnailFrameReady = false;
  private thumbnailCaptureRequested_ = false;
  private thumbnailCaptureResolve: ((captured: boolean) => void) | null = null;
  private thumbnailCaptureTimeout: ReturnType<typeof setTimeout> | null = null;
  private stretchStart = 0;
  private runMaxSliceMs = 0;
  private runSlowestStep = '';
  private pageHooksInstalled = false;
  readonly stats: SaveStats = {
    active: false,
    runs: 0,
    autosaves: 0,
    failures: 0,
    columnsCaptured: 0,
    maxSliceMs: 0,
    lastRunMaxSliceMs: 0,
    lastRunSlowestStep: '',
    lastRunMs: 0,
    storedColumns: 0,
    storedBytes: 0,
  };

  constructor(options: SaveManagerOptions = {}) {
    this.env = options.env ?? browserIdb;
    this.now = options.now ?? (() => performance.now());
    this.autosaveIntervalMs = options.autosaveIntervalMs ?? AUTOSAVE_INTERVAL_MS;
    this.sliceBudgetMs = options.sliceBudgetMs ?? SLICE_BUDGET_MS;
  }

  // -------------------------------------------------------------------------------------------
  // Opening, creating and loading worlds
  // -------------------------------------------------------------------------------------------

  async open(): Promise<SaveDb> {
    this.db ??= await SaveDb.open(this.env());
    return this.db;
  }

  /** Every saved world, for a world list. */
  async listWorlds(): Promise<WorldRecord[]> {
    const db = await this.open();
    return db.getAll<WorldRecord>('worlds');
  }

  /** Starts a world with this name from nothing: records of an older world of the same name go. */
  async create(name: string): Promise<WorldStore> {
    const db = await this.open();
    await db.deleteWorld(name);
    return new WorldStore(db, name);
  }

  /** Renames all stored records and keeps an active session attached to the new key. */
  async renameWorld(world: string, name: string): Promise<void> {
    if (world === name) return;
    const active = this.active?.session.name === world ? this.active : null;
    if (active) await this.save('manual');
    const db = await this.open();
    await db.renameWorld(world, name);
    if (active && this.active === active) {
      active.session.name = name;
      active.store = await WorldStore.load(db, name, active.store.dim);
      this.refreshStoreStats();
    }
  }

  /** Copies all stored records and includes current edits when the source is open. */
  async duplicateWorld(world: string, name: string): Promise<void> {
    if (this.active?.session.name === world) await this.save('manual');
    await (await this.open()).duplicateWorld(world, name);
  }

  /** Deletes a world and detaches it first if it is the active saved session. */
  async deleteWorld(world: string): Promise<void> {
    const active = this.active?.session.name === world ? this.active : null;
    if (active) {
      const running = this.running;
      if (running) await running.catch(() => {});
      if (this.active === active) this.detach();
    }
    await (await this.open()).deleteWorld(world);
  }

  /** Reads a world's records. Throws when no world has this name. */
  async load(name: string): Promise<LoadedWorld> {
    const db = await this.open();
    const record = await readWorldRecord(db, name);
    if (!record) throw new Error(`No saved world named '${name}'`);
    const [store, player, entities] = await Promise.all([
      WorldStore.load(db, name),
      readPlayerRecord(db, name),
      readEntityRecord(db, name, DEFAULT_DIMENSION),
    ]);
    return { record, store, player, entities };
  }

  /** Begins saving `session`. A world that came from the database keeps its creation time. */
  attach(
    session: SaveSession,
    store: WorldStore,
    createdAt: number = Date.now(),
    thumbnail?: Blob,
  ): void {
    this.finishThumbnailCapture(false);
    this.active = { session, store, createdAt, thumbnail };
    this.thumbnailFrameReady = false;
    this.openThumbnailWorker();
    this.lastAutosave = this.now();
    this.stats.active = true;
    this.refreshStoreStats();
    void this.warmUp(store);
  }

  /** Whether the next rendered frame should be copied for a save in progress. */
  get thumbnailCaptureRequested(): boolean {
    return this.thumbnailCaptureRequested_;
  }

  /** Downsamples one just-rendered frame only when a save has requested a thumbnail. */
  captureThumbnailFrame(source: HTMLCanvasElement): void {
    if (!this.thumbnailCaptureRequested_) return;
    if (!this.active || source.width === 0 || source.height === 0) {
      this.finishThumbnailCapture(false);
      return;
    }
    try {
      if (!this.thumbnailCanvas) {
        this.thumbnailCanvas =
          typeof OffscreenCanvas !== 'undefined'
            ? new OffscreenCanvas(160, 90)
            : Object.assign(document.createElement('canvas'), { width: 160, height: 90 });
      }
      const context = this.thumbnailCanvas.getContext('2d');
      if (!context) {
        this.finishThumbnailCapture(false);
        return;
      }
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, 160, 90);
      const drawStarted = this.now();
      try {
        context.drawImage(source, 0, 0, 160, 90);
      } finally {
        this.recordStretch('thumbnail', this.now() - drawStarted);
      }
      this.thumbnailFrameReady = true;
      this.finishThumbnailCapture(true);
    } catch {
      this.finishThumbnailCapture(false);
    }
  }

  private waitForThumbnailFrame(): Promise<boolean> {
    this.finishThumbnailCapture(false);
    this.thumbnailFrameReady = false;
    return new Promise((resolve) => {
      this.thumbnailCaptureResolve = resolve;
      this.thumbnailCaptureRequested_ = true;
      this.thumbnailCaptureTimeout = setTimeout(
        () => this.finishThumbnailCapture(false),
        THUMBNAIL_FRAME_WAIT_FALLBACK_MS,
      );
    });
  }

  private finishThumbnailCapture(captured: boolean): void {
    this.thumbnailCaptureRequested_ = false;
    if (this.thumbnailCaptureTimeout !== null) {
      clearTimeout(this.thumbnailCaptureTimeout);
      this.thumbnailCaptureTimeout = null;
    }
    const resolve = this.thumbnailCaptureResolve;
    this.thumbnailCaptureResolve = null;
    resolve?.(captured);
  }

  private async readThumbnail(): Promise<Blob | undefined> {
    if (!this.thumbnailCanvas || !this.thumbnailFrameReady) return undefined;
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(this.thumbnailCanvas);
    } catch {
      return undefined;
    }
    const worker = this.openThumbnailWorker();
    if (!worker) {
      bitmap.close();
      return undefined;
    }
    return new Promise((resolve) => {
      const finish = (blob?: Blob, failed = false): void => {
        worker.onmessage = null;
        worker.onerror = null;
        if (failed) {
          worker.terminate();
          if (this.thumbnailWorker === worker) this.thumbnailWorker = null;
        }
        resolve(blob);
      };
      worker.onmessage = ({ data }: MessageEvent<{ blob?: Blob; error?: string }>): void => {
        finish(data.blob);
      };
      worker.onerror = (): void => finish(undefined, true);
      try {
        worker.postMessage(bitmap, [bitmap]);
      } catch {
        bitmap.close();
        finish(undefined, true);
      }
    });
  }

  private openThumbnailWorker(): Worker | null {
    if (this.thumbnailWorker) return this.thumbnailWorker;
    if (typeof Worker === 'undefined') return null;
    try {
      this.thumbnailWorker = new Worker(new URL('./thumbnail.worker.ts', import.meta.url), {
        type: 'module',
      });
      return this.thumbnailWorker;
    } catch {
      return null;
    }
  }

  /**
   * Runs each step of a save once on throwaway data, so the first real save does not pay for cold
   * code (serializers, the compression streams, the first database transaction) inside a frame.
   */
  private async warmUp(store: WorldStore): Promise<void> {
    try {
      const column = new ChunkColumn(0, 0);
      for (let sy = 0; sy < ChunkColumn.SECTION_COUNT; sy++) column.getOrCreateSection(sy, 0);
      // Every section gets a few distinct states, so the palette paths run too.
      for (let y = 0; y < 320; y += 7)
        column.setBlockStateId(y % 16, y, (y * 3) % 16, 1 + (y % 19));
      let raw = serializeColumnBinary(column);
      for (let i = 0; i < 8; i++) raw = serializeColumnBinary(column);
      deserializeColumnBinary(await inflate(await deflate(raw)));
      serializeBlockTicks({ time: 0, ticks: [] });
      serializeBlockEntities([]);
      const name = '.warm-up';
      await store.db.write([
        { op: 'put', store: 'worlds', value: { name } },
        { op: 'put', store: 'regions', value: { world: name, dim: store.dim, rx: 0, rz: 0, raw } },
        { op: 'delete', store: 'worlds', key: name },
        { op: 'deletePrefix', store: 'regions', prefix: [name] },
      ]);
    } catch {
      // A warm-up that fails changes nothing; the real save reports its own errors.
    }
  }

  /** Stops saving without writing anything (a world that is being thrown away). */
  detach(): void {
    this.finishThumbnailCapture(false);
    this.active = null;
    this.stats.active = false;
    this.queued = null;
    this.frameWaiters.splice(0).forEach((resolve) => resolve());
  }

  get session(): SaveSession | null {
    return this.active?.session ?? null;
  }

  /** The world exits: everything is saved, then the manager lets go of it. */
  async exit(): Promise<void> {
    if (!this.active) return;
    try {
      await this.save('exit');
    } finally {
      this.detach();
    }
  }

  // -------------------------------------------------------------------------------------------
  // Triggers
  // -------------------------------------------------------------------------------------------

  /** Called once per rendered frame: starts the autosave when it is due and advances a running one. */
  frame(): void {
    if (this.active && !this.running && !this.queued) {
      if (this.now() - this.lastAutosave >= this.autosaveIntervalMs) {
        void this.autosaveNow().catch((error) => this.warn(error));
      }
    }
    this.frameWaiters.splice(0).forEach((resolve) => resolve());
  }

  /** Starts an incremental autosave now, one slice per frame; resolves when it has been written. */
  autosaveNow(): Promise<void> {
    this.lastAutosave = this.now();
    this.stats.autosaves++;
    return this.request('frames', 'autosave');
  }

  /** Saves everything that changed and resolves when it is written. */
  save(reason: SaveReason = 'manual'): Promise<void> {
    this.lastAutosave = this.now();
    return this.request('timers', reason);
  }

  /** Fire-and-forget save for events that cannot wait (pause, a hidden page). */
  saveSoon(reason: SaveReason): void {
    if (!this.active) return;
    void this.save(reason).catch((error) => this.warn(error));
  }

  /** Saves when the page is hidden or being left. Idempotent. */
  installPageHooks(): void {
    if (this.pageHooksInstalled || typeof document === 'undefined') return;
    this.pageHooksInstalled = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.saveSoon('hidden');
    });
    window.addEventListener('pagehide', () => this.saveSoon('exit'));
  }

  private warn(error: unknown): void {
    this.stats.failures++;
    console.warn('[saves] save failed:', error);
  }

  /** Runs one after another; requests that arrive while one waits share it. */
  private request(mode: RunMode, reason: SaveReason): Promise<void> {
    if (!this.active) return Promise.reject(new Error('No world is open to save'));
    if (this.queued) return this.queued;
    const previous = this.running ?? Promise.resolve();
    const next: Promise<void> = previous
      .catch(() => undefined)
      .then(() => {
        this.queued = null;
        return this.execute(mode, reason);
      });
    this.queued = next;
    this.running = next;
    const clear = (): void => {
      if (this.running === next) this.running = null;
      if (this.queued === next) this.queued = null;
    };
    next.then(clear, clear);
    return next;
  }

  // -------------------------------------------------------------------------------------------
  // The save itself
  // -------------------------------------------------------------------------------------------

  private yieldSlice(mode: RunMode): Promise<void> {
    if (mode === 'timers') return new Promise((resolve) => setTimeout(resolve, 0));
    return new Promise((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        resolve();
      };
      this.frameWaiters.push(finish);
      setTimeout(finish, FRAME_WAIT_FALLBACK_MS);
    });
  }

  /** Ends the current main-thread stretch, waits, and starts the next one. */
  private async suspend(step: string, wait: Promise<unknown>): Promise<void> {
    this.recordStretch(step, this.now() - this.stretchStart);
    await wait;
    this.stretchStart = this.now();
  }

  private recordStretch(step: string, stretch: number): void {
    if (stretch > this.runMaxSliceMs) {
      this.runMaxSliceMs = stretch;
      this.runSlowestStep = step;
    }
    this.stats.maxSliceMs = Math.max(this.stats.maxSliceMs, stretch);
  }

  /** The Blob encoder is async; measure only its synchronous request, not time waiting for a callback. */
  private async thumbnailForSave(): Promise<Blob | undefined> {
    this.stretchStart = this.now();
    const framePending = this.waitForThumbnailFrame();
    this.recordStretch('thumbnail-request', this.now() - this.stretchStart);
    const captured = await framePending;
    this.stretchStart = this.now();
    if (!captured) return undefined;

    this.stretchStart = this.now();
    const pending = this.readThumbnail();
    this.recordStretch('thumbnail', this.now() - this.stretchStart);
    const thumbnail = await pending;
    this.stretchStart = this.now();
    return thumbnail;
  }

  private async execute(mode: RunMode, reason: SaveReason): Promise<void> {
    const active = this.active;
    if (!active) return;
    const { session, store } = active;
    const world = session.world;
    const started = this.now();
    this.stretchStart = started;
    this.runMaxSliceMs = 0;
    this.runSlowestStep = '';
    this.stats.runs++;
    try {
      // Settled state only: moves in flight land now, so no `piston_moving` cell is ever saved.
      world.current.mechanics.landAll();

      const targets = new Set<ChunkColumn>(world.modifiedColumns);
      for (const entity of world.blockEntities.getAll()) {
        // Block entities change without a block edit (a kiln burning, a chest being used).
        const column = world.getColumn(Math.floor(entity.x / 16), Math.floor(entity.z / 16), false);
        if (column) targets.add(column);
      }

      let sliceStart = this.now();
      for (const column of targets) {
        if (this.now() - sliceStart >= this.sliceBudgetMs) {
          await this.suspend('capture', this.yieldSlice(mode));
          sliceStart = this.now();
        }
        // A column that unloaded meanwhile was captured by the unload hook.
        if (world.getColumn(column.cx, column.cz, false) !== column) continue;
        this.capture(world, column);
      }

      await this.suspend('capture', Promise.all([...this.compressing]));

      // One region failing must not stop the player and world records from being written.
      let regionError: unknown;
      for (const { rx, rz } of store.pendingRegions()) {
        try {
          await this.suspend('region', this.yieldSlice(mode));
          // Columns captured by the unload hook meanwhile are still compressing. The check and the
          // call that builds the region's records follow each other with no wait in between.
          while (this.compressing.size > 0)
            await this.suspend('capture', Promise.all([...this.compressing]));
          await this.suspend(
            'region',
            store.flushRegion(rx, rz, () => this.suspend('region-build', this.yieldSlice(mode))),
          );
        } catch (error) {
          regionError ??= error;
        }
      }

      await this.suspend('region', this.yieldSlice(mode));
      const captureThumbnail =
        reason !== 'hidden' &&
        reason !== 'exit' &&
        !(typeof document !== 'undefined' && document.visibilityState === 'hidden');
      const thumbnail = captureThumbnail
        ? ((await this.thumbnailForSave()) ?? active.thumbnail)
        : active.thumbnail;
      if (thumbnail) active.thumbnail = thumbnail;
      await this.suspend('world', store.db.write(this.sessionWrites(active, thumbnail)));
      if (regionError) throw regionError;
    } catch (error) {
      this.stats.failures++;
      throw error;
    } finally {
      this.stats.lastRunMs = this.now() - started;
      this.stats.lastRunMaxSliceMs = this.runMaxSliceMs;
      this.stats.lastRunSlowestStep = this.runSlowestStep;
      this.refreshStoreStats();
    }
  }

  /** Snapshot of the player, inventory, ground items and world state. */
  private sessionWrites(active: ActiveSession, thumbnail?: Blob): DbWrite[] {
    const { session, store } = active;
    const world = session.world;
    const weather = weatherManager.getState();
    const record: WorldRecord = {
      name: session.name,
      formatVersion: FORMAT_VERSION,
      seedString: session.seedString,
      worldType: session.worldType,
      createdAt: active.createdAt,
      lastPlayed: Date.now(),
      ...(thumbnail ? { thumbnail } : {}),
      meta: serializeWorldMetadata({
        seed: world.worldSeed,
        timeOfDay: getWorldTime(),
        weather: weather.weather,
        manualOverride: weather.manualOverride,
        strikeCounter: weather.strikeCounter,
        lastTick: weather.lastTick,
        elapsed: weather.elapsed,
        breakCount: world.breakCount,
        worldType: session.worldType,
      }),
      ticksTime: world.ticks.time,
    };
    const writes: DbWrite[] = [{ op: 'put', store: 'worlds', value: record }];
    const player = session.player();
    if (player) {
      writes.push({
        op: 'put',
        store: 'players',
        value: {
          world: session.name,
          player: PLAYER_ID,
          formatVersion: FORMAT_VERSION,
          data: serializePlayerData(player),
          inventory: serializeInventory(player.inventory),
        } satisfies PlayerRecord,
      });
    }
    const items = session.items();
    writes.push({
      op: 'put',
      store: 'entities',
      value: {
        world: session.name,
        dim: store.dim,
        formatVersion: FORMAT_VERSION,
        items: serializeItemEntities(items ? items.pool.filter((entity) => entity.active) : []),
      } satisfies EntityRecord,
    });
    return writes;
  }

  /**
   * Stores one column: its blocks, block entities, pending ticks and powered doors. The blocks are
   * serialized now and compressed in the background; the raw bytes serve reads until then.
   */
  private capture(world: World, column: ChunkColumn, doors?: BlockPosition[]): void {
    const active = this.active;
    if (!active) return;
    const { store } = active;
    const raw = serializeColumnBinary(column);
    const entities = world.blockEntities.getInColumn(column.cx, column.cz);
    const ticks = world.ticks
      .getPendingTicksForColumn(column.cx, column.cz)
      .filter((tick) => tick.type !== PISTON_LAND_TICK);
    const powered = doors ?? world.current.mechanics.poweredOpenables(column.cx, column.cz);
    const record: StoredColumn = {
      cx: column.cx,
      cz: column.cz,
      raw,
      data: null,
      ticks: ticks.length > 0 ? serializeBlockTicks({ time: world.ticks.time, ticks }) : null,
      doors: powered.map((p) => [p.x, p.y, p.z]),
      blockEntities: entities.length > 0 ? serializeBlockEntities(entities) : null,
    };
    store.put(record);
    world.clearModified(column);
    this.stats.columnsCaptured++;
    const job: Promise<void> = deflate(raw)
      .then((data) => {
        if (store.get(record.cx, record.cz) === record) {
          record.data = data;
          record.raw = null;
        }
      })
      .finally(() => this.compressing.delete(job));
    this.compressing.add(job);
    job.catch((error) => this.warn(error));
  }

  /**
   * Called before a streamed column is dropped. A column that changed (or holds block entities,
   * which change silently) is captured first, so walking away from an edit never loses it.
   */
  onColumnUnload(world: World, cx: number, cz: number): void {
    const active = this.active;
    if (!active || active.session.world !== world) return;
    const column = world.getColumn(cx, cz, false);
    if (!column) return;
    if (!world.modifiedColumns.has(column) && world.blockEntities.getInColumn(cx, cz).length === 0)
      return;
    // Moves land and receivers are forgotten before the capture; the powered-door memory is read first.
    const doors = world.current.mechanics.poweredOpenables(cx, cz);
    world.current.removeColumn(cx, cz);
    this.capture(world, column, doors);
  }

  // -------------------------------------------------------------------------------------------
  // Reading columns back
  // -------------------------------------------------------------------------------------------

  has(cx: number, cz: number): boolean {
    return this.active?.store.has(cx, cz) ?? false;
  }

  /** The saved column at (cx, cz) with its block entities, ticks and doors, or null if none was saved. */
  restoreColumn(cx: number, cz: number): Promise<RestoredColumn> | null {
    const stored = this.active?.store.get(cx, cz);
    if (!stored) return null;
    return (async (): Promise<RestoredColumn> => {
      const bytes = stored.raw ?? (await inflate(stored.data!));
      const column = deserializeColumnBinary(bytes);
      if (column.cx !== cx || column.cz !== cz)
        throw new Error(`Saved column (${column.cx},${column.cz}) is stored under (${cx},${cz})`);
      return {
        column,
        ticks: stored.ticks ? deserializeBlockTicks(stored.ticks) : null,
        blockEntities: stored.blockEntities ? deserializeBlockEntities(stored.blockEntities) : [],
        doors: stored.doors.map(([x, y, z]) => ({ x: x!, y: y!, z: z! })),
      };
    })();
  }

  private refreshStoreStats(): void {
    const store = this.active?.store;
    this.stats.storedColumns = store?.size ?? 0;
    this.stats.storedBytes = store ? this.regionStats().reduce((sum, r) => sum + r.bytes, 0) : 0;
  }

  /** Storage per region of the open world, for the "untouched regions cost nothing" check. */
  regionStats(): Array<{ rx: number; rz: number; columns: number; bytes: number }> {
    const store = this.active?.store;
    if (!store) return [];
    const regions = new Map<string, { rx: number; rz: number; columns: number }>();
    for (const column of store.all()) {
      const { rx, rz } = regionOf(column.cx, column.cz);
      const entry = regions.get(`${rx},${rz}`) ?? { rx, rz, columns: 0 };
      entry.columns++;
      regions.set(`${rx},${rz}`, entry);
    }
    return [...regions.values()]
      .map((r) => ({ ...r, bytes: store.regionBytes(r.rx, r.rz) }))
      .sort((a, b) => a.rz - b.rz || a.rx - b.rx);
  }

  /** What the database holds for the open world: records per store and the bytes of their payloads. */
  async databaseUsage(): Promise<{
    regions: Array<{ rx: number; rz: number; columns: number; bytes: number }>;
    blockEntities: number;
    totalBytes: number;
  }> {
    const store = this.active?.store;
    if (!store) throw new Error('No world is open');
    const db = await this.open();
    const regions = await db.getByPrefix<{
      rx: number;
      rz: number;
      columns: unknown[];
    }>('regions', [store.world, store.dim]);
    const entities = await db.getByPrefix<unknown>('blockEntities', [store.world, store.dim]);
    const rows = regions.map((r) => ({
      rx: r.rx,
      rz: r.rz,
      columns: r.columns.length,
      bytes: recordBytes(r),
    }));
    return {
      regions: rows,
      blockEntities: entities.length,
      totalBytes:
        rows.reduce((sum, r) => sum + r.bytes, 0) +
        entities.reduce((s: number, e) => s + recordBytes(e), 0),
    };
  }

  /** Bytes the saved regions of the open world take; a region with no saved column takes none. */
  bytesOfRegion(rx: number, rz: number): number {
    return this.active?.store.regionBytes(rx, rz) ?? 0;
  }
}
