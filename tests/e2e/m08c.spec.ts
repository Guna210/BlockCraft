import { test, expect } from '../harness/fixture';
import {
  assertNotBlank,
  assertNoMissingTexture,
  diffFraction,
  regionMeanColor,
} from '../harness/pixels';
import type { Page } from '@playwright/test';
import type { PNG } from 'pngjs';

const MILESTONE = 'M08c';

/** A flat creative world in daylight with an empty stage: stone floor at y=64, air above it. */
async function stage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const a = window.__blockcraft!;
    await a.createWorld!({
      name: 'M08c stage',
      mode: 'creative',
      type: 'flat',
      seed: 'blockcraft-test-seed-42',
    });
    a.pause!();
    a.setRenderDistance!(4);
    a.setClouds!('off');
    a.setTimeOfDay!(6000);
    a.setFluidAnimationPaused!(true);
    a.fill!(-16, 65, -12, 16, 84, 12, 'air');
    a.fill!(-16, 64, -12, 16, 64, 12, 'stone');
  });
}

/** Moves the camera and waits until the edited sections are meshed and no column fades. */
async function view(
  page: Page,
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
): Promise<void> {
  await page.evaluate(
    async ([px, py, pz, ya, pi]) => {
      const a = window.__blockcraft!;
      a.teleport!(px!, py!, pz!, ya, pi);
      await a.tick!(0);
      await a.waitForTerrain!(1);
    },
    [x, y, z, yaw, pitch] as const,
  );
  await expect
    .poll(() => page.evaluate(() => window.__blockcraft!.getStreamingStats!().columnsFading))
    .toBe(0);
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

/** Runs the simulation and the animation clock for about a second, then freezes both again. */
async function runWind(page: Page): Promise<void> {
  const t0 = await page.evaluate(() => {
    const a = window.__blockcraft!;
    const t = a.getFluidAnimation!().seconds;
    a.resume!();
    a.setFluidAnimationPaused!(false);
    return t;
  });
  await expect
    .poll(() => page.evaluate(() => window.__blockcraft!.getFluidAnimation!().seconds))
    .toBeGreaterThan(t0 + 0.8);
  await page.evaluate(() => {
    const a = window.__blockcraft!;
    a.pause!();
    a.setFluidAnimationPaused!(true);
  });
}

/** Screen position (in pixels) of a world point from the current camera, using the engine's pose. */
async function project(
  page: Page,
  yaw: number,
  pitch: number,
  point: [number, number, number],
  size: { width: number; height: number },
): Promise<{ x: number; y: number }> {
  const { eye, fov } = await page.evaluate(() => {
    const stats = window.__blockcraft!.getRenderStats();
    return { eye: stats.cameraPosition, fov: stats.cameraFov };
  });
  const fwd = [Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw)];
  const right = [-Math.sin(yaw), 0, Math.cos(yaw)];
  const up = [
    right[1]! * fwd[2]! - right[2]! * fwd[1]!,
    right[2]! * fwd[0]! - right[0]! * fwd[2]!,
    right[0]! * fwd[1]! - right[1]! * fwd[0]!,
  ];
  const d = [point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]];
  const dot = (u: number[], v: number[]) => u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!;
  const depth = dot(d, fwd);
  const tanHalf = Math.tan((fov * Math.PI) / 360);
  const aspect = size.width / size.height;
  return {
    x: size.width / 2 + (dot(d, right) / (depth * tanHalf * aspect)) * (size.width / 2),
    y: size.height / 2 - (dot(d, up) / (depth * tanHalf)) * (size.height / 2),
  };
}

async function shot(
  assertAndSaveScreenshot: (o: { name: string; milestone: string }) => Promise<PNG>,
  name: string,
): Promise<PNG> {
  const png = await assertAndSaveScreenshot({ name, milestone: MILESTONE });
  assertNotBlank(png);
  assertNoMissingTexture(png);
  return png;
}

