import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockCollision } from '../../src/entity/physics';
import { Player } from '../../src/entity/player';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { World } from '../../src/world/world';
import { SaveManager, type SaveSession } from '../../src/persist/save-manager';
import { applyRestoredColumn } from '../../src/persist/restore';
import { createFakeIdb } from './helpers/fake-idb';

// Compression of a column that unloads during the region loop is still running when the region
// is built. `deflate` is held back here so that is certain, not a matter of timing.
const gate = vi.hoisted(() => ({
  hold: false,
  open: Promise.resolve(),
  release: (): void => undefined,
}));

vi.mock('../../src/persist/compress', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/persist/compress')>();
  return {
    ...actual,
    deflate: async (data: Uint8Array): Promise<Uint8Array> => {
      if (gate.hold) await gate.open;
      return actual.deflate(data);
    },
  };
});

const Y = 65;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('M17b — a column still compressing when its region is written', () => {
  beforeEach(() => {
    BlockRegistry.getInstance();
    gate.hold = false;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    gate.hold = false;
  });

  it('the run waits for it: it completes, the world and player land, and the column is stored', async () => {
    const fake = createFakeIdb();
    const world = new World(false);
    const player = new Player(new BlockCollision(world), () => true);
    world.setBlock(1, Y, 1, 'stone');
    const session: SaveSession = {
      name: 'w',
      seedString: 'seed',
      worldType: 'default',
      world,
      player: () => player,
      items: () => null,
    };
    const saves = new SaveManager({ env: () => fake.env });
    saves.attach(session, await saves.create('w'));
    // Let the warm-up (which compresses too) finish before anything is held back.
    await sleep(50);

    // On the region step's first yield, column (1, 0) is edited and unloaded, with its
    // compression held: the region loop then finds a column that is not compressed yet.
    const internals = SaveManager.prototype as unknown as {
      yieldSlice: (mode: string) => Promise<void>;
    };
    const original = internals.yieldSlice;
    let injected = false;
    vi.spyOn(internals, 'yieldSlice').mockImplementation(function (this: SaveManager, mode) {
      if (!injected) {
        injected = true;
        gate.hold = true;
        gate.open = new Promise((resolve) => (gate.release = resolve));
        world.setBlock(17, Y, 1, 'dirt');
        saves.onColumnUnload(world, 1, 0);
        world.removeColumn(1, 0);
        setTimeout(() => gate.release(), 30);
      }
      return original.call(this, mode);
    });

    await saves.save('manual');

    expect(injected).toBe(true);
    expect(saves.stats.failures).toBe(0);
    expect(fake.rows('worlds')).toHaveLength(1);
    expect(fake.rows('players')).toHaveLength(1);
    const regions = fake.rows<{ columns: Array<{ cx: number; cz: number }> }>('regions');
    expect(regions).toHaveLength(1);
    expect(regions[0]!.columns.map((c) => c.cx).sort()).toEqual([0, 1]);

    // And the unloaded column's edit is really in the database.
    const reloaded = new SaveManager({ env: () => fake.env });
    const loaded = await reloaded.load('w');
    const fresh = new World(false);
    reloaded.attach({ ...session, world: fresh }, loaded.store);
    applyRestoredColumn(fresh, (await reloaded.restoreColumn(1, 0))!);
    expect(fresh.getBlock(17, Y, 1).id).toBe('dirt');
  });
});
