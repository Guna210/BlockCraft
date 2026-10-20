import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerChestBlockEntity } from '../../src/gameplay/chests';
import { registerKilnBlockEntity } from '../../src/gameplay/kiln';
import { registerCurrentBlockEntities } from '../../src/gameplay/current';
import { TickLoop } from '../../src/engine/loop';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { getWorldTime, resetWorldTime, setWorldTime } from '../../src/world/time';
import { World } from '../../src/world/world';
import { weatherManager } from '../../src/world/weather';
import { SaveManager, type SaveSession } from '../../src/persist/save-manager';
import { applyRestoredColumn, applyWorldRecord, readPlayerData } from '../../src/persist/restore';
import { createFakeIdb, type FakeIdb } from './helpers/fake-idb';

const Y = 65;

function session(world: World, name = 'w'): SaveSession {
  return {
    name,
    seedString: 'seed',
    worldType: 'default',
    world,
    player: () => null,
    items: () => null,
  };
}

function manager(fake: FakeIdb): SaveManager {
  return new SaveManager({ env: () => fake.env });
}

async function startWorld(fake: FakeIdb, world: World, name = 'w'): Promise<SaveManager> {
  const saves = manager(fake);
  saves.attach(session(world, name), await saves.create(name));
  return saves;
}

async function reload(fake: FakeIdb, name = 'w'): Promise<{ world: World; saves: SaveManager }> {
  const saves = manager(fake);
  const loaded = await saves.load(name);
  const world = new World(false);
  saves.attach(session(world, name), loaded.store, loaded.record.createdAt);
  applyWorldRecord(world, loaded.record);
  for (const { cx, cz } of [...loaded.store.all()])
    applyRestoredColumn(world, (await saves.restoreColumn(cx, cz))!);
  return { world, saves };
}

const sleep = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (condition()) return;
    await sleep(1);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

describe('M17b review — world metadata through the real save and load path', () => {
  beforeEach(() => {
    BlockRegistry.getInstance();
    registerChestBlockEntity();
    registerKilnBlockEntity();
    registerCurrentBlockEntities();
  });
  afterEach(() => {
    weatherManager.reset();
    resetWorldTime();
  });

  it('weather (thunder, manual override, strike counter, clocks) and the day time survive', async () => {
    const fake = createFakeIdb();
    const world = new World(false);
    world.setBlock(0, Y, 0, 'stone');
    weatherManager.setState({
      weather: 'thunder',
      manualOverride: true,
      strikeCounter: 7,
      lastTick: 123,
      elapsed: 456,
    });
    setWorldTime(9876);
    for (let i = 0; i < 5; i++) world.tick();
    const saves = await startWorld(fake, world);
    await saves.save('manual');

    weatherManager.reset();
    resetWorldTime();
    expect(weatherManager.getState().weather).toBe('clear');
    const { world: restored } = await reload(fake);
    expect(weatherManager.getState()).toEqual({
      weather: 'thunder',
      manualOverride: true,
      strikeCounter: 7,
      lastTick: 123,
      elapsed: 456,
    });
    expect(getWorldTime()).toBe(9876);
    expect(restored.ticks.time).toBe(world.ticks.time);
  });

  it('a clear sky with no override and zero counters round-trips as well', async () => {
    const fake = createFakeIdb();
    const world = new World(false);
    world.setBlock(0, Y, 0, 'stone');
    weatherManager.setState({
      weather: 'rain',
      manualOverride: false,
      strikeCounter: 0,
      lastTick: -1,
      elapsed: 0,
    });
    await (await startWorld(fake, world)).save('manual');
    weatherManager.reset();
    await reload(fake);
    expect(weatherManager.getState()).toEqual({
      weather: 'rain',
      manualOverride: false,
      strikeCounter: 0,
      lastTick: -1,
      elapsed: 0,
    });
  });
});

describe('M17b review — save triggers', () => {
  beforeEach(() => {
    BlockRegistry.getInstance();
  });

  async function dirtyWorld(fake: FakeIdb): Promise<{ world: World; saves: SaveManager }> {
    const world = new World(false);
    world.setBlock(1, Y, 1, 'stone');
    return { world, saves: await startWorld(fake, world) };
  }

  it('TickLoop.onPause saves, once, on the running → paused edge only', async () => {
    const fake = createFakeIdb();
    const { saves } = await dirtyWorld(fake);
    const loop = new TickLoop(() => undefined);
    loop.onPause = () => saves.saveSoon('pause');
    loop.pause();
    await until(() => fake.rows('regions').length === 1, 'the pause save');
    expect(saves.stats.runs).toBe(1);
    loop.pause();
    await sleep(20);
    expect(saves.stats.runs).toBe(1);
  });

  it('a hidden page saves; a visible one does not', async () => {
    const fake = createFakeIdb();
    const { saves } = await dirtyWorld(fake);
    saves.installPageHooks();
    saves.installPageHooks();
    const state = { value: 'visible' };
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => state.value,
    });
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      await sleep(20);
      expect(saves.stats.runs).toBe(0);
      state.value = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
      await until(() => fake.rows('regions').length === 1, 'the hidden save');
      expect(saves.stats.runs).toBe(1);
    } finally {
      delete (document as unknown as Record<string, unknown>).visibilityState;
    }
  });

  it('pagehide saves', async () => {
    const fake = createFakeIdb();
    const { saves } = await dirtyWorld(fake);
    saves.installPageHooks();
    window.dispatchEvent(new Event('pagehide'));
    await until(() => fake.rows('regions').length === 1, 'the pagehide save');
  });

  it('exit saves what changed, then detaches', async () => {
    const fake = createFakeIdb();
    const { saves } = await dirtyWorld(fake);
    await saves.exit();
    expect(fake.rows('regions')).toHaveLength(1);
    expect(fake.rows('worlds')).toHaveLength(1);
    expect(saves.session).toBeNull();
    await expect(saves.save('manual')).rejects.toThrow(/No world is open/);
  });
});