test('M08c a lit room seen through a glass wall differs from the same shot through air by 0.5–15 percent', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await stage(page);
  await page.evaluate(() => {
    const a = window.__blockcraft!;
    // A 9×3×7 room: planks back wall, cobblestone sides and ceiling, glass front wall at x=0.
    a.fill!(0, 65, -4, 9, 68, 4, 'cobblestone');
    a.fill!(1, 65, -3, 8, 67, 3, 'air');
    a.fill!(8, 65, -3, 8, 67, 3, 'oak_planks');
    a.fill!(0, 65, -3, 0, 67, 3, 'glass');
    // Light inside the room only: three lumite blocks and a gold ore column to give it structure.
    a.setBlock!(6, 65, -2, 'lumite_block');
    a.setBlock!(6, 65, 2, 'lumite_block');
    a.fill!(7, 65, 0, 7, 66, 0, 'gold_ore');
    a.fill!(4, 65, 0, 4, 65, 0, 'copper_ore');
  });
  await view(page, -10, 65.6, 0, 0, 0);
  const withGlass = await shot(assertAndSaveScreenshot, 'm08-glass-wall');
  await page.evaluate(() => window.__blockcraft!.fill!(0, 65, -3, 0, 67, 3, 'air'));
  await view(page, -10, 65.6, 0, 0, 0);
  const withAir = await shot(assertAndSaveScreenshot, 'm08-glass-air');
  const difference = diffFraction(withGlass, withAir);
  console.log('M08c glass wall vs air diffFraction', difference);
  expect(difference).toBeGreaterThan(0.005);
  expect(difference).toBeLessThan(0.15);
});

const GLASS_ROW = [
  'red_stained_glass',
  'orange_stained_glass',
  'yellow_stained_glass',
  'green_stained_glass',
  'cyan_stained_glass',
  'blue_stained_glass',
  'purple_stained_glass',
  'pink_stained_glass',
  'ice',
  'packed_ice',
];

test('M08c stained glass, ice and packed ice tint a lit wall behind them while the wall stays readable', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await stage(page);
  await page.evaluate((row) => {
    const a = window.__blockcraft!;
    // A white-and-dark striped wall two blocks behind the row so tints and opacity are readable.
    a.fill!(3, 65, -9, 3, 67, 9, 'birch_planks');
    a.fill!(3, 66, -9, 3, 66, 9, 'foundation_stone');
    row.forEach((id, i) => a.fill!(0, 65, -5 + i, 0, 67, -5 + i, id));
  }, GLASS_ROW);
  await view(page, -8, 66.6, -0.5, 0, 0);
  const png = await shot(assertAndSaveScreenshot, 'm08-stained-glass-row');
  const size = { width: png.width, height: png.height };
  // The wall is 3 blocks behind the glass, so the pixel showing the middle of a column's glass
  // shows the wall where the same ray crosses x=3: sample the light and dark wall stripes there.
  const eye = await page.evaluate(() => window.__blockcraft!.getRenderStats().cameraPosition);
  const through = async (column: number, wallY: number) => {
    const t = (3 - eye[0]) / (0.5 - eye[0]);
    const zWall = eye[2] + (-4.5 + column - eye[2]) * t;
    const c = await project(page, 0, 0, [3, wallY, zWall], size);
    return regionMeanColor(png, {
      x: Math.round(c.x) - 4,
      y: Math.round(c.y) - 4,
      width: 8,
      height: 8,
    });
  };
  const colours: number[][] = [];
  const dark: number[][] = [];
  for (let i = 0; i < GLASS_ROW.length; i++) {
    colours.push(await through(i, 67.5));
    dark.push(await through(i, 66.5));
  }
  console.log(
    'M08c row light-stripe RGB',
    JSON.stringify(colours),
    'dark-stripe',
    JSON.stringify(dark),
  );
  // Each stained colour leans toward its own hue relative to the other channels.
  const [red, orange, yellow, green, cyan, blue, purple, pink] = colours as [
    number[],
    number[],
    number[],
    number[],
    number[],
    number[],
    number[],
    number[],
  ];
  expect(red[0]!).toBeGreaterThan(red[1]! * 1.15);
  expect(red[0]!).toBeGreaterThan(red[2]! * 1.15);
  expect(orange[0]!).toBeGreaterThan(orange[2]! * 1.2);
  expect(yellow[2]!).toBeLessThan(yellow[0]! * 0.85);
  expect(green[1]!).toBeGreaterThan(green[0]! * 1.05);
  expect(green[1]!).toBeGreaterThan(green[2]! * 1.05);
  expect(cyan[2]!).toBeGreaterThan(cyan[0]! * 1.1);
  expect(blue[2]!).toBeGreaterThan(blue[0]! * 1.2);
  expect(purple[2]!).toBeGreaterThan(purple[1]! * 1.1);
  expect(pink[0]!).toBeGreaterThan(pink[1]! * 1.1);
  // Colours are all distinct from each other.
  for (let i = 0; i < 8; i++)
    for (let j = i + 1; j < 8; j++) {
      const d =
        Math.abs(colours[i]![0]! - colours[j]![0]!) +
        Math.abs(colours[i]![1]! - colours[j]![1]!) +
        Math.abs(colours[i]![2]! - colours[j]![2]!);
      expect(d, `${GLASS_ROW[i]} vs ${GLASS_ROW[j]}`).toBeGreaterThan(15);
    }
  // The wall stripes behind every pane stay readable: the dark stripe is darker than the light one.
  // Packed ice (about 90 % opaque) only hints at the wall, so its facets can outweigh the contrast.
  const lum = (c: number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  for (let i = 0; i < 9; i++)
    expect(lum(colours[i]!) - lum(dark[i]!), GLASS_ROW[i]).toBeGreaterThan(10);
});

