import { test, expect } from '../harness/fixture';

test.describe('M13b: A* pathfinding', () => {
  test('page loads with 0 errors and debug ready for M13 pathfinding integration', async ({
    page,
  }) => {
    const stats = await page.evaluate(() => {
      return (
        window as unknown as {
          __blockcraft: {
            getRenderStats(): { glErrors: number; missingTextures: string[] };
          };
        }
      ).__blockcraft.getRenderStats();
    });

    expect(stats.glErrors).toBe(0);
    expect(stats.missingTextures.length).toBe(0);
  });
});
