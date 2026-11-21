import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import type { Page } from '@playwright/test';
import { test, expect } from '../harness/fixture';
import { assertNoMissingTexture, assertNotBlank, diffFraction } from '../harness/pixels';
import { waitForStreamingIdle } from './helpers/flight';

const MAX_MULTI_DRAW_BATCH = 4096; // src/render/terrain-batcher.ts
const LIGHTING_VARIANT_COUNT = 4;

const SEED = 'blockcraft-test-seed-42';

type Camera = { position: Float32Array; yaw: number; pitch: number; updateView(): void };
type BatchStats = {
  opaqueCutoutSubmissions: number;
  translucentSubmissions: number;
  programSwitches: number;
  textureBinds: number;
  vaoBinds: number;
  arenaPages: number;
  opaquePages: number;
  cutoutPages: number;
  translucentPages: number;
  activeTintSlots: number;
};
type Host = {
  WorldManager: {
    getInstance(): {
      camera: Camera;
      chunkRenderer: {
        multiDraw: unknown;
        getBatchStats(): BatchStats;
      };
    };
  };
};

async function waitSettledFrames(page: Page, count = 3): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.__blockcraft!.getStreamingStats!().columnsFading), {
      timeout: 60_000,
    })
    .toBe(0);
  await page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        const step = (left: number) => {
          if (left <= 0) resolve();
          else requestAnimationFrame(() => step(left - 1));
        };
        step(n);
      }),
    count,
  );
}

