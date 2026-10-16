import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import type { Page } from '@playwright/test';
import { test, expect } from '../harness/fixture';
import { assertColorVariance, assertNoMissingTexture, assertNotBlank } from '../harness/pixels';

// Every registered item, in registry order, read from the data files the game loads.
const ITEM_IDS = fs
  .readdirSync(path.join(process.cwd(), 'data/items'))
  .sort()
  .flatMap((file) =>
    Object.keys(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/items', file), 'utf8'))),
  )
  .filter((id) => id !== 'air');

type Rect = { x: number; y: number; w: number; h: number };

function crop(png: PNG, r: Rect): PNG {
  const out = new PNG({ width: r.w, height: r.h });
  for (let y = 0; y < r.h; y++)
    png.data.copy(
      out.data,
      y * r.w * 4,
      ((r.y + y) * png.width + r.x) * 4,
      ((r.y + y) * png.width + r.x + r.w) * 4,
    );
  return out;
}

async function newWorld(page: Page, mode: 'survival' | 'creative' = 'survival') {
  await page.evaluate(async (m) => {
    const a = window.__blockcraft!;
    await a.createWorld!({
      name: 'M09b',
      seed: 'blockcraft-test-seed-42',
      mode: m,
      type: 'flat',
    });
    a.pause!();
    a.teleport!(0.5, 65, 0.5, 0, 0);
    await a.tick!(1);
  }, mode);
}

async function slotCenter(page: Page, slot: number): Promise<[number, number]> {
  const r = await page.evaluate((s) => window.__blockcraft!.getScreen!().slots[s]!, slot);
  return [r.x + r.w / 2, r.y + r.h / 2];
}

test('M09b moves 64 dirt from slot 0 to slot 20 and splits it 32/32 with right click, matching getInventory()', async ({
  page,
}) => {
  await newWorld(page);
  const steps = await page.evaluate(() => {
    const a = window.__blockcraft!;
    a.giveItem!('dirt', 64);
    a.openScreen!('inventory');
    const out: unknown[] = [];
    const record = () =>
      out.push({ inventory: a.getInventory!(), cursor: a.getInventoryCursor!() });
    a.uiClickSlot!(0, 'left');
    record();
    a.uiClickSlot!(20, 'left');
    record();
    a.uiClickSlot!(20, 'right');
    record();
    a.uiClickSlot!(21, 'left');
    record();
    return out as Array<{
      inventory: Array<{ slot: number; id: string; count: number } | null>;
      cursor: { id: string; count: number } | null;
    }>;
  });
  // Picked up from slot 0.
  expect(steps[0]!.cursor).toEqual({ id: 'dirt', count: 64 });
  expect(steps[0]!.inventory[0]).toBeNull();
  // Placed into slot 20.
  expect(steps[1]!.cursor).toBeNull();
  expect(steps[1]!.inventory[0]).toBeNull();
  expect(steps[1]!.inventory[20]).toEqual({ slot: 20, id: 'dirt', count: 64 });
  // Right click takes half onto the cursor, leaving half.
  expect(steps[2]!.cursor).toEqual({ id: 'dirt', count: 32 });
  expect(steps[2]!.inventory[20]).toEqual({ slot: 20, id: 'dirt', count: 32 });
  // Placing the cursor into an empty slot gives 32 / 32.
  expect(steps[3]!.cursor).toBeNull();
  expect(steps[3]!.inventory[20]).toEqual({ slot: 20, id: 'dirt', count: 32 });
  expect(steps[3]!.inventory[21]).toEqual({ slot: 21, id: 'dirt', count: 32 });
  expect(steps[3]!.inventory.filter((s) => s && s.id === 'dirt')).toHaveLength(2);
});

test('M09b inventory screenshot has no missing texture and every item icon has color variance', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await newWorld(page);
  const layout = [
    // Hotbar
    ['iron_pickaxe', 1],
    ['iron_axe', 1],
    ['iron_sword', 1],
    ['torch', 16],
    ['bread', 5],
    ['grass_block', 64],
    ['dirt', 64],
    ['stone', 64],
    ['oak_planks', 48],
    // Main inventory
    ['oak_log', 20],
    ['birch_log', 12],
    ['pine_log', 9],
    ['oak_leaves', 30],
    ['sand', 64],
    ['gravel', 33],
    ['cobblestone', 64],
    ['coal_ore', 8],
    ['iron_ore', 5],
    ['gold_ore', 3],
    ['ice', 24],
    ['snow_layer', 16],
    ['fire', 1],
    ['blackglass', 7],
    ['glass', 12],
    ['tall_grass', 10],
    ['bluebell', 4],
    ['red_mushroom', 6],
    ['pumpkin', 2],
    ['cactus', 11],
    ['lava', 1],
    ['ladder', 14],
    ['stone_slab', 22],
    ['copper_ingot', 15],
    ['apple', 3],
    ['skyshard_crystal', 2],
    ['vine', 8],
  ] as const;
  expect(layout).toHaveLength(36);
  const hotbarAndMain = layout.length;
  await page.evaluate(
    (entries) => {
      const a = window.__blockcraft!;
      for (const [id, count] of entries) a.giveItem!(id, count);
      a.giveItem!('iron_helmet', 1);
      a.giveItem!('iron_chestplate', 1);
      a.giveItem!('iron_leggings', 1);
      a.giveItem!('iron_boots', 1);
      a.giveItem!('shield', 1);
    },
    layout.slice(0, hotbarAndMain - 5) as unknown as Array<[string, number]>,
  );
  // 31 stacks plus five equipment pieces fill storage; move the equipment into place by clicking.
  await page.evaluate(() => {
    const a = window.__blockcraft!;
    a.openScreen!('inventory');
    const inv = a.getInventory!();
    const slotOf = (id: string) => inv.find((s) => s && s.id === id)!.slot;
    const equip: Array<[string, number]> = [
      ['iron_helmet', 36],
      ['iron_chestplate', 37],
      ['iron_leggings', 38],
      ['iron_boots', 39],
      ['shield', 40],
    ];
    for (const [id, target] of equip) {
      a.uiClickSlot!(slotOf(id), 'left');
      a.uiClickSlot!(target, 'left');
    }
  });
  // Fill the freed storage slots so all 41 slots show an icon.
  await page.evaluate(
    (entries) => {
      const a = window.__blockcraft!;
      for (const [id, count] of entries) a.giveItem!(id, count);
    },
    layout.slice(hotbarAndMain - 5) as unknown as Array<[string, number]>,
  );

  const screen = await page.evaluate(() => window.__blockcraft!.getScreen!());
  expect(screen.name).toBe('inventory');
  expect(Number.isInteger(screen.scale)).toBe(true);
  const inventory = await page.evaluate(() => window.__blockcraft!.getInventory!());
  expect(inventory).toHaveLength(41);
  expect(inventory.every((stack) => stack !== null)).toBe(true);

  // Hover a slot so its tooltip is part of the screenshot.
  const [hx, hy] = await slotCenter(page, 3);
  await page.mouse.move(hx, hy);
  await expect
    .poll(() => page.evaluate(() => window.__blockcraft!.getScreen!().tooltip))
    .toBe('TORCH');
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(0))));

  const shot = await assertAndSaveScreenshot({ name: 'm09-inventory', milestone: 'M09b' });
  assertNotBlank(shot);
  assertNoMissingTexture(shot);
  for (let slot = 0; slot < 41; slot++) {
    const r = screen.slots[slot]!;
    const s = screen.scale;
    // The 16×16 UI-pixel icon area inside the one-pixel slot border.
    const icon = { x: r.x + s, y: r.y + s, w: r.w - 2 * s, h: r.h - 2 * s };
    expect(
      () => assertColorVariance(crop(shot, icon), 10),
      `slot ${slot} ${inventory[slot]!.id}`,
    ).not.toThrow();
  }
  const docs = path.join(process.cwd(), 'docs/screenshots/M09b');
  fs.mkdirSync(docs, { recursive: true });
  fs.copyFileSync(
    path.join(process.cwd(), 'artifacts/M09b/m09-inventory.png'),
    path.join(docs, 'm09-inventory.png'),
  );
});

