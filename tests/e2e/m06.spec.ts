import { test, expect } from '../harness/fixture';
import { PNG } from 'pngjs';
import { genHayTop, genHaySide } from '../../src/render/textures/hay';
import { assertNotBlank, assertNoMissingTexture } from '../harness/pixels';

// Every physics assertion advances the same paused tick function; no elapsed-time movement.
test.beforeEach(async ({ page }) => {
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    await api.createWorld!({
      name: 'M06a',
      seed: 'blockcraft-test-seed-42',
      mode: 'survival',
      type: 'flat',
    });
    api.pause!();
    api.teleport!(0.5, 65, 0.5, 0, 0);
    await api.tick!(1);
  });
});

test('M06a forward walks 21.5 ± 0.5 blocks in 100 ticks', async ({ page }) => {
  const player = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.input!('forward', true);
    await api.tick!(100);
    api.input!('forward', false);
    return api.getPlayer!();
  });
  expect(player.pos[0] - 0.5).toBeGreaterThanOrEqual(21);
  expect(player.pos[0] - 0.5).toBeLessThanOrEqual(22);
  expect(player.pos[1]).toBe(65);
  expect(player.onGround).toBe(true);
});

test('M06a sprint wall, one-block standing gap and 1.5-block sneaking gap', async ({ page }) => {
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.fill!(3, 65, -1, 3, 68, 1, 'stone');
    await api.waitForTerrain!(1);
    api.input!('sprint', true);
    api.input!('forward', true);
    await api.tick!(100);
  });
  expect((await page.evaluate(() => window.__blockcraft!.getPlayer!())).pos[0]).toBeCloseTo(2.7);
  const gaps = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.input!('sprint', false);
    api.fill!(3, 65, -1, 3, 68, 1, 'air');
    // One-block gap, then top slabs leave exactly 1.5 blocks of headroom.
    api.fill!(2, 66, -1, 8, 66, 1, 'stone');
    await api.waitForTerrain!(1);
    api.teleport!(0.5, 65, 0.5, 0, 0);
    await api.tick!(60);
    const one = api.getPlayer!();
    api.fill!(2, 66, -1, 8, 66, 1, 'air');
    for (let x = 2; x <= 8; x++)
      for (let z = -1; z <= 1; z++) api.setBlock!(x, 66, z, 'stone_slab', { half: 'top' });
    await api.waitForTerrain!(1);
    api.teleport!(0.5, 65, 0.5, 0, 0);
    await api.tick!(60);
    const standing = api.getPlayer!();
    api.input!('sneak', true);
    await api.tick!(60);
    const sneaking = api.getPlayer!();
    api.input!('sneak', false);
    await api.tick!(1);
    const released = api.getPlayer!();
    return { one, standing, sneaking, released };
  });
  expect(gaps.one.pos[0]).toBeCloseTo(1.7);
  expect(gaps.standing.pos[0]).toBeCloseTo(1.7);
  expect(gaps.sneaking.pos[0]).toBeGreaterThan(5);
  expect(gaps.sneaking.pos[1]).toBe(65);
  // Releasing sneak under the roof keeps the smaller eye height until standing fits.
  expect(gaps.released.pos[1]).toBe(65);
  expect(gaps.released.vel[0]).toBeLessThanOrEqual(1.3);
});

test('M06a sneaking for 60 ticks stops on a cliff edge', async ({ page }) => {
  const player = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.fill!(2, 60, -2, 10, 64, 2, 'air');
    await api.waitForTerrain!(1);
    api.input!('sneak', true);
    api.input!('forward', true);
    await api.tick!(60);
    return api.getPlayer!();
  });
  expect(player.onGround).toBe(true);
  expect(player.pos[1]).toBe(65);
  expect(player.pos[0]).toBeGreaterThan(2);
  expect(player.pos[0]).toBeLessThan(2.3);
});

test('M06a ten-block fall deals seven half-hearts, water and hay negate it', async ({ page }) => {
  const falls = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.setBlock!(4, 65, 0, 'water');
    api.setBlock!(8, 64, 0, 'hay_bale');
    await api.waitForTerrain!(1);
    const outcomes = [];
    api.teleport!(0.5, 75, 0.5);
    await api.tick!(40);
    outcomes.push(api.getPlayer!());
    api.teleport!(4.5, 75, 0.5);
    await api.tick!(40);
    outcomes.push(api.getPlayer!());
    api.teleport!(8.5, 75, 0.5);
    await api.tick!(40);
    outcomes.push(api.getPlayer!());
    api.setGameMode!('creative');
    api.teleport!(12.5, 75, 0.5);
    await api.tick!(40);
    outcomes.push(api.getPlayer!());
    return outcomes;
  });
  expect(falls[0]!.health).toBe(13);
  expect(falls[1]!.health).toBe(13);
  expect(falls[1]!.inFluid).toBe('water');
  expect(falls[2]!.health).toBe(13);
  expect(falls[3]!.health).toBe(13);
  for (const player of falls) {
    expect(player.pos[1]).toBe(65);
    expect(player.onGround).toBe(true);
  }
});

