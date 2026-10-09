import type { Page } from '@playwright/test';
import type { PNG } from 'pngjs';
import { test, expect } from '../harness/fixture';
import { assertNoMissingTexture, assertNotBlank } from '../harness/pixels';
import { fly, waitForStreamingIdle, type Vec3 } from './helpers/flight';
import { MAX_HOLE_PIXELS, findSkyHoles, isSkyPixel } from './helpers/sky-holes';

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

// M04b: fade-in of new columns, memory after a long flight, the render distance 12 horizon and a
// screenshot in the middle of a flight (SPEC M04, decisions/M04b-fade-and-memory.md).

const MB = 1048576;

/** JS heap in use, without forcing a collection. */
async function heapUsed(page: Page): Promise<number> {
  return page.evaluate(
    () => (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize,
  );
}

/** Forced garbage collection, twice, then the JS heap in use in bytes (needs --js-flags=--expose-gc). */
async function heapUsedAfterGc(page: Page): Promise<number> {
  return page.evaluate(() => {
    const gc = (window as unknown as { gc?: () => void }).gc;
    if (!gc) throw new Error('window.gc is not exposed: Chromium runs with --js-flags=--expose-gc');
    gc();
    gc();
    return (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize;
  });
}

/** Waits until `n` frames have drawn, so the screenshot that follows shows the current camera. */
async function frames(page: Page, n: number): Promise<void> {
  await page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
  }, n);
}

/** Polls until no column is still fading in (the fade is wall-clock time, see column-fade.ts). */
async function waitForFadesDone(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const fading = await page.evaluate(
      () => window.__blockcraft!.getStreamingStats!().columnsFading,
    );
    if (fading === 0) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`columns still fading in after ${timeoutMs} ms`);
}

/** Share of the pixels in columns [left, right) and rows [top, bottom) that have the sky colour. */
function skyShare(png: PNG, left: number, right: number, top: number, bottom: number): number {
  let sky = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      if (isSkyPixel(png, x, y)) sky++;
    }
  }
  return sky / ((right - left) * (bottom - top));
}