describe('M17b review — saves that overlap edits and unloads', () => {
  beforeEach(() => {
    BlockRegistry.getInstance();
  });

  it('an edit made while a save runs is stored by the next save, not lost to the first', async () => {
    const fake = createFakeIdb();
    const world = new World(false);
    world.setBlock(1, Y, 1, 'stone');
    const saves = await startWorld(fake, world);
    const first = saves.save('manual');
    await until(() => saves.has(0, 0), 'the first capture');
    // The column was captured and cleaned; this edit lands in it mid-run.
    world.setBlock(2, Y, 2, 'dirt');
    expect(world.modifiedColumns.size).toBe(1);
    const second = saves.save('manual');
    await Promise.all([first, second]);

    const { world: restored } = await reload(fake);
    expect(restored.getBlock(1, Y, 1).id).toBe('stone');
    expect(restored.getBlock(2, Y, 2).id).toBe('dirt');
  });

  it('a column unloaded while the region loop runs is kept, and the player and world still land', async () => {
    const fake = createFakeIdb();
    const world = new World(false);
    // Three regions (32 columns each): x = 0, 600, 1200.
    for (const x of [1, 600, 1200]) world.setBlock(x, Y, 1, 'stone');
    const saves = await startWorld(fake, world);
    const run = saves.save('manual');
    await until(() => fake.rows('regions').length >= 1, 'the first region write');
    // Edit and drop the last region's column in the middle of the loop.
    world.setBlock(1201, Y, 2, 'dirt');
    saves.onColumnUnload(world, 75, 0);
    world.removeColumn(75, 0);
    await run;
    expect(fake.rows('worlds')).toHaveLength(1);
    await saves.save('manual');

    const { world: restored } = await reload(fake);
    expect(restored.getBlock(1200, Y, 1).id).toBe('stone');
    expect(restored.getBlock(1201, Y, 2).id).toBe('dirt');
    expect(saves.stats.failures).toBe(0);
  });

  it('a region that cannot be written does not stop the world record, and the next save retries it', async () => {
    const fake = createFakeIdb();
    const world = new World(false);
    world.setBlock(1, Y, 1, 'stone');
    world.setBlock(600, Y, 1, 'stone');
    const saves = await startWorld(fake, world);
    fake.failStores = ['regions'];
    await expect(saves.save('manual')).rejects.toThrow();
    // The records of the world were still written; the regions were not.
    expect(fake.rows('worlds')).toHaveLength(1);
    expect(fake.rows('entities')).toHaveLength(1);
    expect(fake.rows('regions')).toHaveLength(0);
    expect(saves.stats.failures).toBe(1);

    fake.failStores = [];
    await saves.save('manual');
    expect(fake.rows('regions')).toHaveLength(2);
  });
});

describe('M17b review — damaged and newer records', () => {
  beforeEach(() => {
    BlockRegistry.getInstance();
  });

  async function savedWorld(fake: FakeIdb): Promise<SaveManager> {
    const world = new World(false);
    world.setBlock(1, Y, 1, 'stone');
    const saves = await startWorld(fake, world);
    await saves.save('manual');
    return saves;
  }

  it('a garbled column fails to restore, so the game regenerates it', async () => {
    const fake = createFakeIdb();
    const saves = await savedWorld(fake);
    const [record] = fake.rows<{ columns: Array<{ data: Uint8Array }> }>('regions');
    record!.columns[0]!.data = Uint8Array.from({ length: 64 }, (_, i) => (i * 37 + 11) & 255);
    await (await saves.open()).write([{ op: 'put', store: 'regions', value: record! }]);

    const loaded = await manager(fake).load('w');
    const fresh = manager(fake);
    fresh.attach(session(new World(false)), loaded.store);
    await expect(fresh.restoreColumn(0, 0)!).rejects.toThrow();
  });

  it('a record from a newer game is refused for regions and for worlds', async () => {
    const fake = createFakeIdb();
    const saves = await savedWorld(fake);
    const db = await saves.open();
    const [region] = fake.rows<{ formatVersion: number }>('regions');
    await db.write([{ op: 'put', store: 'regions', value: { ...region!, formatVersion: 2 } }]);
    await expect(manager(fake).load('w')).rejects.toThrow(/future version 2/);

    await db.write([{ op: 'put', store: 'regions', value: region! }]);
    const [record] = fake.rows<{ formatVersion: number }>('worlds');
    await db.write([{ op: 'put', store: 'worlds', value: { ...record!, formatVersion: 9 } }]);
    await expect(manager(fake).load('w')).rejects.toThrow(/future version 9/);
  });

  it('player data that is not a player record is rejected with an error', () => {
    expect(() =>
      readPlayerData({
        world: 'w',
        player: 'local',
        formatVersion: 1,
        data: Uint8Array.from([1, 2, 3]),
        inventory: new Uint8Array(0),
      }),
    ).toThrow();
  });
});
