import { test, expect } from '../harness/fixture';

test('M08a poured water forms a waterfall column reaching ground within 60 paused simulation ticks', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const a = window.__blockcraft!;
    await a.createWorld!({
      name: 'M08a waterfall',
      mode: 'creative',
      type: 'flat',
      seed: 'blockcraft-test-seed-42',
    });
    a.pause!();
    // A ten-block cliff: the source spills east into a continuous falling column.
    a.fill!(0, 65, -2, 4, 74, 2, 'stone');
    a.fill!(0, 75, -2, 3, 75, 2, 'stone');
    a.fill!(4, 75, -1, 4, 75, 1, 'stone');
    a.setBlock!(4, 75, 0, 'water');
    const before = a.getBlock!(5, 75, 0);
    // Frames, streaming and rendering while paused must not advance fluid work.
    await a.waitForTerrain!(1);
    const afterFrames = a.getBlock!(5, 75, 0);
    await a.tick!(4);
    const beforeDue = a.getBlock!(5, 75, 0);
    await a.tick!(1);
    const spill = a.getBlock!(5, 75, 0);
    let elapsed = 5;
    while (elapsed < 60 && a.getBlock!(5, 65, 0).id !== 'water') {
      await a.tick!(1);
      elapsed++;
    }
    const column = [];
    for (let y = 65; y < 75; y++) column.push(a.getBlock!(5, y, 0));
    const ground = a.getBlock!(5, 64, 0);
    a.setBlock!(4, 75, 0, 'air');
    await a.tick!(160);
    const receded = [];
    for (let y = 65; y <= 75; y++) receded.push(a.getBlock!(5, y, 0).id);
    return { before, afterFrames, beforeDue, spill, elapsed, column, ground, receded };
  });
  console.log('M08a waterfall evidence', JSON.stringify(result));
  expect(result.before.id).toBe('air');
  expect(result.afterFrames.id).toBe('air');
  expect(result.beforeDue.id).toBe('air');
  expect(result.spill).toEqual({ id: 'water', state: { level: '1', falling: 'false' } });
  expect(result.elapsed).toBeLessThanOrEqual(60);
  expect(result.ground.id).toBe('grass_block');
  expect(result.column).toHaveLength(10);
  for (const block of result.column)
    expect(block).toEqual({ id: 'water', state: { level: '0', falling: 'true' } });
  expect(result.receded.every((id) => id === 'air')).toBe(true);
});