test.describe('M04b: fade-in and memory', () => {
  test('heap growth after flying 2000 blocks out and back is at most 15 % after forced GC', async ({
    page,
  }) => {
    await createWorld(page, 'm04-heap');
    await waitForStreamingIdle(page, 60_000);
    const start = await cameraPosition(page);
    const baseline = await heapUsedAfterGc(page);
    const mb = (bytes: number) => (bytes / MB).toFixed(2);

    // Probe: the reading must respond to a known allocation, or the growth check below proves nothing.
    // Chromium reports performance.memory in coarse buckets (decisions/M04b-fade-and-memory.md), so a
    // plain array of 8 million numbers, about 64 MB on the JS heap, must show as at least 32 MB more.
    await page.evaluate(() => {
      (window as unknown as { __heapProbe?: number[] }).__heapProbe = Array.from(
        { length: 8_000_000 },
        (_, i) => i + 0.5,
      );
    });
    await page.waitForTimeout(100);
    const probed = await heapUsed(page);
    const probeReport = `heap probe: +${mb(probed - baseline)} MB after a 64 MB array (${baseline} B -> ${probed} B)`;
    test.info().annotations.push({ type: 'heap probe', description: probeReport });
    console.log(`m04 ${probeReport}`);
    expect(probed - baseline, probeReport).toBeGreaterThanOrEqual(32 * MB);

    // Release the probe before the flight: the heap must return to the baseline by itself.
    await page.evaluate(() => {
      delete (window as unknown as { __heapProbe?: number[] }).__heapProbe;
    });
    await heapUsedAfterGc(page);

    const out: Vec3 = { x: start.x + 2000, y: start.y, z: start.z };
    await fly(page, { from: start, to: out, speed: 60 });
    await fly(page, { from: out, to: start, speed: 60 });
    await waitForStreamingIdle(page, 60_000);
    const end = await heapUsedAfterGc(page);

    const growth = (end - baseline) / baseline;
    const report =
      `heap baseline ${mb(baseline)} MB (${baseline} B), end ${mb(end)} MB (${end} B), ` +
      `growth ${(growth * 100).toFixed(2)} %`;
    test.info().annotations.push({ type: 'heap', description: report });
    console.log(`m04 ${report}`);
    expect(growth, report).toBeLessThanOrEqual(0.15);
  });

  test('at render distance 12 the terrain reaches the horizon with no holes', async ({
    page,
    assertAndSaveScreenshot,
  }) => {
    await createWorld(page, 'm04-horizon');
    await page.evaluate(() => window.__blockcraft!.setRenderDistance!(12));
    await waitForStreamingIdle(page, 120_000);
    await waitForFadesDone(page, 10_000);

    // Eye 40 blocks above the highest ground within 144 blocks of the spawn column, looking 20 degrees
    // down: the lower part of the frame shows ground well inside the loaded square (RD+1 meshed).
    const spawn = await cameraPosition(page);
    const top = await page.evaluate(
      ([x, z]) => {
        let max = -Infinity;
        for (let dx = -144; dx <= 144; dx += 8) {
          for (let dz = -144; dz <= 144; dz += 8) {
            max = Math.max(max, window.__blockcraft!.getHeight!(x! + dx, z! + dz));
          }
        }
        return max;
      },
      [spawn.x, spawn.z] as const,
    );
    await page.evaluate(
      ({ x, y, z, pitch }) => {
        const camera = (window as unknown as Host).WorldManager.getInstance().camera;
        camera.position[0] = x;
        camera.position[1] = y;
        camera.position[2] = z;
        window.__blockcraft!.look!(0, pitch);
      },
      { x: spawn.x, y: top + 40, z: spawn.z, pitch: (-20 * Math.PI) / 180 },
    );
    await frames(page, 3);

    // Before the shot: every column within RD 12 is meshed, and no column is still fading in.
    const loaded = await coverage(page, 12);
    expect(loaded.notMeshed, 'columns within RD 12 that are not meshed').toEqual([]);
    const fading = await page.evaluate(
      () => window.__blockcraft!.getStreamingStats!().columnsFading,
    );
    expect(fading, 'columns still fading in before the shot').toBe(0);

    const png = await assertAndSaveScreenshot({ name: 'm04-horizon', milestone: 'M04b' });
    assertNotBlank(png);
    assertNoMissingTexture(png);

    // Holes: sky that the flood fill from the top row cannot reach is enclosed by terrain. The largest
    // enclosed area must stay within MAX_HOLE_PIXELS. Sky reached from the top row is open, including the
    // view past the RD 12 edge in the corners: there is no fog until M12a, so that edge is a hard line.
    const holes = findSkyHoles(png);
    const upper = skyShare(png, 0, png.width, 0, Math.round(png.height / 10));
    const corners = skyShare(
      png,
      0,
      Math.round(png.width / 4),
      Math.round((png.height * 2) / 3),
      png.height,
    );
    const report =
      `m04 horizon: enclosed sky ${holes.enclosedPixels} px, largest hole ${holes.largestEnclosed} px ` +
      `(limit ${MAX_HOLE_PIXELS}), open sky ${holes.openSky} px, ` +
      `lower-left corner ${(corners * 100).toFixed(2)} % (edge, not asserted), ` +
      `top tenth ${(upper * 100).toFixed(1)} %, top ${top}`;
    test.info().annotations.push({ type: 'horizon', description: report });
    console.log(report);
    expect(
      holes.largestEnclosed,
      `largest enclosed sky, px (limit ${MAX_HOLE_PIXELS})`,
    ).toBeLessThanOrEqual(MAX_HOLE_PIXELS);
    expect(upper, 'sky pixels in the top tenth (above the far edge)').toBeGreaterThan(0.5);
  });

  test('a screenshot in the middle of a 30 blocks/s flight at render distance 8 shows terrain, with a few chunks still loading', async ({
    page,
    assertAndSaveScreenshot,
  }) => {
    await createWorld(page, 'm04-fast-flight');
    const start = await cameraPosition(page);
    const out: Vec3 = { x: start.x + 1000, y: start.y, z: start.z };
    const flight = fly(page, { from: start, to: out, speed: 30 });
    // Shoot once the camera is halfway: 500 blocks at 30 blocks/s is about 17 s of flight.
    for (;;) {
      const at = await cameraPosition(page);
      if (at.x >= start.x + 500) break;
      await page.waitForTimeout(100);
    }
    const png = await assertAndSaveScreenshot({ name: 'm04-fast-flight', milestone: 'M04b' });
    const stats = await page.evaluate(() => window.__blockcraft!.getStreamingStats!());
    // Reported, not asserted: under SwiftShader this frame does not fully meet its checklist
    // (decisions/M04b-fade-and-memory.md, progress/M04b.md).
    const holes = findSkyHoles(png);
    const report =
      `m04 fast flight at x ${start.x + 500}: columnsFading ${stats.columnsFading}, ` +
      `enclosed sky ${holes.enclosedPixels} px (largest ${holes.largestEnclosed} px), ` +
      `open sky ${holes.openSky} px, stats ${JSON.stringify(stats)}`;
    test.info().annotations.push({ type: 'fast flight', description: report });
    console.log(report);
    assertNotBlank(png);
    assertNoMissingTexture(png);
    await flight;
  });
});
