import { test, expect } from '../harness/fixture';
import {
  assertNotBlank,
  assertNoMissingTexture,
  diffFraction,
  regionMeanColor,
} from '../harness/pixels';
import { PNG } from 'pngjs';
import fs from 'node:fs';
import { genWaterFrames, genLavaFrames } from '../../src/render/textures/fluids';

async function lake(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    const a = window.__blockcraft!;
    await a.createWorld!({
      name: 'M08b lake',
      mode: 'creative',
      type: 'flat',
      seed: 'blockcraft-test-seed-42',
    });
    a.pause!();
    a.setRenderDistance!(4);
    a.setClouds!('off');
    a.setTimeOfDay!(6000);
    // A stepped sandy basin: one-block shallows at the near bank, deep blue at the back.
    a.fill!(-4, 65, -12, 24, 78, 12, 'air');
    a.fill!(0, 64, -10, 22, 64, 10, 'sand');
    for (let x = 1; x <= 21; x++) {
      const bottom = 64 - Math.min(7, Math.floor((x - 1) / 3));
      a.fill!(x, bottom, -9, x, 64, 9, 'water');
      a.fill!(x, bottom - 1, -9, x, bottom - 1, 9, 'sand');
    }
    // Pale submerged markers make transmission through shallow water assessable.
    a.fill!(2, 63, -4, 2, 63, 4, 'stone');
    a.fill!(5, 62, -4, 5, 62, 4, 'stone');
    a.teleport!(-4, 70, 0, 0, -0.35);
    await a.tick!(0);
    await a.waitForTerrain!(1);
  });
  await expect
    .poll(() => page.evaluate(() => window.__blockcraft!.getStreamingStats!().columnsFading))
    .toBe(0);
}

test('M08b static water has less than one percent changed pixels in consecutive frames with animation paused', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await lake(page);
  await page.evaluate(() => window.__blockcraft!.setFluidAnimationPaused!(true));
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
  const frames = await page.evaluate(async () => {
    const capture = () =>
      new Promise<string>((resolve) =>
        requestAnimationFrame(() => resolve(document.querySelector('canvas')!.toDataURL())),
      );
    return [await capture(), await capture()];
  });
  const pngs = frames.map((s) => PNG.sync.read(Buffer.from(s.split(',')[1]!, 'base64')));
  fs.mkdirSync('artifacts/M08b', { recursive: true });
  pngs.forEach((png, i) =>
    fs.writeFileSync(`artifacts/M08b/m08-static-${i}.png`, PNG.sync.write(png)),
  );
  pngs.forEach((png) => {
    assertNotBlank(png);
    assertNoMissingTexture(png);
  });
  const difference = diffFraction(pngs[0]!, pngs[1]!);
  console.log('M08b consecutive static frame diffFraction', difference);
  expect(difference).toBeLessThan(0.01);
  const lakeShot = await assertAndSaveScreenshot({ name: 'm08-lake', milestone: 'M08b' });
  assertNotBlank(lakeShot);
  await page.evaluate(async () => {
    const a = window.__blockcraft!;
    a.teleport!(10, 82, 0, 0, -1.4);
    await a.tick!(0);
  });
  const top = await assertAndSaveScreenshot({ name: 'm08-lake-top', milestone: 'M08b' });
  const deep = regionMeanColor(top, { x: 540, y: 220, width: 160, height: 70 });
  const shallow = regionMeanColor(top, { x: 450, y: 570, width: 100, height: 70 });
  const marker = regionMeanColor(top, { x: 590, y: 595, width: 100, height: 24 });
  console.log('M08b top-down deep/shallow/marker RGB', deep, shallow, marker);
  expect(deep[2]).toBeGreaterThan(deep[0] * 1.3);
  expect(deep[0] + deep[1] + deep[2]).toBeLessThan((shallow[0] + shallow[1] + shallow[2]) * 0.7);
  expect(marker[0] + marker[1] + marker[2]).toBeLessThan(
    (shallow[0] + shallow[1] + shallow[2]) * 0.9,
  );
  const before = await page.evaluate(() => window.__blockcraft!.getFluidAnimation!());
  await page.evaluate(() => window.__blockcraft!.setFluidAnimationPaused!(false));
  await expect
    .poll(() => page.evaluate(() => window.__blockcraft!.getFluidAnimation!().seconds))
    .toBeGreaterThan(before.seconds + 0.5);
  const animated = await assertAndSaveScreenshot({ name: 'm08-lake-animated', milestone: 'M08b' });
  await page.evaluate(() => window.__blockcraft!.setFluidAnimationPaused!(true));
  const frozen = await assertAndSaveScreenshot({ name: 'm08-lake-frozen', milestone: 'M08b' });
  // Runtime clock advancement and visible frame change are both required.
  await page.evaluate(() => window.__blockcraft!.setFluidAnimationPaused!(false));
  await expect
    .poll(() => page.evaluate(() => window.__blockcraft!.getFluidAnimation!().seconds))
    .toBeGreaterThan(before.seconds + 1.5);
  const after = await assertAndSaveScreenshot({ name: 'm08-lake-after', milestone: 'M08b' });
  expect(diffFraction(frozen, after)).toBeGreaterThan(0.001);
  assertNoMissingTexture(animated);
});

