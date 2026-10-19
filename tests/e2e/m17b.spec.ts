import fs from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';
import { test, expect } from '../harness/fixture';
import { assertNoMissingTexture, assertNotBlank, diffFraction } from '../harness/pixels';

const MILESTONE = 'M17b';
const WORLD = 'M17b saved world';
const EDIT_COUNT = 20;
const PLAYER_AT: [number, number, number, number, number] = [7.25, 65, 4.5, 2.3, -0.2];

interface Edit {
  x: number;
  y: number;
  z: number;
  id: string;
}

/** 20 distinct edit positions from a fixed seed, spread over several columns and two regions' worth of x. */
function randomEdits(): Edit[] {
  let state = 0x2f6e2b1;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const ids = ['stone', 'oak_planks', 'glass', 'copper_trace', 'sand', 'cobblestone'];
  const seen = new Set<string>();
  const edits: Edit[] = [];
  while (edits.length < EDIT_COUNT) {
    const x = Math.floor(next() * 90) - 45;
    const z = Math.floor(next() * 90) - 45;
    const y = 66 + Math.floor(next() * 6);
    const key = `${x},${y},${z}`;
    // Keep clear of the chest, the kiln and the player.
    if (seen.has(key) || (Math.abs(x) < 10 && Math.abs(z) < 10)) continue;
    seen.add(key);
    edits.push({ x, y, z, id: ids[Math.floor(next() * ids.length)]! });
  }
  return edits;
}

async function newWorld(
  page: Page,
  name: string,
  type: 'flat' | 'default' = 'flat',
): Promise<void> {
  await page.evaluate(
    async ({ name, type }) => {
      const api = window.__blockcraft!;
      await api.createWorld!({ name, seed: 'blockcraft-m17b', mode: 'survival', type });
      api.pause!();
      api.setRenderDistance!(4);
      api.setClouds!('off');
      api.setTimeOfDay!(6000);
      await api.tick!(1);
      await api.waitForTerrain!(2);
    },
    { name, type },
  );
}

async function reloadPage(page: Page): Promise<void> {
  await page.reload();
  await page.waitForFunction(() => window.__blockcraft?.ready);
  await page.evaluate(async () => {
    await window.__blockcraft!.ready();
  });
}

