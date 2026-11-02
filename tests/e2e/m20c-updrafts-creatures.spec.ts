import fs from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';
import type { PNG } from 'pngjs';
import { test, expect } from '../harness/fixture';
import {
  assertColorVariance,
  assertNoMissingTexture,
  assertNotBlank,
  regionMeanColor,
} from '../harness/pixels';

const MILESTONE = 'M20c';
const SEED = 'blockcraft-m20c';
// Found from the seed's own fields (M20b's height field, the Updraft field and the island grid);
// each test checks its spot before using it.
const UPDRAFT = { x: 60.5, z: 22.5 };
// A floating island pierced by a lavafall (a 2x2 ceiling fall), with an Updraft over its east half.
const ISLAND = {
  x: -223,
  z: -26,
  top: 116,
  updraft: { x: -215.5, z: -25.5 },
  fall: { x: -235, z: -29 },
};
const FOREST = { x: -15, z: 19 };
const SHORE = { x: -29, z: -96 };

function publish(name: string): void {
  const destination = path.join(process.cwd(), `docs/screenshots/${MILESTONE}/${name}.png`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(process.cwd(), `artifacts/${MILESTONE}/${name}.png`), destination);
}

function hue([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
}
function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}
function frameMean(png: PNG): [number, number, number] {
  return regionMeanColor(png, { x: 0, y: 0, width: png.width, height: png.height });
}

async function hollowdeep(page: Page, name: string): Promise<void> {
  await page.evaluate(
    async ({ name, seed }) => {
      const api = window.__blockcraft!;
      api.setRenderDistance!(4);
      await api.createWorld!({ name, seed, mode: 'creative', type: 'flat', spawning: false });
      api.pause!();
      api.setClouds!('off');
      api.teleport!(0.5, 65, 0.5, 0, 0);
      await api.waitForTerrain!(1);
      await api.travelTo!('hollowdeep', 0.5, 100, 0.5);
      await api.waitForTravel!();
      // Let the arrival warp fade (0.05 a tick) before anything is measured or captured.
      await api.tick!(30);
    },
    { name, seed: SEED },
  );
}

/** Teleports, lets the terrain around settle, and holds the view. */
async function view(
  page: Page,
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
): Promise<void> {
  await page.evaluate(
    async ([x, y, z, yaw, pitch]) => {
      const api = window.__blockcraft!;
      api.teleport!(x!, y!, z!, yaw, pitch);
      await api.waitForTerrain!(2);
      await api.tick!(2);
      api.teleport!(x!, y!, z!, yaw, pitch);
      await api.tick!(1);
    },
    [x, y, z, yaw, pitch],
  );
}

test('M20c: a jump inside an Updraft rises at least twice as high as outside one', async ({
  page,
}) => {
  await hollowdeep(page, 'M20c updraft');
  const result = await page.evaluate(async (zone) => {
    const api = window.__blockcraft!;
    const found = api.findUpdraft!(zone.x, zone.z, 8);
    const jump = async (x: number, z: number) => {
      api.fill!(
        Math.floor(x) - 2,
        99,
        Math.floor(z) - 2,
        Math.floor(x) + 2,
        99,
        Math.floor(z) + 2,
        'duskrock',
      );
      api.fill!(
        Math.floor(x) - 2,
        100,
        Math.floor(z) - 2,
        Math.floor(x) + 2,
        110,
        Math.floor(z) + 2,
        'air',
      );
      api.teleport!(x, 100, z, 0, 0);
      await api.tick!(10);
      const base = api.getPlayer!().pos[1];
      api.input!('jump', true);
      await api.tick!(1);
      api.input!('jump', false);
      let apex = base;
      for (let i = 0; i < 80; i++) {
        await api.tick!(1);
        apex = Math.max(apex, api.getPlayer!().pos[1]);
      }
      return {
        base,
        apex: apex - base,
        landed: api.getPlayer!().pos[1],
        field: api.getUpdraft!(x, 100.9, z),
      };
    };
    const inside = await jump(zone.x, zone.z);
    const outside = await jump(zone.x, zone.z - 20);
    return { found, inside, outside, dimension: api.getDimension!() };
  }, UPDRAFT);
  console.log('[m20c jump]', JSON.stringify(result));
  expect(result.dimension).toBe('hollowdeep');
  expect(result.found).toMatchObject({ x: UPDRAFT.x, z: UPDRAFT.z });
  expect(result.inside.field).toEqual({ inside: true, gravity: 0.4 });
  expect(result.outside.field).toEqual({ inside: false, gravity: 1 });
  expect(result.outside.apex).toBeGreaterThan(1);
  expect(result.inside.apex).toBeGreaterThanOrEqual(2 * result.outside.apex);
  expect(result.inside.landed).toBeCloseTo(result.inside.base, 2);
  expect(result.outside.landed).toBeCloseTo(result.outside.base, 2);
});