/** A 5×5×5 oak leaf cube on a log, hanging in front of open sky. */
async function leafCube(page: Page): Promise<void> {
  await page.evaluate(() => {
    const a = window.__blockcraft!;
    a.fill!(4, 65, -1, 4, 67, -1, 'oak_log');
    a.fill!(2, 68, -3, 6, 72, 1, 'oak_leaves');
  });
}

function skyPixels(
  png: PNG,
  rect: { x: number; y: number; width: number; height: number },
): number {
  let sky = 0;
  for (let y = rect.y; y < rect.y + rect.height; y++)
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const i = (y * png.width + x) * 4;
      if (png.data[i + 2]! > png.data[i]! + 40 && png.data[i + 2]! > png.data[i + 1]! + 10) sky++;
    }
  return sky;
}

test('M08c leaves fancy shows the sky through gaps, fast draws opaque cubes and switching back restores fancy', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await stage(page);
  await leafCube(page);
  await view(page, -6, 68.5, -1, 0, 0.15);
  const fancy = await shot(assertAndSaveScreenshot, 'm08-leaves-fancy');
  await page.evaluate(() => window.__blockcraft!.setLeaves!('fast'));
  await view(page, -6, 68.5, -1, 0, 0.15);
  await expect
    .poll(() => page.evaluate(() => window.__blockcraft!.getStreamingStats!().columnsFading))
    .toBe(0);
  const fast = await shot(assertAndSaveScreenshot, 'm08-leaves-fast');
  const centre = await project(page, 0, 0.15, [2, 70.5, -1], {
    width: fancy.width,
    height: fancy.height,
  });
  const rect = {
    x: Math.round(centre.x) - 60,
    y: Math.round(centre.y) - 60,
    width: 120,
    height: 120,
  };
  const fancySky = skyPixels(fancy, rect);
  const fastSky = skyPixels(fast, rect);
  console.log('M08c leaves sky pixels in the cube region fancy/fast', fancySky, fastSky);
  expect(fancySky).toBeGreaterThan(fastSky + 50);
  expect(fastSky).toBe(0);
  expect(diffFraction(fancy, fast)).toBeGreaterThan(0.005);
  await page.evaluate(() => window.__blockcraft!.setLeaves!('fancy'));
  await view(page, -6, 68.5, -1, 0, 0.15);
  const again = await shot(assertAndSaveScreenshot, 'm08-leaves-fancy-again');
  // Coincident faces of neighbouring leaves may z-fight differently after a remesh: allow a sliver.
  expect(diffFraction(fancy, again)).toBeLessThan(0.002);
});

