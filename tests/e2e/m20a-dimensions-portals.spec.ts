import fs from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';
import { test, expect } from '../harness/fixture';
import { assertNoMissingTexture, assertNotBlank } from '../harness/pixels';

const MILESTONE = 'M20a';
const GROUND = 64;

interface PortalRecord {
  x: number;
  y: number;
  z: number;
  axis: 'x' | 'z';
}

function publish(name: string): void {
  const destination = path.join(process.cwd(), `docs/screenshots/${MILESTONE}/${name}.png`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(process.cwd(), `artifacts/${MILESTONE}/${name}.png`), destination);
}

async function newWorld(page: Page, name: string): Promise<void> {
  await page.evaluate(async (name) => {
    const api = window.__blockcraft!;
    await api.createWorld!({
      name,
      seed: 'blockcraft-m20a',
      mode: 'creative',
      type: 'flat',
      spawning: false,
    });
    api.pause!();
    api.setRenderDistance!(4);
    api.setClouds!('off');
    api.setTimeOfDay!(6000);
    await api.tick!(1);
    await api.waitForTerrain!(2);
  }, name);
}

async function reloadPage(page: Page): Promise<void> {
  await page.reload();
  await page.waitForFunction(() => window.__blockcraft?.ready);
  await page.evaluate(async () => {
    await window.__blockcraft!.ready();
  });
}

/**
 * Builds a cornerless 4×5 Lumite frame on the ground facing +z, with its opening's min cell at
 * (x, GROUND + 1, z), then lights it with Ember Flint the way a player does: held, aimed at the
 * frame's bottom row from inside the opening's line of sight, and used.
 */
async function buildAndLight(page: Page, x: number, z: number) {
  return page.evaluate(
    async ({ x, z, ground }) => {
      const api = window.__blockcraft!;
      const y = ground + 1;
      api.teleport!(x + 1, y, z - 2.5, Math.PI / 2, 0);
      await api.waitForTerrain!(2);
      for (let v = -1; v <= 3; v++)
        for (let u = -1; u <= 2; u++) {
          const inside = u >= 0 && u <= 1 && v >= 0 && v <= 2;
          const corner = (u === -1 || u === 2) && (v === -1 || v === 3);
          api.setBlock!(x + u, y + v, z, inside || corner ? 'air' : 'lumite_block');
        }
      api.giveItem!('ember_flint', 1);
      const slot = api.getInventory!().findIndex((stack) => stack?.id === 'ember_flint');
      if (slot >= 0 && slot < 9) api.selectHotbarSlot!(slot);
      // Aim at the top face of the bottom row, through the empty opening.
      const eye = y + 1.62;
      api.teleport!(x + 0.5, y, z - 2.5, Math.PI / 2, -Math.atan2(eye - y, 3));
      await api.tick!(1);
      const aim = api.raycast!();
      api.input!('use', true);
      await api.tick!(1);
      api.input!('use', false);
      await api.tick!(1);
      const cells: string[] = [];
      for (let v = 0; v <= 2; v++)
        for (let u = 0; u <= 1; u++) cells.push(api.getBlock!(x + u, y + v, z).id);
      return { aim, cells, portals: api.getPortals!(), held: api.getPlayer!().selectedSlot, slot };
    },
    { x, z, ground: GROUND },
  );
}

/** Stands in the opening whose min cell is (x, y, z) until the portal has taken the player across. */
async function travelThrough(page: Page, portal: PortalRecord) {
  return page.evaluate(async (portal) => {
    const api = window.__blockcraft!;
    const before = api.getPortalTravel!().changes;
    const [px, pz] =
      portal.axis === 'x' ? [portal.x + 1, portal.z + 0.5] : [portal.x + 0.5, portal.z + 1];
    api.teleport!(px, portal.y, pz, Math.PI / 2, 0);
    await api.tick!(40);
    const halfway = api.getPortalTravel!();
    const dimensionHalfway = api.getDimension!();
    await api.tick!(40);
    await api.waitForTravel!();
    await api.tick!(1);
    const after = api.getPortalTravel!();
    return {
      halfway,
      dimensionHalfway,
      after,
      before,
      dimension: api.getDimension!(),
      player: api.getPlayer!(),
      portals: api.getPortals!(),
    };
  }, portal);
}

