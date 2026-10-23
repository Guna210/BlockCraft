/**
 * A small hand-written IndexedDB wrapper (decisions/M17b-saving.md). It knows the persistence
 * schema and nothing about the game: world stores plus one settings store, promise-based reads,
 * and writes grouped into one transaction so a save either lands completely or not at all.
 */

export const DB_NAME = 'blockcraft-saves';
export const DB_VERSION = 2;

/**
 * Object stores and their key paths. World-store keys start with the world name, so a world's
 * records are one key range per store. The separate settings store holds one global record.
 */
export const STORE_KEY_PATHS = {
  /** One record per world: metadata. Key `name`. */
  worlds: 'name',
  /** One record per 32×32-column region of a dimension. Key `[world, dim, rx, rz]`. */
  regions: ['world', 'dim', 'rx', 'rz'],
  /** One record per player of a world. Key `[world, player]`. */
  players: ['world', 'player'],
  /** Ground entities of a dimension. Key `[world, dim]`. */
  entities: ['world', 'dim'],
  /** Block entities of one region. Key `[world, dim, rx, rz]`. */
  blockEntities: ['world', 'dim', 'rx', 'rz'],
  /** One global user preference record. Key `key` (`global`). */
  settings: 'key',
} as const;

export type StoreName = keyof typeof STORE_KEY_PATHS;
export const STORE_NAMES = Object.keys(STORE_KEY_PATHS) as StoreName[];
export const WORLD_STORE_NAMES = STORE_NAMES.filter((name) => name !== 'settings') as Array<
  Exclude<StoreName, 'settings'>
>;

export type DbKey = string | number | DbKey[];

/** A write inside a grouped transaction. `prefix` deletes every record whose key starts with it. */
export type DbWrite =
  | { op: 'put'; store: StoreName; value: object }
  | { op: 'delete'; store: StoreName; key: DbKey }
  | { op: 'deletePrefix'; store: StoreName; prefix: DbKey[] };

/** The pieces of the browser's IndexedDB the wrapper uses; tests pass an in-memory stand-in. */
export interface IdbEnvironment {
  factory: IDBFactory;
  keyRange: Pick<typeof IDBKeyRange, 'bound'>;
}

export function browserIdb(): IdbEnvironment {
  if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not available');
  return { factory: indexedDB, keyRange: IDBKeyRange };
}

function requestPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** Every key that starts with `prefix`: arrays sort after numbers and strings, so `[...prefix, []]` ends the range. */
function prefixRange(env: IdbEnvironment, prefix: DbKey[]): IDBKeyRange {
  return env.keyRange.bound(prefix, [...prefix, []]);
}

function recordKey(store: StoreName, record: Record<string, unknown>): DbKey {
  const keyPath = STORE_KEY_PATHS[store];
  return typeof keyPath === 'string'
    ? (record[keyPath] as DbKey)
    : keyPath.map((part) => record[part] as DbKey);
}

export class SaveDb {
  private constructor(
    private readonly db: IDBDatabase,
    private readonly env: IdbEnvironment,
  ) {}