test('M20c: the Hollowdeep plays its own music mood', async ({ page }) => {
  await hollowdeep(page, 'M20c music');
  await page.keyboard.press('Space');
  await page.waitForFunction(
    () => window.__blockcraft!.getAudioStats!().contextState === 'running',
    undefined,
    { timeout: 5000 },
  );
  await page.evaluate(async () => window.__blockcraft!.tick!(40));
  await page.waitForFunction(
    () => window.__blockcraft!.getAudioStats!().lastSounds.includes('music.sequence'),
    undefined,
    { timeout: 15000, polling: 10 },
  );
  const context = await page.evaluate(() => ({
    music: window.__blockcraft!.getMusicContext!(),
    dimension: window.__blockcraft!.getDimension!(),
  }));
  expect(context).toEqual({ music: 'hollowdeep', dimension: 'hollowdeep' });
});

test('M20c: Hollowdeep forest, magma sea and floating islands look unlike the Overworld', async ({
  page,
  assertAndSaveScreenshot,
  getRenderStats,
}) => {
  // The Overworld reference: the same flat world at noon, looking along the horizon.
  await page.evaluate(async (seed) => {
    const api = window.__blockcraft!;
    api.setRenderDistance!(4);
    await api.createWorld!({
      name: 'M20c look',
      seed,
      mode: 'creative',
      type: 'flat',
      spawning: false,
    });
    api.pause!();
    api.setClouds!('off');
    api.setTimeOfDay!(6000);
    api.teleport!(0.5, 66, 0.5, 0, -0.1);
    await api.waitForTerrain!(2);
    await api.tick!(2);
  }, SEED);
  const overworld = await assertAndSaveScreenshot({
    name: 'm20c-overworld-reference',
    milestone: MILESTONE,
  });
  assertNotBlank(overworld);
  const overworldHue = hue(frameMean(overworld));

  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    await api.travelTo!('hollowdeep', 0.5, 100, 0.5);
    await api.waitForTravel!();
    await api.tick!(30);
  });
  const biomeAt = (spot: { x: number; z: number }) =>
    page.evaluate((spot) => window.__blockcraft!.getBiome!(spot.x, spot.z), spot);
  const biomes: Record<string, string> = {};

  // Glowcap forest: standing a few blocks above the floor among the trees.
  await page.evaluate(async (forest) => {
    const api = window.__blockcraft!;
    api.teleport!(forest.x + 0.5, 120, forest.z + 0.5, 0, 0);
    await api.waitForTerrain!(2);
  }, FOREST);
  const floor = await page.evaluate((forest) => {
    const api = window.__blockcraft!;
    for (let y = 150; y > 41; y--) {
      const id = api.getBlock!(forest.x, y, forest.z).id;
      if (id === 'duskrock' || id === 'veilroot') return y;
    }
    return -1;
  }, FOREST);
  expect(floor).toBeGreaterThan(41);
  await view(page, FOREST.x + 0.5, floor + 4, FOREST.z + 0.5, 0.6, -0.12);
  biomes.forest = await biomeAt(FOREST);
  const forest = await assertAndSaveScreenshot({
    name: 'm20-hollowdeep-forest',
    milestone: MILESTONE,
  });
  assertNotBlank(forest);
  assertNoMissingTexture(forest);
  assertColorVariance(forest, 8);
  publish('m20-hollowdeep-forest');

  // Magma sea: from the shore, looking down across the lava.
  await view(page, SHORE.x + 9.5, 52, SHORE.z + 0.5, Math.PI, -0.35);
  biomes.shore = await biomeAt(SHORE);
  const sea = await assertAndSaveScreenshot({ name: 'm20-magma-sea', milestone: MILESTONE });
  assertNotBlank(sea);
  assertNoMissingTexture(sea);
  assertColorVariance(sea, 8);
  publish('m20-magma-sea');
  const seaMean = regionMeanColor(sea, {
    x: 0,
    y: sea.height / 2,
    width: sea.width,
    height: sea.height / 2,
  });

  // A floating island from beside its lavafall, looking east across the lava-lit top through the
  // Updraft's motes, with two Glowwings drifting over it.
  await page.evaluate((island) => {
    const api = window.__blockcraft!;
    api.spawn!('glowwing', island.x - 1.5, island.top + 6, island.z - 1.5);
    api.spawn!('glowwing', island.x + 8.5, island.top + 9, island.z + 2.5);
  }, ISLAND);
  await view(page, ISLAND.x - 17.5, ISLAND.top + 4, ISLAND.z - 0.5, 0.1, -0.4);
  const spot = await page.evaluate((island) => {
    const api = window.__blockcraft!;
    return {
      updraft: api.findUpdraft!(island.updraft.x, island.updraft.z, 4),
      fall: api.getBlock!(island.fall.x, island.top + 2, island.fall.z).id,
      ground: api.getBlock!(island.x, island.top, island.z).id,
    };
  }, ISLAND);
  expect(spot.updraft).toMatchObject(ISLAND.updraft);
  expect(spot.fall).toBe('lava');
  expect(spot.ground).toBe('driftstone');
  biomes.island = await biomeAt(ISLAND);
  const islands = await assertAndSaveScreenshot({
    name: 'm20-floating-islands',
    milestone: MILESTONE,
  });
  assertNotBlank(islands);
  assertNoMissingTexture(islands);
  assertColorVariance(islands, 6);
  publish('m20-floating-islands');
  const glow = await page.evaluate(() => window.__blockcraft!.getUpdraftGlowZones!());

  const hues = [forest, sea, islands].map((png) => hue(frameMean(png)));
  console.log(
    '[m20c hues]',
    JSON.stringify({ biomes, overworldHue, hues, seaMean, glow, overworld: frameMean(overworld) }),
  );
  expect(biomes.forest).toBe('glowcap_forest');
  expect(biomes.shore).toBe('magma_sea');
  expect(biomes.island).toBe('driftstone_expanse');
  expect(glow).toBeGreaterThan(0);
  // Lava dominates the lower half of the sea view: red over blue.
  expect(seaMean[0]).toBeGreaterThan(seaMean[2] * 1.3);
  for (const h of hues) expect(hueDistance(h, overworldHue)).toBeGreaterThanOrEqual(45);
  expect((await getRenderStats()).missingTextures).toEqual([]);
});

