import { test, expect } from '../harness/fixture';

test.describe('M02a: Blocks & Chunk Storage Debug API', () => {
  test('getBlock, setBlock and fill debug API methods operate correctly on world', async ({
    page,
  }) => {
    // Check initial getBlock at (0, 64, 0) is air
    const initialBlock = await page.evaluate(() => {
      return window.__blockcraft!.getBlock!(0, 64, 0);
    });
    expect(initialBlock).toEqual({ id: 'air', state: {} });

    // setBlock stone at (0, 64, 0)
    await page.evaluate(() => {
      window.__blockcraft!.setBlock!(0, 64, 0, 'stone');
    });

    const stoneBlock = await page.evaluate(() => {
      return window.__blockcraft!.getBlock!(0, 64, 0);
    });
    expect(stoneBlock).toEqual({ id: 'stone', state: {} });

    // setBlock oak_log with axis 'x' at (1, 64, 0)
    await page.evaluate(() => {
      window.__blockcraft!.setBlock!(1, 64, 0, 'oak_log', { axis: 'x' });
    });

    const logBlock = await page.evaluate(() => {
      return window.__blockcraft!.getBlock!(1, 64, 0);
    });
    expect(logBlock).toEqual({ id: 'oak_log', state: { axis: 'x' } });

    // fill region from (10, 70, 10) to (12, 72, 12) with dirt
    await page.evaluate(() => {
      window.__blockcraft!.fill!(10, 70, 10, 12, 72, 12, 'dirt');
    });

    const filledMin = await page.evaluate(() => {
      return window.__blockcraft!.getBlock!(10, 70, 10);
    });
    const filledMax = await page.evaluate(() => {
      return window.__blockcraft!.getBlock!(12, 72, 12);
    });
    const filledMid = await page.evaluate(() => {
      return window.__blockcraft!.getBlock!(11, 71, 11);
    });

    expect(filledMin.id).toBe('dirt');
    expect(filledMax.id).toBe('dirt');
    expect(filledMid.id).toBe('dirt');
  });
});