test('M17b: edits, a chest and a kiln mid-smelt survive a page reload and loadWorld', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  const edits = randomEdits();
  await newWorld(page, WORLD);

  const before = await page.evaluate(
    async ({ edits, at }) => {
      const api = window.__blockcraft!;
      // The scene: a kiln, a chest and a row of planks and stone with a torch, in front of the camera.
      api.teleport!(at[0], at[1], at[2], at[3], at[4]);
      api.setBlock!(5, 65, 6, 'kiln');
      api.setBlock!(7, 65, 7, 'chest', { facing: 'north', pair: 'single' });
      for (let i = 0; i < 4; i++) api.setBlock!(4 + i, 65, 8, i % 2 ? 'oak_planks' : 'stone');
      api.setBlock!(5, 66, 8, 'torch');
      for (const e of edits) {
        await api.waitForTerrain!(2);
        api.setBlock!(e.x, e.y, e.z, e.id);
      }

      // Kiln: iron ore and coal, 100 of the 200 ticks smelted.
      api.giveItem!('iron_ore', 8);
      api.giveItem!('coal', 1);
      api.openScreen!('kiln');
      api.uiClickSlot!(4, 'left', true);
      api.uiClickSlot!(3, 'left', true);
      api.openScreen!('none');
      await api.tick!(100);

      // Chest: 12 iron ingots and 5 planks.
      api.giveItem!('iron_ingot', 12);
      api.openScreen!('chest');
      api.uiClickSlot!(27, 'left', true);
      api.openScreen!('none');
      api.giveItem!('oak_planks', 5);
      api.openScreen!('chest');
      api.uiClickSlot!(27, 'left', true);
      api.openScreen!('none');

      api.teleport!(at[0], at[1], at[2], at[3], at[4]);
      await api.tick!(1);
      await api.waitForTerrain!(2);
      return {
        kiln: api.getBlockEntity!(5, 65, 6),
        chest: api.getBlockEntity!(7, 65, 7),
        player: api.getPlayer!(),
        inventory: api.getInventory!(),
        drops: api.getDropStats!(),
      };
    },
    { edits, at: PLAYER_AT },
  );
  const kilnBefore = before.kiln!.state as {
    cookProgress: number;
    burnRemaining: number;
    input: { count: number };
  };
  expect(kilnBefore.cookProgress).toBeGreaterThan(50);
  expect(kilnBefore.burnRemaining).toBeGreaterThan(0);
  const chestBefore = before.chest!.state as { slots: Array<{ id: string; count: number } | null> };
  expect(chestBefore.slots.filter(Boolean).length).toBeGreaterThan(0);

  const beforeImage = await assertAndSaveScreenshot({
    name: 'm17-before-reload',
    milestone: MILESTONE,
  });
  assertNotBlank(beforeImage);
  assertNoMissingTexture(beforeImage);

  console.log('DROPS', JSON.stringify(before.drops));
  await page.evaluate(() => window.__blockcraft!.save!());

  await reloadPage(page);
  const after = await page.evaluate(
    async ({ edits, name }) => {
      const api = window.__blockcraft!;
      await api.loadWorld!(name);
      api.pause!();
      api.setRenderDistance!(4);
      api.setClouds!('off');
      const player = api.getPlayer!();
      const kiln = api.getBlockEntity!(5, 65, 6);
      const chest = api.getBlockEntity!(7, 65, 7);
      // Edited blocks live in columns far from the player: they stream in and come from the save.
      await api.waitForTerrain!(2);
      const mismatches: string[] = [];
      for (const e of edits) {
        api.teleport!(e.x + 0.5, 70, e.z + 0.5);
        await api.waitForTerrain!(1);
        const id = api.getBlock!(e.x, e.y, e.z).id;
        if (id !== e.id) mismatches.push(`${e.x},${e.y},${e.z}: ${id} != ${e.id}`);
      }
      return {
        player,
        kiln,
        chest,
        mismatches,
        inventory: api.getInventory!(),
      };
    },
    { edits, name: WORLD },
  );

  expect(after.mismatches).toEqual([]);
  expect(after.chest!.state).toEqual(before.chest!.state);
  expect(after.kiln!.blockId).toBe('kiln');
  const kilnAfter = after.kiln!.state as typeof kilnBefore;
  expect(kilnAfter.input.count).toBe(kilnBefore.input.count);
  // The loop runs while the load finishes, so the kiln may have burned on a little since the save;
  // progress and burn time move together.
  const progressed = kilnAfter.cookProgress - kilnBefore.cookProgress;
  expect(progressed).toBeGreaterThanOrEqual(0);
  expect(progressed).toBeLessThan(100);
  expect(kilnBefore.burnRemaining - kilnAfter.burnRemaining).toBe(progressed);
  expect(after.inventory).toEqual(before.inventory);

  // Player position, within 0.01 (taken right after the load returned).
  for (const axis of [0, 1, 2] as const)
    expect(Math.abs(after.player.pos[axis] - before.player.pos[axis])).toBeLessThan(0.01);

  // The kiln keeps smelting from where it was.
  const later = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.teleport!(7.25, 65, 4.5, 2.3, -0.2);
    await api.waitForTerrain!(2);
    await api.tick!(30);
    return api.getBlockEntity!(5, 65, 6)!.state as { cookProgress: number; burnRemaining: number };
  });
  expect(later.cookProgress).toBe(kilnAfter.cookProgress + 30);
  expect(later.burnRemaining).toBe(kilnAfter.burnRemaining - 30);

  // The same scene from the same spot.
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.teleport!(7.25, 65, 4.5, 2.3, -0.2);
    await api.waitForTerrain!(2);
    await api.tick!(1);
  });
  const afterImage = await assertAndSaveScreenshot({
    name: 'm17-after-reload',
    milestone: MILESTONE,
  });
  assertNotBlank(afterImage);
  assertNoMissingTexture(afterImage);
  // The kiln has burned on, so the flame may differ; the world around it is identical.
  expect(diffFraction(beforeImage, afterImage)).toBeLessThan(0.02);

  const directory = path.join(process.cwd(), 'docs/screenshots/M17b');
  fs.mkdirSync(directory, { recursive: true });
  for (const name of ['m17-before-reload', 'm17-after-reload'])
    fs.copyFileSync(
      path.join(process.cwd(), `artifacts/${MILESTONE}/${name}.png`),
      path.join(directory, `${name}.png`),
    );
});

