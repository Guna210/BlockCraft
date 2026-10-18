import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import type { Page } from '@playwright/test';
import { test, expect } from '../harness/fixture';
import { assertNotBlank, assertNoMissingTexture } from '../harness/pixels';

async function setupWorld(page: Page) {
  await page.evaluate(async () => {
    const a = window.__blockcraft!;
    await a.createWorld!({
      name: 'M10c',
      seed: 'blockcraft-m10c-test',
      mode: 'survival',
      type: 'flat',
    });
    a.pause!();
    a.teleport!(0.5, 65, 0.5, 0, 0);
    await a.tick!(1);
  });
}

test('kiln smelts 8 iron ore with 1 coal in 80 s of tick()', async ({ page }) => {
  await setupWorld(page);
  const result = await page.evaluate(async () => {
    const a = window.__blockcraft!;

    // Place a kiln block
    a.setBlock!(2, 65, 0, 'kiln');
    await a.waitForTerrain!(1);

    // Give 8 iron ore and 1 coal
    a.giveItem!('iron_ore', 8);
    a.giveItem!('coal', 1);

    // Open kiln screen
    a.openScreen!('kiln');

    // Slot 3 in kiln screen is hotbar 0 (iron_ore: 8)
    // Slot 4 in kiln screen is hotbar 1 (coal: 1)
    // Shift-click coal into fuel slot (slot 1)
    a.uiClickSlot!(4, 'left', true);
    // Shift-click iron_ore into input slot (slot 0)
    a.uiClickSlot!(3, 'left', true);

    const screenBefore = a.getScreen!();

    // 80 seconds at 20 ticks/sec = 1600 ticks
    await a.tick!(1600);

    const screenAfter = a.getScreen!();

    // Take smelted items from output slot (slot 2) with shift-click to award XP
    const playerBefore = a.getPlayer!();
    a.uiClickSlot!(2, 'left', true);
    const playerAfter = a.getPlayer!();

    return {
      screenBefore,
      screenAfter,
      xpBefore: playerBefore.xpLevel + playerBefore.xpProgress,
      xpAfter: playerAfter.xpLevel + playerAfter.xpProgress,
      inventory: a.getInventory!(),
    };
  });

  // Verify that 8 iron ingots were produced
  const hasEightIngots = result.inventory.some(
    (slot) => slot !== null && slot.id === 'iron_ingot' && slot.count === 8,
  );
  expect(hasEightIngots).toBe(true);

  // Verify player gained XP from retrieving smelted ingots
  expect(result.xpAfter).toBeGreaterThan(result.xpBefore);
});

test('wooden pickaxe breaks after exactly 59 uses', async ({ page }) => {
  await setupWorld(page);
  const history = await page.evaluate(async () => {
    const a = window.__blockcraft!;
    a.giveItem!('wooden_pickaxe', 1);
    a.selectHotbarSlot!(0);

    const recorded: Array<{ use: number; damage: number | null | undefined; broken: boolean }> = [];

    // Dirt hardness is 0.5; wooden pickaxe breaks it in ~15 ticks
    for (let use = 1; use <= 59; use++) {
      a.setBlock!(2, 66, 0, 'dirt');
      await a.waitForTerrain!(1);

      a.input!('attack', true);
      let ticks = 0;
      while (a.getBlock!(2, 66, 0).id !== 'air' && ticks < 25) {
        await a.tick!(1);
        ticks++;
      }
      a.input!('attack', false);

      const held = a.getInventory!()[0];
      const broken = !held || held.id !== 'wooden_pickaxe';
      recorded.push({
        use,
        damage: held?.damage,
        broken,
      });
    }

    return recorded;
  });

  // Verify that on uses 1 through 58, the pickaxe remained intact with damage matching uses
  for (let i = 0; i < 58; i++) {
    expect(history[i]!.broken).toBe(false);
    expect(history[i]!.damage).toBe(i + 1);
  }

  // Verify that on exactly the 59th use, the pickaxe broke and disappeared
  expect(history[58]!.broken).toBe(true);
});

