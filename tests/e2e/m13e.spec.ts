import { test, expect } from '../harness/fixture';
import type { Page } from '@playwright/test';

const ECS_FIRST_ID = 1 << 20;

test.beforeEach(async ({ page }) => {
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    await api.createWorld!({
      name: 'M13e',
      seed: 'blockcraft-test-seed-42',
      mode: 'survival',
      type: 'flat',
    });
    api.pause!();
    // Adopt the camera's spawn view before positioning the player.
    api.input!('forward', true);
    api.input!('forward', false);
    api.teleport!(0.5, api.getHeight!(0, 0) + 1, 0.5, 0, 0);
    await api.tick!(1);
  });
  // Clear naturally spawned creatures so only the test's own are near the player. Their drops
  // appear on the next tick; remove them before the player can pick any up.
  const inventory = await page.evaluate(async (first) => {
    const api = window.__blockcraft!;
    for (const entity of api.getEntities!()) if (entity.id >= first) api.kill!(entity.id);
    await api.tick!(1);
    for (const item of api.getEntities!({ type: 'item' })) api.kill!(item.id);
    await api.tick!(24);
    return api.getInventory!();
  }, ECS_FIRST_ID);
  expect(inventory.filter((stack) => stack !== null)).toEqual([]);
});

/** Feet height on the flat world. */
async function ground(page: Page): Promise<number> {
  return page.evaluate(() => window.__blockcraft!.getHeight!(0, 0) + 1);
}

/** Turns the player's view to the middle of an entity's body. */
async function aimAt(page: Page, id: number, height: number): Promise<void> {
  await page.evaluate(
    ([target, h]) => {
      const api = window.__blockcraft!;
      const entity = api.getEntities!().find((e) => e.id === target)!;
      const player = api.getPlayer!();
      const eye = [player.pos[0], player.pos[1] + 1.62, player.pos[2]];
      const dx = entity.pos[0] - eye[0]!,
        dy = entity.pos[1] + h! - eye[1]!,
        dz = entity.pos[2] - eye[2]!;
      api.look!(Math.atan2(dz, dx), Math.atan2(dy, Math.hypot(dx, dz)));
    },
    [id, height],
  );
}

/** One press of an input action, held for one tick. */
async function press(page: Page, action: 'attack' | 'use'): Promise<void> {
  await page.evaluate(async (a) => {
    const api = window.__blockcraft!;
    api.input!(a, true);
    await api.tick!(1);
    api.input!(a, false);
  }, action);
}

async function health(page: Page, id: number): Promise<number> {
  return page.evaluate((target) => {
    const entity = window.__blockcraft!.getEntities!().find((e) => e.id === target);
    if (!entity) throw new Error(`Entity ${target} is gone`);
    return entity.health;
  }, id);
}

