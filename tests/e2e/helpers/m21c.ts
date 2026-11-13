import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
export async function connect(page: Page, name: string, port = 3001): Promise<void> {
  await page.getByRole('button', { name: 'Multiplayer', exact: true }).click();
  const form = page.locator('#multiplayer-screen');
  await form.getByLabel('Player name').fill(name);
  await form.getByLabel('Server address').fill(`ws://localhost:${port}`);
  await form.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(form).toBeHidden({ timeout: 60000 });
  await expect
    .poll(() => page.evaluate(() => window.__blockcraft!.getNetStats!().connected))
    .toBe(true);
  await page.evaluate(() => {
    window.__blockcraft!.setRenderDistance!(2);
    return window.__blockcraft!.waitForTerrain!(1);
  });
}
export async function second(
  browser: Browser,
): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (
      m.type() === 'error' ||
      (m.type() === 'warning' && m.text().toLowerCase().includes('webgl'))
    )
      errors.push(m.text());
  });
  page.on('requestfailed', (r) => errors.push(`requestfailed ${r.url()}`));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`HTTP ${r.status()}`);
  });
  await page.goto('http://localhost:3000/?debug=1');
  await page.evaluate(() => window.__blockcraft!.ready());
  return { context, page, errors };
}
export async function face(page: Page, other: Page): Promise<void> {
  const pos = await other.evaluate(() => window.__blockcraft!.getPlayer!().pos);
  await page.evaluate((pos) => {
    const api = window.__blockcraft!,
      p = api.getPlayer!().pos;
    api.look!(
      Math.atan2(pos[2] - p[2], pos[0] - p[0]),
      Math.atan2(pos[1] + 1.3 - (p[1] + 1.62), Math.hypot(pos[0] - p[0], pos[2] - p[2])),
    );
  }, pos);
}
export async function move(page: Page, blocks = 2): Promise<void> {
  const start = await page.evaluate((blocks) => {
    const api = window.__blockcraft!,
      p = api.getPlayer!().pos;
    let yaw = 0,
      best = Infinity;
    for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      let score = 0;
      for (let step = 1; step <= Math.ceil(blocks) + 1; step++)
        score += Math.abs(
          api.getHeight!(
            Math.floor(p[0] + Math.cos(angle) * step),
            Math.floor(p[2] + Math.sin(angle) * step),
          ) -
            (p[1] - 1),
        );
      if (score < best) {
        best = score;
        yaw = angle;
      }
    }
    api.look!(yaw, 0);
    api.input!('forward', true);
    api.input!('jump', true);
    return p;
  }, blocks);
  try {
    await expect
      .poll(
        () =>
          page.evaluate((start) => {
            const p = window.__blockcraft!.getPlayer!().pos;
            return Math.hypot(p[0] - start[0], p[2] - start[2]);
          }, start),
        { timeout: 10000 },
      )
      .toBeGreaterThan(blocks);
  } catch (error) {
    console.log(
      'M21c move diagnosis',
      await page.evaluate(() => ({
        player: window.__blockcraft!.getPlayer!(),
        trace: window.__blockcraft!.getNetPredictionTrace!(),
      })),
    );
    throw error;
  } finally {
    await page.evaluate(() => {
      window.__blockcraft!.input!('forward', false);
      window.__blockcraft!.input!('jump', false);
    });
  }
  let swimming = false;
  await expect
    .poll(
      async () => {
        const state = await page.evaluate(() => {
          const api = window.__blockcraft!,
            p = api.getPlayer!();
          return {
            ground: p.onGround,
            fluid: p.inFluid,
            head: api.getBlock!(
              Math.floor(p.pos[0]),
              Math.floor(p.pos[1] + 1.62),
              Math.floor(p.pos[2]),
            ).id,
          };
        });
        if (state.fluid && !swimming) {
          await page.evaluate(() => window.__blockcraft!.input!('jump', true));
          swimming = true;
        }
        return state.fluid ? state.head !== 'water' : state.ground;
      },
      { timeout: 10000 },
    )
    .toBe(true);
}

export async function assertHealthy(page: Page, errors: string[]): Promise<void> {
  expect(errors).toEqual([]);
  const stats = await page.evaluate(() => window.__blockcraft!.getRenderStats());
  expect(stats.glErrors).toBe(0);
  expect(stats.missingTextures).toEqual([]);
}
