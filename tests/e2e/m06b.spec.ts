import { test, expect } from '../harness/fixture';
import { PNG } from 'pngjs';
import {
  assertNotBlank,
  assertNoMissingTexture,
  regionMeanColor,
  diffFraction,
} from '../harness/pixels';
import { genLadder, genVine } from '../../src/render/textures/climbing';
import {
  genPlayerHead,
  genPlayerHair,
  genPlayerCoat,
  genPlayerLeg,
} from '../../src/render/textures/player';

// All movement advances debug ticks; frame barriers only wait for presentation.
test.beforeEach(async ({ page }) => {
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    await api.createWorld!({
      name: 'M06b',
      seed: 'blockcraft-test-seed-42',
      mode: 'survival',
      type: 'flat',
    });
    api.pause!();
    api.setTimeOfDay!(6000);
    api.teleport!(0.5, 65, 0.5, 0, 0);
    await api.tick!(1);
  });
});

test('M06b swimming rises, surface bobs and jump climbs out onto a one-block bank', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.fill!(-4, 65, -4, 12, 69, 4, 'water');
    api.fill!(2, 65, -4, 12, 70, 4, 'stone');
    await api.waitForTerrain!(1);
    api.teleport!(0.5, 66, 0.5);
    api.input!('jump', true);
    await api.tick!(4);
    const rising = api.getPlayer!();
    await api.tick!(40);
    const bob = api.getPlayer!();
    const bobSamples = [];
    for (let i = 0; i < 20; i++) {
      await api.tick!(1);
      bobSamples.push(api.getPlayer!().pos[1]);
    }
    api.input!('forward', true);
    await api.tick!(25);
    api.input!('forward', false);
    api.input!('jump', false);
    await api.tick!(20);
    return { rising, bob, bobSamples, bank: api.getPlayer!() };
  });
  expect(result.rising.inFluid).toBe('water');
  expect(result.rising.pos[1]).toBeGreaterThan(66.3);
  expect(result.bob.pos[1]).toBeGreaterThan(69.45);
  expect(result.bob.pos[1]).toBeLessThan(69.55);
  expect(Math.max(...result.bobSamples) - Math.min(...result.bobSamples)).toBeGreaterThan(0.07);
  expect(result.bob.inFluid).toBe('water');
  expect(result.bank.pos[0]).toBeGreaterThan(2.3);
  expect(result.bank.pos[1]).toBe(71);
  expect(result.bank.inFluid).toBeNull();
  expect(result.bank.health).toBe(20);
});

test('M06b ladder and vine climb, capped descent and sneak hold', async ({ page }) => {
  const samples = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    const results = [];
    api.fill!(1, 65, -1, 1, 85, 4, 'stone');
    for (const [block, z] of [
      ['ladder', 0],
      ['vine', 3],
    ] as const)
      for (let y = 65; y <= 85; y++) api.setBlock!(0, y, z, block, { facing: 'west' });
    await api.waitForTerrain!(1);
    for (const z of [0.5, 3.5]) {
      api.teleport!(0.5, 70, z, 0, 0);
      api.input!('forward', true);
      await api.tick!(20);
      const up = api.getPlayer!();
      api.input!('forward', false);
      await api.tick!(10);
      const start = api.getPlayer!();
      await api.tick!(20);
      const down = api.getPlayer!();
      api.input!('sneak', true);
      await api.tick!(20);
      const held = api.getPlayer!();
      api.input!('sneak', false);
      api.input!('jump', true);
      await api.tick!(10);
      const jump = api.getPlayer!();
      api.input!('jump', false);
      results.push({ up, start, down, held, jump });
    }
    return results;
  });
  for (const s of samples) {
    expect(s.up.pos[1]).toBeCloseTo(72.35);
    expect(s.start.pos[1] - s.down.pos[1]).toBeCloseTo(2.35);
    expect(s.down.vel[1]).toBeCloseTo(-2.35);
    expect(s.held.pos[1]).toBe(s.down.pos[1]);
    expect(s.jump.pos[1] - s.held.pos[1]).toBeCloseTo(1.175);
    expect(s.jump.health).toBe(20);
  }
});