// Every registered item, in batches of the 36 storage slots, so each icon is checked in place.
const BATCH = 36;
for (let start = 0; start < ITEM_IDS.length; start += BATCH) {
  test(`M09b every registry icon has color variance (items ${start + 1}–${Math.min(start + BATCH, ITEM_IDS.length)})`, async ({
    page,
    assertAndSaveScreenshot,
  }) => {
    await newWorld(page);
    const ids = ITEM_IDS.slice(start, start + BATCH);
    await page.evaluate((list) => {
      const a = window.__blockcraft!;
      for (const id of list) a.giveItem!(id, 1);
      a.openScreen!('inventory');
    }, ids);
    const screen = await page.evaluate(() => window.__blockcraft!.getScreen!());
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(0))));
    const shot = await assertAndSaveScreenshot({ name: `m09b-icons-${start}`, milestone: 'M09b' });
    assertNoMissingTexture(shot);
    ids.forEach((id, slot) => {
      const r = screen.slots[slot]!;
      const s = screen.scale;
      const icon = { x: r.x + s, y: r.y + s, w: r.w - 2 * s, h: r.h - 2 * s };
      expect(() => assertColorVariance(crop(shot, icon), 10), id).not.toThrow();
    });
  });
}

test('M09b E opens and closes the screen, releases input and returns the cursor stack', async ({
  page,
}) => {
  await newWorld(page);
  const moved = await page.evaluate(async () => {
    const a = window.__blockcraft!;
    // Control: with the screen closed, holding forward moves the player.
    a.input!('forward', true);
    await a.tick!(10);
    const closedX = a.getPlayer!().pos[0];
    a.input!('forward', false);
    a.teleport!(0.5, 65, 0.5, 0, 0);
    await a.tick!(1);
    return closedX;
  });
  expect(Math.abs(moved - 0.5)).toBeGreaterThan(0.05);

  await page.keyboard.press('KeyE');
  expect(await page.evaluate(() => window.__blockcraft!.getScreen!().name)).toBe('inventory');
  const stayed = await page.evaluate(async () => {
    const a = window.__blockcraft!;
    a.input!('forward', true);
    a.input!('jump', true);
    await a.tick!(10);
    const pos = a.getPlayer!().pos;
    a.input!('forward', false);
    a.input!('jump', false);
    return pos;
  });
  expect(stayed[0]).toBeCloseTo(0.5, 3);
  expect(stayed[2]).toBeCloseTo(0.5, 3);
  expect(stayed[1]).toBeCloseTo(65, 1);

  await page.evaluate(() => {
    const a = window.__blockcraft!;
    a.giveItem!('dirt', 40);
    a.uiClickSlot!(0, 'left');
  });
  expect(await page.evaluate(() => window.__blockcraft!.getInventoryCursor!())).toEqual({
    id: 'dirt',
    count: 40,
  });
  await page.keyboard.press('Escape');
  const closed = await page.evaluate(() => {
    const a = window.__blockcraft!;
    return {
      screen: a.getScreen!().name,
      cursor: a.getInventoryCursor!(),
      slot0: a.getInventory!()[0],
    };
  });
  expect(closed).toEqual({
    screen: null,
    cursor: null,
    slot0: { slot: 0, id: 'dirt', count: 40 },
  });
  await page.keyboard.press('KeyE');
  expect(await page.evaluate(() => window.__blockcraft!.getScreen!().name)).toBe('inventory');
  await page.keyboard.press('KeyE');
  expect(await page.evaluate(() => window.__blockcraft!.getScreen!().name)).toBeNull();
});

