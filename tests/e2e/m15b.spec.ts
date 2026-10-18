import fs from 'fs';
import path from 'path';
import { test, expect } from '../harness/fixture';
import { assertNoMissingTexture, assertNotBlank, diffFraction } from '../harness/pixels';

const MILESTONE = 'M15b';

/**
 * A 2×2 doorway at x = 0..1 in a stone wall along z = 0. Four sticky pistons sit in the wall
 * (x = -2 and x = 3, two rows) with a stone panel beside each. Powered, the pistons extend and
 * push the panels together across the doorway; unpowered, they pull the panels back into the wall.
 * An inverter torch makes the button open the door: pressing it cuts the pistons' power.
 */
async function buildDoor(
  page: import('@playwright/test').Page,
  timeOfDay: number,
  camera: [number, number, number, number, number],
): Promise<void> {
  await page.evaluate(
    async ({ timeOfDay, camera }) => {
      const api = window.__blockcraft!;
      await api.createWorld!({
        name: 'M15b Piston door',
        seed: 'blockcraft-m15b-pistons',
        mode: 'creative',
        type: 'flat',
      });
      api.pause!();
      api.setRenderDistance!(4);
      api.setClouds!('off');
      api.setTimeOfDay!(timeOfDay);
      api.teleport!(camera[0], camera[1], camera[2], camera[3], camera[4]);
      await api.tick!(1);
      await api.waitForTerrain!(1);

      for (let x = -4; x <= 5; x++) for (let y = 65; y <= 67; y++) api.setBlock!(x, y, 0, 'stone');
      for (const y of [65, 66]) {
        for (const x of [0, 1, -1, 2]) api.setBlock!(x, y, 0, 'air');
        api.setBlock!(-2, y, 0, 'sticky_piston', { facing: 'east', extended: 'false' });
        api.setBlock!(3, y, 0, 'sticky_piston', { facing: 'west', extended: 'false' });
        api.setBlock!(-1, y, 0, 'stone');
        api.setBlock!(2, y, 0, 'stone');
      }
      // Backing for the pockets, so an extended head does not leave a see-through slot.
      for (const x of [-1, 2]) for (const y of [65, 66]) api.setBlock!(x, y, 1, 'stone');
      // Wiring behind the wall: a trace row feeding both piston columns.
      for (let x = -2; x <= 3; x++) api.setBlock!(x, 66, 3, 'copper_trace');
      for (const x of [-2, 3]) api.setBlock!(x, 66, 2, 'copper_trace');
      api.setBlock!(-2, 66, 1, 'copper_trace');
      api.setBlock!(3, 66, 1, 'copper_trace');
      api.setBlock!(-3, 65, 1, 'stone');
      api.setBlock!(-3, 66, 1, 'inverter_torch', { attachment: 'floor', lit: 'true' });
      api.setBlock!(-3, 65, 2, 'stone_button', { face: 'wall_north', powered: 'false' });
      // Light for the night view.
      api.setBlock!(-4, 65, -2, 'torch');
      api.setBlock!(5, 65, -2, 'torch');
      api.setBlock!(-1, 65, -3, 'torch');
      api.setBlock!(2, 65, -3, 'torch');
      await api.tick!(1);
      await api.waitForTerrain!(1);
    },
    { timeOfDay, camera },
  );
}

const doorCells = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const api = window.__blockcraft!;
    const cells = [
      [0, 65],
      [1, 65],
      [0, 66],
      [1, 66],
    ];
    return {
      doorway: cells.map(([x, y]) => api.getBlock!(x!, y!, 0).id),
      heads: [-1, 2].flatMap((x) => [65, 66].map((y) => api.getBlock!(x, y, 0).id)),
      pistons: [
        api.getBlock!(-2, 65, 0).state.extended,
        api.getBlock!(-2, 66, 0).state.extended,
        api.getBlock!(3, 65, 0).state.extended,
        api.getBlock!(3, 66, 0).state.extended,
      ],
      moving: api.getMovingBlocks!().length,
    };
  });