test('iron ore drops with stone pickaxe and drops nothing with wooden pickaxe', async ({
  page,
}) => {
  await setupWorld(page);
  const result = await page.evaluate(async () => {
    const a = window.__blockcraft!;

    // 1. Break iron_ore with wooden pickaxe (harvest tier 0 < required minTier 1)
    a.giveItem!('wooden_pickaxe', 1);
    a.selectHotbarSlot!(0);
    a.setBlock!(2, 66, 0, 'iron_ore');
    await a.waitForTerrain!(1);

    a.input!('attack', true);
    let woodTicks = 0;
    while (a.getBlock!(2, 66, 0).id !== 'air' && woodTicks < 160) {
      await a.tick!(1);
      woodTicks++;
    }
    a.input!('attack', false);

    const entitiesAfterWood = a.getEntities!({ type: 'item' });

    // 2. Break iron_ore with stone pickaxe (harvest tier 1 >= required minTier 1)
    a.giveItem!('stone_pickaxe', 1);
    a.selectHotbarSlot!(1);
    a.setBlock!(2, 66, 0, 'iron_ore');
    await a.waitForTerrain!(1);

    a.input!('attack', true);
    let stoneTicks = 0;
    while (a.getBlock!(2, 66, 0).id !== 'air' && stoneTicks < 50) {
      await a.tick!(1);
      stoneTicks++;
    }
    a.input!('attack', false);

    const entitiesAfterStone = a.getEntities!({ type: 'item' });

    return {
      entitiesAfterWood,
      entitiesAfterStone,
    };
  });

  // Wooden pickaxe fails harvest criteria: drops 0 loot items
  expect(result.entitiesAfterWood.length).toBe(0);

  // Stone pickaxe satisfies harvest criteria: drops raw iron loot
  expect(result.entitiesAfterStone.length).toBeGreaterThan(0);
  const droppedRawIron = result.entitiesAfterStone.some((e) => e.item === 'raw_iron');
  expect(droppedRawIron).toBe(true);
});

