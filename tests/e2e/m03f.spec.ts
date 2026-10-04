import { test, expect } from '../harness/fixture';
import { assertNoMissingTexture, assertNotBlank } from '../harness/pixels';
import type { Page } from '@playwright/test';

// M03f owner screenshots (not a SPEC Visual Review item): an oakwood forest, a desert and a
// rainforest, seen from above at about 30 degrees.

interface CameraHandle {
  position: Float32Array;
  yaw: number;
  pitch: number;
  updateView(): void;
}

type WorldManagerWindow = Window & {
  WorldManager: { getInstance(): { camera: CameraHandle } };
};

interface HeldFrames {
  __rafNative: (cb: FrameRequestCallback) => number;
  __rafQueue: FrameRequestCallback[];
}

// The same helpers as tests/e2e/m03c.spec.ts (tests/harness is read-only and that spec does not
// export them): hold the game's frame loop while terrain loads, then draw three frames on demand.
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

/**
 * Finds a spot well inside the biome (every point of a 3 x 3 pattern, 24 blocks apart, is that
 * biome), puts the camera above it looking down at 30 degrees, loads the terrain around it and
 * returns what the camera sees.
 */
async function frameBiome(page: Page, biome: string): Promise<{ x: number; y: number; z: number }> {
  const located = await page.evaluate(
    (id) => window.__blockcraft!.locate!('biome', id, [0, 64, 0]),
    biome,
  );
  expect(located, `locate('biome', '${biome}')`).not.toBeNull();

  const spot = await page.evaluate(
    ({ id, start }) => {
      const api = window.__blockcraft!;
      const inside = (x: number, z: number): boolean => {
        for (let dz = -24; dz <= 24; dz += 24) {
          for (let dx = -24; dx <= 24; dx += 24) {
            if (api.getBiome!(x + dx, z + dz) !== id) return false;
          }
        }
        return true;
      };
      for (let r = 0; r <= 400; r += 16) {
        for (let i = -r; i <= r; i += 16) {
          for (const [x, z] of [
            [start[0] + i, start[2] - r],
            [start[0] + i, start[2] + r],
            [start[0] - r, start[2] + i],
            [start[0] + r, start[2] + i],
          ] as const) {
            if (inside(x, z)) return { x, z };
          }
        }
      }
      return { x: start[0], z: start[2] };
    },
    { id: biome, start: located! },
  );

  // Load the columns around the spot (4 chunks each way) so that the ground can be measured
  await page.evaluate(({ x, z }) => {
    const camera = (window as unknown as WorldManagerWindow).WorldManager.getInstance().camera;
    camera.position[0] = x;
    camera.position[1] = 120;
    camera.position[2] = z;
    camera.updateView();
  }, spot);
  await page.evaluate(() => window.__blockcraft!.waitForTerrain!(4));

  // Choose the direction to look in: the camera stands 22 blocks behind the spot, 12 blocks above
  // the ground, and looks 30 degrees down; the view that has the most ground in front of it
  // (the centre ray above the ground, but within 30 blocks of it) is kept, so that a hill does not
  // fill the screen.
  const view = await page.evaluate(({ x, z }) => {
    const api = window.__blockcraft!;
    // the lowest of five samples, so that a crown above one of them does not count as ground
    const ground = (px: number, pz: number): number => {
      let lowest = 999;
      for (const [dx, dz] of [
        [0, 0],
        [3, 0],
        [-3, 0],
        [0, 3],
        [0, -3],
      ] as const) {
        lowest = Math.min(lowest, api.getHeight!(px + dx, pz + dz));
      }
      return lowest;
    };
    const headings = [
      { hx: 0, hz: -1, yaw: -Math.PI / 2 },
      { hx: 0, hz: 1, yaw: Math.PI / 2 },
      { hx: 1, hz: 0, yaw: 0 },
      { hx: -1, hz: 0, yaw: Math.PI },
    ];
    let best = { score: -1, camX: x, camY: 0, camZ: z, yaw: -Math.PI / 2, ground: 0 };
    for (const { hx, hz, yaw } of headings) {
      const camX = x - hx * 22;
      const camZ = z - hz * 22;
      const base = Math.max(ground(x, z), ground(camX, camZ));
      const camY = base + 12;
      let score = 0;
      for (let d = 8; d <= 44; d += 6) {
        const g = ground(camX + hx * d, camZ + hz * d);
        const ray = camY - d * Math.tan((30 * Math.PI) / 180);
        if (ray > g - 2 && ray - g < 30) score++;
      }
      if (score > best.score) best = { score, camX, camY, camZ, yaw, ground: base };
    }
    return best;
  }, spot);

  await page.evaluate(({ camX, camY, camZ, yaw }) => {
    const camera = (window as unknown as WorldManagerWindow).WorldManager.getInstance().camera;
    camera.position[0] = camX;
    camera.position[1] = camY;
    camera.position[2] = camZ;
    camera.yaw = yaw;
    camera.pitch = -(30 * Math.PI) / 180;
    camera.updateView();
  }, view);
  await page.evaluate(() => window.__blockcraft!.waitForTerrain!(3));
  await renderFrames(page);
  return { x: spot.x, y: view.ground, z: spot.z };
}

for (const [biome, name] of [
  ['oakwood_forest', 'm03f-forest'],
  ['desert', 'm03f-desert'],
  ['rainforest', 'm03f-rainforest'],
] as const) {
  test(`M03f: ${biome} seen from above at 30 degrees`, async ({
    page,
    assertAndSaveScreenshot,
  }) => {
    test.setTimeout(60_000);
    await holdFrames(page);
    await page.evaluate(async () => {
      await window.__blockcraft!.createWorld!({
        name: 'm03f-world',
        seed: 'blockcraft-test-seed-42',
        mode: 'survival',
        type: 'default',
      });
    });

    await frameBiome(page, biome);
    const png = await assertAndSaveScreenshot({ name, milestone: 'm03' });
    assertNotBlank(png);
    assertNoMissingTexture(png);
  });
}