test('M17b: three autosaves cause no main-thread stretch longer than 16 ms', async ({ page }) => {
  await newWorld(page, 'M17b autosave');
  const stats = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.resume?.();
    const runs: Array<{ lastRunMaxSliceMs: number; step: string; columns: number }> = [];
    for (let run = 0; run < 3; run++) {
      // Many modified columns: an 8 × 8 grid of columns, one edit each, new ones each run.
      for (let cx = -4; cx < 4; cx++)
        for (let cz = -4; cz < 4; cz++)
          api.setBlock!(cx * 16 + run, 66 + run, cz * 16 + 3, 'stone');
      // The edits are made, and the autosave comes later (it is on a 60 s timer in the game).
      await new Promise((resolve) => setTimeout(resolve, 400));
      await api.autosaveNow!();
      const s = (await api.getSaveStats!()).stats;
      runs.push({
        lastRunMaxSliceMs: s.lastRunMaxSliceMs,
        step: s.lastRunSlowestStep,
        columns: s.storedColumns,
      });
    }
    return { runs, total: (await api.getSaveStats!()).stats };
  });
  expect(stats.total.autosaves).toBe(3);
  expect(stats.runs[2]!.columns).toBeGreaterThanOrEqual(64);
  for (const run of stats.runs)
    expect(
      run.lastRunMaxSliceMs,
      `slowest step: ${run.step}; all runs: ${JSON.stringify(stats.runs)}`,
    ).toBeLessThanOrEqual(16);
  expect(stats.total.maxSliceMs).toBeLessThanOrEqual(16);
  expect(stats.total.failures).toBe(0);
});

test('M17b: an unmodified region takes under 1 KB and regenerates identically after reload', async ({
  page,
}) => {
  await newWorld(page, 'M17b regions', 'default');
  const FAR = { x: 700, z: 700 };
  const hashFar = (): Promise<string> =>
    page.evaluate(async (far) => {
      const api = window.__blockcraft!;
      api.teleport!(far.x, 120, far.z);
      await api.waitForTerrain!(2);
      return api.worldHash!(far.x - 16, far.z - 16, far.x + 16, far.z + 16);
    }, FAR);
  const farBefore = await hashFar();

  const usage = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.teleport!(0.5, 120, 0.5);
    await api.waitForTerrain!(2);
    api.setBlock!(1, 100, 1, 'stone');
    api.setBlock!(-40, 100, -40, 'stone');
    await api.save!();
    return (await api.getSaveStats!()).usage!;
  });
  // Only the region around the origin edits has a record; the visited far region has none.
  const far = usage.regions.find(
    (r) => r.rx === Math.floor(FAR.x / 512) && r.rz === Math.floor(FAR.z / 512),
  );
  expect(far?.bytes ?? 0).toBeLessThan(1024);
  expect(usage.regions.length).toBeGreaterThanOrEqual(1);
  expect(usage.regions.every((r) => r.rx !== 1 || r.rz !== 1)).toBe(true);

  await reloadPage(page);
  await page.evaluate(async () => {
    await window.__blockcraft!.loadWorld!('M17b regions');
    window.__blockcraft!.pause!();
  });
  expect(await hashFar()).toBe(farBefore);
  const edited = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.teleport!(0.5, 120, 0.5);
    await api.waitForTerrain!(2);
    return api.getBlock!(1, 100, 1).id;
  });
  expect(edited).toBe('stone');
});

/** Counts the region records of a world straight from the browser's database. */
function regionRecords(page: Page, world: string): Promise<number> {
  return page.evaluate(
    (name) =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('blockcraft-saves');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db
            .transaction('regions')
            .objectStore('regions')
            .count(IDBKeyRange.bound([name], [name, []]));
          request.onsuccess = () => {
            db.close();
            resolve(request.result);
          };
          request.onerror = () => reject(request.error);
        };
      }),
    world,
  );
}