test('M20a: Ember Flint lights a Lumite frame and 4 s inside carries the player to the Hollowdeep and back', async ({
  page,
}) => {
  await newWorld(page, 'M20a travel');
  const lit = await buildAndLight(page, 2, 6);
  console.log('[m20a light]', JSON.stringify(lit));
  expect(lit.aim).toMatchObject({ hit: true, block: [2, GROUND, 6], face: 'top' });
  expect(lit.cells).toEqual(Array(6).fill('portal'));
  expect(lit.portals).toEqual([{ x: 2, y: GROUND + 1, z: 6, axis: 'x' }]);

  const there = await travelThrough(page, lit.portals[0]!);
  console.log('[m20a there]', JSON.stringify(there));
  // The warp ramps up while the player waits, and nothing happens before the full 80 ticks.
  expect(there.dimensionHalfway).toBe('overworld');
  expect(there.halfway.ticksInside).toBe(40);
  expect(there.halfway.warp).toBeCloseTo(0.5, 5);
  expect(there.dimension).toBe('hollowdeep');
  expect(there.player.dimension).toBe('hollowdeep');
  expect(there.after.changes).toBe(there.before + 1);
  expect(there.portals).toHaveLength(1);
  const arrival = there.portals[0]!;
  expect(Math.abs(arrival.x - 3 / 4)).toBeLessThanOrEqual(2);
  expect(Math.abs(arrival.z - 6.5 / 4)).toBeLessThanOrEqual(2);

  // Standing on in the arrival portal does not bounce the player straight back.
  const stay = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    await api.tick!(120);
    await api.waitForTravel!();
    const below = api.getPlayer!().pos;
    return {
      dimension: api.getDimension!(),
      travel: api.getPortalTravel!(),
      floor: api.getBlock!(Math.floor(below[0]), Math.floor(below[1]) - 1, Math.floor(below[2])).id,
      feet: api.getBlock!(Math.floor(below[0]), Math.floor(below[1]), Math.floor(below[2])).id,
    };
  });
  console.log('[m20a stay]', JSON.stringify(stay));
  expect(stay.dimension).toBe('hollowdeep');
  expect(stay.travel.ticksInside).toBe(0);
  expect(stay.feet).toBe('portal');
  expect(stay.floor).toBe('lumite_block');

  // Step out and back in: the return trip comes out at the original portal.
  await page.evaluate(async (portal) => {
    const api = window.__blockcraft!;
    api.teleport!(portal.x + 1, portal.y, portal.z - 1.5, Math.PI / 2, 0);
    await api.tick!(2);
  }, arrival);
  const back = await travelThrough(page, arrival);
  console.log('[m20a back]', JSON.stringify(back));
  expect(back.dimension).toBe('overworld');
  expect(back.player.dimension).toBe('overworld');
  expect(back.portals).toEqual([{ x: 2, y: GROUND + 1, z: 6, axis: 'x' }]);
  expect(Math.hypot(back.player.pos[0] - 3, back.player.pos[2] - 6.5)).toBeLessThanOrEqual(8);
});

