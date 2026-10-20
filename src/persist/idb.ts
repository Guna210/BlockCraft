/**
 * A small hand-written IndexedDB wrapper (decisions/M17b-saving.md). It knows the save schema and
 * nothing about the game: five object stores, promise-based reads, and writes grouped into one
 * transaction so a save either lands completely or not at all.
 */

export const DB_NAME = 'blockcraft-saves';
export const DB_VERSION = 1;

/**
 * Object stores and their key paths. Every key starts with the world name, so a world's records are
 * one key range per store and deleting a world is a range delete.
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
} as const;

export type StoreName = keyof typeof STORE_KEY_PATHS;
export const STORE_NAMES = Object.keys(STORE_KEY_PATHS) as StoreName[];

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

  /** Deletes every record of a world from every store. */
  async deleteWorld(world: string): Promise<void> {
    await this.write([
      { op: 'delete', store: 'worlds', key: world },
      ...(['regions', 'players', 'entities', 'blockEntities'] as const).map((store): DbWrite => ({
        op: 'deletePrefix',
        store,
        prefix: [world],
      })),
    ]);
  }
}