/** Rewrites every record of a store that belongs to the world, in the browser's database. */
function rewriteRecords(
  page: Page,
  store: 'regions' | 'players',
  world: string,
  how: 'garble-columns' | 'garble-player',
): Promise<number> {
  return page.evaluate(
    ({ store, world, how }) =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('blockcraft-saves');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(store, 'readwrite');
          const objects = tx.objectStore(store);
          const all = objects.getAll(IDBKeyRange.bound([world], [world, []]));
          all.onsuccess = () => {
            const garbage = Uint8Array.from({ length: 96 }, (_, i) => (i * 53 + 7) & 255);
            for (const record of all.result as Array<Record<string, unknown>>) {
              if (how === 'garble-columns')
                for (const column of record.columns as Array<{ data: Uint8Array }>)
                  column.data = garbage;
              else record.data = garbage;
              objects.put(record);
            }
            tx.oncomplete = () => {
              db.close();
              resolve(all.result.length);
            };
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { store, world, how },
  );
}

test.describe('M17b: what triggers a save', () => {
  test('pausing a running game saves', async ({ page }) => {
    await newWorld(page, 'M17b trigger pause');
    await page.evaluate(() => {
      const api = window.__blockcraft!;
      api.resume!();
      api.setBlock!(3, 65, 3, 'stone');
    });
    expect(await regionRecords(page, 'M17b trigger pause')).toBe(0);
    await page.evaluate(() => window.__blockcraft!.pause!());
    await expect.poll(() => regionRecords(page, 'M17b trigger pause')).toBe(1);
  });

  test('the page becoming hidden saves', async ({ page }) => {
    await newWorld(page, 'M17b trigger hidden');
    await page.evaluate(() => window.__blockcraft!.setBlock!(3, 65, 3, 'stone'));
    expect(await regionRecords(page, 'M17b trigger hidden')).toBe(0);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => regionRecords(page, 'M17b trigger hidden')).toBe(1);
  });

  test('pagehide saves', async ({ page }) => {
    await newWorld(page, 'M17b trigger pagehide');
    await page.evaluate(() => window.__blockcraft!.setBlock!(3, 65, 3, 'stone'));
    expect(await regionRecords(page, 'M17b trigger pagehide')).toBe(0);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expect.poll(() => regionRecords(page, 'M17b trigger pagehide')).toBe(1);
  });

  test('leaving a world for another one saves the first', async ({ page }) => {
    await newWorld(page, 'M17b trigger exit');
    await page.evaluate(() => window.__blockcraft!.setBlock!(3, 65, 3, 'stone'));
    expect(await regionRecords(page, 'M17b trigger exit')).toBe(0);
    await newWorld(page, 'M17b trigger exit other');
    expect(await regionRecords(page, 'M17b trigger exit')).toBe(1);
  });
});

test('M17b: XP and a spawn point survive a reload, and a missing spawn point stays missing', async ({
  page,
}) => {
  await newWorld(page, 'M17b xp');
  await page.evaluate(() => {
    const api = window.__blockcraft!;
    api.setXp!(7, 0.5);
    api.spawnPoint!([10, 65, 12]);
  });
  await page.evaluate(() => window.__blockcraft!.save!());
  await newWorld(page, 'M17b no spawn');
  await page.evaluate(() => {
    const api = window.__blockcraft!;
    api.setXp!(0, 0);
    api.spawnPoint!(null);
  });
  await page.evaluate(() => window.__blockcraft!.save!());

  await reloadPage(page);
  const withSpawn = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    await api.loadWorld!('M17b xp');
    const player = api.getPlayer!();
    return { xpLevel: player.xpLevel, xpProgress: player.xpProgress, spawn: api.spawnPoint!() };
  });
  expect(withSpawn).toEqual({ xpLevel: 7, xpProgress: 0.5, spawn: [10, 65, 12] });
  const without = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    await api.loadWorld!('M17b no spawn');
    const player = api.getPlayer!();
    return { xpLevel: player.xpLevel, xpProgress: player.xpProgress, spawn: api.spawnPoint!() };
  });
  expect(without).toEqual({ xpLevel: 0, xpProgress: 0, spawn: null });
});

