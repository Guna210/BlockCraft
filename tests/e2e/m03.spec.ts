import { test, expect } from '../harness/fixture';
import { assertColorVariance, assertNoMissingTexture, assertNotBlank } from '../harness/pixels';
import type { Page } from '@playwright/test';

test.describe('M03b: Terrain Shape, Pipeline & Worker Pool Determinism', () => {
  test('worldHash of region (0,0)-(64,64) is identical for worker counts 1, 2 and 4, on a repeat run, and matches main-thread generation', async ({
    page,
  }) => {
    // 1. Get main-thread generated baseline hash by forcing demand generation on an empty world instance
    const mainThreadHashResult = await page.evaluate(async () => {
      const wm = (
        window as unknown as {
          WorldManager: {
            getInstance: () => { resetWorldToEmpty: (seed: string, type: string) => void };
          };
        }
      ).WorldManager.getInstance();

      wm.resetWorldToEmpty('blockcraft-test-seed-42', 'default');
      window.__blockcraft!.resetMainThreadGenCount!();

      // worldHash over region (0,0) to (64,64) forces on-demand main thread generation for columns (0,0)..(4,4)
      const hash = window.__blockcraft!.worldHash!(0, 0, 64, 64);
      const mainGenCount = window.__blockcraft!.getMainThreadGenCount!();

      return { hash, mainGenCount };
    });

    expect(mainThreadHashResult.hash).toBeDefined();
    expect(mainThreadHashResult.hash.length).toBe(8);
    expect(mainThreadHashResult.mainGenCount).toBe(25); // Exactly 5x5 = 25 columns generated on main thread

    const baselineHash = mainThreadHashResult.hash;

    // 2. Test worker counts 1, 2, 4 across 4 cycles total through real Web Workers
    // (worker count 1 has 2 runs to test repeatability; worker counts 2 and 4 have 1 run each)
    const workerConfig = [
      { workerCount: 1, runCount: 2 },
      { workerCount: 2, runCount: 1 },
      { workerCount: 4, runCount: 1 },
    ];
    const hashesByWorkerCount: Record<number, string[]> = { 1: [], 2: [], 4: [] };

    for (const { workerCount, runCount } of workerConfig) {
      for (let run = 1; run <= runCount; run++) {
        const result = await page.evaluate(
          async ({ count }) => {
            window.__blockcraft!.setWorkerPoolSize!(count);
            window.__blockcraft!.resetMainThreadGenCount!();

            await window.__blockcraft!.createWorld!({
              seed: 'blockcraft-test-seed-42',
              type: 'default',
            });

            await window.__blockcraft!.waitForTerrain!(4);

            window.__blockcraft!.resetMainThreadGenCount!();

            const hash = window.__blockcraft!.worldHash!(0, 0, 64, 64);
            const mainGenCount = window.__blockcraft!.getMainThreadGenCount!();
            const workerStats = window.__blockcraft!.getWorkerStats!();

            return { hash, mainGenCount, genMsP95: workerStats.genMsP95 };
          },
          { count: workerCount },
        );

        // Assert no column in region was generated on demand on main thread
        expect(
          result.mainGenCount,
          `Worker count ${workerCount} run ${run} triggered main thread generation`,
        ).toBe(0);

        hashesByWorkerCount[workerCount]!.push(result.hash);

        // Assert hash matches baseline
        expect(
          result.hash,
          `Worker count ${workerCount} run ${run} hash '${result.hash}' differs from baseline '${baselineHash}'`,
        ).toBe(baselineHash);
      }

      // Assert repeat runs for worker count N are identical
      const runs = hashesByWorkerCount[workerCount]!;
      if (runs.length > 1) {
        expect(runs[0]).toBe(runs[1]);
      }
    }
  });

  // M03b-fix3: the spawn is the nearest generated dry-land column to (0, 0), not getHeight(0, 0).
  for (const seed of ['blockcraft-test-seed-42', 'blockcraft-alt-seed-7']) {
    test(`default world spawns the camera on dry land above sea level (${seed})`, async ({
      page,
    }) => {
      await page.evaluate(async (s) => {
        await window.__blockcraft!.createWorld!({ seed: s, type: 'default' });
        await window.__blockcraft!.waitForTerrain!(4);
      }, seed);

      const spawnData = await page.evaluate(() => {
        const cam = (
          window as unknown as {
            WorldManager: {
              getInstance: () => { camera: { position: [number, number, number] } };
            };
          }
        ).WorldManager.getInstance().camera;
        const camPos = [cam.position[0], cam.position[1], cam.position[2]] as [
          number,
          number,
          number,
        ];
        const bx = Math.floor(camPos[0]);
        const bz = Math.floor(camPos[2]);
        const groundY = Math.round(camPos[1] - 1.82);
        return {
          camPos,
          groundY,
          surfaceY: window.__blockcraft!.getHeight!(bx, bz),
          ground: window.__blockcraft!.getBlock!(bx, groundY, bz).id,
          feet: window.__blockcraft!.getBlock!(bx, groundY + 1, bz).id,
          head: window.__blockcraft!.getBlock!(bx, groundY + 2, bz).id,
          biome: window.__blockcraft!.getBiome!(bx, bz),
        };
      });

      test.info().annotations.push({
        type: 'spawn',
        description: `${seed}: ${JSON.stringify(spawnData.camPos)} ground=${spawnData.ground} biome=${spawnData.biome}`,
      });

      // Camera at (x + 0.5, top + 1.82, z + 0.5), top above sea level (y > 64)
      expect(spawnData.camPos[1]).toBeGreaterThan(64);
      expect(spawnData.camPos[0] % 1).toBeCloseTo(0.5, 2);
      expect(spawnData.camPos[2] % 1).toBeCloseTo(0.5, 2);
      expect(spawnData.groundY).toBeGreaterThan(64);
      expect(spawnData.groundY).toBe(spawnData.surfaceY);
      // Standing on solid ground, with no fluid at the feet or head
      expect(['air', 'water', 'lava']).not.toContain(spawnData.ground);
      expect(spawnData.feet).not.toBe('water');
      expect(spawnData.feet).not.toBe('lava');
      expect(spawnData.head).not.toBe('water');
      expect(spawnData.head).not.toBe('lava');
    });
  }
});