test('M13e: striking a Tuftbuck while falling deals 1.5× damage and knocks it back', async ({
  page,
}) => {
  const y = await ground(page);
  const [falling, standing] = await page.evaluate((g) => {
    const api = window.__blockcraft!;
    return [api.spawn!('tuftbuck', 0.5, g, 0.5), api.spawn!('tuftbuck', 10.5, g, 0.5)];
  }, y);
  expect(await health(page, falling)).toBe(10);
  expect(await health(page, standing)).toBe(10);

  // Crit: drop the player from 1.5 blocks up, 1.5 blocks from the Tuftbuck, and swing mid-fall.
  await page.evaluate(async (g) => {
    const api = window.__blockcraft!;
    api.teleport!(0.5, g + 1.5, -1, Math.PI / 2, -0.8);
    await api.tick!(2);
  }, y);
  const midFall = await page.evaluate(() => window.__blockcraft!.getPlayer!());
  expect(midFall.onGround).toBe(false);
  expect(midFall.vel[1]).toBeLessThan(0);
  expect(midFall.pos[1]).toBeGreaterThan(y + 0.5);
  await aimAt(page, falling, 0.65);
  await press(page, 'attack');
  const critDamage = 10 - (await health(page, falling));
  const knock = await page.evaluate((target) => {
    const api = window.__blockcraft!;
    const entity = api.getEntities!().find((e) => e.id === target)!;
    const player = api.getPlayer!();
    const vel = api.getEntityAI!(target).vel;
    const dx = entity.pos[0] - player.pos[0],
      dz = entity.pos[2] - player.pos[2];
    const length = Math.hypot(dx, dz);
    return { away: (vel[0] * dx + vel[2] * dz) / length, vel };
  }, falling);
  console.log('M13e crit damage', critDamage, 'knockback velocity', knock.vel, 'away', knock.away);
  expect(knock.away).toBeGreaterThan(0);

  // The same swing standing on the ground, at a full meter, on the second Tuftbuck.
  await page.evaluate(async (g) => {
    const api = window.__blockcraft!;
    api.teleport!(10.5, g, -1, Math.PI / 2, 0);
    await api.tick!(10);
  }, y);
  const grounded = await page.evaluate(() => window.__blockcraft!.getPlayer!());
  expect(grounded.onGround).toBe(true);
  await aimAt(page, standing, 0.65);
  await press(page, 'attack');
  const plainDamage = 10 - (await health(page, standing));
  console.log('M13e grounded damage', plainDamage);
  expect(plainDamage).toBeGreaterThan(0);
  expect(critDamage).toBeCloseTo(1.5 * plainDamage, 6);
});

test('M13e: 2 Tuftbucks fed wheat within 5 blocks produce a baby within 100 ticks', async ({
  page,
}) => {
  const y = await ground(page);
  const [a, b] = await page.evaluate((g) => {
    const api = window.__blockcraft!;
    api.giveItem!('wheat', 2);
    return [api.spawn!('tuftbuck', 0.5, g, 0.5), api.spawn!('tuftbuck', 5.5, g, 0.5)];
  }, y);
  const inventory = await page.evaluate(() => window.__blockcraft!.getInventory!());
  const selected = (await page.evaluate(() => window.__blockcraft!.getPlayer!())).selectedSlot;
  expect(inventory[selected]).toMatchObject({ id: 'wheat', count: 2 });

  for (const [id, x] of [
    [a, 0.5],
    [b, 5.5],
  ] as const) {
    await page.evaluate(
      ([px, g]) => window.__blockcraft!.teleport!(px!, g!, -1.5, Math.PI / 2, 0),
      [x, y],
    );
    await aimAt(page, id, 0.65);
    await press(page, 'use');
    expect(
      (await page.evaluate((target) => window.__blockcraft!.getEntityAI!(target), id)).love,
    ).toBeGreaterThan(0);
  }
  // Both wheat were eaten.
  const after = await page.evaluate(() => window.__blockcraft!.getInventory!());
  expect(after.some((stack) => stack?.id === 'wheat')).toBe(false);

  let babyAt = -1;
  let baby: { id: number; pos: [number, number, number] } | null = null;
  for (let ticks = 0; ticks < 100 && baby === null; ticks += 5) {
    baby = await page.evaluate(
      async ([parentA, parentB]) => {
        const api = window.__blockcraft!;
        await api.tick!(5);
        const found = api.getEntities!({ type: 'tuftbuck' }).find(
          (e) => e.id !== parentA && e.id !== parentB && api.getEntityAI!(e.id).baby,
        );
        return found ? { id: found.id, pos: found.pos } : null;
      },
      [a, b],
    );
    if (baby) babyAt = ticks + 5;
  }
  console.log('M13e baby', baby, 'within', babyAt, 'ticks');
  expect(baby).not.toBeNull();
  expect(babyAt).toBeLessThanOrEqual(100);
  // Born between its parents, and still a baby (it grows up over 24000 ticks).
  expect(baby!.pos[0]).toBeGreaterThan(-2);
  expect(baby!.pos[0]).toBeLessThan(8);
  const ai = await page.evaluate((id) => window.__blockcraft!.getEntityAI!(id), baby!.id);
  expect(ai.baby).toBe(true);
  expect(ai.ageTicks).toBeLessThan(200);
});
