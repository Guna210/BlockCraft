import { test, expect } from '../harness/fixture';
import { assertHealthy, connect, second, face, move } from './helpers/m21c';

test('two players render one another and replicate a block edit within 500 ms', async ({
  page,
  browser,
  assertAndSaveScreenshot,
}) => {
  const b = await second(browser);
  try {
    // Select the existing networking-test distance before login; setting it afterward allows
    // default-distance startup work to queue ahead of the first remote frames.
    await Promise.all(
      [page, b.page].map((client) =>
        client.evaluate(() => window.__blockcraft!.setRenderDistance!(2)),
      ),
    );
    const unique = Date.now().toString(36);
    await connect(page, `world-A-${unique}`);
    await connect(b.page, `world-B-${unique}`);
    await move(b.page);
    await face(page, b.page);
    await face(b.page, page);
    for (const client of [page, b.page])
      await expect
        .poll(() =>
          client.evaluate(
            () =>
              window.__blockcraft!.getRemoteEntities!().filter(
                (e) => e.kind === 'player' && e.draws > 0,
              ).length,
          ),
        )
        .toBeGreaterThan(0);
    await expect(
      page.locator('.remote-name').filter({ hasText: `world-B-${unique}` }),
    ).toBeInViewport();
    await expect(
      b.page.locator('.remote-name').filter({ hasText: `world-A-${unique}` }),
    ).toBeInViewport();
    await assertAndSaveScreenshot({ name: 'm21-two-players', milestone: 'm21' });
    await page.keyboard.down('Tab');
    await expect(page.locator('#player-list')).toContainText(`world-B-${unique}`);
    await expect(page.locator('#player-list')).toContainText(/\d+ ms/);
    await page.keyboard.up('Tab');
    // Keep the target and all neighbouring columns inside received terrain.
    await page.evaluate(() => window.__blockcraft!.waitForTerrain!(2));
    await b.page.evaluate(() => window.__blockcraft!.waitForTerrain!(2));
    const target = await b.page.evaluate(() => {
      const api = window.__blockcraft!;
      const neighbours = [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ];
      const fluid = (id: string) => id === 'water' || id === 'lava';
      // Check block data first, then confirm nearby stone centres in distance order.
      const pos = api.getPlayer!().pos;
      const candidates: Array<{ block: [number, number, number]; distance: number }> = [];
      for (let x = Math.floor(pos[0]) - 3; x <= Math.floor(pos[0]) + 3; x++)
        for (let y = Math.floor(pos[1]) - 1; y <= Math.floor(pos[1]) + 4; y++)
          for (let z = Math.floor(pos[2]) - 3; z <= Math.floor(pos[2]) + 3; z++) {
            const distance = Math.hypot(
              x + 0.5 - pos[0],
              y + 0.5 - pos[1] - 1.62,
              z + 0.5 - pos[2],
            );
            if (distance > 3.5 || api.getBlock!(x, y, z).id !== 'stone') continue;
            if (
              neighbours.some(([dx, dy, dz]) => fluid(api.getBlock!(x + dx!, y + dy!, z + dz!).id))
            )
              continue;
            candidates.push({ block: [x, y, z], distance });
          }
      candidates.sort((a, b) => a.distance - b.distance);
      for (const {
        block: [x, y, z],
      } of candidates) {
        api.look!(
          Math.atan2(z + 0.5 - pos[2], x + 0.5 - pos[0]),
          Math.atan2(y + 0.5 - pos[1] - 1.62, Math.hypot(x + 0.5 - pos[0], z + 0.5 - pos[2])),
        );
        const hit = api.raycast!();
        if (hit.hit && hit.block![0] === x && hit.block![1] === y && hit.block![2] === z)
          return hit;
      }
      throw new Error(
        'No reachable solid stone target without fluid neighbours in received terrain',
      );
    });
    expect(target.hit).toBe(true);
    const block = target.block!;
    const before = await b.page.evaluate(
      ([x, y, z]) => window.__blockcraft!.getBlock!(x, y, z).id,
      block,
    );
    expect(before).not.toBe('air');
    expect(before).toBe('stone');
    expect(
      await b.page.evaluate(([x, y, z]) => {
        const api = window.__blockcraft!;
        return [
          [1, 0, 0],
          [-1, 0, 0],
          [0, 1, 0],
          [0, -1, 0],
          [0, 0, 1],
          [0, 0, -1],
        ]
          .map(([dx, dy, dz]) => api.getBlock!(x + dx!, y + dy!, z + dz!).id)
          .filter((id) => id === 'water' || id === 'lava');
      }, block),
    ).toEqual([]);
    expect(
      await page.evaluate(([x, y, z]) => window.__blockcraft!.getBlock!(x, y, z).id, block),
    ).toBe(before);
    await Promise.all(
      [page, b.page].map((client) =>
        client.evaluate(() => window.__blockcraft!.resetFrameStats!()),
      ),
    );
    // A watches the chosen edit, rather than continuing to render the sky/water behind B.
    await page.evaluate(([x, y, z]) => {
      const api = window.__blockcraft!,
        p = api.getPlayer!().pos;
      api.look!(
        Math.atan2(z + 0.5 - p[2], x + 0.5 - p[0]),
        Math.atan2(y + 0.5 - p[1] - 1.62, Math.hypot(x + 0.5 - p[0], z + 0.5 - p[2])),
      );
    }, block);
    await b.page.evaluate(() => window.__blockcraft!.input!('attack', true));
    await expect
      .poll(
        () => b.page.evaluate(([x, y, z]) => window.__blockcraft!.getBlock!(x, y, z).id, block),
        { timeout: 60000, intervals: [20] },
      )
      .toBe('air');
    const start = Date.now();
    await expect
      .poll(() => page.evaluate(([x, y, z]) => window.__blockcraft!.getBlock!(x, y, z).id, block), {
        timeout: 500,
        intervals: [20],
      })
      .toBe('air');
    const elapsed = Date.now() - start;
    console.log('M21c block replication ms', elapsed);
    expect(elapsed).toBeLessThanOrEqual(500);
    await b.page.evaluate(() => window.__blockcraft!.input!('attack', false));
    await assertHealthy(b.page, b.errors);
  } catch (error) {
    const state = await Promise.all(
      [page, b.page].map((client) =>
        client.evaluate(() => ({
          entities: window.__blockcraft!.getRemoteEntities!(),
          frames: window.__blockcraft!.getFrameStats!(),
          net: window.__blockcraft!.getNetStats!(),
          visibility: document.visibilityState,
        })),
      ),
    ).catch(() => []);
    console.log('M21c world failure state', JSON.stringify(state));
    throw error;
  } finally {
    await b.context.close();
  }
});