test('M09b closing drops a cursor stack that has no room', async ({ page }) => {
  await newWorld(page);
  const result = await page.evaluate(async () => {
    const a = window.__blockcraft!;
    for (let i = 0; i < 36; i++) a.giveItem!('stone', 64);
    a.openScreen!('inventory');
    a.uiClickSlot!(0, 'left');
    // Refill the vacated slot so nothing can take the stack back.
    a.giveItem!('dirt', 64);
    a.openScreen!('none');
    await a.tick!(2);
    return {
      cursor: a.getInventoryCursor!(),
      entities: a.getEntities!({ type: 'item' }).map((e) => ({ item: e.item, count: e.count })),
      stone: a.getInventory!().filter((s) => s && s.id === 'stone').length,
    };
  });
  expect(result.cursor).toBeNull();
  expect(result.entities).toEqual([{ item: 'stone', count: 64 }]);
  expect(result.stone).toBe(35);
});

test('M09b Q drops one from the selected hotbar slot, Ctrl+Q the whole stack; open screen drops the hovered slot', async ({
  page,
}) => {
  await newWorld(page);
  await page.evaluate(() => {
    const a = window.__blockcraft!;
    a.giveItem!('dirt', 64);
    a.giveItem!('stone', 20);
    a.giveItem!('sand', 10);
  });
  await page.keyboard.press('KeyQ');
  let state = await page.evaluate(() => {
    const a = window.__blockcraft!;
    return { inv: a.getInventory!().slice(0, 3), entities: a.getEntities!({ type: 'item' }) };
  });
  expect(state.inv[0]).toEqual({ slot: 0, id: 'dirt', count: 63 });
  expect(state.entities).toHaveLength(1);
  expect(state.entities[0]).toMatchObject({ item: 'dirt', count: 1 });

  await page.evaluate(() => window.__blockcraft!.selectHotbarSlot!(1));
  await page.keyboard.press('Control+KeyQ');
  state = await page.evaluate(() => {
    const a = window.__blockcraft!;
    return { inv: a.getInventory!().slice(0, 3), entities: a.getEntities!({ type: 'item' }) };
  });
  expect(state.inv[1]).toBeNull();
  expect(state.entities.map((e) => `${e.item}:${e.count}`).sort()).toEqual(['dirt:1', 'stone:20']);

  await page.keyboard.press('KeyE');
  const [x, y] = await slotCenter(page, 2);
  await page.mouse.move(x, y);
  await page.keyboard.press('KeyQ');
  state = await page.evaluate(() => {
    const a = window.__blockcraft!;
    return { inv: a.getInventory!().slice(0, 3), entities: a.getEntities!({ type: 'item' }) };
  });
  expect(state.inv[2]).toEqual({ slot: 2, id: 'sand', count: 9 });
  await page.keyboard.press('Control+KeyQ');
  state = await page.evaluate(() => {
    const a = window.__blockcraft!;
    return { inv: a.getInventory!().slice(0, 3), entities: a.getEntities!({ type: 'item' }) };
  });
  expect(state.inv[2]).toBeNull();
  expect(state.entities.map((e) => `${e.item}:${e.count}`).sort()).toEqual([
    'dirt:1',
    'sand:1',
    'sand:9',
    'stone:20',
  ]);
});

