import { beforeEach, describe, expect, it } from 'vitest';
import { registerChestBlockEntity, type ChestEntityState } from '../../src/gameplay/chests';
import { registerKilnBlockEntity, type KilnState } from '../../src/gameplay/kiln';
import { registerCurrentBlockEntities } from '../../src/gameplay/current';
import { PISTON_MOVE_TICKS } from '../../src/gameplay/mechanics';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { World } from '../../src/world/world';
import { SaveManager, type SaveSession } from '../../src/persist/save-manager';
import { applyRestoredColumn, applyWorldRecord } from '../../src/persist/restore';
import { regionOf } from '../../src/persist/world-store';
import { createFakeIdb, type FakeIdb } from './helpers/fake-idb';

const Y = 65;

function makeWorld(): World {
  return new World(false);
}

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

function manager(
  fake: FakeIdb,
  options: { now?: () => number; autosaveIntervalMs?: number } = {},
): SaveManager {
  return new SaveManager({ env: () => fake.env, ...options });
}

async function startWorld(fake: FakeIdb, world: World, name = 'w'): Promise<SaveManager> {
  const saves = manager(fake);
  const store = await saves.create(name);
  saves.attach(session(world, name), store);
  return saves;
}

/** Loads the saved world `name` into a brand-new World, the way a reload does. */
async function reload(fake: FakeIdb, name = 'w'): Promise<{ world: World; saves: SaveManager }> {
  const saves = manager(fake);
  const loaded = await saves.load(name);
  const world = makeWorld();
  saves.attach(session(world, name), loaded.store, loaded.record.createdAt);
  applyWorldRecord(world, loaded.record);
  const columns = [...loaded.store.all()].map((c) => ({ cx: c.cx, cz: c.cz }));
  for (const { cx, cz } of columns)
    applyRestoredColumn(world, (await saves.restoreColumn(cx, cz))!);
  return { world, saves };
}