// M03g: six fixed viewpoints (plains, mountains, ocean, desert, snowy, underground cave) on the
// standard seed, plus the biome-border view of Visual Review `m03-biome-border.png`. Every
// coordinate, yaw and pitch is hard-coded, so a view never changes between runs. They were chosen
// with the generator's own data (biome and height samplers, `locate`) and the spots in
// progress/M03e.md and progress/M03f.md. The camera is placed through `WorldManager`, as in
// m03d.spec.ts and m03f.spec.ts, because `teleport` does not exist before M06a.
//
// A viewpoint loads the terrain around `focus` first, then moves the camera and loads the terrain
// around it, which is the order the screenshots were chosen in (the loaded columns decide what
// the frame shows). The game's frame loop is held and three frames are drawn on demand, the same
// helpers as m03c.spec.ts and m03f.spec.ts (tests/harness is read-only and neither spec exports
// them).

interface HeldFrames {
  __rafNative: (cb: FrameRequestCallback) => number;
  __rafQueue: FrameRequestCallback[];
}

interface ViewpointCamera {
  position: Float32Array;
  yaw: number;
  pitch: number;
  updateView(): void;
}

interface WorldHandle {
  getInstance(): {
    camera: ViewpointCamera;
    world: {
      getColumn(cx: number, cz: number, create: boolean): { grassTints: Uint8Array } | null;
    };
  };
}

async function holdFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as HeldFrames;
    w.__rafNative = window.requestAnimationFrame.bind(window);
    w.__rafQueue = [];
    window.requestAnimationFrame = (cb: FrameRequestCallback) => w.__rafQueue.push(cb);
  });
}

async function renderFrames(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const w = window as unknown as HeldFrames;
    for (let i = 0; i < 3; i++) {
      for (const cb of w.__rafQueue.splice(0)) w.__rafNative(cb);
      await new Promise((r) => w.__rafNative(() => w.__rafNative(r)));
    }
  });
}

interface Viewpoint {
  /** Terrain is loaded around this block column first. */
  focus: [number, number];
  /** Camera position, yaw and pitch in degrees (yaw 0 looks along +x, 90 along +z). */
  camera: [number, number, number];
  yaw: number;
  pitch: number;
  /** getBiome at the camera's block column. */
  biome: string;
}

