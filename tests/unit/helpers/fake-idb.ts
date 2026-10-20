import type { IdbEnvironment } from '../../../src/persist/idb';

// A small in-memory IndexedDB for unit tests (the jsdom environment has none). It implements what
// the SaveDb wrapper uses: open with upgrades, object stores with key paths, get / getAll / count /
// put / delete over keys and key ranges, and transaction completion events. Values are deep-copied
// on put and on read, like the structured clone of the real thing.

type Key = string | number | Key[];

function rank(key: Key): number {
  if (typeof key === 'number') return 0;
  if (typeof key === 'string') return 1;
  return 2;
}

/** The IndexedDB key order: numbers, then strings, then arrays (compared element by element). */
export function compareKeys(a: Key, b: Key): number {
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const c = compareKeys(a[i]!, b[i]!);
      if (c !== 0) return c;
    }
    return a.length - b.length;
  }
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function clone<T>(value: T): T {
  if (ArrayBuffer.isView(value)) return (value as unknown as Uint8Array).slice() as unknown as T;
  if (Array.isArray(value)) return value.map(clone) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = clone(v);
    return out as T;
  }
  return value;
}

interface Range {
  lower: Key;
  upper: Key;
}

function inRange(key: Key, range: Range): boolean {
  return compareKeys(key, range.lower) >= 0 && compareKeys(key, range.upper) <= 0;
}

function isRange(value: unknown): value is Range {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'lower' in value;
}

function pathValue(record: Record<string, unknown>, path: string | readonly string[]): Key {
  if (typeof path === 'string') return record[path] as Key;
  return path.map((p) => record[p] as Key);
}

interface Req<T> {
  result: T | undefined;
  error: Error | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}

class FakeStore {
  readonly rows: Array<{ key: Key; value: Record<string, unknown> }> = [];
  constructor(
    readonly name: string,
    readonly keyPath: string | readonly string[],
  ) {}

  find(key: Key): number {
    return this.rows.findIndex((r) => compareKeys(r.key, key) === 0);
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  error: Error | null = null;
  private pending = 0;
  private finished = false;

  constructor(
    private readonly stores: Map<string, FakeStore>,
    private readonly names: string[],
    private readonly mode: 'readonly' | 'readwrite',
    private readonly hooks: { failWrites: (store: string) => boolean },
  ) {
    // A transaction with no requests still completes.
    setTimeout(() => this.settle(), 0);
  }

  objectStore(name: string): FakeObjectStore {
    if (!this.names.includes(name)) throw new Error(`Store '${name}' is not in this transaction`);
    return new FakeObjectStore(this.stores.get(name)!, this);
  }

  request<T>(run: () => T, write: boolean, store = ''): Req<T> {
    if (write && this.mode === 'readonly') throw new Error('The transaction is read-only');
    const request: Req<T> = { result: undefined, error: null, onsuccess: null, onerror: null };
    this.pending++;
    // The operation applies at once, in order; the result is delivered in a later task.
    let outcome: { ok: true; value: T } | { ok: false; error: Error };
    try {
      if (write && this.hooks.failWrites(store)) throw new Error('Simulated write failure');
      outcome = { ok: true, value: run() };
    } catch (error) {
      outcome = { ok: false, error: error as Error };
    }
    setTimeout(() => {
      this.pending--;
      if (outcome.ok) {
        request.result = outcome.value;
        request.onsuccess?.();
      } else {
        request.error = outcome.error;
        this.error = outcome.error;
        request.onerror?.();
        this.onerror?.();
        this.onabort?.();
        this.finished = true;
        return;
      }
      setTimeout(() => this.settle(), 0);
    }, 0);
    return request;
  }

  private settle(): void {
    if (this.finished || this.pending > 0) return;
    this.finished = true;
    this.oncomplete?.();
  }
}

class FakeObjectStore {
  constructor(
    private readonly store: FakeStore,
    private readonly tx: FakeTransaction,
  ) {}

  get(key: Key): Req<unknown> {
    return this.tx.request(() => {
      const index = this.store.find(key);
      return index < 0 ? undefined : clone(this.store.rows[index]!.value);
    }, false);
  }