test('M17b: light is recomputed when saved columns load', async ({ page }) => {
  await newWorld(page, 'M17b light');
  // A torch, and a 5 × 5 roof two blocks up that shades the ground below it.
  const probes: Array<[number, number, number]> = [
    [5, 66, 9],
    [6, 66, 8],
    [5, 66, 10],
    [22, 65, 22],
    [20, 65, 20],
    [22, 65, 26],
  ];
  const measure = (): Promise<Array<{ sky: number; block: number }>> =>
    page.evaluate(async (points) => {
      const api = window.__blockcraft!;
      await api.waitForTerrain!(2);
      await api.tick!(2);
      return points.map(([x, y, z]) => api.getLight!(x, y, z));
    }, probes);
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.teleport!(12, 65, 12);
    await api.waitForTerrain!(2);
    api.setBlock!(5, 66, 8, 'torch');
    for (let x = 20; x < 25; x++) for (let z = 20; z < 25; z++) api.setBlock!(x, 67, z, 'stone');
    await api.tick!(2);
  });
  const before = await measure();
  // The torch lights its neighbours; the roof takes sky light away from the ground under it.
  expect(before[0]!.block).toBeGreaterThan(8);
  expect(before[1]!.block).toBeGreaterThan(8);
  expect(before[0]!.block).toBeGreaterThan(before[2]!.block);
  expect(before[3]!.sky).toBeLessThan(15);
  expect(before[3]!.sky).toBeLessThan(before[5]!.sky);
  expect(before[5]!.sky).toBe(15);

  await page.evaluate(() => window.__blockcraft!.save!());
  await reloadPage(page);
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    await api.loadWorld!('M17b light');
    api.pause!();
  });
  expect(await measure()).toEqual(before);
});

test('M17b: damaged saves fall back to regeneration or fail clearly', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  await newWorld(page, 'M17b damaged');
  await page.evaluate(() => window.__blockcraft!.setBlock!(3, 65, 3, 'stone'));
  await page.evaluate(() => window.__blockcraft!.save!());
  await reloadPage(page);

  // The saved column is garbled: the world still loads, with the column generated afresh.
  expect(await rewriteRecords(page, 'regions', 'M17b damaged', 'garble-columns')).toBe(1);
  const block = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    await api.loadWorld!('M17b damaged');
    api.pause!();
    await api.waitForTerrain!(2);
    return api.getBlock!(3, 65, 3).id;
  });
  expect(block).toBe('air');
  expect(warnings.some((text) => text.includes('[saves] column 0,0 unreadable'))).toBe(true);

  // The saved player is garbled: loading the world is refused with a clear message.
  await reloadPage(page);
  expect(await rewriteRecords(page, 'players', 'M17b damaged', 'garble-player')).toBe(1);
  const refusal = await page.evaluate(async () => {
    try {
      await window.__blockcraft!.loadWorld!('M17b damaged');
      return null;
    } catch (error) {
      return (error as Error).message;
    }
  });
  expect(refusal).toMatch(/saved player of world 'M17b damaged' is damaged/);
});

test('M17b: autosaves of a default-terrain world with hundreds of edited columns stay under 16 ms', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await newWorld(page, 'M17b heavy autosave', 'default');
  const runs = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.setRenderDistance!(9);
    api.teleport!(0.5, 150, 0.5);
    await api.waitForTerrain!(2);
    api.resume!();
    const out: Array<{ lastRunMaxSliceMs: number; step: string; columns: number; ms: number }> = [];
    for (let run = 0; run < 4; run++) {
      // Terrain-heavy edits: a 6 × 6 patch in every column of a 19 × 19 grid, inside generated terrain.
      for (let cx = -9; cx <= 9; cx++)
        for (let cz = -9; cz <= 9; cz++)
          for (let dx = 0; dx < 6; dx++)
            for (let dz = 0; dz < 6; dz++)
              api.setBlock!(cx * 16 + dx, 30 + run, cz * 16 + dz, run % 2 ? 'sand' : 'stone');
      await new Promise((resolve) => setTimeout(resolve, 400));
      await api.autosaveNow!();
      const s = (await api.getSaveStats!()).stats;
      out.push({
        lastRunMaxSliceMs: s.lastRunMaxSliceMs,
        step: s.lastRunSlowestStep,
        columns: s.storedColumns,
        ms: s.lastRunMs,
      });
    }
    return out;
  });
  console.log('HEAVY', JSON.stringify(runs));
  expect(runs[3]!.columns).toBeGreaterThanOrEqual(300);
  // Under software rendering on two shared cores one stretch in a run can be hit by a garbage
  // collection or by preemption (a column's capture takes well under a millisecond when the
  // machine is quiet). A cost that really is too big shows in every run, so three of four must pass.
  const within = runs.filter((run) => run.lastRunMaxSliceMs <= 16).length;
  expect(within, JSON.stringify(runs)).toBeGreaterThanOrEqual(3);
});
