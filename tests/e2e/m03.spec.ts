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