test('M08b waterfall sloped apron and animated downward side faces', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await lake(page);
  await page.evaluate(async () => {
    const a = window.__blockcraft!;
    a.fill!(0, 65, -7, 18, 80, 7, 'air');
    a.fill!(8, 65, -5, 14, 74, 5, 'stone');
    a.fill!(8, 75, -3, 14, 75, 3, 'water');
    for (let y = 65; y <= 74; y++)
      for (let z = -2; z <= 2; z++) a.setBlock!(7, y, z, 'water', { level: '0', falling: 'true' });
    for (let x = 1; x <= 6; x++)
      for (let z = -3; z <= 3; z++)
        a.setBlock!(x, 65, z, 'water', { level: String(7 - x), falling: 'false' });
    a.teleport!(-3, 70, -10, 0.65, -0.08);
    await a.tick!(0);
    await a.waitForTerrain!(1);
  });
  const before = await assertAndSaveScreenshot({ name: 'm08-waterfall', milestone: 'M08b' });
  assertNotBlank(before);
  assertNoMissingTexture(before);
  const time = await page.evaluate(() => window.__blockcraft!.getFluidAnimation!().seconds);
  await expect
    .poll(() => page.evaluate(() => window.__blockcraft!.getFluidAnimation!().seconds))
    .toBeGreaterThan(time + 0.7);
  const after = await assertAndSaveScreenshot({
    name: 'm08-waterfall-animated',
    milestone: 'M08b',
  });
  expect(diffFraction(before, after)).toBeGreaterThan(0.001);
  let sideChanged = 0;
  for (let y = 300; y < 460; y++)
    for (let x = 670; x < 740; x++) {
      const i = (y * before.width + x) * 4;
      if (
        before.data[i] !== after.data[i] ||
        before.data[i + 1] !== after.data[i + 1] ||
        before.data[i + 2] !== after.data[i + 2]
      )
        sideChanged++;
    }
  console.log('M08b waterfall side crop diffFraction', sideChanged / (70 * 160));
  expect(sideChanged / (70 * 160)).toBeGreaterThan(0.01);
});

