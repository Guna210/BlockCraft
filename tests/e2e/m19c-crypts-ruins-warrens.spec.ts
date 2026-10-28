import fs from 'fs';
import path from 'path';
import { test, expect } from '../harness/fixture';
import { assertNoMissingTexture, assertNotBlank } from '../harness/pixels';
import { waitForStreamingIdle } from './helpers/flight';

const SEED = 'm19c-crypts';
const cryptTable = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'data/loot/chests/sunken_crypt.json'), 'utf8'),
) as { entries: Array<{ id: string }> };
const cryptItems = cryptTable.entries.map((entry) => entry.id);

function publish(name: string): void {
  const destination = path.join(process.cwd(), `docs/screenshots/M19c/${name}.png`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(process.cwd(), `artifacts/M19c/${name}.png`), destination);
}

test('M19c: a located Sunken Crypt holds a spawner and a chest of crypt loot', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  const result = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    await api.createWorld!({
      seed: 'm19c-crypts',
      mode: 'creative',
      type: 'default',
      structures: true,
      spawning: false,
    });
    api.pause!();
    const start = api.locate!('structure', 'sunken_crypt', [0, 64, 0]);
    if (!start) return { start, spawner: null, chests: [] };
    const [x, floor, z] = start;
    api.teleport!(x + 5.5, floor + 1, z + 1.5, Math.PI / 2, 0);
    await api.waitForTerrain!(3);

    const block = api.getBlock!(x + 5, floor + 1, z + 5);
    const spawnerEntity = api.getBlockEntity!(x + 5, floor + 1, z + 5);
    const spawner = {
      id: block.id,
      creature: (spawnerEntity?.state as { creature?: string } | undefined)?.creature ?? null,
    };
    const chests: Array<{ x: number; z: number; stacks: Array<{ id: string; count: number }> }> =
      [];
    for (let dx = 0; dx <= 10; dx++)
      for (let dz = 0; dz <= 10; dz++) {
        if (api.getBlock!(x + dx, floor + 1, z + dz).id !== 'chest') continue;
        const state = api.getBlockEntity!(x + dx, floor + 1, z + dz)?.state as
          { slots?: Array<{ id: string; count: number } | null> } | undefined;
        chests.push({
          x: x + dx,
          z: z + dz,
          stacks: (state?.slots ?? []).filter(
            (slot): slot is { id: string; count: number } => slot !== null,
          ),
        });
      }

    // Light the hall for the screenshot with four torches by the walls, then stand away from the
    // first chest looking past the spawner toward it.
    for (const [dx, dz] of [
      [2, 5],
      [8, 5],
      [5, 2],
      [5, 8],
    ] as const) {
      if (api.getBlock!(x + dx, floor + 1, z + dz).id === 'air')
        api.setBlock!(x + dx, floor + 1, z + dz, 'torch');
    }
    const target = chests[0] ?? { x: x + 5, z: z + 1 };
    const sx = x + 5.5,
      sz = z + 5.5;
    const ax = sx - (target.x + 0.5),
      az = sz - (target.z + 0.5);
    const length = Math.max(0.001, Math.hypot(ax, az));
    const cx = sx + (ax / length) * 3.2,
      cz = sz + (az / length) * 3.2;
    api.teleport!(cx, floor + 2.2, cz, Math.atan2(target.z + 0.5 - cz, target.x + 0.5 - cx), -0.3);
    await api.tick!(30);
    return { start, spawner, chests, light: api.getLight!(x + 5, floor + 1, z + 3) };
  });

  console.log('[m19c crypt evidence]', JSON.stringify(result));
  expect(result.start, "locate('structure','sunken_crypt',[0,64,0])").not.toBeNull();
  expect(Math.hypot(result.start![0], result.start![2])).toBeLessThanOrEqual(2000);
  expect(result.spawner?.id).toBe('spawner');
  expect(['hollow', 'skitterer', 'sporeburst']).toContain(result.spawner?.creature);
  expect(result.chests.length).toBeGreaterThanOrEqual(1);
  const looted = result.chests.filter((chest) => chest.stacks.length >= 3);
  expect(looted.length).toBeGreaterThanOrEqual(1);
  for (const chest of looted)
    for (const stack of chest.stacks) {
      expect(cryptItems).toContain(stack.id);
      expect(stack.count).toBeGreaterThan(0);
    }

  await waitForStreamingIdle(page, 120_000);
  const screenshot = await assertAndSaveScreenshot({ name: 'm19-crypt', milestone: 'M19c' });
  assertNotBlank(screenshot);
  assertNoMissingTexture(screenshot);
  publish('m19-crypt');
});

