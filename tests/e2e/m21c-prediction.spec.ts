import { test, expect } from '../harness/fixture';
import { connect } from './helpers/m21c';
test('150 ms latency predicts input within one frame with fewer than five corrections over 30 seconds', async ({
  page,
}) => {
  await connect(page, `prediction-${Date.now().toString(36)}`, 3002);
  await expect
    .poll(() => page.evaluate(() => window.__blockcraft!.getNetStats!().rttMs))
    .toBeGreaterThan(100);
  const response = await page.evaluate(
    () =>
      new Promise<{ before: number[]; after: number[] }>((resolve) => {
        requestAnimationFrame(() => {
          const api = window.__blockcraft!;
          api.look!(0, 0);
          const before = [...api.getPlayer!().pos];
          api.input!('forward', true);
          requestAnimationFrame(() => resolve({ before, after: [...api.getPlayer!().pos] }));
        });
      }),
  );
  expect(response.after[0]).toBeGreaterThan(response.before[0]!);
  await page.evaluate(() => window.__blockcraft!.input!('forward', false));
  // Walk four sides, jumping up terrain steps and swimming at the surface when crossing water.
  const distance = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    let distance = 0,
      last = api.getPlayer!().pos;
    api.input!('forward', true);
    for (let step = 0; step < 120; step++) {
      const yaw = ((Math.floor(step / 10) % 4) * Math.PI) / 2;
      api.look!(yaw, 0);
      const p = api.getPlayer!();
      const ahead = api.getHeight!(
        Math.floor(p.pos[0] + Math.cos(yaw)),
        Math.floor(p.pos[2] + Math.sin(yaw)),
      );
      api.input!('jump', p.inFluid !== null || ahead >= p.pos[1]);
      await new Promise((resolve) => setTimeout(resolve, 250));
      const next = api.getPlayer!().pos;
      distance += Math.hypot(next[0] - last[0], next[2] - last[2]);
      last = next;
    }
    api.input!('forward', false);
    api.input!('jump', false);
    return distance;
  });
  const stats = await page.evaluate(() => window.__blockcraft!.getNetStats!());
  console.log(
    'M21c delayed walk',
    JSON.stringify({
      response,
      distance,
      stats,
      trace: await page.evaluate(() => window.__blockcraft!.getNetPredictionTrace!()),
    }),
  );
  expect(distance).toBeGreaterThan(3);
  expect(stats.predictionCorrections).toBeLessThan(5);
  expect(stats.connected).toBe(true);
});
