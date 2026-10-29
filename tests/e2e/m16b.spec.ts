import { test, expect } from '../harness/fixture';

test('M16b: audio context starts on the first user gesture', async ({ page }) => {
  const before = await page.evaluate(() => window.__blockcraft!.getAudioStats!());
  expect(before.contextState).toBe('not-created');
  await page.mouse.click(640, 360);
  await page.waitForFunction(
    () => window.__blockcraft!.getAudioStats!().contextState === 'running',
    undefined,
    { timeout: 5000 },
  );
  const after = await page.evaluate(() => window.__blockcraft!.getAudioStats!());
  expect(after.contextState).toBe('running');
});

test.describe('M16b gameplay audio', () => {
  test.beforeEach(async ({ page }) => {
    await page.evaluate(async () => {
      const api = window.__blockcraft!;
      api.setRenderDistance!(4);
      await api.createWorld!({
        name: 'M16b audio',
        seed: 'blockcraft-test-seed-42',
        mode: 'creative',
        type: 'flat',
        spawning: false,
      });
      api.pause!();
      api.setClouds!('off');
      api.teleport!(0.5, 65, 10.5, 0, 0);
      await api.waitForTerrain!(1);
    });
    await page.mouse.click(640, 360);
    await page.waitForFunction(
      () => window.__blockcraft!.getAudioStats!().contextState === 'running',
      undefined,
      { timeout: 5000 },
    );
  });

  test('grass and stone footsteps have different sound IDs', async ({ page }) => {
    const ids = await page.evaluate(async () => {
      const api = window.__blockcraft!;
      api.fill!(-16, 64, 6, 0, 64, 14, 'grass_block');
      api.fill!(1, 64, 6, 32, 64, 14, 'stone');
      api.teleport!(-10.5, 65, 10.5, 0, 0);
      api.input!('forward', true);
      await api.tick!(20);
      api.input!('forward', false);
      const afterGrass = api.getAudioStats!().lastSounds;
      api.teleport!(10.5, 65, 10.5, 0, 0);
      api.input!('forward', true);
      await api.tick!(20);
      api.input!('forward', false);
      return {
        afterGrass,
        all: api.getAudioStats!().lastSounds,
      };
    });
    expect(ids.afterGrass).toContain('footstep.grass');
    expect(ids.all).toContain('footstep.grass');
    expect(ids.all).toContain('footstep.stone');
  });

  test('block break and Blast Charge detonation log their material sounds', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const api = window.__blockcraft!;
      api.setBlock!(3, 66, 10, 'stone');
      api.teleport!(0.5, 65, 10.5, 0, 0);
      api.input!('attack', true);
      await api.tick!(1);
      api.input!('attack', false);
      api.setBlock!(8, 65, 10, 'blast_charge');
      const before = api.getExplosionStats!().detonations;
      const id = api.primeBlastCharge!(8, 65, 10);
      api.resume!();
      let frames = 0;
      while (api.getExplosionStats!().detonations === before && frames < 100) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        frames++;
      }
      api.pause!();
      return { id, frames, sounds: api.getAudioStats!().lastSounds };
    });
    expect(result.id).not.toBeNull();
    expect(result.frames).toBeLessThan(100);
    expect(result.sounds).toContain('break.stone');
    expect(result.sounds).toContain('entity.explosion');
  });

  test('27-charge chain never exceeds the 32-voice limit', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const api = window.__blockcraft!;
      api.teleport!(0.5, 65, 20.5, 0, 0);
      api.fill!(-1, 65, -1, 1, 67, 1, 'blast_charge');
      await api.waitForTerrain!(1);
      const start = api.getExplosionStats!();
      api.primeBlastCharge!(0, 65, 0);
      api.resume!();
      let maxVoices = 0;
      let frames = 0;
      while (api.getExplosionStats!().detonations < 27 && frames < 400) {
        maxVoices = Math.max(maxVoices, api.getAudioStats!().activeVoices);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        frames++;
      }
      while (api.getExplosionStats!().pending > 0 && frames < 500) {
        maxVoices = Math.max(maxVoices, api.getAudioStats!().activeVoices);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        frames++;
      }
      api.pause!();
      const completed = api.getExplosionStats!();
      return {
        detonations: completed.detonations - start.detonations,
        maxVoices,
        activeVoices: api.getAudioStats!().activeVoices,
        frames,
      };
    });
    console.log('M16b charge audio voices', JSON.stringify(result));
    expect(result.detonations).toBe(27);
    expect(result.maxVoices).toBeLessThanOrEqual(32);
    expect(result.activeVoices).toBeLessThanOrEqual(32);
    expect(result.frames).toBeLessThan(500);
  });
});