  static async open(env: IdbEnvironment = browserIdb(), name: string = DB_NAME): Promise<SaveDb> {
    const request = env.factory.open(name, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of STORE_NAMES) {
        if (!db.objectStoreNames.contains(store))
          db.createObjectStore(store, { keyPath: STORE_KEY_PATHS[store] as string | string[] });
      }
    };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Cannot open the save database'));
      request.onblocked = () => reject(new Error('The save database is blocked by another tab'));
    });
    return new SaveDb(db, env);
  }

  close(): void {
    this.db.close();
  }

  async get<T>(store: StoreName, key: DbKey): Promise<T | undefined> {
    const tx = this.db.transaction(store, 'readonly');
    const result = await requestPromise<T | undefined>(tx.objectStore(store).get(key));
    await transactionDone(tx);
    return result;
  }

  async getAll<T>(store: StoreName): Promise<T[]> {
    const tx = this.db.transaction(store, 'readonly');
    const result = await requestPromise<T[]>(tx.objectStore(store).getAll());
    await transactionDone(tx);
    return result;
  }

  /** All records whose key starts with `prefix`. */
  async getByPrefix<T>(store: StoreName, prefix: DbKey[]): Promise<T[]> {
    const tx = this.db.transaction(store, 'readonly');
    const result = await requestPromise<T[]>(
      tx.objectStore(store).getAll(prefixRange(this.env, prefix)),
    );
    await transactionDone(tx);
    return result;
  }

  async count(store: StoreName, prefix?: DbKey[]): Promise<number> {
    const tx = this.db.transaction(store, 'readonly');
    const objectStore = tx.objectStore(store);
    const result = await requestPromise<number>(
      prefix ? objectStore.count(prefixRange(this.env, prefix)) : objectStore.count(),
    );
    await transactionDone(tx);
    return result;
  }

  /** Applies the writes in one readwrite transaction; resolves when it has committed. */
  async write(writes: ReadonlyArray<DbWrite>): Promise<void> {
    if (writes.length === 0) return;
    const names = [...new Set(writes.map((w) => w.store))];
    const tx = this.db.transaction(names, 'readwrite');
    const done = transactionDone(tx);
    for (const write of writes) {
      const store = tx.objectStore(write.store);
      if (write.op === 'put') store.put(write.value);
      else if (write.op === 'delete') store.delete(write.key);
      else store.delete(prefixRange(this.env, write.prefix));
    }
    await done;
  }

  /** Deletes every record of a world without touching global settings. */
  async deleteWorld(world: string): Promise<void> {
    await this.write(
      WORLD_STORE_NAMES.map((store): DbWrite =>
        store === 'worlds'
          ? { op: 'delete', store, key: world }
          : { op: 'deletePrefix', store, prefix: [world] },
      ),
    );
  }

  /** Moves a world's records under a new unique name in one readwrite transaction. */
  async renameWorld(world: string, name: string): Promise<void> {
    if (world === name) return;
    await this.transferWorld(world, name, true);
  }

  /** Copies every record of a world under a new unique name in one readwrite transaction. */
  async duplicateWorld(world: string, name: string): Promise<void> {
    await this.transferWorld(world, name, false);
  }

  private async transferWorld(world: string, name: string, move: boolean): Promise<void> {
    const tx = this.db.transaction(WORLD_STORE_NAMES, 'readwrite');
    const done = transactionDone(tx);
    // The separate handler marks the rejection handled while request callbacks are still pending.
    void done.catch(() => {});
    try {
      const worlds = tx.objectStore('worlds');
      const [target, source] = await Promise.all([
        requestPromise<Record<string, unknown> | undefined>(worlds.get(name)),
        requestPromise<Record<string, unknown> | undefined>(worlds.get(world)),
      ]);
      if (target) {
        tx.abort();
        await done.catch(() => {});
        throw new Error(`A world named '${name}' already exists`);
      }
      if (!source) {
        tx.abort();
        await done.catch(() => {});
        throw new Error(`No saved world named '${world}'`);
      }

      for (const storeName of WORLD_STORE_NAMES) {
        const store = tx.objectStore(storeName);
        if (storeName === 'worlds') {
          store.put({ ...source, name });
          if (move) store.delete(world);
          continue;
        }
        const query = prefixRange(this.env, [world]);
        const request = store.getAll(query) as IDBRequest<Record<string, unknown>[]>;
        request.onsuccess = () => {
          for (const record of request.result) {
            const renamed = { ...record, world: name };
            store.put(renamed);
            if (move) store.delete(recordKey(storeName, record));
          }
        };
      }
      await done;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // The transaction may already have committed or aborted.
      }
      await done.catch(() => {});
      throw error;
    }
  }
}
