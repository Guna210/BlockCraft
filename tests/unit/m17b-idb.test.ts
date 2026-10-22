import { afterEach, describe, expect, it } from 'vitest';
import { DB_NAME, DB_VERSION, SaveDb, STORE_NAMES, WORLD_STORE_NAMES } from '../../src/persist/idb';
import {
  readPlayerRecord,
  readWorldRecord,
  type PlayerRecord,
  type WorldRecord,
} from '../../src/persist/world-store';
import { FORMAT_VERSION, migrations } from '../../src/persist/version';
import { createFakeIdb, compareKeys } from './helpers/fake-idb';

describe('M17b — IndexedDB wrapper', () => {
  afterEach(() => migrations.clear());

  it('creates the world and settings stores on first open', async () => {
    const fake = createFakeIdb();
    await SaveDb.open(fake.env);
    expect([...STORE_NAMES].sort()).toEqual([
      'blockEntities',
      'entities',
      'players',
      'regions',
      'settings',
      'worlds',
    ]);
    expect(fake.versionOf(DB_NAME)).toBe(DB_VERSION);
    for (const store of STORE_NAMES) expect(fake.rows(store)).toEqual([]);
  });

  it('puts, gets and deletes records by compound key', async () => {
    const db = await SaveDb.open(createFakeIdb().env);
    await db.write([
      { op: 'put', store: 'regions', value: { world: 'a', dim: 'overworld', rx: 0, rz: -1, n: 1 } },
      { op: 'put', store: 'regions', value: { world: 'a', dim: 'overworld', rx: 0, rz: 0, n: 2 } },
    ]);
    expect((await db.get<{ n: number }>('regions', ['a', 'overworld', 0, -1]))?.n).toBe(1);
    expect(await db.get('regions', ['a', 'overworld', 5, 5])).toBeUndefined();
    await db.write([{ op: 'delete', store: 'regions', key: ['a', 'overworld', 0, -1] }]);
    expect(await db.count('regions')).toBe(1);
  });

  it('stores typed arrays without sharing the caller’s buffer', async () => {
    const db = await SaveDb.open(createFakeIdb().env);
    const bytes = new Uint8Array([1, 2, 3]);
    await db.write([
      { op: 'put', store: 'entities', value: { world: 'w', dim: 'd', items: bytes } },
    ]);
    bytes[0] = 99;
    const read = await db.get<{ items: Uint8Array }>('entities', ['w', 'd']);
    expect([...read!.items]).toEqual([1, 2, 3]);
  });

  it('reads a key prefix: all records of one world and dimension, nothing else', async () => {
    const db = await SaveDb.open(createFakeIdb().env);
    const regions = [
      ['a', 'overworld', 0, 0],
      ['a', 'overworld', -3, 7],
      ['a', 'nether', 0, 0],
      ['ab', 'overworld', 0, 0],
      ['b', 'overworld', 0, 0],
    ] as const;
    await db.write(
      regions.map(([world, dim, rx, rz]) => ({
        op: 'put' as const,
        store: 'regions' as const,
        value: { world, dim, rx, rz },
      })),
    );
    expect(await db.getByPrefix('regions', ['a'])).toHaveLength(3);
    expect(await db.getByPrefix('regions', ['a', 'overworld'])).toHaveLength(2);
    expect(await db.count('regions', ['a', 'overworld'])).toBe(2);
    expect(await db.getByPrefix('regions', ['zz'])).toHaveLength(0);
  });

  it('deleteWorld removes the world from every store and leaves other worlds', async () => {
    const db = await SaveDb.open(createFakeIdb().env);
    for (const world of ['a', 'ab']) {
      await db.write([
        { op: 'put', store: 'worlds', value: { name: world } },
        { op: 'put', store: 'regions', value: { world, dim: 'overworld', rx: 0, rz: 0 } },
        { op: 'put', store: 'blockEntities', value: { world, dim: 'overworld', rx: 0, rz: 0 } },
        { op: 'put', store: 'players', value: { world, player: 'local' } },
        { op: 'put', store: 'entities', value: { world, dim: 'overworld' } },
      ]);
    }
    await db.write([
      { op: 'put', store: 'settings', value: { key: 'global', value: { fov: 80 } } },
    ]);
    await db.deleteWorld('a');
    for (const store of WORLD_STORE_NAMES) expect(await db.count(store)).toBe(1);
    expect(await db.count('settings')).toBe(1);
    expect(await db.get('settings', 'global')).toEqual({ key: 'global', value: { fov: 80 } });
    expect(await db.get('worlds', 'a')).toBeUndefined();
    expect(await db.get('worlds', 'ab')).toEqual({ name: 'ab' });
  });

  it('a write is all or nothing: a failed transaction leaves earlier data unchanged', async () => {
    const fake = createFakeIdb();
    const db = await SaveDb.open(fake.env);
    await db.write([{ op: 'put', store: 'worlds', value: { name: 'w', v: 1 } }]);
    fake.failWrites = true;
    await expect(
      db.write([{ op: 'put', store: 'worlds', value: { name: 'w', v: 2 } }]),
    ).rejects.toThrow();
    fake.failWrites = false;
    expect(await db.get('worlds', 'w')).toEqual({ name: 'w', v: 1 });
  });

  it('keeps data across close and reopen of the same database', async () => {
    const fake = createFakeIdb();
    const first = await SaveDb.open(fake.env);
    await first.write([{ op: 'put', store: 'worlds', value: { name: 'kept' } }]);
    first.close();
    const second = await SaveDb.open(fake.env);
    expect(await second.getAll('worlds')).toEqual([{ name: 'kept' }]);
  });

  it('orders keys like IndexedDB: numbers, strings, then arrays', () => {
    expect(compareKeys(1, 'a')).toBeLessThan(0);
    expect(compareKeys('a', [])).toBeLessThan(0);
    expect(compareKeys(['a', 1], ['a', 2])).toBeLessThan(0);
    expect(compareKeys(['a'], ['a', 0])).toBeLessThan(0);
    expect(compareKeys(['a', -1], ['a', 0])).toBeLessThan(0);
  });

  describe('migration hook', () => {
    const world = (formatVersion: number): WorldRecord => ({
      name: 'old',
      formatVersion,
      seedString: '',
      worldType: 'default',
      createdAt: 0,
      lastPlayed: 0,
      meta: new Uint8Array(),
      ticksTime: 0,
    });

    it('returns a current-version record as stored', async () => {
      const db = await SaveDb.open(createFakeIdb().env);
      await db.write([{ op: 'put', store: 'worlds', value: world(FORMAT_VERSION) }]);
      expect((await readWorldRecord(db, 'old'))?.formatVersion).toBe(FORMAT_VERSION);
      expect(await readWorldRecord(db, 'missing')).toBeUndefined();
    });

    it('runs a registered migration on an older record', async () => {
      const db = await SaveDb.open(createFakeIdb().env);
      migrations.register<WorldRecord>('worlds', 0, (record) => ({
        ...record,
        seedString: 'migrated',
        formatVersion: 1,
      }));
      await db.write([{ op: 'put', store: 'worlds', value: world(0) }]);
      const read = await readWorldRecord(db, 'old');
      expect(read?.seedString).toBe('migrated');
    });

    it('fails clearly when no migration exists, or the record comes from a newer game', async () => {
      const db = await SaveDb.open(createFakeIdb().env);
      await db.write([
        { op: 'put', store: 'worlds', value: world(0) },
        {
          op: 'put',
          store: 'players',
          value: {
            world: 'old',
            player: 'local',
            formatVersion: FORMAT_VERSION + 1,
          } as PlayerRecord,
        },
      ]);
      await expect(readWorldRecord(db, 'old')).rejects.toThrow(/No migration/);
      await expect(readPlayerRecord(db, 'old')).rejects.toThrow(/future version/);
    });
  });
});
