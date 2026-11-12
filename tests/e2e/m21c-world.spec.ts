import { test, expect } from '../harness/fixture';
import { assertHealthy, connect, second, face, move } from './helpers/m21c';

test('two players render one another and replicate a block edit within 500 ms', async ({
  page,
  browser,
  assertAndSaveScreenshot,
}) => {
  const b = await second(browser);
  try {
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
    const target = await b.page.evaluate(() => {
      const api = window.__blockcraft!;
      api.look!(0, -Math.PI / 2 + 0.011);
      return api.raycast!();
    });
    expect(target.hit).toBe(true);
    const block = target.block!;
    const before = await b.page.evaluate(
      ([x, y, z]) => window.__blockcraft!.getBlock!(x, y, z).id,
      block,
    );
    expect(before).not.toBe('air');
    expect(
      await page.evaluate(([x, y, z]) => window.__blockcraft!.getBlock!(x, y, z).id, block),
    ).toBe(before);
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