test('a raw twenty-block FinishBreak is rejected and remains in both worlds', async ({
  page,
  browser,
}) => {
  const b = await second(browser);
  try {
    const unique = Date.now().toString(36);
    await connect(page, `reach-A-${unique}`);
    await connect(b.page, `reach-B-${unique}`);
    await page.evaluate(() => window.__blockcraft!.waitForTerrain!(2));
    await b.page.evaluate(() => window.__blockcraft!.waitForTerrain!(2));
    const target = await page.evaluate(() => {
      const api = window.__blockcraft!,
        p = api.getPlayer!().pos;
      const x = Math.floor(p[0]) + 20,
        z = Math.floor(p[2]);
      return [x, api.getHeight!(x, z), z] as [number, number, number];
    });
    const original = await page.evaluate(
      ([x, y, z]) => window.__blockcraft!.getBlock!(x, y, z).id,
      target,
    );
    expect(original).not.toBe('air');
    expect(
      await b.page.evaluate(([x, y, z]) => window.__blockcraft!.getBlock!(x, y, z).id, target),
    ).toBe(original);
    await page.evaluate(([x, y, z]) => window.__blockcraft!.netFinishBreak!(x, y, z), target);
    await expect
      .poll(() =>
        page.evaluate(
          ([x, y, z]) =>
            window.__blockcraft!.getNetBlockUpdates!().some(
              (u) => u.x === x && u.y === y && u.z === z,
            ),
          target,
        ),
      )
      .toBe(true);
    for (const client of [page, b.page])
      expect(
        await client.evaluate(([x, y, z]) => window.__blockcraft!.getBlock!(x, y, z).id, target),
      ).toBe(original);
    await assertHealthy(b.page, b.errors);
  } finally {
    await b.context.close();
  }
});