async function placeCamera(
  page: Page,
  x: number,
  y: number,
  z: number,
  yaw?: number,
  pitch?: number,
): Promise<void> {
  await page.evaluate(
    ([px, py, pz, yw, pt]) => {
      const camera = (window as unknown as { WorldManager: WorldHandle }).WorldManager.getInstance()
        .camera;
      camera.position[0] = px!;
      camera.position[1] = py!;
      camera.position[2] = pz!;
      if (yw !== undefined) camera.yaw = (yw * Math.PI) / 180;
      if (pt !== undefined) camera.pitch = (pt * Math.PI) / 180;
      camera.updateView();
    },
    [x, y, z, yaw, pitch] as const,
  );
}

async function showViewpoint(page: Page, view: Viewpoint): Promise<void> {
  await holdFrames(page);
  await page.evaluate(async () => {
    await window.__blockcraft!.createWorld!({
      name: 'm03g-viewpoint',
      seed: 'blockcraft-test-seed-42',
      mode: 'survival',
      type: 'default',
    });
  });
  await placeCamera(page, view.focus[0], 120, view.focus[1]);
  await page.evaluate(() => window.__blockcraft!.waitForTerrain!(4));
  await placeCamera(page, ...view.camera, view.yaw, view.pitch);
  await page.evaluate(() => window.__blockcraft!.waitForTerrain!(4));
  await renderFrames(page);

  const biome = await page.evaluate(
    ([x, z]) => window.__blockcraft!.getBiome!(Math.floor(x!), Math.floor(z!)),
    [view.camera[0], view.camera[2]] as const,
  );
  expect(biome, `getBiome at the viewpoint (${view.camera[0]}, ${view.camera[2]})`).toBe(
    view.biome,
  );
}

const VIEWPOINTS: Record<string, Viewpoint> = {
  // flowers, tall grass and a pumpkin on terraced grassland
  plains: {
    focus: [1120, -432],
    camera: [1120.5, 75.5, -446.5],
    yaw: 90,
    pitch: -28,
    biome: 'plains',
  },
  // a ridge of the frost-peaks massif seen from 60 blocks above its southern slope: snow-capped
  // peaks around a large exposed stone cliff
  mountains: {
    focus: [-552, -410],
    camera: [-600.5, 172.5, -505.5],
    yaw: 100,
    pitch: -18,
    biome: 'frost_peaks',
  },
  // under the sea surface, 2 blocks deep, looking at the sandy seabed that rises to the shore
  ocean: {
    focus: [-266, -188],
    camera: [-282.5, 62.5, -187.5],
    yaw: 0,
    pitch: -6,
    biome: 'ocean',
  },
  desert: {
    focus: [64, -208],
    camera: [64.5, 97, -229.5],
    yaw: 90,
    pitch: -30,
    biome: 'desert',
  },
  // snow, spruce and ice spikes
  snowy: {
    focus: [16, 624],
    camera: [16.5, 74.5, 609.5],
    yaw: 90,
    pitch: -28,
    biome: 'snowy_tundra',
  },
  // inside the open cavern of progress/M03e.md, 6 blocks from its wall of iron ore; the camera
  // stands at (-69.5, 19.5, -222.5), 4 blocks from M03e's suggested spot because the wall there
  // fills the frame
  cave: {
    focus: [-66, -217],
    camera: [-69.5, 19.5, -222.5],
    yaw: 39,
    pitch: -12,
    biome: 'savanna',
  },
  // olive savanna grass blending into the green of the plains and rainforest around it
  border: {
    focus: [-246, -190],
    camera: [-246.5, 87.5, -204.5],
    yaw: 90,
    pitch: -50,
    biome: 'rainforest',
  },
};

