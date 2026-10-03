import { test, expect } from '../harness/fixture';

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

  test('default world spawns camera surface height at (0.5, getHeight(0,0) + 1.82, 0.5)', async ({
    page,
  }) => {
    await page.evaluate(async () => {
      await window.__blockcraft!.createWorld!({
        seed: 'blockcraft-test-seed-42',
        type: 'default',
      });
      await window.__blockcraft!.waitForTerrain!(4);
    });

    const spawnData = await page.evaluate(() => {
      const surfaceY = window.__blockcraft!.getHeight!(0, 0);
      const cam = (
        window as unknown as {
          WorldManager: { getInstance: () => { camera: { position: [number, number, number] } } };
        }
      ).WorldManager.getInstance().camera;

      return {
        surfaceY,
        camPos: [cam.position[0], cam.position[1], cam.position[2]],
      };
    });

    expect(spawnData.surfaceY).toBeGreaterThan(30);
    expect(spawnData.camPos[0]).toBeCloseTo(0.5, 2);
    expect(spawnData.camPos[1]).toBeCloseTo(spawnData.surfaceY + 1.82, 2);
    expect(spawnData.camPos[2]).toBeCloseTo(0.5, 2);
  });
});
