import { test, expect } from '../harness/fixture';
import type { Page } from '@playwright/test';

const FIRST = 1 << 20;
test.beforeEach(async ({ page }) => {
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    await api.createWorld!({
      name: 'M13h',
      seed: 'blockcraft-test-seed-42',
      mode: 'survival',
      type: 'flat',
    });
    api.pause!();
    api.input!('forward', true);
    api.input!('forward', false);
    api.teleport!(0.5, api.getHeight!(0, 0) + 1, 0.5, Math.PI, 0);
    await api.tick!(1);
  });
});

async function setup(page: Page, distance = 10) {
  return page.evaluate(
    ({ first, distance }) => {
      const api = window.__blockcraft!;
      for (const entity of api.getEntities!()) if (entity.id >= first) api.kill!(entity.id);
      const y = api.getHeight!(0, 0) + 1;
      api.setTimeOfDay!(18000);
      api.teleport!(0.5, y, 0.5, Math.PI, 0);
      return { id: api.spawn!('cinderwraith', distance + 0.5, y, 0.5), y };
    },
    { first: FIRST, distance },
  );
}

/** The local model's face lies forward of the feet; aim at eye height using its real body yaw. */
async function lookAtEyes(page: Page, id: number) {
  await page.evaluate((id) => {
    const api = window.__blockcraft!;
    const mob = api.getEntities!({ type: 'cinderwraith' }).find((e) => e.id === id)!;
    const yaw = api.getEntityAI!(id).yaw!;
    const p = api.getPlayer!();
    const x = mob.pos[0] + Math.cos(yaw) * 0.65;
    const z = mob.pos[2] + Math.sin(yaw) * 0.65;
    const dx = x - p.pos[0],
      dz = z - p.pos[2];
    api.look!(
      Math.atan2(dz, dx),
      Math.atan2(mob.pos[1] + 22.5 / 16 - (p.pos[1] + 1.62), Math.hypot(dx, dz)),
    );
  }, id);
}

test('M13h: neutral for 200 ticks looking away; gaze provokes pursuit and damage within 200 ticks', async ({
  page,
}) => {
  const { id } = await setup(page);
  const neutral = await page.evaluate(async (id) => {
    const api = window.__blockcraft!;
    const before = api.getPlayer!().health;
    await api.tick!(200);
    return { before, health: api.getPlayer!().health, ai: api.getEntityAI!(id) };
  }, id);
  expect(neutral.ai.target).toBeNull();
  expect(neutral.health).toBe(neutral.before);
  await lookAtEyes(page, id);
  const result = await page.evaluate(async (id) => {
    const api = window.__blockcraft!;
    const before = api.getPlayer!().health;
    await api.tick!(1);
    const target = api.getEntityAI!(id).target;
    let ticks = 1;
    while (ticks < 200 && api.getPlayer!().health >= before) {
      await api.tick!(1);
      ticks++;
    }
    return {
      target,
      ticks,
      before,
      player: api.getPlayer!(),
      mob: api.getEntities!({ type: 'cinderwraith' }).find((e) => e.id === id)!,
      ai: api.getEntityAI!(id),
    };
  }, id);
  expect(result.target).toBe(0);
  expect(result.player.health).toBeLessThan(result.before);
  expect(result.ai.goal).toBe('melee_attack');
  expect(
    Math.hypot(result.mob.pos[0] - result.player.pos[0], result.mob.pos[2] - result.player.pos[2]),
  ).toBeLessThan(2);
  console.log('M13h gaze hit at tick', result.ticks, 'health', result.player.health);
});

test('M13h: hitting a neutral Cinderwraith provokes it and teleports at least four blocks to a safe spot', async ({
  page,
}) => {
  const { id, y } = await setup(page, 2);
  // Body aim: below the head, so the attack itself must be the provocation.
  await page.evaluate(
    async ({ id }) => {
      const api = window.__blockcraft!;
      api.look!(0, Math.atan2(0.8 - 1.62, 2));
      await api.tick!(1);
      const target = api.getEntityAI!(id).target;
      if (target !== null) throw new Error('Body aim provoked a neutral creature');
      api.input!('attack', true);
      await api.tick!(1);
      api.input!('attack', false);
    },
    { id, y },
  );
  const landing = await page.evaluate(
    ({ id, y }) => {
      const api = window.__blockcraft!;
      const entity = api.getEntities!({ type: 'cinderwraith' }).find((e) => e.id === id)!;
      const [x, py, z] = entity.pos;
      const bx = Math.floor(x),
        by = Math.floor(py + 0.01),
        bz = Math.floor(z);
      return {
        entity,
        target: api.getEntityAI!(id).target,
        distance: Math.hypot(x - 2.5, py - y, z - 0.5),
        below: api.getBlock!(bx, by - 1, bz).id,
        feet: api.getBlock!(bx, by, bz).id,
        head: api.getBlock!(bx, by + 1, bz).id,
      };
    },
    { id, y },
  );
  expect(landing.entity.health).toBeLessThan(30);
  expect(landing.target).toBe(0);
  expect(landing.distance).toBeGreaterThanOrEqual(4);
  expect(landing.distance).toBeLessThanOrEqual(16.1);
  expect(['grass_block', 'dirt', 'stone', 'foundation_stone']).toContain(landing.below);
  expect(landing.feet).toBe('air');
  expect(landing.head).toBe('air');
  console.log('M13h hurt teleport', landing.distance, 'to', landing.entity.pos);
});

test('M13h: visual review at dusk and daylight close-up', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await page.evaluate(async (first) => {
    const api = window.__blockcraft!;
    api.setGameMode!('creative');
    for (const e of api.getEntities!()) if (e.id >= first) api.kill!(e.id);
    const y = api.getHeight!(0, 0) + 1;
    // Choose a front-facing spawn using the sanctioned debug API, without changing its pose.
    let chosen = -1;
    for (let attempt = 0; attempt < 100 && chosen < 0; attempt++) {
      const id = api.spawn!('cinderwraith', 0.5, y, 0.5);
      const yaw = api.getEntityAI!(id).yaw!;
      if (Math.abs(Math.atan2(Math.sin(yaw), Math.cos(yaw))) < 0.3) chosen = id;
      else api.kill!(id);
    }
    if (chosen < 0) throw new Error('No front-facing Cinderwraith found');
    await api.tick!(26);
    for (const e of api.getEntities!({ type: 'item' })) api.kill!(e.id);
    api.teleport!(4.4, y + 0.25, 2.5, Math.atan2(-2, -3.9), -0.17);
    api.setWeather!('clear');
    api.setTimeOfDay!(11900);
  }, FIRST);
  // Wait for rendered frames, preserving the paused pose and live sparks.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const dusk = await assertAndSaveScreenshot({ milestone: 'm13h', name: 'm13-cinderwraith' });
  let red = 0;
  for (let i = 0; i < dusk.data.length; i += 4)
    if (dusk.data[i]! > 150 && dusk.data[i + 1]! < 110 && dusk.data[i + 2]! < 100) red++;
  expect(red).toBeGreaterThan(10);
  await page.evaluate(() => {
    const api = window.__blockcraft!;
    const y = api.getHeight!(0, 0) + 1;
    api.teleport!(3.2, y + 0.15, 1.8, Math.atan2(-1.3, -2.7), -0.22);
    api.setTimeOfDay!(6000);
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await assertAndSaveScreenshot({ milestone: 'm13h', name: 'm13-cinderwraith-daylight' });
});