test('M09b mouse input: click, drag distribution, double click and tooltip go through the inventory operations', async ({
  page,
}) => {
  await newWorld(page);
  await page.evaluate(() => {
    const a = window.__blockcraft!;
    a.giveItem!('iron_helmet', 1);
    a.giveItem!('dirt', 30);
    a.openScreen!('inventory');
  });
  // Hover shows the item name.
  const [hx, hy] = await slotCenter(page, 0);
  await page.mouse.move(hx, hy);
  await expect
    .poll(() => page.evaluate(() => window.__blockcraft!.getScreen!().tooltip))
    .toBe('IRON HELMET');

  // Click the dirt stack up, then drag it evenly over three empty slots (30 / 3 = 10 each).
  const [dx, dy] = await slotCenter(page, 1);
  await page.mouse.click(dx, dy);
  expect(await page.evaluate(() => window.__blockcraft!.getInventoryCursor!())).toEqual({
    id: 'dirt',
    count: 30,
  });
  const targets = [
    await slotCenter(page, 10),
    await slotCenter(page, 11),
    await slotCenter(page, 12),
  ];
  await page.mouse.move(targets[0]![0], targets[0]![1]);
  await page.mouse.down();
  await page.mouse.move(targets[1]![0], targets[1]![1], { steps: 4 });
  await page.mouse.move(targets[2]![0], targets[2]![1], { steps: 4 });
  await page.mouse.up();
  let inv = await page.evaluate(() => window.__blockcraft!.getInventory!());
  expect([10, 11, 12].map((i) => inv[i]?.count)).toEqual([10, 10, 10]);
  expect(await page.evaluate(() => window.__blockcraft!.getInventoryCursor!())).toBeNull();

  // Double click collects every dirt stack onto the cursor.
  await page.mouse.dblclick(targets[0]![0], targets[0]![1]);
  const cursor = await page.evaluate(() => window.__blockcraft!.getInventoryCursor!());
  expect(cursor).toEqual({ id: 'dirt', count: 30 });
  inv = await page.evaluate(() => window.__blockcraft!.getInventory!());
  expect(inv.filter((s) => s && s.id === 'dirt')).toHaveLength(0);

  // Shift-click sends the helmet to its armor slot.
  await page.mouse.click(dx, dy);
  const [sx, sy] = await slotCenter(page, 0);
  await page.keyboard.down('Shift');
  await page.mouse.click(sx, sy);
  await page.keyboard.up('Shift');
  inv = await page.evaluate(() => window.__blockcraft!.getInventory!());
  expect(inv[36]).toMatchObject({ id: 'iron_helmet', count: 1 });
  expect(inv[0]).toBeNull();
});