// Inside the forest, where the floor climbs away from the magma sea.
const GROVE = { x: -20, z: 30 };
// The first dry ground east of the magma-sea shore spot.
const BANK = { x: -25, z: -96 };

test('M20c: Glowwing and Magmaw close-ups', async ({ page, assertAndSaveScreenshot }) => {
  await hollowdeep(page, 'M20c creatures');
  const wing = await page.evaluate(async (grove) => {
    const api = window.__blockcraft!;
    api.teleport!(grove.x + 0.5, 120, grove.z - 5.5, 0, 0);
    await api.waitForTerrain!(2);
    let floor = -1;
    for (let y = 150; y > 41 && floor < 0; y--)
      if (['duskrock', 'veilroot'].includes(api.getBlock!(grove.x, y, grove.z).id)) floor = y;
    // A clear pocket of air so the close-up is the creature, not a trunk.
    api.fill!(grove.x - 5, floor + 1, grove.z - 7, grove.x + 5, floor + 8, grove.z + 3, 'air');
    const id = api.spawn!('glowwing', grove.x + 0.5, floor + 3, grove.z + 0.5);
    await api.tick!(3);
    api.teleport!(grove.x + 0.5, floor + 2.9, grove.z - 3, Math.PI / 2, -0.45);
    await api.waitForTerrain!(2);
    await api.tick!(1);
    return { id, floor, entities: api.getEntities!({ type: 'glowwing' }).length };
  }, GROVE);
  console.log('[m20c glowwing]', JSON.stringify(wing));
  expect(wing.floor).toBeGreaterThan(41);
  expect(wing.entities).toBe(1);
  const glowwing = await assertAndSaveScreenshot({ name: 'm20-glowwing', milestone: MILESTONE });
  assertNotBlank(glowwing);
  assertNoMissingTexture(glowwing);
  publish('m20-glowwing');
  const wingState = await page.evaluate(
    (id) => window.__blockcraft!.getHollowdeepCreature!(id),
    wing.id,
  );
  expect(wingState?.type).toBe('glowwing');

  // The Magmaw hauled out on the bank, a moment before it crawls back into the lava.
  const maw = await page.evaluate(async (bank) => {
    const api = window.__blockcraft!;
    api.teleport!(bank.x - 3.5, 60, bank.z + 0.5, 0, 0);
    await api.waitForTerrain!(2);
    let ground = -1;
    for (let y = 60; y > 30 && ground < 0; y--)
      if (api.getBlock!(bank.x, y, bank.z).id !== 'air') ground = y;
    const below = api.getBlock!(bank.x, ground, bank.z).id;
    const id = api.spawn!('magmaw', bank.x + 0.5, ground + 1, bank.z + 0.5);
    // From just above the lava, looking back up the bank at it.
    api.teleport!(bank.x - 3.5, ground + 1.5, bank.z + 0.5, 0, -0.35);
    await api.tick!(1);
    api.teleport!(bank.x - 3.5, ground + 1.5, bank.z + 0.5, 0, -0.35);
    return { id, ground, below, state: api.getHollowdeepCreature!(id) };
  }, BANK);
  console.log('[m20c magmaw]', JSON.stringify(maw));
  expect(maw.below).not.toBe('lava');
  expect(maw.state?.type).toBe('magmaw');
  const magmaw = await assertAndSaveScreenshot({ name: 'm20-magmaw', milestone: MILESTONE });
  assertNotBlank(magmaw);
  assertNoMissingTexture(magmaw);
  publish('m20-magmaw');
});
