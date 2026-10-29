import { test, expect } from '../harness/fixture';
import type { Page } from '@playwright/test';

const ECS_FIRST_ID = 1 << 20;
const NOON = 6000;
const MIDNIGHT = 18000;

test.beforeEach(async ({ page }) => {
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    await api.createWorld!({
      name: 'M13f',
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
  // Only the test's own creatures: remove any others, then their drops.
  await page.evaluate(async (first) => {
    const api = window.__blockcraft!;
    for (const entity of api.getEntities!()) if (entity.id >= first) api.kill!(entity.id);
    await api.tick!(1);
    for (const item of api.getEntities!({ type: 'item' })) api.kill!(item.id);
    await api.tick!(1);
  }, ECS_FIRST_ID);
});

/** Feet height on the flat world. */
async function ground(page: Page): Promise<number> {
  return page.evaluate(() => window.__blockcraft!.getHeight!(0, 0) + 1);
}

interface Sample {
  pos: [number, number, number] | null;
  goal: string | null;
  health: number;
  player: [number, number, number];
}

/** Advances one tick and reports the mob (null position once it is gone) and the player. */
async function step(page: Page, id: number): Promise<Sample> {
  return page.evaluate(async (target) => {
    const api = window.__blockcraft!;
    await api.tick!(1);
    const entity = api.getEntities!().find((e) => e.id === target);
    const player = api.getPlayer!();
    return {
      pos: entity ? entity.pos : null,
      goal: entity ? api.getEntityAI!(target).goal : null,
      health: player.health,
      player: player.pos,
    };
  }, id);
}

test('M13f: a Hollow spawned 10 blocks away at night reaches the player and hurts them within 200 ticks', async ({
  page,
}) => {
  const y = await ground(page);
  const id = await page.evaluate(
    ([g, time]) => {
      const api = window.__blockcraft!;
      api.setTimeOfDay!(time!);
      return api.spawn!('hollow', 10.5, g!, 0.5);
    },
    [y, MIDNIGHT],
  );
  const before = (await page.evaluate(() => window.__blockcraft!.getPlayer!())).health;
  expect(before).toBe(20);
  let hurtAt = -1,
    sample: Sample | null = null;
  for (let tick = 1; tick <= 200 && hurtAt < 0; tick++) {
    sample = await step(page, id);
    if (sample.health < before) hurtAt = tick;
  }
  console.log('M13f Hollow hit at tick', hurtAt, 'health', sample?.health, 'at', sample?.pos);
  expect(hurtAt).toBeGreaterThan(0);
  expect(sample!.goal).toBe('melee_attack');
  // It is next to the player when the hit lands.
  const gap = Math.hypot(sample!.pos![0] - sample!.player[0], sample!.pos![2] - sample!.player[2]);
  expect(gap).toBeLessThan(2);
});

test('M13f: a Hollow in daylight walks into shade within 300 ticks', async ({ page }) => {
  const y = await ground(page);
  // A roof two blocks up, 8 blocks east: the cells under it have sky light below 15.
  const setup = await page.evaluate(
    async ([g, time]) => {
      const api = window.__blockcraft!;
      api.setTimeOfDay!(time!);
      api.setGameMode!('creative');
      api.teleport!(-12.5, g!, 0.5, 0, 0);
      api.fill!(8, g! + 2, -1, 10, g! + 2, 1, 'stone');
      await api.tick!(5);
      return {
        open: api.getLight!(0, g! + 1, 0).sky,
        shade: api.getLight!(9, g! + 1, 0).sky,
        id: api.spawn!('hollow', 0.5, g!, 0.5),
      };
    },
    [y, NOON],
  );
  expect(setup.open).toBe(15);
  expect(setup.shade).toBeLessThan(15);
  let shadedAt = -1,
    sample: Sample | null = null;
  const goals = new Set<string | null>();
  for (let tick = 1; tick <= 300 && shadedAt < 0; tick++) {
    sample = await step(page, setup.id);
    goals.add(sample.goal);
    const head = await page.evaluate(
      ([x, hy, z]) => window.__blockcraft!.getLight!(x!, hy!, z!).sky,
      [Math.floor(sample.pos![0]), Math.floor(sample.pos![1] + 1.9), Math.floor(sample.pos![2])],
    );
    if (head < 15) shadedAt = tick;
  }
  console.log('M13f Hollow shaded at tick', shadedAt, 'at', sample?.pos, 'goals', [...goals]);
  expect(goals.has('avoid_sunlight')).toBe(true);
  expect(shadedAt).toBeGreaterThan(0);
  expect(sample!.pos![0]).toBeGreaterThan(7);
});

test('M13f: a Skitterer climbs a 6-block wall to reach the player', async ({ page }) => {
  const y = await ground(page);
  const id = await page.evaluate(
    async ([g, time]) => {
      const api = window.__blockcraft!;
      api.setTimeOfDay!(time!);
      // A 6-block-high stone block; the player stands on top of it.
      api.fill!(3, g!, -3, 8, g! + 5, 3, 'stone');
      api.teleport!(6.5, g! + 6, 0.5, Math.PI, 0);
      await api.tick!(2);
      return api.spawn!('skitterer', 0.5, g!, 0.5);
    },
    [y, MIDNIGHT],
  );
  const before = (await page.evaluate(() => window.__blockcraft!.getPlayer!())).health;
  let top = -Infinity,
    climbing = false,
    hurtAt = -1,
    sample: Sample | null = null;
  for (let tick = 1; tick <= 400 && hurtAt < 0; tick++) {
    sample = await step(page, id);
    top = Math.max(top, sample.pos![1]);
    // On the wall face: off the ground, beside the block, below its top.
    if (sample.pos![0] < 3 && sample.pos![1] > y + 2 && sample.pos![1] < y + 6) climbing = true;
    if (sample.health < before) hurtAt = tick;
  }
  console.log('M13f Skitterer hit at tick', hurtAt, 'highest', top - y, 'at', sample?.pos);
  expect(climbing).toBe(true);
  expect(top).toBeGreaterThanOrEqual(y + 6 - 1e-3);
  expect(hurtAt).toBeGreaterThan(0);
  expect(sample!.pos![1]).toBeGreaterThanOrEqual(y + 6 - 1e-3);
});

test('M13f: a Sporeburst swells for 30 ticks and bursts, hurting the player; running > 7 blocks away cancels it', async ({
  page,
}) => {
  const y = await ground(page);
  await page.evaluate((time) => window.__blockcraft!.setTimeOfDay!(time), MIDNIGHT);

  // Burst: the player stands still 2.5 blocks away.
  const burster = await page.evaluate(
    (g) => window.__blockcraft!.spawn!('sporeburst', 3, g, 0.5),
    y,
  );
  let sample: Sample = await step(page, burster);
  for (let tick = 0; tick < 10 && sample.goal !== 'swell'; tick++)
    sample = await step(page, burster);
  expect(sample.goal).toBe('swell');
  // Ticks from the first swelling tick to the burst, both included.
  let swell = 1;
  while (sample.pos && swell < 60) {
    sample = await step(page, burster);
    swell++;
  }
  console.log('M13f Sporeburst burst after', swell, 'swell ticks; player health', sample.health);
  expect(sample.pos).toBeNull();
  expect(swell).toBe(30);
  expect(sample.health).toBeLessThan(20);
  const clouds = await page.evaluate(
    () => window.__blockcraft!.getEntities!({ type: 'spore_cloud' }).length,
  );
  expect(clouds).toBe(1);
  expect(
    await page.evaluate((g) => {
      const api = window.__blockcraft!;
      let removed = 0;
      for (let x = 1; x <= 5; x++)
        for (let z = -2; z <= 2; z++) if (api.getBlock!(x, g - 1, z).id === 'air') removed++;
      return removed;
    }, y),
  ).toBeGreaterThan(0);

  // Cancel: the player sprints away from a second one once it starts to swell.
  const health = sample.health;
  const runner = await page.evaluate(async (g) => {
    const api = window.__blockcraft!;
    api.teleport!(-30.5, g, 0.5, Math.PI, 0);
    await api.tick!(1);
    return api.spawn!('sporeburst', -28, g, 0.5);
  }, y);
  sample = await step(page, runner);
  for (let tick = 0; tick < 10 && sample.goal !== 'swell'; tick++)
    sample = await step(page, runner);
  expect(sample.goal).toBe('swell');
  await page.evaluate(() => {
    const api = window.__blockcraft!;
    api.input!('forward', true);
    api.input!('sprint', true);
  });
  let ticks = 0;
  while (sample.goal === 'swell' && ticks < 40) {
    ticks++;
    sample = await step(page, runner);
  }
  const distance = Math.hypot(sample.pos![0] - sample.player[0], sample.pos![2] - sample.player[2]);
  console.log('M13f Sporeburst swell cancelled after', ticks, 'ticks at distance', distance);
  expect(ticks).toBeLessThan(30);
  expect(distance).toBeGreaterThan(7);
  // It is still there and still chasing, and nothing burst.
  for (let n = 0; n < 20; n++) sample = await step(page, runner);
  expect(sample.pos).not.toBeNull();
  expect(sample.goal).not.toBe('swell');
  // Natural regeneration may heal a little, but nothing hurt the player.
  expect(sample.health).toBeGreaterThanOrEqual(health);
  await page.evaluate(() => {
    const api = window.__blockcraft!;
    api.input!('forward', false);
    api.input!('sprint', false);
  });
});
