import { test, expect } from '../harness/fixture';

async function waitFrames(page: import('@playwright/test').Page, count = 2): Promise<void> {
  await page.evaluate(async (frames) => {
    for (let frame = 0; frame < frames; frame++)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, count);
}

test('M22d: subtitles caption an out-of-view creature with a refreshed camera-relative direction', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    await api.createWorld!({
      name: 'M22d subtitles',
      seed: 'm22d-subtitles',
      mode: 'creative',
      type: 'flat',
      spawning: false,
    });
    api.pause!();
    api.setRenderDistance!(4);
    api.teleport!(0.5, 65, 8.5, 0, 0);
    await api.waitForTerrain!(1);
    api.setSetting!('subtitles', false);
  });
  await waitFrames(page);

  const initial = await page.evaluate(() => {
    const api = window.__blockcraft!;
    const id = api.spawn!('hollow', -4.5, 65, 8.5);
    const creature = api.getEntities!().find((entity) => entity.id === id)!;
    api.playSound!('creature.hollow.idle', creature.pos);
    const hidden = api.getSubtitles!();
    api.setSetting!('subtitles', true);
    api.playSound!('creature.hollow.idle', creature.pos);
    return { hidden, first: api.getSubtitles!(), id };
  });
  expect(initial.hidden).toEqual([]);
  expect(initial.first).toHaveLength(1);
  expect(initial.first[0]).toMatchObject({ text: 'Hollow groans', direction: 'behind' });

  await page.evaluate(async (creatureId) => {
    const api = window.__blockcraft!;
    api.look!(Math.PI / 2, 0);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const creature = api.getEntities!().find((entity) => entity.id === creatureId)!;
    api.playSound!('creature.hollow.idle', creature.pos);
  }, initial.id);
  const refreshed = await page.evaluate(() => window.__blockcraft!.getSubtitles!());
  expect(refreshed).toHaveLength(1);
  expect(refreshed[0]).toMatchObject({ text: 'Hollow groans', direction: 'right' });

  const screenshot = await assertAndSaveScreenshot({ name: 'm22d-subtitles', milestone: 'M22d' });
  expect(screenshot.width).toBeGreaterThan(0);
});

test('M22d: reduced motion holds the camera steady during an explosion and the negative control shakes', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    await api.createWorld!({
      name: 'M22d motion',
      seed: 'm22d-motion',
      mode: 'creative',
      type: 'flat',
      spawning: false,
    });
    api.setRenderDistance!(4);
    api.setGameMode!('creative');
    api.pause!();
    api.setClouds!('off');
    api.teleport!(0.5, 65, 8.5, 0, 0);
    await api.waitForTerrain!(1);
  });

  const explode = async (x: number, z: number): Promise<void> => {
    await page.evaluate(
      async ({ x, z }) => {
        const api = window.__blockcraft!;
        const before = api.getExplosionStats!().detonations;
        api.setBlock!(x, 65, z, 'blast_charge');
        api.primeBlastCharge!(x, 65, z);
        api.resume!();
        while (api.getExplosionStats!().detonations === before)
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        api.pause!();
        api.teleport!(0.5, 65, 8.5, 0, 0);
      },
      { x, z },
    );
  };
  const samples = async (): Promise<
    Array<{ position: number[]; yaw: number; pitch: number; fov: number; roll: number }>
  > =>
    page.evaluate(async () => {
      const api = window.__blockcraft!;
      const result: Array<{
        position: number[];
        yaw: number;
        pitch: number;
        fov: number;
        roll: number;
      }> = [];
      for (let frame = 0; frame < 5; frame++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const player = api.getPlayer!();
        const render = api.getRenderStats();
        result.push({
          position: render.cameraPosition,
          yaw: player.yaw,
          pitch: player.pitch,
          fov: render.cameraFov,
          roll: render.cameraRoll,
        });
      }
      return result;
    });

  await page.evaluate(() => window.__blockcraft!.setSetting!('reducedMotion', true));
  await explode(7, 8);
  const reduced = await samples();
  for (const sample of reduced.slice(1)) {
    expect(sample.position).toEqual(reduced[0]!.position);
    expect(sample.yaw).toBe(reduced[0]!.yaw);
    expect(sample.pitch).toBe(reduced[0]!.pitch);
    expect(sample.fov).toBe(reduced[0]!.fov);
    expect(sample.roll).toBe(0);
  }

  await page.evaluate(() => window.__blockcraft!.setSetting!('reducedMotion', false));
  await explode(-10, 8);
  const normal = await samples();
  expect(
    normal.some(
      (sample, index) =>
        index > 0 &&
        (sample.position.some((value, axis) => value !== normal[index - 1]!.position[axis]) ||
          sample.roll !== normal[index - 1]!.roll),
    ),
  ).toBe(true);
});

test('M22d: ACCESS settings switch to the opaque high-contrast palette', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('#settings-screen')).toBeVisible();
  await page.getByRole('button', { name: 'ACCESS' }).click();
  await expect(page.getByRole('button', { name: 'Directional subtitles: OFF' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reduced motion: OFF' })).toBeVisible();
  await page.getByRole('button', { name: 'High contrast: OFF' }).click();
  await expect(page.getByRole('button', { name: 'High contrast: ON' })).toBeVisible();
  expect(await page.evaluate(() => window.__blockcraft!.getSettings!().highContrast)).toBe(true);
  const screenshot = await assertAndSaveScreenshot({
    name: 'm22d-high-contrast',
    milestone: 'M22d',
  });
  expect(screenshot.width).toBeGreaterThan(0);
});

test('M22d: tick fault saves the world and returns through the recovery screen', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  test.setTimeout(180_000);
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    await api.createWorld!({
      name: 'M22d recovery',
      seed: 'm22d-recovery',
      mode: 'creative',
      type: 'flat',
      spawning: false,
    });
    api.setRenderDistance!(4);
    api.pause!();
    await api.waitForTerrain!(1);
  });
  const block = await page.evaluate(() => {
    const api = window.__blockcraft!;
    const [px, py, pz] = api.getPlayer!().pos;
    const location = [Math.floor(px) + 2, Math.floor(py) + 2, Math.floor(pz)] as const;
    api.setBlock!(location[0], location[1], location[2], 'lumite_block');
    api.injectFault!('tick');
    api.resume!();
    return location;
  });

  await expect(page.locator('#recovery-screen')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#recovery-screen')).toContainText('Injected fault');
  await expect(page.locator('#recovery-screen')).toContainText('World saved', { timeout: 15_000 });
  const screenshot = await assertAndSaveScreenshot({
    name: 'm22d-recovery',
    milestone: 'M22d',
  });
  expect(screenshot.width).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Back to title' }).click();
  await expect(page.locator('#recovery-screen')).toBeHidden({ timeout: 30_000 });
  await page.evaluate(async () => window.__blockcraft!.loadWorld!('M22d recovery'));
  await expect
    .poll(() =>
      page.evaluate((position) => {
        const api = window.__blockcraft!;
        return api.getBlock!(position[0]!, position[1]!, position[2]!).id;
      }, block),
    )
    .toBe('lumite_block');
});