test('M06b Mire distance is 0.4 times normal ground over 100 ticks', async ({ page }) => {
  const distances = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.input!('forward', true);
    await api.tick!(100);
    api.input!('forward', false);
    const normal = api.getPlayer!().pos[0] - 0.5;
    api.fill!(-2, 64, -2, 30, 64, 2, 'mire');
    await api.waitForTerrain!(1);
    api.teleport!(0.5, 65, 0.5);
    api.input!('forward', true);
    await api.tick!(100);
    return { normal, slowed: api.getPlayer!().pos[0] - 0.5, player: api.getPlayer!() };
  });
  expect(distances.slowed / distances.normal).toBeGreaterThan(0.39);
  expect(distances.slowed / distances.normal).toBeLessThan(0.41);
  expect(distances.player.onGround).toBe(true);
  expect(distances.player.pos[1]).toBe(65);
});

test('M06b third-person ray avoids wall behind player, F5 cycles and model only draws in third person', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.fill!(-3, 65, -4, -3, 69, 4, 'stone');
    // Settle the whole view before comparing first-person frames across F5 cycles.
    await api.waitForTerrain!(8);
    api.teleport!(0.5, 65, 0.5, 0, -0.12);
    await api.tick!(0);
  });
  const first = await assertAndSaveScreenshot({
    name: 'm06-first-person-before',
    milestone: 'M06b',
  });
  await page.evaluate(() => {
    const api = window.__blockcraft!;
    api.input!('perspective', true);
    api.input!('perspective', false);
  });
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.__blockcraft!.getRenderStats())).playerModelParts,
    )
    .toBe(6);
  const back = await page.evaluate(() => window.__blockcraft!.getRenderStats());
  expect(back.perspective).toBe(1);
  expect(back.cameraPosition[0]).toBeGreaterThan(-2);
  expect(back.cameraPosition[0]).toBeLessThan(-1.5);
  expect(
    await page.evaluate(
      ([x, y, z]) =>
        window.__blockcraft!.getBlock!(Math.floor(x!), Math.floor(y!), Math.floor(z!)).id,
      back.cameraPosition,
    ),
  ).toBe('air');
  const shot = await assertAndSaveScreenshot({ name: 'm06-third-person', milestone: 'M06b' });
  assertNotBlank(shot);
  assertNoMissingTexture(shot);
  await page.keyboard.press('F5');
  expect((await page.evaluate(() => window.__blockcraft!.getRenderStats())).perspective).toBe(2);
  await page.evaluate(() => {
    const api = window.__blockcraft!;
    api.input!('perspective', true);
    api.input!('perspective', false);
  });
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.__blockcraft!.getRenderStats())).playerModelParts,
    )
    .toBe(0);
  expect((await page.evaluate(() => window.__blockcraft!.getRenderStats())).perspective).toBe(0);
  const restored = await assertAndSaveScreenshot({
    name: 'm06-first-person-after',
    milestone: 'M06b',
  });
  expect(diffFraction(first, restored)).toBeLessThan(0.0001);
});

test('M06b sprint FOV eases to 77 and back to 70 using ticks', async ({ page }) => {
  const samples = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.input!('forward', true);
    api.input!('sprint', true);
    await api.tick!(1);
    const one = api.getRenderStats().cameraFov;
    await api.tick!(4);
    const sprint = api.getRenderStats().cameraFov;
    api.input!('sprint', false);
    await api.tick!(1);
    const out = api.getRenderStats().cameraFov;
    await api.tick!(4);
    return { one, sprint, out, end: api.getRenderStats().cameraFov };
  });
  expect(samples.one).toBeCloseTo(71.4);
  expect(samples.sprint).toBeCloseTo(77);
  expect(samples.out).toBeCloseTo(75.6);
  expect(samples.end).toBeCloseTo(70);
});

