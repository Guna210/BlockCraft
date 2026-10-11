import { test, expect } from '../harness/fixture';
import type { PNG } from 'pngjs';
import { mkdirSync, copyFileSync } from 'node:fs';
import { waitForStreamingIdle } from './helpers/flight';

function mean(png: PNG, rect = { x: 0, y: 0, w: png.width, h: png.height }) {
  const rgb = [0, 0, 0];
  for (let y = rect.y; y < rect.y + rect.h; y++)
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = (y * png.width + x) * 4;
      for (let c = 0; c < 3; c++) rgb[c]! += png.data[i + c]!;
    }
  for (let c = 0; c < 3; c++) rgb[c]! /= rect.w * rect.h;
  const [r, g, b] = rgb as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const h = d === 0 ? 0 : max === r ? (g - b) / d : max === g ? 2 + (b - r) / d : 4 + (r - g) / d;
  return {
    luminance: 0.2126 * r + 0.7152 * g + 0.0722 * b,
    hue: (((h * 60) % 360) + 360) % 360,
    rgb,
  };
}

function save(name: string) {
  mkdirSync('docs/screenshots/M05b', { recursive: true });
  copyFileSync(`artifacts/M05b/${name}.png`, `docs/screenshots/M05b/${name}.png`);
}

test('M05 sealed stone room becomes warm and bright with a standing torch', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    await api.createWorld!({ type: 'flat', seed: 'blockcraft-test-seed-42' });
    // The surrounding flat-world stone forms a completely sealed room, without a skylight.
    api.fill!(3, 25, 3, 6, 28, 5, 'air');
    const wm = (
      window as unknown as {
        WorldManager: {
          getInstance(): {
            camera: { position: Float32Array; yaw: number; pitch: number; updateView(): void };
          };
        };
      }
    ).WorldManager.getInstance();
    wm.camera.position.set([4.5, 26.5, 5.5]);
    wm.camera.yaw = -Math.PI / 2;
    wm.camera.pitch = -0.65;
    wm.camera.updateView();
    await api.waitForTerrain!(1);
  });
  await waitForStreamingIdle(page, 120_000);
  const dark = mean(await assertAndSaveScreenshot({ name: 'm05-cave-dark', milestone: 'M05b' }));
  expect(dark.luminance).toBeLessThan(15);
  await page.evaluate(async () => {
    window.__blockcraft!.setBlock!(4, 25, 4, 'torch');
    await window.__blockcraft!.waitForTerrain!(1);
  });
  await waitForStreamingIdle(page, 120_000);
  const png = await assertAndSaveScreenshot({ name: 'm05-cave-torch', milestone: 'M05b' });
  save('m05-cave-torch');
  const lit = mean(png);
  // Stone floor beside the source, excluding its crossed flame and shaft sprites.
  const near = mean(png, { x: 780, y: 440, w: 100, h: 70 });
  console.log(
    'm05 torch',
    JSON.stringify({
      room: [3, 25, 3, 6, 28, 5],
      camera: [4.5, 26.5, 5.5],
      yaw: -Math.PI / 2,
      pitch: -0.65,
      torch: [4, 25, 4],
      hueRegion: [780, 440, 100, 70],
      dark,
      lit,
      rise: lit.luminance - dark.luminance,
      near,
    }),
  );
  expect(lit.luminance - dark.luminance).toBeGreaterThan(40);
  expect(near.hue).toBeGreaterThanOrEqual(15);
  expect(near.hue).toBeLessThanOrEqual(45);
});

test('M05 ambient occlusion darkens an inner stone corner', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await page.evaluate(async () => {
    const api = window.__blockcraft!;
    await api.createWorld!({ type: 'flat', seed: 'blockcraft-test-seed-42' });
    // An open roof admits uniform sky light; perpendicular walls create the inner corner.
    api.fill!(3, 66, 3, 8, 70, 8, 'air');
    api.fill!(3, 66, 3, 3, 69, 8, 'stone');
    api.fill!(3, 66, 3, 8, 69, 3, 'stone');
    const wm = (
      window as unknown as {
        WorldManager: {
          getInstance(): {
            camera: { position: Float32Array; yaw: number; pitch: number; updateView(): void };
          };
        };
      }
    ).WorldManager.getInstance();
    wm.camera.position.set([7.5, 67.5, 7.5]);
    wm.camera.yaw = (-3 * Math.PI) / 4;
    wm.camera.pitch = 0;
    wm.camera.updateView();
    await api.waitForTerrain!(1);
  });
  await waitForStreamingIdle(page, 120_000);
  const png = await assertAndSaveScreenshot({ name: 'm05-ao', milestone: 'M05b' });
  save('m05-ao');
  // Centre seam at x=z=4, compared with the same-height centre of its left wall face.
  const corner = mean(png, { x: 633, y: 353, w: 14, h: 14 });
  const wall = mean(png, { x: 400, y: 353, w: 14, h: 14 });
  const ratio = corner.luminance / wall.luminance;
  console.log(
    'm05 AO',
    JSON.stringify({
      walls: [
        [3, 66, 3, 3, 69, 8],
        [3, 66, 3, 8, 69, 3],
      ],
      camera: [7.5, 67.5, 7.5],
      yaw: (-3 * Math.PI) / 4,
      pitch: 0,
      corner,
      wall,
      ratio,
    }),
  );
  expect(ratio).toBeLessThan(0.75);
});
