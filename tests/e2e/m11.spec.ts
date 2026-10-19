import { test, expect } from '../harness/fixture';

test.beforeEach(async ({ page }) => {
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    await api.createWorld!({
      name: 'M11a',
      seed: 'blockcraft-m11a-test',
      mode: 'survival',
      type: 'flat',
    });
    api.pause!();
    api.teleport!(0.5, 65, 0.5, 0, 0);
    await api.tick!(1);
  });
});

test('M11a submerge player for 400 ticks depletes air to 0 at tick 300 then damage 2 half-hearts per second, refilling on surface', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const api = window.__blockcraft!;

    // Encase a 1x1 shaft of water with glass so water stays in place
    // Ground is at y=64 (stone/dirt). Player at y=65.
    api.fill!(-1, 64, -1, 1, 68, 1, 'glass');
    api.fill!(0, 65, 0, 0, 67, 0, 'water');
    await api.waitForTerrain!(1);

    // Teleport inside the water shaft, submerged
    api.teleport!(0.5, 65, 0.5, 0, 0);
    api.setVitals!({ health: 20, hunger: 15, air: 300 });

    // Submerge for 299 ticks: air is still > 0
    await api.tick!(299);
    const at299 = api.getPlayer!();

    // Tick 1 more (total 300 ticks): air reaches 0, health still 20
    await api.tick!(1);
    const at300 = api.getPlayer!();

    // Tick 19 more (total 319 ticks): 19 ticks without air, health still 20
    await api.tick!(19);
    const at319 = api.getPlayer!();

    // Tick 1 more (total 320 ticks): first 2-health hit lands 20 ticks after air reached 0
    await api.tick!(1);
    const at320 = api.getPlayer!();

    // Tick 80 more (total 400 ticks submerged): 4 more hits of 2 damage = 8 damage, total 10 damage taken -> health 10
    await api.tick!(80);
    const at400 = api.getPlayer!();

    // Teleport above/out of water to surface
    api.teleport!(10.5, 65, 0.5, 0, 0);
    await api.tick!(1);
    const surfaced = api.getPlayer!();

    return { at299, at300, at319, at320, at400, surfaced };
  });

  expect(result.at299.air).toBeGreaterThan(0);
  expect(result.at300.air).toBe(0);
  expect(result.at300.health).toBe(20);
  expect(result.at319.health).toBe(20);
  expect(result.at320.health).toBe(18);
  expect(result.at400.air).toBe(0);
  expect(result.at400.health).toBe(10);
  expect(result.surfaced.air).toBe(300);
});

test('M11a standing in lava for 40 ticks deals damage and sets burning, exiting into water extinguishes', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const api = window.__blockcraft!;

    // Set up a lava chamber and a water chamber separated by stone
    // Lava pit at x=2, y=65, z=0 (ground at y=64 stone)
    api.fill!(1, 64, -1, 3, 67, 1, 'stone');
    api.setBlock!(2, 65, 0, 'lava');
    api.setBlock!(2, 66, 0, 'lava');

    // Water pit at x=6, y=65, z=0
    api.fill!(5, 64, -1, 7, 67, 1, 'stone');
    api.setBlock!(6, 65, 0, 'water');
    api.setBlock!(6, 66, 0, 'water');
    await api.waitForTerrain!(1);

    // Teleport into lava
    api.teleport!(2.5, 65, 0.5, 0, 0);
    api.setVitals!({ health: 20, hunger: 15 });

    // Stand in lava for 40 ticks (deals 4 damage every 10 ticks = 16 damage)
    await api.tick!(40);
    const inLava = api.getPlayer!();

    // Exit into water
    api.teleport!(6.5, 65, 0.5, 0, 0);
    await api.tick!(1);
    const inWater = api.getPlayer!();

    return { inLava, inWater };
  });

  expect(result.inLava.health).toBe(4);
  expect(result.inLava.burning).toBe(true);
  expect(result.inWater.burning).toBe(false);
});