test('M15b: a 2x2 piston door opens within 10 ticks of the button and closes after it releases', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await buildDoor(page, 18000, [0.5, 65, -7, Math.PI / 2, -0.12]);
  await page.evaluate(async () => {
    await window.__blockcraft!.tick!(4);
  });

  const closed = await doorCells(page);
  expect(closed.doorway).toEqual(['stone', 'stone', 'stone', 'stone']);
  expect(closed.pistons).toEqual(['true', 'true', 'true', 'true']);
  expect(closed.moving).toBe(0);
  await page.evaluate(async () => {
    await window.__blockcraft!.waitForTerrain!(1);
  });
  const closedImage = await assertAndSaveScreenshot({
    name: 'm15-piston-door-closed',
    milestone: MILESTONE,
  });
  assertNotBlank(closedImage);
  assertNoMissingTexture(closedImage);

  // Press the button and count ticks until the doorway is clear.
  const opening = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.useBlock!(-3, 65, 2);
    // Blocks start sliding in the same tick, before any further tick passes.
    const sawMoving = api.getMovingBlocks!().length > 0;
    let ticks = 0;
    const clear = () =>
      [
        [0, 65],
        [1, 65],
        [0, 66],
        [1, 66],
      ].every(([x, y]) => api.getBlock!(x!, y!, 0).id === 'air');
    while ((!clear() || api.getMovingBlocks!().length > 0) && ticks < 40) {
      await api.tick!(1);
      ticks++;
    }
    await api.tick!(1);
    await api.waitForTerrain!(1);
    return { ticks, sawMoving, buttonStillDown: api.getBlock!(-3, 65, 2).state.powered };
  });
  expect(opening.ticks).toBeLessThanOrEqual(10);
  expect(opening.sawMoving).toBe(true);
  expect(opening.buttonStillDown).toBe('true');

  const open = await doorCells(page);
  expect(open.doorway).toEqual(['air', 'air', 'air', 'air']);
  expect(open.pistons).toEqual(['false', 'false', 'false', 'false']);
  expect(open.heads).toEqual(['stone', 'stone', 'stone', 'stone']);

  const openImage = await assertAndSaveScreenshot({
    name: 'm15-piston-door',
    milestone: MILESTONE,
  });
  assertNotBlank(openImage);
  assertNoMissingTexture(openImage);
  expect(diffFraction(closedImage, openImage)).toBeGreaterThan(0.01);

  // The stone button lets go after 20 ticks, the torch relights and the pistons close the door.
  const closing = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    let ticks = 0;
    const shut = () =>
      [
        [0, 65],
        [1, 65],
        [0, 66],
        [1, 66],
      ].every(([x, y]) => api.getBlock!(x!, y!, 0).id === 'stone');
    while (!shut() && ticks < 80) {
      await api.tick!(1);
      ticks++;
    }
    return { ticks, buttonDown: api.getBlock!(-3, 65, 2).state.powered };
  });
  expect(closing.buttonDown).toBe('false');
  // The stone button holds for 20 ticks from the press, then the pistons need their move time.
  expect(opening.ticks + closing.ticks).toBeGreaterThanOrEqual(20);
  expect(opening.ticks + closing.ticks).toBeLessThanOrEqual(30);
  expect((await doorCells(page)).pistons).toEqual(['true', 'true', 'true', 'true']);

  const screenshotDirectory = path.join(process.cwd(), 'docs/screenshots/M15b');
  fs.mkdirSync(screenshotDirectory, { recursive: true });
  for (const name of ['m15-piston-door', 'm15-piston-door-closed'])
    fs.copyFileSync(
      path.join(process.cwd(), `artifacts/${MILESTONE}/${name}.png`),
      path.join(screenshotDirectory, `${name}.png`),
    );
});