  getAll(range?: Range): Req<unknown[]> {
    return this.tx.request(
      () =>
        this.store.rows.filter((r) => !range || inRange(r.key, range)).map((r) => clone(r.value)),
      false,
    );
  }

  count(range?: Range): Req<number> {
    return this.tx.request(
      () => this.store.rows.filter((r) => !range || inRange(r.key, range)).length,
      false,
    );
  }

  put(value: Record<string, unknown>): Req<Key> {
    return this.tx.request(
      () => {
        const key = pathValue(value, this.store.keyPath);
        const copy = clone(value);
        const index = this.store.find(key);
        if (index >= 0) this.store.rows[index] = { key, value: copy };
        else {
          this.store.rows.push({ key, value: copy });
          this.store.rows.sort((a, b) => compareKeys(a.key, b.key));
        }
        return key;
      },
      true,
      this.store.name,
    );
  }

  delete(target: Key | Range): Req<undefined> {
    return this.tx.request(
      () => {
        const keep = this.store.rows.filter((r) =>
          isRange(target) ? !inRange(r.key, target) : compareKeys(r.key, target) !== 0,
        );
        this.store.rows.length = 0;
        this.store.rows.push(...keep);
        return undefined;
      },
      true,
      this.store.name,
    );
  }
}

class FakeDatabase {
  readonly stores = new Map<string, FakeStore>();
  version = 0;
  readonly objectStoreNames = {
    contains: (name: string): boolean => this.stores.has(name),
  };

  constructor(private readonly hooks: { failWrites: (store: string) => boolean }) {}

  createObjectStore(name: string, options: { keyPath: string | readonly string[] }): FakeStore {
    const store = new FakeStore(name, options.keyPath);
    this.stores.set(name, store);
    return store;
  }

  transaction(
    names: string | string[],
    mode: 'readonly' | 'readwrite' = 'readonly',
  ): FakeTransaction {
    const list = Array.isArray(names) ? names : [names];
    return new FakeTransaction(this.stores, list, mode, this.hooks);
  }

  close(): void {}
}

export interface FakeIdb {
  env: IdbEnvironment;
  /** Make every write transaction fail while true. */
  failWrites: boolean;
  /** Make writes to these object stores fail (other stores still write). */
  failStores: string[];
  /** Version the named database was created with (undefined if never opened). */
  versionOf(name: string): number | undefined;
  /** Rows of one store of the default database, for assertions on what was written. */
  rows<T>(store: string, name?: string): T[];
}

export function createFakeIdb(): FakeIdb {
  const databases = new Map<string, FakeDatabase>();
  const state = { failWrites: false, failStores: [] as string[] };
  const hooks = {
    failWrites: (store: string) => state.failWrites || state.failStores.includes(store),
  };

  const factory = {
    open(name: string, version: number) {
      const request = {
        result: undefined as unknown,
        error: null as Error | null,
        onupgradeneeded: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onblocked: null as (() => void) | null,
      };
      setTimeout(() => {
        let db = databases.get(name);
        if (db && version < db.version) {
          request.error = new Error('VersionError');
          request.onerror?.();
          return;
        }
        const fresh = !db || version > db.version;
        if (!db) {
          db = new FakeDatabase(hooks);
          databases.set(name, db);
        }
        request.result = db;
        if (fresh) {
          db.version = version;
          request.onupgradeneeded?.();
        }
        request.onsuccess?.();
      }, 0);
      return request;
    },
  } as unknown as IDBFactory;

  const keyRange = {
    bound: (lower: Key, upper: Key): Range => ({ lower, upper }),
  } as unknown as Pick<typeof IDBKeyRange, 'bound'>;

  return {
    env: { factory, keyRange },
    get failWrites() {
      return state.failWrites;
    },
    set failWrites(value: boolean) {
      state.failWrites = value;
    },
    get failStores() {
      return state.failStores;
    },
    set failStores(value: string[]) {
      state.failStores = value;
    },
    versionOf: (name) => databases.get(name)?.version,
    rows: <T>(store: string, name = 'blockcraft-saves'): T[] =>
      (databases.get(name)?.stores.get(store)?.rows ?? []).map((r) => clone(r.value) as T),
  };
}
