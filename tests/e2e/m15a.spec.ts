import fs from 'fs';
import path from 'path';
import { test, expect } from '../harness/fixture';
import { assertNoMissingTexture, assertNotBlank } from '../harness/pixels';

const MILESTONE = 'M15a';

test('M15a: a 16-block trace lights its lamp only with a middle relay', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await page
    .evaluate(async () => {
      const api = window.__blockcraft!;
      await api.createWorld!({
        name: 'M15a Current circuits',
        seed: 'blockcraft-m15a-current',
        mode: 'creative',
        type: 'flat',
      });
      api.pause!();
      api.setRenderDistance!(4);
      api.setClouds!('off');
      api.setTimeOfDay!(6000);
      api.teleport!(0.5, 65, 4, 0, -0.1);
      await api.tick!(1);
      await api.waitForTerrain!(1);

      api.setBlock!(1, 65, 0, 'lever', { face: 'floor', powered: 'true' });
      for (let x = 2; x <= 17; x++) api.setBlock!(x, 65, 0, 'copper_trace');
      for (let x = 2; x <= 17; x++) api.setBlock!(x, 65, 2, 'copper_trace');
      api.setBlock!(18, 65, 0, 'lamp');
      await api.waitForTerrain!(1);

      const withoutRelay = api.getBlock!(18, 65, 0);
      api.setBlock!(10, 65, 0, 'relay', {
        facing: 'east',
        delay: '1',
        locked: 'false',
        powered: 'false',
      });
      await api.tick!(2);
      await api.waitForTerrain!(1);
      return {
        withoutRelay,
        withRelay: api.getBlock!(18, 65, 0),
        poweredTrace: api.getBlock!(9, 65, 0),
        unpoweredTrace: api.getBlock!(9, 65, 2),
      };
    })
    .then((result) => {
      expect(result.withoutRelay.id).toBe('lamp');
      expect(result.withoutRelay.state.lit).toBe('false');
      expect(result.withRelay.state.lit).toBe('true');
      expect(result.poweredTrace.state.power).toBe('8');
      expect(result.unpoweredTrace.state.power).toBe('0');
    });

  await page
    .evaluate(async () => {
      const api = window.__blockcraft!;
      await api.createWorld!({
        name: 'M15a Circuit Visual Review',
        seed: 'blockcraft-m15a-circuit-visual',
        mode: 'creative',
        type: 'flat',
      });
      api.pause!();
      api.setRenderDistance!(4);
      api.setClouds!('off');
      api.setTimeOfDay!(18000);
      api.teleport!(2.5, 67.2, 9, -Math.PI / 2, -0.24);
      await api.tick!(1);
      await api.waitForTerrain!(1);

      api.setBlock!(-1, 65, 0, 'lever', { face: 'floor', powered: 'true' });
      for (let x = 0; x <= 5; x++) api.setBlock!(x, 65, 0, 'copper_trace');
      for (let x = 0; x <= 5; x++) api.setBlock!(x, 65, 2, 'copper_trace');
      api.setBlock!(6, 65, 0, 'lamp');
      api.setBlock!(6, 65, 2, 'lamp');
      await api.tick!(1);
      await api.waitForTerrain!(1);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );

      return {
        poweredTrace: api.getBlock!(3, 65, 0),
        unpoweredTrace: api.getBlock!(3, 65, 2),
        litLamp: api.getBlock!(6, 65, 0),
        unlitLamp: api.getBlock!(6, 65, 2),
      };
    })
    .then((result) => {
      expect(Number(result.poweredTrace.state.power)).toBeGreaterThan(0);
      expect(result.unpoweredTrace.state.power).toBe('0');
      expect(result.litLamp.state.lit).toBe('true');
      expect(result.unlitLamp.state.lit).toBe('false');
    });
  const image = await assertAndSaveScreenshot({ name: 'm15-circuit', milestone: MILESTONE });
  assertNotBlank(image);
  assertNoMissingTexture(image);
  const screenshotDirectory = path.join(process.cwd(), 'docs/screenshots/M15a');
  fs.mkdirSync(screenshotDirectory, { recursive: true });
  fs.copyFileSync(
    path.join(process.cwd(), `artifacts/${MILESTONE}/m15-circuit.png`),
    path.join(screenshotDirectory, 'm15-circuit.png'),
  );
});