test.describe('M03g: fixed-viewpoint screenshots (SPEC M03 E2E criteria)', () => {
  for (const name of ['plains', 'mountains', 'desert', 'snowy'] as const) {
    test(`${name} viewpoint`, async ({ page, assertAndSaveScreenshot }) => {
      test.setTimeout(60_000);
      await showViewpoint(page, VIEWPOINTS[name]!);
      const png = await assertAndSaveScreenshot({ name: `m03-${name}`, milestone: 'm03' });
      assertNotBlank(png);
      assertNoMissingTexture(png);
      assertColorVariance(png, 20);
    });
  }

  test('ocean viewpoint', async ({ page, assertAndSaveScreenshot }) => {
    test.setTimeout(60_000);
    const view = VIEWPOINTS.ocean!;
    await showViewpoint(page, view);
    const block = await page.evaluate(
      ([x, y, z]) =>
        window.__blockcraft!.getBlock!(Math.floor(x!), Math.floor(y!), Math.floor(z!)).id,
      view.camera,
    );
    expect(block, 'the camera is under water').toBe('water');
    const png = await assertAndSaveScreenshot({ name: 'm03-ocean', milestone: 'm03' });
    assertNotBlank(png);
    assertNoMissingTexture(png);
    assertColorVariance(png, 20);

    // The water tile is opaque until M08b, so the seabed cannot be seen through the surface from
    // above: this second shot, from 6.5 blocks above the same water, shows the surface and the sandy
    // shore for the owner.
    await placeCamera(page, -284.5, 70.5, -187.5, 0, -22);
    await renderFrames(page);
    const above = await assertAndSaveScreenshot({ name: 'm03-ocean-surface', milestone: 'm03' });
    assertNotBlank(above);
    assertNoMissingTexture(above);
    assertColorVariance(above, 20);
  });

  test('underground cave viewpoint', async ({ page, assertAndSaveScreenshot }) => {
    test.setTimeout(60_000);
    const view = VIEWPOINTS.cave!;
    await showViewpoint(page, view);
    const scene = await page.evaluate(([x, y, z]) => {
      const api = window.__blockcraft!;
      const bx = Math.floor(x!);
      const by = Math.floor(y!);
      const bz = Math.floor(z!);
      return {
        camera: api.getBlock!(bx, by, bz).id,
        head: api.getBlock!(bx, by + 1, bz).id,
        iron: api.getBlock!(-65, 18, -218).id,
        lumite: api.getBlock!(-64, 16, -219).id,
        surface: api.getHeight!(bx, bz),
      };
    }, view.camera);
    // inside open air, deep underground, ores in the wall (progress/M03e.md)
    expect(scene.camera).toBe('air');
    expect(scene.head).toBe('air');
    expect(scene.surface).toBeGreaterThan(view.camera[1] + 20);
    expect(scene.iron).toBe('iron_ore');
    expect(scene.lumite).toBe('lumite_ore');
    const png = await assertAndSaveScreenshot({ name: 'm03-cave', milestone: 'm03' });
    assertNotBlank(png);
    assertNoMissingTexture(png);
    assertColorVariance(png, 20);
  });

  test('biome border viewpoint: grass tint blends smoothly', async ({
    page,
    assertAndSaveScreenshot,
  }) => {
    test.setTimeout(60_000);
    await showViewpoint(page, VIEWPOINTS.border!);
    // The grass tint of the loaded columns along a line across the border (x = -246, z -215 to
    // -165): neighbouring blocks differ by at most 12/255 per channel, and the whole line changes
    // by much more, so the blend is smooth but real.
    const tint = await page.evaluate(() => {
      const world = (window as unknown as { WorldManager: WorldHandle }).WorldManager.getInstance()
        .world;
      const x = -246;
      const row: number[][] = [];
      for (let z = -215; z <= -165; z++) {
        const col = world.getColumn(Math.floor(x / 16), Math.floor(z / 16), false)!;
        const i = (((z % 16) + 16) % 16) * 16 + (((x % 16) + 16) % 16);
        row.push([col.grassTints[i * 3]!, col.grassTints[i * 3 + 1]!, col.grassTints[i * 3 + 2]!]);
      }
      return row;
    });
    let maxStep = 0;
    let maxSpread = 0;
    for (let i = 1; i < tint.length; i++) {
      for (let c = 0; c < 3; c++)
        maxStep = Math.max(maxStep, Math.abs(tint[i]![c]! - tint[i - 1]![c]!));
    }
    for (let c = 0; c < 3; c++) {
      const values = tint.map((t) => t[c]!);
      maxSpread = Math.max(maxSpread, Math.max(...values) - Math.min(...values));
    }
    expect(maxStep, 'largest tint step between neighbouring blocks').toBeLessThanOrEqual(12);
    expect(maxSpread, 'tint change along the line').toBeGreaterThanOrEqual(40);

    const png = await assertAndSaveScreenshot({ name: 'm03-biome-border', milestone: 'm03' });
    assertNotBlank(png);
    assertNoMissingTexture(png);
    assertColorVariance(png, 20);
  });
});