test('M08b lava cave is animated, emissive and lights neighboring stone', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await page.evaluate(async () => {
    const a = window.__blockcraft!;
    await a.createWorld!({
      name: 'M08b lava cave',
      mode: 'creative',
      type: 'flat',
      seed: 'blockcraft-test-seed-42',
    });
    a.pause!();
    a.setRenderDistance!(4);
    a.setTimeOfDay!(6000);
    a.fill!(-3, 65, -8, 19, 76, 8, 'stone');
    a.fill!(-2, 66, -7, 18, 74, 7, 'air');
    a.fill!(4, 65, -5, 15, 65, 5, 'lava');
    a.fill!(16, 66, -5, 17, 68, 5, 'stone');
    a.teleport!(0, 68, 0, 0, -0.25);
    await a.tick!(0);
    await a.waitForTerrain!(1);
  });
  const light = await page.evaluate(() => window.__blockcraft!.getLight!(4, 66, 0));
  expect(light.block).toBeGreaterThan(0);
  const before = await assertAndSaveScreenshot({ name: 'm08-lava-cave', milestone: 'M08b' });
  assertNotBlank(before);
  assertNoMissingTexture(before);
  const time = await page.evaluate(() => window.__blockcraft!.getFluidAnimation!().seconds);
  await expect
    .poll(() => page.evaluate(() => window.__blockcraft!.getFluidAnimation!().seconds))
    .toBeGreaterThan(time + 0.7);
  const after = await assertAndSaveScreenshot({ name: 'm08-lava-animated', milestone: 'M08b' });
  expect(diffFraction(before, after)).toBeGreaterThan(0.001);
  // ART.md repeat review: water above lava; frames 0, 8, 16, 24 left to right.
  const sheet = new PNG({ width: 792, height: 392 });
  sheet.data.fill(48);
  for (let i = 3; i < sheet.data.length; i += 4) sheet.data[i] = 255;
  [genWaterFrames(), genLavaFrames()].forEach((frames, row) => {
    [0, 8, 16, 24].forEach((frame, col) => {
      const tile = frames[frame]!;
      for (let y = 0; y < 192; y++)
        for (let x = 0; x < 192; x++) {
          const src = ((Math.floor(y / 4) % 16) * 16 + (Math.floor(x / 4) % 16)) * 4;
          const dst = ((row * 200 + y) * sheet.width + col * 200 + x) * 4;
          for (let channel = 0; channel < 3; channel++)
            sheet.data[dst + channel] = tile[src + channel]!;
        }
    });
  });
  await page.setContent(
    `<body style="margin:0;background:#303030"><img style="margin:32px" src="data:image/png;base64,${PNG.sync.write(sheet).toString('base64')}" /></body>`,
  );
  await assertAndSaveScreenshot({ name: 'm08-fluid-texture-sheet', milestone: 'M08b' });
});

test('M08b master integration renders M10a cubes and both slab halves beside water', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  const placed = await page.evaluate(async () => {
    const a = window.__blockcraft!;
    await a.createWorld!({
      name: 'M08b master blocks',
      mode: 'creative',
      type: 'flat',
      seed: 'blockcraft-test-seed-42',
    });
    a.pause!();
    a.setRenderDistance!(4);
    a.setClouds!('off');
    a.setTimeOfDay!(6000);
    a.setFluidAnimationPaused!(true);
    a.fill!(-4, 65, -12, 20, 78, 12, 'air');
    const cubes = ['rainwood_planks', 'acacia_planks', 'coarse_dirt', 'mud', 'lumite_block'];
    const slabs = [
      'cobblestone_slab',
      'mossy_cobblestone_slab',
      'oak_slab',
      'birch_slab',
      'pine_slab',
      'rainwood_slab',
      'acacia_slab',
    ];
    const entries = [
      ...cubes.map((id) => ({ id, state: {} })),
      ...slabs.flatMap((id) => [
        { id, state: { half: 'bottom' } },
        { id, state: { half: 'top' } },
      ]),
    ];
    const placed = entries.map(({ id, state }, i) => {
      const x = 3 + (i % 5) * 3,
        z = -6 + Math.floor(i / 5) * 4;
      a.setBlock!(x, 66, z, id, state);
      a.setBlock!(x, 66, z + 1, 'water');
      return { expected: id, block: a.getBlock!(x, 66, z) };
    });
    a.teleport!(-6, 75, -12, 0.65, -0.5);
    await a.tick!(0);
    await a.waitForTerrain!(1);
    return placed;
  });
  for (const { expected, block } of placed) expect(block.id).toBe(expected);
  const shot = await assertAndSaveScreenshot({ name: 'm08-master-blocks', milestone: 'M08b' });
  assertNotBlank(shot);
  assertNoMissingTexture(shot);
});
