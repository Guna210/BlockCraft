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
      return { player, kiln, chest, mismatches, inventory: api.getInventory!() };
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
