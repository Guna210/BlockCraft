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
    await page.keyboard.press('Space');
    await page.waitForFunction(
      () => window.__blockcraft!.getAudioStats!().contextState === 'running',
      undefined,
      { timeout: 5000 },
    );
  });

  test('starts a composed music voice after the context runs', async ({ page }) => {
    await page.evaluate(async () => window.__blockcraft!.tick!(20));
    const statsHandle = await page.waitForFunction(
      () => {
        const stats = window.__blockcraft!.getAudioStats!();
        return stats.activeVoices > 0 && stats.lastSounds.includes('music.sequence')
          ? stats
          : false;
      },
      undefined,
      { timeout: 15000, polling: 10 },
    );
    const stats = await statsHandle.jsonValue();
    if (!stats) throw new Error('Music voice did not become active');
    expect(stats.contextState).toBe('running');
    expect(stats.activeVoices).toBeGreaterThan(0);
    expect(stats.lastSounds).toContain('music.sequence');
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
    const breakStats = await page.evaluate(async () => {
      const api = window.__blockcraft!;
      const prototype = AudioBufferSourceNode.prototype;
      const originalStart = prototype.start;
      let activeVoicesAtBreak = 0;
      // Capture the short voice when its source starts instead of missing it on a later poll.
      prototype.start = function (
        this: AudioBufferSourceNode,
        ...args: Parameters<AudioBufferSourceNode['start']>
      ) {
        const result = originalStart.apply(this, args);
        const stats = api.getAudioStats!();
        if (stats.lastSounds.includes('break.stone')) {
          activeVoicesAtBreak = Math.max(activeVoicesAtBreak, stats.activeVoices);
        }
        return result;
      };
      try {
        api.setBlock!(3, 66, 10, 'stone');
        api.teleport!(0.5, 65, 10.5, 0, 0);
        api.input!('attack', true);
        await api.tick!(1);
        api.input!('attack', false);
        const deadline = performance.now() + 5000;
        while (activeVoicesAtBreak === 0 && performance.now() < deadline)
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        return {
          activeVoices: activeVoicesAtBreak,
          lastSounds: api.getAudioStats!().lastSounds,
        };
      } finally {
        prototype.start = originalStart;
      }
    });
    expect(breakStats.lastSounds).toContain('break.stone');
    expect(breakStats.activeVoices).toBeGreaterThan(0);
    await page.waitForFunction(
      () => window.__blockcraft!.getAudioStats!().activeVoices === 0,
      undefined,
      { timeout: 10000, polling: 10 },
    );

    const result = await page.evaluate(async () => {
      const api = window.__blockcraft!;
      api.setBlock!(8, 65, 10, 'blast_charge');
      const before = api.getExplosionStats!().detonations;
      const id = api.primeBlastCharge!(8, 65, 10);
      api.resume!();
      let frames = 0;
      let explosionVoiceActive = false;
      let explosionActiveVoices = 0;
      while (api.getExplosionStats!().detonations === before && frames < 100) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const stats = api.getAudioStats!();
        explosionVoiceActive ||=
          stats.lastSounds.includes('entity.explosion') && stats.activeVoices > 0;
        explosionActiveVoices = Math.max(explosionActiveVoices, stats.activeVoices);
        frames++;
      }
      const deadline = performance.now() + 2000;
      while (!explosionVoiceActive && performance.now() < deadline) {
        const stats = api.getAudioStats!();
        explosionVoiceActive =
          stats.lastSounds.includes('entity.explosion') && stats.activeVoices > 0;
        explosionActiveVoices = Math.max(explosionActiveVoices, stats.activeVoices);
        if (!explosionVoiceActive)
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      api.pause!();
      return {
        id,
        frames,
        sounds: api.getAudioStats!().lastSounds,
        explosionVoiceActive,
        explosionActiveVoices,
      };
    });
    expect(result.id).not.toBeNull();
    expect(result.frames).toBeLessThan(100);
    expect(result.sounds).toContain('break.stone');
    expect(result.sounds).toContain('entity.explosion');
    expect(result.explosionVoiceActive).toBe(true);
    expect(result.explosionActiveVoices).toBeGreaterThan(0);
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