test('M08c plants sway only at the top and leaves only in fancy mode, driven by the wind clock', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await stage(page);
  await page.evaluate(() => {
    const a = window.__blockcraft!;
    a.setBlock!(2, 65, 0, 'tall_grass');
    a.fill!(2, 70, 3, 4, 72, 5, 'oak_leaves');
  });
  const yaw = 0.25;
  const pitch = 0.1;
  await view(page, -1, 65.9, -0.4, yaw, pitch);
  const grab = async (name: string) => {
    const png = await shot(assertAndSaveScreenshot, name);
    return png;
  };
  // Paused clock: nothing moves.
  const still1 = await grab('m08-sway-paused-1');
  await page.evaluate(
    () => new Promise<void>((r) => setTimeout(() => requestAnimationFrame(() => r()), 400)),
  );
  const still2 = await grab('m08-sway-paused-2');
  expect(diffFraction(still1, still2)).toBe(0);
  // Running clock: the plant tip moves while its base stays put.
  await runWind(page);
  await view(page, -1, 65.9, -0.4, yaw, pitch);
  const moved = await grab('m08-sway-moved');
  const size = { width: moved.width, height: moved.height };
  const base = await project(page, yaw, pitch, [2.5, 65, 0.5], size);
  const top = await project(page, yaw, pitch, [2.5, 66, 0.5], size);
  const height = base.y - top.y;
  const rows = (a: PNG, b: PNG, y0: number, y1: number) => {
    let changed = 0;
    for (let y = Math.max(0, Math.round(y0)); y < Math.round(y1); y++)
      for (let x = Math.round(base.x - height); x < Math.round(base.x + height); x++) {
        const i = (y * a.width + x) * 4;
        if (
          a.data[i] !== b.data[i] ||
          a.data[i + 1] !== b.data[i + 1] ||
          a.data[i + 2] !== b.data[i + 2]
        )
          changed++;
      }
    return changed;
  };
  const tipChanged = rows(still2, moved, top.y - 4, top.y + height * 0.5);
  const baseChanged = rows(still2, moved, base.y - height * 0.08, base.y);
  console.log(
    'M08c plant changed pixels tip/base',
    tipChanged,
    baseChanged,
    'plant height px',
    height,
  );
  expect(tipChanged).toBeGreaterThan(5);
  expect(baseChanged).toBeLessThan(tipChanged / 10);
  // Fast leaves do not wave: with the clock running the leaf cube stays pixel-identical.
  await page.evaluate(() => window.__blockcraft!.setLeaves!('fast'));
  await view(page, -1, 65.9, -0.4, yaw, pitch);
  const fastA = await grab('m08-sway-fast-1');
  await page.evaluate(() => window.__blockcraft!.setFluidAnimationPaused!(false));
  await runWind(page);
  await view(page, -1, 65.9, -0.4, yaw, pitch);
  const fastB = await grab('m08-sway-fast-2');
  const leafCentre = await project(page, yaw, pitch, [3, 71, 4], size);
  const leafRect = {
    x: Math.round(leafCentre.x) - 50,
    y: Math.round(leafCentre.y) - 50,
    width: 100,
    height: 100,
  };
  let leafDiff = 0;
  for (let y = leafRect.y; y < leafRect.y + leafRect.height; y++)
    for (let x = leafRect.x; x < leafRect.x + leafRect.width; x++) {
      const i = (y * fastA.width + x) * 4;
      if (fastA.data[i] !== fastB.data[i] || fastA.data[i + 1] !== fastB.data[i + 1]) leafDiff++;
    }
  console.log('M08c fast leaves changed pixels with running clock', leafDiff);
  expect(leafDiff).toBe(0);
});