describe('M17b — saving and restoring a world', () => {
  beforeEach(() => {
    BlockRegistry.getInstance();
    registerChestBlockEntity();
    registerKilnBlockEntity();
    registerCurrentBlockEntities();
  });

  it('saves only modified columns; untouched regions have no record at all', async () => {
    const fake = createFakeIdb();
    const world = makeWorld();
    // Columns the generator would write directly never mark themselves modified.
    world.getColumn(5, 5, true);
    world.getColumn(100, 100, true);
    world.setBlock(3, Y, 3, 'stone');
    const saves = await startWorld(fake, world);
    await saves.save('manual');

    const regions = fake.rows<{ rx: number; rz: number; columns: unknown[] }>('regions');
    expect(regions).toHaveLength(1);
    expect(regions[0]!.columns).toHaveLength(1);
    expect(saves.bytesOfRegion(regionOf(100, 100).rx, regionOf(100, 100).rz)).toBe(0);
    expect(saves.has(5, 5)).toBe(false);
    expect(saves.has(0, 0)).toBe(true);
  });

  it('round-trips edits, the break counter and the tick clock into a fresh world', async () => {
    const fake = createFakeIdb();
    const world = makeWorld();
    world.setBlock(1, Y, 2, 'stone');
    world.setBlock(-20, Y, 40, 'oak_planks');
    world.breakCount = 42;
    for (let i = 0; i < 7; i++) world.tick();
    const saves = await startWorld(fake, world);
    await saves.save('manual');

    const { world: restored } = await reload(fake);
    expect(restored.getBlock(1, Y, 2).id).toBe('stone');
    expect(restored.getBlock(-20, Y, 40).id).toBe('oak_planks');
    expect(restored.breakCount).toBe(42);
    expect(restored.ticks.time).toBe(world.ticks.time);
    // Restoring is not an edit: nothing is dirty until the player changes something.
    expect(restored.modifiedColumns.size).toBe(0);
  });

  it('keeps the world records of different worlds apart', async () => {
    const fake = createFakeIdb();
    const a = makeWorld();
    a.setBlock(0, Y, 0, 'stone');
    const savesA = await startWorld(fake, a, 'a');
    await savesA.save('manual');
    const b = makeWorld();
    b.setBlock(0, Y, 0, 'dirt');
    const savesB = await startWorld(fake, b, 'b');
    await savesB.save('manual');

    expect((await reload(fake, 'a')).world.getBlock(0, Y, 0).id).toBe('stone');
    expect((await reload(fake, 'b')).world.getBlock(0, Y, 0).id).toBe('dirt');
    await expect(manager(fake).load('missing')).rejects.toThrow(/No saved world/);
    expect((await manager(fake).listWorlds()).map((w) => w.name).sort()).toEqual(['a', 'b']);
  });

  it('creating a world with an existing name replaces the old records', async () => {
    const fake = createFakeIdb();
    const old = makeWorld();
    old.setBlock(0, Y, 0, 'stone');
    await (await startWorld(fake, old)).save('manual');
    const fresh = makeWorld();
    await (await startWorld(fake, fresh)).save('manual');
    expect(fake.rows('regions')).toHaveLength(0);
  });

  it('a column unloaded after an edit is captured, and the edit survives', async () => {
    const fake = createFakeIdb();
    const world = makeWorld();
    const saves = await startWorld(fake, world);
    world.setBlock(2, Y, 2, 'stone');
    saves.onColumnUnload(world, 0, 0);
    world.removeColumn(0, 0);
    await saves.save('manual');

    const { world: restored } = await reload(fake);
    expect(restored.getBlock(2, Y, 2).id).toBe('stone');
  });

  it('autosaves when 60 s have passed on the clock, not before', async () => {
    const fake = createFakeIdb();
    let clock = 0;
    const world = makeWorld();
    const saves = manager(fake, { now: () => clock });
    saves.attach(session(world), await saves.create('w'));
    world.setBlock(0, Y, 0, 'stone');

    clock = 59_999;
    saves.frame();
    expect(saves.stats.autosaves).toBe(0);
    clock = 60_000;
    saves.frame();
    expect(saves.stats.autosaves).toBe(1);
    // Frames advance a running autosave; it finishes without help from timers alone.
    for (let i = 0; i < 200 && fake.rows('regions').length === 0; i++) {
      saves.frame();
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(fake.rows('regions')).toHaveLength(1);
  });

  it('a failing write is counted and retried by the next save', async () => {
    const fake = createFakeIdb();
    const world = makeWorld();
    world.setBlock(0, Y, 0, 'stone');
    const saves = await startWorld(fake, world);
    fake.failWrites = true;
    await expect(saves.save('manual')).rejects.toThrow();
    expect(saves.stats.failures).toBe(1);
    fake.failWrites = false;
    await saves.save('manual');
    expect(fake.rows('regions')).toHaveLength(1);
  });

  describe('block entities', () => {
    it('restores chest contents and a kiln mid-smelt, which then keeps smelting', async () => {
      const fake = createFakeIdb();
      const world = makeWorld();
      world.setBlock(0, Y, 0, 'chest', { facing: 'north', pair: 'single' });
      world.setBlock(2, Y, 0, 'kiln');
      const chest = world.blockEntities.getState<ChestEntityState>(0, Y, 0)!;
      chest.slots[3] = { id: 'iron_ingot', count: 12, damage: null };
      const kiln = world.blockEntities.getState<KilnState>(2, Y, 0)!;
      kiln.input = { id: 'raw_iron', count: 4, damage: null };
      kiln.fuel = { id: 'coal', count: 2, damage: null };
      for (let i = 0; i < 60; i++) world.tick();
      const progress = kiln.cookProgress;
      const burn = kiln.burnRemaining;
      expect(progress).toBeGreaterThan(0);
      expect(burn).toBeGreaterThan(0);

      // Block entities change without block edits, so no edit is needed to be saved.
      const saves = await startWorld(fake, world);
      await saves.save('manual');
      const { world: restored } = await reload(fake);

      const chestAfter = restored.blockEntities.getState<ChestEntityState>(0, Y, 0)!;
      expect(chestAfter.slots[3]).toEqual({ id: 'iron_ingot', count: 12, damage: null });
      const kilnAfter = restored.blockEntities.getState<KilnState>(2, Y, 0)!;
      expect(kilnAfter.cookProgress).toBe(progress);
      expect(kilnAfter.burnRemaining).toBe(burn);
      expect(kilnAfter.input).toEqual(kiln.input);

      for (let i = 0; i < 20; i++) restored.tick();
      expect(kilnAfter.cookProgress).toBe(progress + 20);
      expect(kilnAfter.burnRemaining).toBe(burn - 20);
    });

    it('restores a dispenser’s slots', async () => {
      const fake = createFakeIdb();
      const world = makeWorld();
      world.setBlock(0, Y, 0, 'dispenser', { facing: 'east', triggered: 'false' });
      const slots = world.blockEntities.getContainer(0, Y, 0)!.slots as Array<unknown>;
      slots[4] = { id: 'arrow', count: 9 };
      await (await startWorld(fake, world)).save('manual');
      const { world: restored } = await reload(fake);
      expect(restored.blockEntities.getContainer(0, Y, 0)!.slots[4]).toEqual({
        id: 'arrow',
        count: 9,
      });
    });
  });

  describe('scheduled block ticks', () => {
    it('keep their remaining delay against the new clock, however far the clocks differ', async () => {
      const fake = createFakeIdb();
      const world = makeWorld();
      world.setBlock(0, Y, 0, 'stone');
      for (let i = 0; i < 100; i++) world.tick();
      world.ticks.schedule({ x: 1, y: Y, z: 1, type: 'test_tick' }, 30);
      const saved = world.ticks.getPendingTicks().find((t) => t.type === 'test_tick')!;
      expect(saved.due - world.ticks.time).toBe(30);
      await (await startWorld(fake, world)).save('manual');

      const saves = manager(fake);
      const loaded = await saves.load('w');
      const restored = makeWorld();
      saves.attach(session(restored), loaded.store);
      applyWorldRecord(restored, loaded.record);
      restored.ticks.time = 5000; // the world clock restarted somewhere else
      for (const { cx, cz } of [...loaded.store.all()])
        applyRestoredColumn(restored, (await saves.restoreColumn(cx, cz))!);
      const tick = restored.ticks.getPendingTicks().find((t) => t.type === 'test_tick')!;
      expect(tick.due - restored.ticks.time).toBe(30);
    });

    it('addRebased never schedules in the past and skips an already pending tick', () => {
      const world = makeWorld();
      world.ticks.time = 500;
      world.ticks.addRebased(
        [
          { x: 0, y: 0, z: 0, type: 'a', due: 10, priority: 0, order: 0 }, // overdue when saved
          { x: 1, y: 0, z: 0, type: 'a', due: 910, priority: 0, order: 1 },
        ],
        900,
      );
      const due = world.ticks
        .getPendingTicks()
        .map((t) => t.due - 500)
        .sort((a, b) => a - b);
      expect(due).toEqual([1, 10]);
      world.ticks.addRebased(
        [{ x: 1, y: 0, z: 0, type: 'a', due: 5000, priority: 0, order: 0 }],
        900,
      );
      expect(world.ticks.getPendingTicks()).toHaveLength(2);
    });
  });

  describe('M15a — Current logic after reload', () => {
    it('a lever-driven trace is settled once, and keeps responding to the lever', async () => {
      const fake = createFakeIdb();
      const world = makeWorld();
      world.setBlock(-1, Y, 0, 'lever', { face: 'floor', powered: 'true' });
      for (let x = 0; x < 6; x++) world.setBlock(x, Y, 0, 'copper_trace');
      expect(world.getBlock(3, Y, 0).state.power).toBe('12');
      await (await startWorld(fake, world)).save('manual');

      const { world: restored } = await reload(fake);
      expect(restored.getBlock(3, Y, 0).state.power).toBe('12');

      // The components were registered on load, so switching the lever off still cuts the circuit.
      const lever = restored.getBlock(-1, Y, 0);
      const off = BlockRegistry.getInstance().getStateId('lever', {
        ...lever.state,
        powered: 'false',
      })!;
      restored.setBlockStateId(-1, Y, 0, off);
      expect(restored.getBlock(3, Y, 0).state.power).toBe('0');
      const on = BlockRegistry.getInstance().getStateId('lever', {
        ...lever.state,
        powered: 'true',
      })!;
      restored.setBlockStateId(-1, Y, 0, on);
      expect(restored.getBlock(3, Y, 0).state.power).toBe('12');
    });
  });

  describe('M15b — Mechanics after reload', () => {
    it('a piston extended before the save is saved settled and retracts after reload', async () => {
      const fake = createFakeIdb();
      const world = makeWorld();
      world.setBlock(0, Y, 0, 'piston', { facing: 'east', extended: 'false' });
      world.setBlock(1, Y, 0, 'stone');
      world.setBlock(0, Y + 1, 0, 'lever', { face: 'floor', powered: 'true' });
      expect(world.getBlock(0, Y, 0).state.extended).toBe('true');
      // The push is still in flight: the save lands it first.
      expect(world.current.mechanics.movingBlocks().length).toBeGreaterThan(0);
      const saves = await startWorld(fake, world);
      await saves.save('manual');
      expect(world.current.mechanics.movingBlocks()).toEqual([]);

      const { world: restored } = await reload(fake);
      expect(restored.current.mechanics.movingBlocks()).toEqual([]);
      expect(restored.getBlock(1, Y, 0).id).toBe('piston_head');
      expect(restored.getBlock(2, Y, 0).id).toBe('stone');

      const lever = restored.getBlock(0, Y + 1, 0);
      const off = BlockRegistry.getInstance().getStateId('lever', {
        ...lever.state,
        powered: 'false',
      })!;
      restored.setBlockStateId(0, Y + 1, 0, off);
      for (let i = 0; i < PISTON_MOVE_TICKS + 2; i++) restored.tick();
      expect(restored.getBlock(0, Y, 0).state.extended).toBe('false');
      expect(restored.getBlock(1, Y, 0).id).not.toBe('piston_head');
    });

    it('a powered door stays open after reload and closes when power goes', async () => {
      const fake = createFakeIdb();
      const world = makeWorld();
      world.setBlock(0, Y, 0, 'oak_door', { half: 'lower', facing: 'north' });
      world.setBlock(0, Y + 1, 0, 'oak_door', { half: 'upper', facing: 'north' });
      world.setBlock(1, Y, 0, 'copper_trace');
      world.setBlock(2, Y, 0, 'lever', { face: 'floor', powered: 'true' });
      expect(world.getBlock(0, Y, 0).state.open).toBe('true');
      await (await startWorld(fake, world)).save('manual');

      const { world: restored } = await reload(fake);
      expect(restored.getBlock(0, Y, 0).state.open).toBe('true');
      const lever = restored.getBlock(2, Y, 0);
      const off = BlockRegistry.getInstance().getStateId('lever', {
        ...lever.state,
        powered: 'false',
      })!;
      restored.setBlockStateId(2, Y, 0, off);
      expect(restored.getBlock(0, Y, 0).state.open).toBe('false');
      expect(restored.getBlock(0, Y + 1, 0).state.open).toBe('false');
    });
  });
});