test('M20a: a portal at (400, y, 400) opens near (100, y, 100) in the Hollowdeep, and saving there restores it', async ({
  page,
}) => {
  const WORLD = 'M20a scaled';
  await newWorld(page, WORLD);
  const lit = await buildAndLight(page, 400, 400);
  expect(lit.cells).toEqual(Array(6).fill('portal'));
  const there = await travelThrough(page, lit.portals[0]!);
  console.log('[m20a scaled]', JSON.stringify(there));
  expect(there.dimension).toBe('hollowdeep');
  expect(there.portals).toHaveLength(1);
  const arrival = there.portals[0]!;
  expect(Math.abs(arrival.x - 100)).toBeLessThanOrEqual(4);
  expect(Math.abs(arrival.z - 100)).toBeLessThanOrEqual(4);
  expect(Math.abs(there.player.pos[0] - 100.25)).toBeLessThanOrEqual(4);
  expect(Math.abs(there.player.pos[2] - 100.125)).toBeLessThanOrEqual(4);

  // Save in the Hollowdeep, reload the page and load the world: the player is back there.
  await page.evaluate(async (arrival) => {
    const api = window.__blockcraft!;
    api.teleport!(arrival.x + 1, arrival.y, arrival.z - 1.5, Math.PI / 2, 0);
    await api.tick!(2);
    await api.save!();
  }, arrival);
  const saved = await page.evaluate(() => window.__blockcraft!.getPlayer!().pos);
  await reloadPage(page);
  const restored = await page.evaluate(
    async ({ name, arrival }) => {
      const api = window.__blockcraft!;
      await api.loadWorld!(name);
      api.pause!();
      await api.tick!(1);
      await api.waitForTerrain!(2);
      return {
        dimension: api.getDimension!(),
        player: api.getPlayer!(),
        portals: api.getPortals!(),
        portalBlock: api.getBlock!(arrival.x, arrival.y, arrival.z).id,
        frameBlock: api.getBlock!(arrival.x, arrival.y - 1, arrival.z).id,
      };
    },
    { name: WORLD, arrival },
  );
  console.log('[m20a restored]', JSON.stringify(restored));
  expect(restored.dimension).toBe('hollowdeep');
  expect(restored.player.dimension).toBe('hollowdeep');
  expect(restored.portals).toEqual([arrival]);
  expect(restored.portalBlock).toBe('portal');
  expect(restored.frameBlock).toBe('lumite_block');
  expect(
    Math.hypot(restored.player.pos[0] - saved[0], restored.player.pos[2] - saved[2]),
  ).toBeLessThan(0.5);
});

test('M20a: breaking a frame block puts the portal out', async ({ page }) => {
  await newWorld(page, 'M20a break');
  const lit = await buildAndLight(page, -6, 4);
  expect(lit.cells).toEqual(Array(6).fill('portal'));
  const result = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.setBlock!(-7, 66, 4, 'air');
    await api.tick!(1);
    const cells: string[] = [];
    for (let v = 0; v <= 2; v++)
      for (let u = 0; u <= 1; u++) cells.push(api.getBlock!(-6 + u, 65 + v, 4).id);
    return { cells, portals: api.getPortals!() };
  });
  expect(result.cells).toEqual(Array(6).fill('air'));
  expect(result.portals).toEqual([]);
});

test('M20a: a lit portal glows with an animated swirl in its Lumite frame', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await newWorld(page, 'M20a screenshot');
  const lit = await buildAndLight(page, 2, 6);
  expect(lit.cells).toEqual(Array(6).fill('portal'));
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.setTimeOfDay!(13500);
    api.teleport!(3, 65, 0.5, Math.PI / 2, 0);
    await api.tick!(2);
    await api.waitForTerrain!(2);
  });
  const first = await assertAndSaveScreenshot({ name: 'm20-portal', milestone: MILESTONE });
  assertNotBlank(first);
  assertNoMissingTexture(first);
  // The surface keeps moving: a later frame of the same view differs inside the opening.
  await page.waitForTimeout(700);
  const second = await assertAndSaveScreenshot({ name: 'm20-portal-later', milestone: MILESTONE });
  let changed = 0;
  const cx = Math.floor(first.width / 2);
  const cy = Math.floor(first.height / 2);
  for (let y = cy - 20; y < cy + 20; y++)
    for (let x = cx - 20; x < cx + 20; x++) {
      const i = (y * first.width + x) * 4;
      if (
        Math.abs(first.data[i]! - second.data[i]!) +
          Math.abs(first.data[i + 1]! - second.data[i + 1]!) +
          Math.abs(first.data[i + 2]! - second.data[i + 2]!) >
        24
      )
        changed++;
    }
  expect(changed).toBeGreaterThan(40);
  publish('m20-portal');
});