test('M19c: a Spire Ruin and a Mineshaft Warren generate near the test seed', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  const spire = await page.evaluate(async (seed) => {
    const api = window.__blockcraft!;
    await api.createWorld!({
      seed,
      mode: 'creative',
      type: 'default',
      structures: true,
      spawning: false,
    });
    api.pause!();
    api.setTimeOfDay!(5000);
    const start = api.locate!('structure', 'spire_ruin', [0, 64, 0]);
    if (!start) return { start, stones: 0 };
    const [x, y, z] = start;
    const eye: [number, number, number] = [x + 3.5 - 13, y + 14, z + 3.5 + 13];
    api.teleport!(eye[0], eye[1], eye[2], Math.atan2(-13, 13), -0.45);
    await api.waitForTerrain!(3);
    let stones = 0;
    for (let dy = -2; dy <= 20; dy++)
      for (let dx = 0; dx < 7; dx++)
        for (const dz of [0, 6]) {
          const id = api.getBlock!(x + dx, y + dy, z + dz).id;
          if (id === 'cobblestone' || id === 'mossy_cobblestone') stones++;
        }
    await api.tick!(2);
    return { start, stones };
  }, SEED);
  console.log('[m19c spire evidence]', JSON.stringify(spire));
  expect(spire.start, "locate('structure','spire_ruin',[0,64,0])").not.toBeNull();
  expect(spire.stones).toBeGreaterThan(10);
  const spireShot = await assertAndSaveScreenshot({ name: 'm19-spire-ruin', milestone: 'M19c' });
  assertNotBlank(spireShot);
  assertNoMissingTexture(spireShot);
  publish('m19-spire-ruin');

  const warren = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    const start = api.locate!('structure', 'mineshaft_warren', [0, 64, 0]);
    if (!start) return { start, rails: 0, chests: 0 };
    const [x, floor, z] = start;
    api.teleport!(x + 4.5, floor + 1, z + 4.5, 0, 0);
    await api.waitForTerrain!(3);
    let rails = 0,
      chests = 0;
    for (let dx = -12; dx <= 20; dx++)
      for (let dz = -12; dz <= 20; dz++) {
        const id = api.getBlock!(x + dx, floor + 1, z + dz).id;
        if (id === 'decorative_rail') rails++;
        if (id === 'chest') chests++;
      }
    for (const [dx, dz] of [
      [1, 1],
      [7, 1],
      [1, 7],
      [7, 7],
    ] as const) {
      if (api.getBlock!(x + dx, floor + 1, z + dz).id === 'air')
        api.setBlock!(x + dx, floor + 1, z + dz, 'torch');
    }
    // Look down one tunnel mouth from the far side of the hub.
    const along = api.getBlock!(x + 4, floor + 1, z + 1).id === 'decorative_rail';
    if (along) api.teleport!(x + 4.5, floor + 1.2, z + 7.6, -Math.PI / 2, -0.15);
    else api.teleport!(x + 7.6, floor + 1.2, z + 4.5, Math.PI, -0.15);
    await api.tick!(30);
    return { start, rails, chests, light: api.getLight!(x + 4, floor + 1, z + 4) };
  });
  console.log('[m19c warren evidence]', JSON.stringify(warren));
  expect(warren.start, "locate('structure','mineshaft_warren',[0,64,0])").not.toBeNull();
  expect(warren.rails).toBeGreaterThan(5);
  expect(warren.chests).toBeGreaterThanOrEqual(1);
  await waitForStreamingIdle(page, 120_000);
  const warrenShot = await assertAndSaveScreenshot({
    name: 'm19-mineshaft-warren',
    milestone: 'M19c',
  });
  assertNotBlank(warrenShot);
  assertNoMissingTexture(warrenShot);
  publish('m19-mineshaft-warren');
});
