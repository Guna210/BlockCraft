import { test, expect } from '../harness/fixture';
import { assertNotBlank, assertNoMissingTexture, diffFraction } from '../harness/pixels';
import type { Page } from '@playwright/test';
import type { PNG } from 'pngjs';

const MILESTONE = 'BLOCKS-shapes';
const WOODS = ['oak', 'birch', 'pine', 'acacia', 'rainwood'];

/** A flat world with an empty stage: stone floor at y=64, air above it. */
async function stage(page: Page, mode: 'creative' | 'survival' = 'creative'): Promise<void> {
  await page.evaluate(async (m) => {
    const a = window.__blockcraft!;
    await a.createWorld!({
      name: 'BLOCKS-shapes stage',
      mode: m,
      type: 'flat',
      seed: 'blockcraft-test-seed-42',
    });
    a.pause!();
    a.setRenderDistance!(4);
    a.setClouds!('off');
    a.setTimeOfDay!(6000);
    a.fill!(-16, 65, -12, 16, 84, 12, 'air');
    a.fill!(-16, 64, -12, 16, 64, 12, 'stone');
  }, mode);
}

async function view(
  page: Page,
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
): Promise<void> {
  await page.evaluate(
    async ([px, py, pz, ya, pi]) => {
      const a = window.__blockcraft!;
      a.teleport!(px!, py!, pz!, ya, pi);
      await a.tick!(0);
      await a.waitForTerrain!(1);
    },
    [x, y, z, yaw, pitch] as const,
  );
  await expect
    .poll(() => page.evaluate(() => window.__blockcraft!.getStreamingStats!().columnsFading))
    .toBe(0);
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

async function shot(
  assertAndSaveScreenshot: (o: { name: string; milestone: string }) => Promise<PNG>,
  name: string,
): Promise<PNG> {
  const png = await assertAndSaveScreenshot({ name, milestone: MILESTONE });
  assertNotBlank(png);
  assertNoMissingTexture(png);
  return png;
}

/** One row per wood along z: stairs, fence pair, closed door, closed trapdoor, then an open one. */
async function buildShowcase(page: Page): Promise<void> {
  await page.evaluate((woods) => {
    const a = window.__blockcraft!;
    woods.forEach((wood, i) => {
      const z = -6 + i * 3;
      // The viewer stands to the west and looks east (yaw 0).
      a.placeShape!(`${wood}_stairs`, 0, 65, z, { look: [-1, 0] });
      a.placeShape!(`${wood}_stairs`, 1, 65, z, { look: [-1, 0] });
      a.placeShape!(`${wood}_fence`, 3, 65, z);
      a.placeShape!(`${wood}_fence`, 3, 65, z + 1);
      a.placeShape!(`${wood}_door`, 5, 65, z, { look: [1, 0], hit: [0.5, 0.5, 0.9] });
      a.placeShape!(`${wood}_trapdoor`, 7, 65, z, { face: 'top' });
      a.placeShape!(`${wood}_trapdoor`, 8, 65, z, { face: 'west', hit: [0, 0.25, 0.5] });
    });
  }, WOODS);
}

test('BLOCKS-shapes every wood shows stairs, fences, doors and trapdoors, and opening them changes the view', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await stage(page);
  await buildShowcase(page);
  await view(page, -7, 68.5, 0, 0, -0.38);
  const closed = await shot(assertAndSaveScreenshot, 'shapes-closed');
  const toggled = await page.evaluate((woods) => {
    const a = window.__blockcraft!;
    let cells = 0;
    for (let i = 0; i < woods.length; i++) {
      const z = -6 + i * 3;
      cells += a.toggleShape!(5, 65, z) + a.toggleShape!(7, 65, z) + a.toggleShape!(8, 65, z);
    }
    return cells;
  }, WOODS);
  expect(toggled).toBe(WOODS.length * 4);
  await view(page, -7, 68.5, 0, 0, -0.38);
  const open = await shot(assertAndSaveScreenshot, 'shapes-open');
  const difference = diffFraction(closed, open);
  console.log('BLOCKS-shapes closed vs open diffFraction', difference);
  expect(difference).toBeGreaterThan(0.002);
});

