import { test, expect } from '../harness/fixture';

test.describe('M03b-fix3: createWorld race', () => {
  test('a createWorld that is superseded by a newer one cannot write into the newer world', async ({
    page,
  }) => {
    const SEED_A = 'blockcraft-test-seed-42';
    const SEED_B = 'blockcraft-alt-seed-7';

    const result = await page.evaluate(
      async ({ seedA, seedB }) => {
        const wm = (
          window as unknown as {
            WorldManager: {
              getInstance: () => { resetWorldToEmpty: (seed: string, type: string) => void };
            };
          }
        ).WorldManager.getInstance();
        const api = window.__blockcraft!;

        // Fresh B: generated on the main thread into an empty world, no worker race involved.
        wm.resetWorldToEmpty(seedB, 'default');
        const freshB = api.worldHash!(0, 0, 64, 64);
        wm.resetWorldToEmpty(seedA, 'default');
        const freshA = api.worldHash!(0, 0, 64, 64);

        // A is not awaited. B is requested 300 ms later, while A is still generating.
        const worldA = api.createWorld!({ seed: seedA, type: 'default' });
        await new Promise((r) => setTimeout(r, 300));
        await api.createWorld!({ seed: seedB, type: 'default' });
        await worldA;
        await api.waitForTerrain!(4);

        const racedB = api.worldHash!(0, 0, 64, 64);
        return { freshA, freshB, racedB };
      },
      { seedA: SEED_A, seedB: SEED_B },
    );

    expect(result.freshA).not.toBe(result.freshB);
    expect(
      result.racedB,
      `B after a superseded createWorld(A) is ${result.racedB}, a fresh B is ${result.freshB}`,
    ).toBe(result.freshB);
  });
});
