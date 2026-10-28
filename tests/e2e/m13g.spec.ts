import fs from 'fs';
import path from 'path';
import { test, expect } from '../harness/fixture';
import { assertNoMissingTexture, assertNotBlank } from '../harness/pixels';

const MILESTONE = 'M13g';
const HOSTILE_TYPES = ['hollow', 'thornling', 'skitterer', 'sporeburst', 'cinderwraith'];
const CREATURES = [
  'tuftbuck',
  'rootboar',
  'dapplefowl',
  'mossback',
  'glimmer_moth',
  'hollow',
  'thornling',
  'skitterer',
  'sporeburst',
  'cinderwraith',
];

async function saveReviewImage(name: string): Promise<void> {
  const source = path.join(process.cwd(), 'artifacts', MILESTONE, `${name}.png`);
  const destination = path.join(process.cwd(), 'docs/screenshots/M13g', `${name}.png`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

test('M13g: night spawns stay under the hostile cap after 2000 ticks', async ({ page }) => {
  const count = await page.evaluate(async (hostileTypes) => {
    const api = window.__blockcraft!;
    await api.createWorld!({ seed: 'blockcraft-m13g-cap', mode: 'survival', type: 'flat' });
    api.pause!();
    api.setRenderDistance!(4);
    api.setWeather!('clear');
    api.setTimeOfDay!(18000);
    const y = api.getHeight!(0, 0) + 1;
    api.teleport!(0.5, y, 0.5, 0, 0);
    // A dark, empty 64×64 arena with no block-light sources.
    api.fill!(-32, y - 1, -32, 31, y - 1, 31, 'stone');
    await api.tick!(2000);
    return hostileTypes.reduce((sum, type) => sum + api.getEntities!({ type }).length, 0);
  }, HOSTILE_TYPES);
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThanOrEqual(40);
});

test('M13g: no hostiles spawn at noon in the open', async ({ page }) => {
  const count = await page.evaluate(async (hostileTypes) => {
    const api = window.__blockcraft!;
    await api.createWorld!({ seed: 'blockcraft-m13g-noon', mode: 'survival', type: 'flat' });
    api.pause!();
    api.setRenderDistance!(4);
    api.setWeather!('clear');
    api.setTimeOfDay!(6000);
    const y = api.getHeight!(0, 0) + 1;
    api.teleport!(0.5, y, 0.5, 0, 0);
    api.fill!(-32, y - 1, -32, 31, y - 1, 31, 'stone');
    await api.tick!(2000);
    return hostileTypes.reduce((sum, type) => sum + api.getEntities!({ type }).length, 0);
  }, HOSTILE_TYPES);
  expect(count).toBe(0);
});

test('M13g visual review: all ten Overworld creatures in a textured, lit lineup', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await page.evaluate(async (creatures) => {
    const api = window.__blockcraft!;
    await api.createWorld!({
      seed: 'blockcraft-m13g-creatures',
      mode: 'creative',
      type: 'flat',
      spawning: false,
    });
    api.pause!();
    api.setRenderDistance!(4);
    api.setClouds!('off');
    api.setWeather!('clear');
    api.setTimeOfDay!(6000);
    api.setGameMode!('creative');
    const y = api.getHeight!(0, 0) + 1;
    creatures.forEach((type, index) =>
      api.spawn!(type, 4.5, y + (type === 'glimmer_moth' ? 1.3 : 0), -6.75 + index * 1.5),
    );
    api.teleport!(-3.5, y, 0, 0, -0.03);
    await api.waitForTerrain!(4);
    await api.tick!(1);
  }, CREATURES);
  const image = await assertAndSaveScreenshot({ milestone: MILESTONE, name: 'm13-creatures' });
  assertNotBlank(image);
  assertNoMissingTexture(image);
  await saveReviewImage('m13-creatures');
});

test('M13g visual review: a hostile flashes red just after a hit', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    await api.createWorld!({
      seed: 'blockcraft-m13g-combat',
      mode: 'creative',
      type: 'flat',
      spawning: false,
    });
    api.pause!();
    api.setRenderDistance!(4);
    api.setClouds!('off');
    api.setWeather!('clear');
    api.setTimeOfDay!(6000);
    api.setGameMode!('creative');
    const y = api.getHeight!(0, 0) + 1;
    api.teleport!(0.5, y, 0.5, 0, 0);
    api.giveItem!('iron_sword', 1);
    api.selectHotbarSlot!(0);
    api.spawn!('hollow', 3.5, y, 0.5);
    await api.tick!(1);
    api.input!('attack', true);
    await api.tick!(1);
    api.input!('attack', false);
  });
  const image = await assertAndSaveScreenshot({ milestone: MILESTONE, name: 'm13-combat' });
  assertNotBlank(image);
  assertNoMissingTexture(image);
  let red = 0;
  for (let i = 0; i < image.data.length; i += 4)
    if (image.data[i]! > 150 && image.data[i + 1]! < 110 && image.data[i + 2]! < 100) red++;
  expect(red).toBeGreaterThan(10);
  await saveReviewImage('m13-combat');
});

test('M13g visual review: hostiles approach through the dark', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  const approached = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    await api.createWorld!({
      seed: 'blockcraft-m13g-night',
      mode: 'survival',
      type: 'flat',
      spawning: false,
    });
    api.pause!();
    api.setRenderDistance!(4);
    api.setClouds!('off');
    api.setWeather!('clear');
    api.setTimeOfDay!(18000);
    const y = api.getHeight!(0, 0) + 1;
    api.teleport!(0.5, y, 0.5, 0, 0);
    const hollow = api.spawn!('hollow', 12.5, y, 0.5);
    const skitterer = api.spawn!('skitterer', 10.5, y, 2.5);
    const start = [hollow, skitterer].map((id) => api.getEntities!().find((e) => e.id === id)!.pos);
    await api.tick!(40);
    const finish = [hollow, skitterer].map(
      (id) => api.getEntities!().find((e) => e.id === id)!.pos,
    );
    return finish.some(
      (pos, index) =>
        Math.hypot(pos[0] - 0.5, pos[2] - 0.5) <
        Math.hypot(start[index]![0] - 0.5, start[index]![2] - 0.5),
    );
  });
  expect(approached).toBe(true);
  const image = await assertAndSaveScreenshot({ milestone: MILESTONE, name: 'm13-night' });
  assertNotBlank(image);
  assertNoMissingTexture(image);
  await saveReviewImage('m13-night');
});