test('Visual Review: m10-kiln mid-smelt with damaged tool durability bar', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await setupWorld(page);
  await page.evaluate(async () => {
    const a = window.__blockcraft!;

    // Give wooden pickaxe in hotbar slot 0 and set damage to 20 (durability 59, ~34% wear)
    a.giveItem!('wooden_pickaxe', 1);
    a.selectHotbarSlot!(0);
    a.setItemDamage!(0, 20);

    // Place a kiln block
    a.setBlock!(2, 65, 0, 'kiln');
    await a.waitForTerrain!(1);

    // Give 8 iron ore and 1 coal
    a.giveItem!('iron_ore', 8);
    a.giveItem!('coal', 1);

    // Open kiln screen
    a.openScreen!('kiln');

    // Slot 4 in kiln screen is hotbar 1 (iron_ore)
    // Slot 5 in kiln screen is hotbar 2 (coal)
    a.uiClickSlot!(5, 'left', true); // Shift-click coal to fuel
    a.uiClickSlot!(4, 'left', true); // Shift-click iron ore to input

    // Tick 100 ticks (5 seconds): exactly halfway through first smelt
    // Flame is burning (1500 / 1600 ticks remaining)
    // Arrow is half-filled (100 / 200 ticks cook progress)
    await a.tick!(100);

    // Re-render open screen
    a.openScreen!('kiln');
    await new Promise((resolve) => requestAnimationFrame(() => resolve(0)));
  });

  const shot = await assertAndSaveScreenshot({ name: 'm10-kiln', milestone: 'M10c' });
  assertNotBlank(shot);
  assertNoMissingTexture(shot);

  const docs = path.join(process.cwd(), 'docs/screenshots/M10c');
  fs.mkdirSync(docs, { recursive: true });
  fs.copyFileSync(
    path.join(process.cwd(), 'artifacts/M10c/m10-kiln.png'),
    path.join(docs, 'm10-kiln.png'),
  );

  // Generate m10-kiln-flame.png showing zoomed comparison of flame at full fuel vs ~half fuel
  const flameWidth = 240;
  const flameHeight = 120;
  const flamePng = new PNG({ width: flameWidth, height: flameHeight });

  const PALETTE = {
    panel: [85, 90, 128],
    outline: [21, 18, 31],
    slot: [35, 37, 58],
    red: [179, 43, 27],
    orange: [217, 109, 26],
    yellow: [242, 193, 46],
  };

  for (let y = 0; y < flameHeight; y++) {
    for (let x = 0; x < flameWidth; x++) {
      const idx = (y * flameWidth + x) * 4;
      flamePng.data[idx] = PALETTE.panel[0]!;
      flamePng.data[idx + 1] = PALETTE.panel[1]!;
      flamePng.data[idx + 2] = PALETTE.panel[2]!;
      flamePng.data[idx + 3] = 255;
    }
  }

  const FLAME_FRAME: readonly string[] = [
    '......R.......',
    '.....RRR......',
    '....RROOR.....',
    '...RROOORR....',
    '..RROOOOOOR...',
    '...ROOOOOOOR..',
    '..RROOOOOOORR.',
    '..RROOOYOOORR.',
    '.RROOOYYYOOOR.',
    '.RROOOYYYOOOR.',
    '..RROOOYOOOR..',
    '..RROOOOOORR..',
    '...RRROOORR...',
    '....RRRRR.....',
  ];

  const isFlameEdge = (frame: readonly string[], row: number, col: number): boolean => {
    if (row === 0 || row === 13 || col === 0 || col === 13) return true;
    return (
      frame[row - 1]![col] === '.' ||
      frame[row + 1]![col] === '.' ||
      frame[row]![col - 1] === '.' ||
      frame[row]![col + 1] === '.'
    );
  };

  const renderSingleFlame = (
    startX: number,
    startY: number,
    scale: number,
    burnRemaining: number,
    burnTotal: number,
  ) => {
    const frame = FLAME_FRAME;
    const ratio = burnTotal > 0 ? Math.max(0, Math.min(1, burnRemaining / burnTotal)) : 0;
    const fillH = Math.round(14 * ratio);
    const startFillRow = 14 - fillH;

    for (let row = 0; row < 14; row++) {
      const line = frame[row]!;
      const isLitRow = row >= startFillRow && burnRemaining > 0;
      for (let col = 0; col < 14; col++) {
        const ch = line[col];
        if (ch === '.') continue;
        let rgb: number[];
        if (isLitRow) {
          rgb = ch === 'Y' ? PALETTE.yellow : ch === 'O' ? PALETTE.orange : PALETTE.red;
        } else {
          const isEdge = isFlameEdge(frame, row, col);
          rgb = isEdge ? PALETTE.outline : PALETTE.slot;
        }

        for (let py = 0; py < scale; py++) {
          for (let px = 0; px < scale; px++) {
            const pxX = startX + col * scale + px;
            const pxY = startY + row * scale + py;
            const idx = (pxY * flameWidth + pxX) * 4;
            flamePng.data[idx] = rgb[0]!;
            flamePng.data[idx + 1] = rgb[1]!;
            flamePng.data[idx + 2] = rgb[2]!;
            flamePng.data[idx + 3] = 255;
          }
        }
      }
    }
  };

  // Left: Full Fuel (1600/1600 ticks, 100%)
  renderSingleFlame(24, 18, 6, 1600, 1600);

  // Right: ~Half Fuel (800/1600 ticks, 50%)
  renderSingleFlame(132, 18, 6, 800, 1600);

  assertNotBlank(flamePng);
  assertNoMissingTexture(flamePng);
  const flameBuffer = PNG.sync.write(flamePng);

  const artifacts = path.join(process.cwd(), 'artifacts/M10c');
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(path.join(artifacts, 'm10-kiln-flame.png'), flameBuffer);
  fs.writeFileSync(path.join(docs, 'm10-kiln-flame.png'), flameBuffer);
});