test('M06b underwater blue tint, 2–24 fog, deep seabed visibility and night brightness', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    // Surface y=85, seabed y=65: 20 blocks. Camera is 4.38 below the surface.
    api.fill!(-15, 65, -15, 15, 84, 15, 'water');
    for (let x = -14; x <= 14; x++)
      for (let z = -14; z <= 14; z++)
        api.setBlock!(x, 64, z, (x + z) % 4 === 0 ? 'cobblestone' : 'sand');
    api.fill!(5, 65, -4, 7, 66, 4, 'cobblestone');
    await api.waitForTerrain!(1);
    api.teleport!(0.5, 79, 0.5, 0, -1.15);
    await api.tick!(0);
  });
  await expect
    .poll(async () => (await page.evaluate(() => window.__blockcraft!.getRenderStats())).underwater)
    .toBe(true);
  const stats = await page.evaluate(() => window.__blockcraft!.getRenderStats());
  expect(stats.underwaterFog).toEqual([2, 24]);
  expect(stats.underwaterBrightnessFloor).toBeCloseTo(0.28);
  const shot = await assertAndSaveScreenshot({ name: 'm06-underwater', milestone: 'M06b' });
  assertNotBlank(shot);
  assertNoMissingTexture(shot);
  const mean = regionMeanColor(shot, { x: 400, y: 360, width: 480, height: 300 });
  expect(mean[2]).toBeGreaterThan(mean[0] + 12);
  const pixels: number[] = [];
  for (let y = 400; y < 660; y++)
    for (let x = 420; x < 860; x++) {
      const i = (y * shot.width + x) * 4;
      pixels.push(shot.data[i]! * 0.2126 + shot.data[i + 1]! * 0.7152 + shot.data[i + 2]! * 0.0722);
    }
  const average = pixels.reduce((a, b) => a + b, 0) / pixels.length;
  const deviation = Math.sqrt(pixels.reduce((a, b) => a + (b - average) ** 2, 0) / pixels.length);
  console.log(
    'M06b underwater seabed luminance/standard deviation:',
    average,
    deviation,
    'RGB:',
    mean,
  );
  expect(average).toBeGreaterThan(15);
  expect(deviation).toBeGreaterThan(2);
  await page.evaluate(() => window.__blockcraft!.setTimeOfDay!(18000));
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.__blockcraft!.getRenderStats()))
          .underwaterBrightnessFloor,
    )
    .toBeLessThan(0.05);
  const night = await assertAndSaveScreenshot({ name: 'm06-underwater-night', milestone: 'M06b' });
  const nightMean = regionMeanColor(night, { x: 400, y: 360, width: 480, height: 300 });
  expect(nightMean[2]).toBeLessThan(mean[2] * 0.5);
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.setTimeOfDay!(6000);
    api.teleport!(0.5, 85, 0.5, 0, -0.4);
    await api.tick!(0);
  });
  await expect
    .poll(async () => (await page.evaluate(() => window.__blockcraft!.getRenderStats())).underwater)
    .toBe(false);
  expect(
    (await page.evaluate(() => window.__blockcraft!.getRenderStats())).underwaterBrightnessFloor,
  ).toBe(0);
});

test('M06b ladder/vine faces and procedural texture repeats', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.fill!(4, 65, -3, 4, 70, 3, 'stone');
    for (let y = 65; y <= 69; y++) {
      api.setBlock!(3, y, -1, 'ladder', { facing: 'west' });
      api.setBlock!(3, y, 1, 'vine', { facing: 'west' });
    }
    await api.waitForTerrain!(1);
    api.teleport!(0.5, 66, 0.5, 0, 0);
    await api.tick!(0);
  });
  const wall = await assertAndSaveScreenshot({ name: 'm06-ladder-vine', milestone: 'M06b' });
  assertNotBlank(wall);
  assertNoMissingTexture(wall);
  const generators = [
    genPlayerHead,
    genPlayerHair,
    genPlayerCoat,
    genPlayerLeg,
    genLadder,
    genVine,
  ];
  const png = new PNG({ width: generators.length * 200 - 8, height: 192 });
  png.data.fill(80);
  for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255;
  generators.forEach((gen, t) => {
    const tile = gen(42);
    for (let y = 0; y < 192; y++)
      for (let x = 0; x < 192; x++) {
        const src = ((Math.floor(y / 4) % 16) * 16 + (Math.floor(x / 4) % 16)) * 4,
          dst = (y * png.width + t * 200 + x) * 4;
        if (tile[src + 3]) for (let c = 0; c < 4; c++) png.data[dst + c] = tile[src + c]!;
      }
  });
  await page.setContent(
    `<body style="margin:0;background:#505050"><img style="margin:32px" src="data:image/png;base64,${PNG.sync.write(png).toString('base64')}" /></body>`,
  );
  const sheet = await assertAndSaveScreenshot({ name: 'm06-texture-sheet', milestone: 'M06b' });
  assertNotBlank(sheet);
  assertNoMissingTexture(sheet);
});
