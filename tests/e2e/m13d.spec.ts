import { expect, test } from '../harness/fixture';

async function prepareBowRange(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page.evaluate(async (worldName) => {
    const api = window.__blockcraft!;
    await api.createWorld!({
      name: worldName,
      seed: 'blockcraft-test-seed-42',
      mode: 'survival',
      type: 'flat',
    });
    api.pause!();
    api.setRenderDistance!(4);
    api.setTimeOfDay!(6000);
    api.teleport!(0.5, 65, 0.5, 0, 0);
    api.giveItem!('bow', 1);
    api.giveItem!('arrow', 3);
    api.selectHotbarSlot!(0);
    await api.waitForTerrain!(2);
    api.fill!(20, 64, 0, 20, 70, 2, 'stone');
    await api.waitForTerrain!(1);
  }, name);
}

async function fireAtWall(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const api = window.__blockcraft!;
    api.input!('use', true);
    await api.tick!(20);
    api.input!('use', false);
    const projectile = api.getEntities!({ type: 'arrow' })[0];
    if (!projectile) throw new Error('Charged bow did not create an arrow');
    const samples = [api.getProjectile!(projectile.id)];
    for (let tick = 0; tick < 20 && !samples[samples.length - 1]!.stuck; tick++) {
      await api.tick!(1);
      samples.push(api.getProjectile!(projectile.id));
    }
    return {
      id: projectile.id,
      samples,
      arrowsAfterShot: api.getInventory!().reduce(
        (sum, stack) => sum + (stack?.id === 'arrow' ? stack.count : 0),
        0,
      ),
    };
  });
}

test('M13d a fully charged horizontal arrow drops under gravity and embeds in a wall 20 blocks away', async ({
  page,
}) => {
  await prepareBowRange(page, 'M13d arrow flight');
  const result = await fireAtWall(page);
  const firstY = result.samples[0]!.pos[1],
    last = result.samples[result.samples.length - 1]!;
  let apex = 0;
  for (let index = 1; index < result.samples.length; index++)
    if (result.samples[index]!.pos[1] > result.samples[apex]!.pos[1]) apex = index;
  for (let index = apex + 1; index < result.samples.length; index++)
    expect(result.samples[index]!.pos[1]).toBeLessThanOrEqual(result.samples[index - 1]!.pos[1]);
  expect(last.stuck).toBe(true);
  expect(firstY - last.pos[1]).toBeGreaterThan(0);
  expect(Math.abs(last.pos[0] - 20)).toBeLessThanOrEqual(0.5);
  expect(result.arrowsAfterShot).toBe(2);
});

test('M13d walking into a stuck survival arrow picks up one arrow', async ({ page }) => {
  await prepareBowRange(page, 'M13d arrow pickup');
  const fired = await fireAtWall(page);
  expect(fired.samples[fired.samples.length - 1]!.stuck).toBe(true);
  const result = await page.evaluate(
    async ({ id, before }) => {
      const api = window.__blockcraft!;
      api.input!('forward', true);
      await api.tick!(100);
      api.input!('forward', false);
      let pickupTicks = 0;
      const countArrows = () =>
        api.getInventory!().reduce(
          (sum, stack) => sum + (stack?.id === 'arrow' ? stack.count : 0),
          0,
        );
      while (countArrows() <= before && pickupTicks < 20) {
        await api.tick!(1);
        pickupTicks++;
      }
      return {
        pickupTicks,
        arrows: countArrows(),
        remaining: api.getEntities!({ type: 'arrow' }).some((entity) => entity.id === id),
        player: api.getPlayer!(),
      };
    },
    { id: fired.id, before: fired.arrowsAfterShot },
  );
  expect(result.pickupTicks).toBeLessThanOrEqual(20);
  expect(result.arrows).toBe(fired.arrowsAfterShot + 1);
  expect(result.remaining).toBe(false);
});