test.describe('PERF-batch: Terrain draw batching', () => {
  test('opaque and cutout GL submissions stay bounded and nearly constant from RD8 to RD16 with LOD off', async ({
    page,
  }) => {
    test.setTimeout(600_000);
    await page.evaluate(async (seed) => {
      const api = window.__blockcraft!;
      api.setRenderDistance!(8);
      await api.createWorld!({
        name: 'perf-batch-scaling',
        seed,
        mode: 'creative',
        type: 'default',
        spawning: false,
      });
      api.pause!();
      api.setTimeOfDay!(6000);
      api.setWeather!('clear');
      api.setClouds!('off');
      api.setFluidAnimationPaused!(true);
      api.setSetting!('lod', false);
    }, SEED);
    await waitForStreamingIdle(page, 240_000);

    // Elevate camera above highest terrain near spawn (same pose method as M22b/M22a)
    const pose = await page.evaluate(() => {
      const api = window.__blockcraft!;
      const [x, y, z] = api.getPlayer!().pos;
      const eyeOffset = api.getRenderStats().cameraPosition[1] - y;
      let top = 0;
      for (let dx = -144; dx <= 144; dx += 8) {
        for (let dz = -144; dz <= 144; dz += 8) {
          top = Math.max(top, api.getHeight!(x + dx, z + dz));
        }
      }
      const cam = (window as unknown as Host).WorldManager.getInstance().camera;
      cam.position.set([x, top + 40, z]);
      cam.yaw = 0;
      cam.pitch = -Math.PI / 10;
      cam.updateView();
      return { x, y: top + 40, z, eyeOffset };
    });
    await waitForStreamingIdle(page, 240_000);
    await waitSettledFrames(page, 4);

    const sampleMetrics = () =>
      page.evaluate(() => {
        const api = window.__blockcraft!;
        const wm = (window as unknown as Host).WorldManager.getInstance();
        return {
          render: api.getRenderStats(),
          batch: wm.chunkRenderer.getBatchStats(),
        };
      });

    const rd8 = await sampleMetrics();

    // Expand to RD16 with LOD off, pointing camera up while streaming so software frames stay light
    await page.evaluate(() => {
      const api = window.__blockcraft!;
      const cam = (window as unknown as Host).WorldManager.getInstance().camera;
      cam.pitch = 1.55;
      cam.updateView();
      api.setSetting!('lod', false);
      api.setRenderDistance!(16);
    });
    await waitForStreamingIdle(page, 360_000);
    await page.evaluate((p) => {
      const cam = (window as unknown as Host).WorldManager.getInstance().camera;
      cam.position.set([p.x, p.y, p.z]);
      cam.yaw = 0;
      cam.pitch = -Math.PI / 10;
      cam.updateView();
    }, pose);
    await waitSettledFrames(page, 4);

    const rd16 = await sampleMetrics();

    console.log(
      'PERF-batch scaling',
      JSON.stringify({
        rd8: {
          chunksVisible: rd8.render.chunksVisible,
          drawCalls: rd8.render.drawCalls,
          drawSubmissions: rd8.render.drawSubmissions,
          ...rd8.batch,
        },
        rd16: {
          chunksVisible: rd16.render.chunksVisible,
          drawCalls: rd16.render.drawCalls,
          drawSubmissions: rd16.render.drawSubmissions,
          ...rd16.batch,
        },
      }),
    );

    expect(rd8.render.chunksVisible).toBeGreaterThan(100);
    expect(rd16.render.chunksVisible).toBeGreaterThan(rd8.render.chunksVisible * 2);

    // Opaque + cutout GL submissions are bounded by (active lighting variants x arena pages) <= 32
    expect(rd8.batch.opaqueCutoutSubmissions).toBeGreaterThan(0);
    expect(rd8.batch.opaqueCutoutSubmissions).toBeLessThanOrEqual(32);
    expect(rd16.batch.opaqueCutoutSubmissions).toBeGreaterThan(0);
    expect(rd16.batch.opaqueCutoutSubmissions).toBeLessThanOrEqual(32);

    // Submissions are one per non-empty (pass, lighting variant, arena page) key, plus one extra per
    // MAX_MULTI_DRAW_BATCH draws. Which pages and variants hold visible sections depends on the order
    // in which columns streamed in, so a fixed "RD8 + 8" margin flaked in CI (run 44802846579 saw 12
    // and 11 for identical scenes). The bound is derived from the counted pages instead:
    // keys <= variants x (opaque pages + cutout pages), splits <= ceil(draws / 4096).
    // A fixed page cap keeps that formula from hiding page proliferation: opaque pages start at
    // 1,048,576 quads and cutout pages at 524,288, so RD8 fits one of each (cap 4 leaves slack for
    // fragmentation) and RD16 (about 5x the columns) needs at most two of each plus slack (cap 6).
    const pageCaps = new Map([
      [rd8, 4],
      [rd16, 6],
    ]);
    for (const sample of [rd8, rd16]) {
      const pages = sample.batch.opaquePages + sample.batch.cutoutPages;
      expect(pages, 'opaque + cutout arena pages').toBeLessThanOrEqual(pageCaps.get(sample)!);
      const keyBound = LIGHTING_VARIANT_COUNT * pages;
      const splitBound = Math.ceil(sample.render.drawCalls / MAX_MULTI_DRAW_BATCH);
      expect(sample.batch.opaqueCutoutSubmissions).toBeLessThanOrEqual(keyBound + splitBound);
      // Submissions do not scale with sections: far fewer submissions than logical draws.
      expect(sample.batch.opaqueCutoutSubmissions * 50).toBeLessThanOrEqual(
        sample.render.drawCalls,
      );
    }
    // RD16 loads about 5x the columns of RD8, so the bounds above are not trivially met by a tiny scene.
    expect(rd16.render.drawCalls).toBeGreaterThan(rd8.render.drawCalls * 2);
  });

  test('batched path is pixel-identical to glcheck=draw per-section path at 3 fixed viewpoints', async ({
    page,
  }) => {
    test.setTimeout(480_000);

    await page.evaluate(async (seed) => {
      const api = window.__blockcraft!;
      await api.ready();
      api.setRenderDistance!(8);
      await api.createWorld!({
        name: 'perf-batch-pixel-id',
        seed,
        mode: 'creative',
        type: 'default',
        spawning: false,
      });
      api.pause!();
      api.setTimeOfDay!(6000);
      api.setWeather!('clear');
      api.setClouds!('off');
      api.setFluidAnimationPaused!(true);
      api.setSetting!('lod', false);
    }, SEED);
    await waitForStreamingIdle(page, 240_000);

    const spawnPose = await page.evaluate(() => {
      const api = window.__blockcraft!;
      const [x, , z] = api.getPlayer!().pos;
      const surface = api.getHeight!(x, z);
      let top = 0;
      for (let dx = -144; dx <= 144; dx += 8) {
        for (let dz = -144; dz <= 144; dz += 8) {
          top = Math.max(top, api.getHeight!(x + dx, z + dz));
        }
      }
      return { x, y: surface + 18, topY: top + 10, z };
    });

    const viewpoints: Array<{
      id: string;
      pos: [number, number, number];
      yaw: number;
      pitch: number;
      debugLight: boolean;
      prePos?: [number, number, number];
    }> = [
      {
        id: 'overworld-daytime',
        pos: [spawnPose.x, spawnPose.y, spawnPose.z],
        yaw: 0.4,
        pitch: -0.35,
        debugLight: false,
      },
      {
        id: 'underground-cave',
        prePos: [-66, 120, -217],
        pos: [-69.5, 19.5, -222.5],
        yaw: (39 * Math.PI) / 180,
        pitch: (-12 * Math.PI) / 180,
        debugLight: true,
      },
      {
        id: 'water-translucent',
        pos: [spawnPose.x, spawnPose.topY, spawnPose.z],
        yaw: Math.PI / 2,
        pitch: -0.25,
        debugLight: false,
      },
    ];

    const masterDir = '/tmp/perf-batch-master';
    const outDir = path.resolve('docs/screenshots/PERF-batch');
    fs.mkdirSync(outDir, { recursive: true });

    for (const vp of viewpoints) {
      await page.evaluate(async (v) => {
        const api = window.__blockcraft!;
        const cam = (window as unknown as Host).WorldManager.getInstance().camera;
        if (v.prePos) {
          cam.position.set(v.prePos);
          cam.updateView();
          await api.waitForTerrain!(8);
        }
        cam.position.set(v.pos);
        cam.yaw = v.yaw;
        cam.pitch = v.pitch;
        cam.updateView();
        await api.waitForTerrain!(8);
        api.setDebugLight!(v.debugLight);
      }, vp);
      await waitForStreamingIdle(page, 240_000);
      await waitSettledFrames(page, 4);

      // 1. Capture batched multi-draw frame
      const batchedStats = await page.evaluate(() => {
        const cr = (window as unknown as Host).WorldManager.getInstance().chunkRenderer;
        return {
          multiDraw: Boolean(cr.multiDraw),
          batch: cr.getBatchStats(),
          render: window.__blockcraft!.getRenderStats(),
        };
      });
      expect(batchedStats.multiDraw).toBe(true);
      const batchedBuf = await page.locator('#game-canvas').screenshot();

      // 2. Switch to the per-section drawElements path (same as ?debug=1&glcheck=draw) for 2 frames
      const perDrawStats = await page.evaluate(async () => {
        const cr = (window as unknown as Host).WorldManager.getInstance().chunkRenderer as {
          multiDraw: unknown;
          __savedMultiDraw?: unknown;
          getBatchStats(): BatchStats;
        };
        cr.__savedMultiDraw = cr.multiDraw;
        cr.multiDraw = null;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return {
          multiDraw: Boolean(cr.multiDraw),
          batch: cr.getBatchStats(),
          render: window.__blockcraft!.getRenderStats(),
        };
      });
      expect(perDrawStats.multiDraw).toBe(false);
      expect(perDrawStats.render.drawSubmissions).toBeGreaterThanOrEqual(
        perDrawStats.render.chunksVisible,
      );
      const perDrawBuf = await page.locator('#game-canvas').screenshot();

      // Restore multi-draw
      await page.evaluate(async () => {
        const cr = (window as unknown as Host).WorldManager.getInstance().chunkRenderer as {
          multiDraw: unknown;
          __savedMultiDraw?: unknown;
        };
        cr.multiDraw = cr.__savedMultiDraw ?? null;
        await new Promise((r) => requestAnimationFrame(r));
      });

      const batchedPng = PNG.sync.read(batchedBuf);
      const perDrawPng = PNG.sync.read(perDrawBuf);

      assertNotBlank(batchedPng);
      assertNoMissingTexture(batchedPng);
      assertNotBlank(perDrawPng);
      assertNoMissingTexture(perDrawPng);

      fs.writeFileSync(path.join(outDir, `perf-batch-${vp.id}.png`), batchedBuf);

      const diffPerDraw = diffFraction(batchedPng, perDrawPng);
      let diffMaster: number | null = null;
      const masterPath = path.join(masterDir, `view-${vp.id}.png`);
      if (fs.existsSync(masterPath)) {
        const masterPng = PNG.sync.read(fs.readFileSync(masterPath));
        diffMaster = diffFraction(batchedPng, masterPng);
      }

      console.log(
        'PERF-batch pixel-identity',
        JSON.stringify({
          viewpoint: vp.id,
          diffPerDraw,
          diffMaster,
          batchedSubmissions: batchedStats.render.drawSubmissions,
          perDrawSubmissions: perDrawStats.render.drawSubmissions,
        }),
      );

      expect(diffPerDraw, `${vp.id} batched vs per-section`).toBeLessThanOrEqual(0.0005);
      if (diffMaster !== null) {
        expect(diffMaster, `${vp.id} batched vs master baseline`).toBeLessThanOrEqual(0.0005);
      }
    }

    // Finally, verify ?debug=1&glcheck=draw URL parameter disables multiDraw on boot and renders without GL errors
    const baseUrl = page.url().split('?')[0];
    await page.goto(`${baseUrl}?debug=1&glcheck=draw`);
    await page.waitForFunction(() => window.__blockcraft?.ready);
    const glCheckDrawBoot = await page.evaluate(async () => {
      const api = window.__blockcraft!;
      await api.ready();
      await api.createWorld!({
        name: 'perf-batch-glcheck-flat',
        seed: 'blockcraft-test-seed-42',
        mode: 'creative',
        type: 'flat',
        spawning: false,
      });
      await api.waitForTerrain!(2);
      const cr = (window as unknown as Host).WorldManager.getInstance().chunkRenderer;
      return {
        multiDraw: Boolean(cr.multiDraw),
        stats: api.getRenderStats(),
      };
    });
    expect(glCheckDrawBoot.multiDraw).toBe(false);
    expect(glCheckDrawBoot.stats.drawCalls).toBeGreaterThan(0);
    expect(glCheckDrawBoot.stats.glErrors).toBe(0);
  });
});