test('BLOCKS-shapes fences join each other and full blocks and let go when the neighbour breaks', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await stage(page);
  const states = await page.evaluate(() => {
    const a = window.__blockcraft!;
    // A 5x5 pen of oak fences with a birch fence gate-gap and a stone corner pillar.
    for (let i = 0; i < 5; i++) {
      a.placeShape!('oak_fence', i, 65, 0);
      a.placeShape!('oak_fence', i, 65, 4);
      a.placeShape!('oak_fence', 0, 65, i);
      a.placeShape!('oak_fence', 4, 65, i);
    }
    a.setBlock!(6, 65, 2, 'stone');
    a.setBlock!(6, 66, 2, 'stone');
    a.placeShape!('birch_fence', 5, 65, 2);
    a.breakShape!(4, 65, 2);
    return {
      corner: a.getBlock!(0, 65, 0).state,
      side: a.getBlock!(2, 65, 0).state,
      gapEdge: a.getBlock!(4, 65, 1).state,
      birch: a.getBlock!(5, 65, 2).state,
    };
  });
  expect(states.corner).toMatchObject({
    east: 'true',
    south: 'true',
    north: 'false',
    west: 'false',
  });
  expect(states.side).toMatchObject({ east: 'true', west: 'true', north: 'false', south: 'false' });
  expect(states.gapEdge).toMatchObject({ north: 'true', south: 'false' });
  expect(states.birch).toMatchObject({ east: 'true', west: 'false' });
  await view(page, -5, 68, 2, 0.35, -0.5);
  await shot(assertAndSaveScreenshot, 'shapes-fence-pen');
});

test('BLOCKS-shapes the player walks up a staircase without jumping and a door blocks until opened', async ({
  page,
}) => {
  await stage(page, 'survival');
  const climb = await page.evaluate(async () => {
    const a = window.__blockcraft!;
    for (let i = 0; i < 3; i++) {
      a.fill!(i, 65, -1, i, 65 + i - 1, 1, 'stone');
      for (const z of [-1, 0, 1]) a.placeShape!('stone_stairs', i, 65 + i, z, { look: [1, 0] });
    }
    a.fill!(3, 65, -1, 3, 67, 1, 'stone');
    a.teleport!(-2.5, 65, 0.5, 0, 0);
    await a.tick!(5);
    a.input!('forward', true);
    const ys: number[] = [];
    let jumped = false;
    for (let n = 0; n < 60; n++) {
      await a.tick!(1);
      const p = a.getPlayer!();
      ys.push(p.pos[1]);
      if (p.vel[1] > 3) jumped = true;
      if (p.pos[0] > 3.3) break;
    }
    a.input!('forward', false);
    const end = a.getPlayer!();
    return { ys, jumped, x: end.pos[0], y: end.pos[1] };
  });
  expect(climb.jumped).toBe(false);
  expect(climb.x).toBeGreaterThan(2.7);
  expect(climb.y).toBeCloseTo(68, 1);
  for (let i = 1; i < climb.ys.length; i++)
    expect(climb.ys[i]!).toBeGreaterThanOrEqual(climb.ys[i - 1]! - 1e-6);

  const door = await page.evaluate(async () => {
    const a = window.__blockcraft!;
    a.fill!(-16, 65, -12, 16, 84, 12, 'air');
    a.fill!(-6, 65, -1, 6, 67, -1, 'stone');
    a.fill!(-6, 65, 1, 6, 67, 1, 'stone');
    a.fill!(-6, 68, -1, 6, 68, 1, 'stone');
    // Facing 'west': the closed leaf covers the cell's west edge, across the corridor.
    a.placeShape!('oak_door', 0, 65, 0, { look: [1, 0], hit: [0.5, 0.5, 0.9] });
    const run = async () => {
      a.teleport!(-3.5, 65, 0.5, 0, 0);
      await a.tick!(3);
      a.input!('forward', true);
      await a.tick!(60);
      a.input!('forward', false);
      return a.getPlayer!().pos[0];
    };
    const closedX = await run();
    a.toggleShape!(0, 65, 0);
    const openX = await run();
    return { closedX, openX };
  });
  expect(door.closedX).toBeLessThan(0);
  expect(door.openX).toBeGreaterThan(1.5);
});

test('BLOCKS-shapes inventory icons show every new block as a readable thumbnail', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await stage(page, 'survival');
  await page.evaluate(() => {
    const a = window.__blockcraft!;
    for (const wood of ['oak', 'birch', 'pine', 'acacia', 'rainwood'])
      for (const kind of ['stairs', 'fence', 'door', 'trapdoor']) a.giveItem!(`${wood}_${kind}`, 1);
    a.giveItem!('stone_stairs', 1);
    a.giveItem!('cobblestone_stairs', 1);
    a.openScreen!('inventory');
  });
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
  await shot(assertAndSaveScreenshot, 'shapes-inventory');
});