test('M06a jumping under a two-block ceiling bonks without clipping', async ({ page }) => {
  const samples = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.fill!(-1, 67, -1, 1, 67, 1, 'stone');
    await api.waitForTerrain!(1);
    api.input!('jump', true);
    await api.tick!(1);
    const bonk = api.getPlayer!();
    api.input!('jump', false);
    const positions = [bonk.pos[1]];
    for (let i = 0; i < 20; i++) {
      await api.tick!(1);
      positions.push(api.getPlayer!().pos[1]);
    }
    return { bonk, positions, landed: api.getPlayer!() };
  });
  expect(samples.bonk.vel[1]).toBe(0);
  expect(samples.bonk.pos[1]).toBeCloseTo(65.2);
  expect(Math.max(...samples.positions) + 1.8).toBeLessThanOrEqual(67 + 1e-7);
  expect(samples.landed.pos[1]).toBe(65);
  expect(samples.landed.onGround).toBe(true);
});

test('M06a unloaded column freezes and legacy camera control detaches', async ({ page }) => {
  const state = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.teleport!(10000, 100, 10000);
    const before = api.getPlayer!();
    await api.tick!(100);
    const frozen = api.getPlayer!();
    const wm = (
      window as unknown as {
        WorldManager: {
          getInstance(): { camera: { position: Float32Array; yaw: number; updateView(): void } };
        };
      }
    ).WorldManager.getInstance();
    wm.camera.position.set([5, 90, 5]);
    wm.camera.yaw = 1;
    wm.camera.updateView();
    await api.tick!(100);
    const camera = Array.from(wm.camera.position);
    api.look!(0, 0);
    const attached = api.getPlayer!();
    return { before, frozen, camera, attached };
  });
  expect(state.frozen.pos).toEqual(state.before.pos);
  expect(state.frozen.vel[1]).toBe(0);
  expect(state.camera).toEqual([5, 90, 5]);
  expect(state.attached.pos).toEqual([5, 88.38, 5]);
});

test('M06a creative double-jump flies up and down without gravity', async ({ page }) => {
  const flight = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.setGameMode!('creative');
    api.input!('jump', true);
    await api.tick!(1);
    api.input!('jump', false);
    await api.tick!(1);
    api.input!('jump', true);
    await api.tick!(1);
    const start = api.getPlayer!();
    await api.tick!(20);
    const up = api.getPlayer!();
    api.input!('jump', false);
    await api.tick!(20);
    const hover = api.getPlayer!();
    api.input!('sneak', true);
    await api.tick!(10);
    const down = api.getPlayer!();
    return { start, up, hover, down };
  });
  expect(flight.up.pos[1] - flight.start.pos[1]).toBeCloseTo(10.9);
  expect(flight.hover.pos[1]).toBe(flight.up.pos[1]);
  expect(flight.hover.vel[1]).toBe(0);
  expect(flight.hover.mode).toBe('creative');
  expect(flight.down.pos[1] - flight.hover.pos[1]).toBeCloseTo(-5.45);
});

test('M06a hay texture sheet shows both tiles repeated 3×3 at 4× scale', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  const png = new PNG({ width: 392, height: 192 });
  png.data.fill(80);
  for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255;
  [genHayTop(42), genHaySide(42)].forEach((tile, t) => {
    for (let y = 0; y < 192; y++)
      for (let x = 0; x < 192; x++) {
        const src = ((Math.floor(y / 4) % 16) * 16 + (Math.floor(x / 4) % 16)) * 4;
        const dest = (y * 392 + t * 200 + x) * 4;
        for (let c = 0; c < 4; c++) png.data[dest + c] = tile[src + c]!;
      }
  });
  await page.setContent(
    `<body style="margin:0;background:#505050"><img style="margin:32px" src="data:image/png;base64,${PNG.sync.write(png).toString('base64')}" /></body>`,
  );
  const shot = await assertAndSaveScreenshot({ name: 'm06-hay-sheet', milestone: 'M06a' });
  assertNotBlank(shot);
  assertNoMissingTexture(shot);
});
