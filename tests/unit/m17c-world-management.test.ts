import { describe, expect, it, vi } from 'vitest';
import { api } from '../../src/debug/api/core';
import '../../src/debug/api/persist';
import { SaveDb, WORLD_STORE_NAMES } from '../../src/persist/idb';
import { SaveManager } from '../../src/persist/save-manager';
import { createFakeIdb } from './helpers/fake-idb';
import { World } from '../../src/world/world';
import { WorldManager } from '../../src/world/world-manager';
import { formatWorldListTime } from '../../src/ui/world-list-screen';

async function saveWorldRecords(db: SaveDb, name: string, marker: string): Promise<void> {
  await db.write([
    { op: 'put', store: 'worlds', value: { name, marker } },
    {
      op: 'put',
      store: 'regions',
      value: { world: name, dim: 'overworld', rx: -1, rz: 2, marker },
    },
    { op: 'put', store: 'players', value: { world: name, player: 'local', marker } },
    { op: 'put', store: 'entities', value: { world: name, dim: 'overworld', marker } },
    {
      op: 'put',
      store: 'blockEntities',
      value: { world: name, dim: 'overworld', rx: -1, rz: 2, marker },
    },
  ]);
}

describe('M17c — world record management', () => {
  it('formats last-played dates with the local 24-hour clock', () => {
    const localDate = new Date(2026, 8, 7, 4, 5);
    expect(formatWorldListTime(localDate.getTime())).toBe('2026-09-07 04:05');
  });

  it('lists a world without a thumbnail as hasThumbnail false and loads it', async () => {
    const fake = createFakeIdb();
    const saves = new SaveManager({ env: () => fake.env });
    const world = new World(false);
    saves.attach(
      {
        name: 'No Thumbnail',
        seedString: 'seed',
        worldType: 'default',
        world,
        player: () => null,
        items: () => null,
      },
      await saves.create('No Thumbnail'),
    );
    await saves.save('hidden');

    const getInstance = vi
      .spyOn(WorldManager, 'getInstance')
      .mockReturnValue({ saves } as unknown as WorldManager);
    try {
      await expect(api.listWorlds?.()).resolves.toEqual([
        {
          name: 'No Thumbnail',
          lastPlayed: expect.any(Number),
          hasThumbnail: false,
        },
      ]);
    } finally {
      getInstance.mockRestore();
    }

    const loaded = await new SaveManager({ env: () => fake.env }).load('No Thumbnail');
    expect(loaded.record.name).toBe('No Thumbnail');
    expect(loaded.record.thumbnail).toBeUndefined();
  });

  it('renames every store in one operation and preserves other worlds', async () => {
    const db = await SaveDb.open(createFakeIdb().env);
    await saveWorldRecords(db, 'Garden', 'source');
    await saveWorldRecords(db, 'Other', 'untouched');

    await db.renameWorld('Garden', 'Meadow');

    expect(await db.get('worlds', 'Garden')).toBeUndefined();
    expect(await db.get<{ marker: string }>('worlds', 'Meadow')).toMatchObject({
      name: 'Meadow',
      marker: 'source',
    });
    for (const store of WORLD_STORE_NAMES) {
      if (store === 'worlds') {
        expect(await db.get('worlds', 'Other')).toEqual({ name: 'Other', marker: 'untouched' });
        continue;
      }
      const moved = await db.getByPrefix<{ world: string; marker: string }>(store, ['Meadow']);
      const untouched = await db.getByPrefix<{ world: string; marker: string }>(store, ['Other']);
      expect(moved).toHaveLength(1);
      expect(moved[0]!.marker).toBe('source');
      expect(untouched).toHaveLength(1);
      expect(untouched[0]!.marker).toBe('untouched');
    }
  });

  it('duplicates every store while preserving the source and rejects a name clash', async () => {
    const db = await SaveDb.open(createFakeIdb().env);
    await saveWorldRecords(db, 'Garden', 'source');
    await saveWorldRecords(db, 'Other', 'untouched');

    await db.duplicateWorld('Garden', 'Garden Copy');

    for (const store of WORLD_STORE_NAMES) {
      if (store === 'worlds') {
        expect(await db.get('worlds', 'Garden')).toEqual({ name: 'Garden', marker: 'source' });
        expect(await db.get('worlds', 'Garden Copy')).toEqual({
          name: 'Garden Copy',
          marker: 'source',
        });
        continue;
      }
      const source = await db.getByPrefix<{ world: string; marker: string }>(store, ['Garden']);
      const copy = await db.getByPrefix<{ world: string; marker: string }>(store, ['Garden Copy']);
      expect(source).toHaveLength(1);
      expect(source[0]!.marker).toBe('source');
      expect(copy).toHaveLength(1);
      expect(copy[0]!.marker).toBe('source');
    }

    await expect(db.duplicateWorld('Garden', 'Other')).rejects.toThrow(
      "A world named 'Other' already exists",
    );
    expect(await db.get('worlds', 'Other')).toEqual({ name: 'Other', marker: 'untouched' });
  });

  it('does not partially rename when the target name exists or source is missing', async () => {
    const db = await SaveDb.open(createFakeIdb().env);
    await saveWorldRecords(db, 'Garden', 'source');
    await saveWorldRecords(db, 'Other', 'untouched');

    await expect(db.renameWorld('Garden', 'Other')).rejects.toThrow(
      "A world named 'Other' already exists",
    );
    await expect(db.renameWorld('Missing', 'New')).rejects.toThrow(
      "No saved world named 'Missing'",
    );
    for (const store of WORLD_STORE_NAMES) {
      if (store === 'worlds') {
        expect(await db.get('worlds', 'Garden')).toEqual({ name: 'Garden', marker: 'source' });
        expect(await db.get('worlds', 'Other')).toEqual({ name: 'Other', marker: 'untouched' });
        continue;
      }
      const gardens = await db.getByPrefix(store, ['Garden']);
      const others = await db.getByPrefix(store, ['Other']);
      expect(gardens).toHaveLength(1);
      expect(others).toHaveLength(1);
    }
  });
});
