import { test, expect } from '../harness/fixture';
import { fly, waitForStreamingIdle, type Vec3 } from './helpers/flight';

// M04a: terrain streams around the camera. Flying 1000 blocks at 30 blocks/s at render distance 8
// must never let a frame or a streaming task between frames take more than 50 ms, load at most the
// ring the render distance asks for, and give every GPU resource back. frameCpuMsP95 and uploadMsP95
// are reported, not asserted (SPEC M04, decisions/M04a-streaming.md).

const SEED = 'blockcraft-test-seed-42';

interface Handle {
  camera: { position: Float32Array; yaw: number; pitch: number; updateView(): void };
  world: { hasColumn(cx: number, cz: number): boolean };
  streamer: { phaseOf(cx: number, cz: number): string | undefined };
  chunkRenderer: {
    sectionMeshCount: number;
    lastVisible: Array<{ sx: number; sy: number; sz: number }>;
  };
}
type Host = { WorldManager: { getInstance(): Handle } };

async function createWorld(page: import('@playwright/test').Page, name: string) {
  await page.evaluate(
    async ({ name, seed }) => {
      await window.__blockcraft!.createWorld!({ name, seed, mode: 'survival', type: 'default' });
    },
    { name, seed: SEED },
  );
}

async function cameraPosition(page: import('@playwright/test').Page): Promise<Vec3> {
  return page.evaluate(() => {
    const p = (window as unknown as Host).WorldManager.getInstance().camera.position;
    return { x: p[0]!, y: p[1]!, z: p[2]! };
  });
}

/** Columns with block data, and the columns within `rd` of the camera that are not meshed. */
async function coverage(page: import('@playwright/test').Page, rd: number) {
  return page.evaluate((rd) => {
    const wm = (window as unknown as Host).WorldManager.getInstance();
    const ccx = Math.floor(wm.camera.position[0]! / 16);
    const ccz = Math.floor(wm.camera.position[2]! / 16);
    const notMeshed: string[] = [];
    for (let cx = ccx - rd; cx <= ccx + rd; cx++) {
      for (let cz = ccz - rd; cz <= ccz + rd; cz++) {
        if (!wm.world.hasColumn(cx, cz) || wm.streamer.phaseOf(cx, cz) !== 'meshed') {
          notMeshed.push(`${cx},${cz}:${wm.streamer.phaseOf(cx, cz)}`);
        }
      }
    }
    return {
      camera: [ccx, ccz],
      originLoaded: wm.world.hasColumn(0, 0),
      loaded: window.__blockcraft!.getRenderStats().chunksLoaded,
      notMeshed,
    };
  }, rd);
}

test.describe('M04a: streaming', () => {
  test('flying 1000 blocks at render distance 8 stays inside the frame budgets and frees what it leaves', async ({
    page,
  }) => {
    test.setTimeout(600_000);
    await createWorld(page, 'm04-flight');
    expect(
      await page.evaluate(() => window.__blockcraft!.getStreamingStats!().renderDistance),
    ).toBe(8);
    await waitForStreamingIdle(page, 120_000);

    const start = await cameraPosition(page);
    const baseline = await page.evaluate(() => window.__blockcraft!.getGlResourceCounts!());
    expect(baseline.buffers).toBeGreaterThan(0);
    const out: Vec3 = { x: start.x + 1000, y: start.y, z: start.z };

    await page.evaluate(() => window.__blockcraft!.resetFrameStats!());
    await fly(page, { from: start, to: out, speed: 30 });
    const stats = await page.evaluate(() => window.__blockcraft!.getFrameStats!());
    console.log('m04 flight frame stats', JSON.stringify(stats));
    // Measured and reported, not asserted: M22a enforces frameCpuMsP95 <= 8 and uploadMsP95 <= 3 at
    // RD 8 (SPEC M04). They show in the report and the CI log.
    for (const name of ['frameCpuMsP95', 'uploadMsP95', 'glCheckMsMax'] as const) {
      test.info().annotations.push({ type: name, description: stats[name].toFixed(1) });
      console.log(`m04 reported ${name} = ${stats[name].toFixed(1)} ms`);
    }

    // The flight takes 33 s of wall-clock time; SwiftShader draws 1-2 frames per second at RD 8 and
    // fewer when other specs run beside this one, so this only proves frames were measured.
    expect(stats.frames, 'frames rendered during the flight').toBeGreaterThan(10);
    expect(stats.frameCpuMsMax, 'worst frame').toBeLessThanOrEqual(50);
    // Streaming work between frames (pump slices, worker-result handlers) stays under SPEC 2.2's 50 ms.
    expect(
      stats.pumpMsMax,
      'longest streaming task outside the frame callback',
    ).toBeLessThanOrEqual(50);

    await waitForStreamingIdle(page, 120_000);
    const rd = 8;
    const bound = (2 * (rd + 2) + 1) ** 2;
    const far = await coverage(page, rd);
    expect(far.notMeshed, 'columns within RD 8 that are not meshed').toEqual([]);
    expect(far.loaded).toBeLessThanOrEqual(bound);
    // Real streaming happened: the spawn column left the world.
    expect(far.camera[0]).toBeGreaterThan(50);
    expect(far.originLoaded).toBe(false);

    await page.evaluate(() => window.__blockcraft!.setRenderDistance!(4));
    await waitForStreamingIdle(page, 120_000);
    const near = await coverage(page, 4);
    expect(near.notMeshed, 'columns within RD 4 that are not meshed').toEqual([]);
    expect(near.loaded).toBeLessThanOrEqual((2 * (4 + 2) + 1) ** 2);

    await page.evaluate(() => window.__blockcraft!.setRenderDistance!(8));
    await fly(page, { from: out, to: start, speed: 30 });
    await waitForStreamingIdle(page, 120_000);
    const back = await coverage(page, 8);
    expect(back.notMeshed).toEqual([]);

    const after = await page.evaluate(() => window.__blockcraft!.getGlResourceCounts!());
    for (const kind of ['buffers', 'vaos', 'textures'] as const) {
      expect(after[kind], `${kind} after flying back`).toBeLessThanOrEqual(baseline[kind] * 1.1);
      expect(after[kind], `${kind} after flying back`).toBeGreaterThanOrEqual(baseline[kind] * 0.9);
    }
  });

  test('at render distance 8 only the columns in view are drawn and a 180 degree turn changes them', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await createWorld(page, 'm04-culling');
    await waitForStreamingIdle(page, 120_000);
    const sample = () =>
      page.evaluate(async () => {
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const wm = (window as unknown as Host).WorldManager.getInstance();
        return {
          visible: window.__blockcraft!.getRenderStats().chunksVisible,
          total: wm.chunkRenderer.sectionMeshCount,
          columns: Array.from(
            new Set(wm.chunkRenderer.lastVisible.map((m) => `${m.sx},${m.sz}`)),
          ).sort(),
        };
      });

    await page.evaluate(() => window.__blockcraft!.look!(0, 0));
    const east = await sample();
    await page.evaluate(() => window.__blockcraft!.look!(Math.PI, 0));
    const west = await sample();

    console.log('m04 culling', east.visible, west.visible, east.total);
    expect(east.total).toBeGreaterThan(500);
    expect(east.visible).toBeGreaterThan(0);
    expect(east.visible).toBeLessThan(east.total * 0.6);
    expect(west.visible).toBeLessThan(west.total * 0.6);
    expect(west.columns).not.toEqual(east.columns);
  });
});
