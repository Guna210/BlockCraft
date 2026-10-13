import { test, expect } from '../harness/fixture';
import { assertNotBlank, assertNoMissingTexture, diffFraction } from '../harness/pixels';

test.beforeEach(async ({ page }) => {
  await page.evaluate(async () => {
    const a = window.__blockcraft!;
    await a.createWorld!({ name: 'M07a', mode: 'creative', type: 'flat' });
    a.pause!();
    a.teleport!(0.5, 65, 0.5, 0, 0);
    await a.tick!(1);
  });
});

test('M07a placement rejects own AABB and non-replaceable blocks; adjacent placement and log X axis succeed', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const a = window.__blockcraft!;
    a.setHeldBlock!('stone');
    a.setBlock!(1, 66, 0, 'stone');
    await a.waitForTerrain!(1);
    a.input!('use', true);
    await a.tick!(1);
    a.input!('use', false);
    const own = a.getBlock!(0, 66, 0);
    a.setBlock!(1, 66, 0, 'air');
    a.setBlock!(3, 66, 0, 'stone');
    await a.waitForTerrain!(1);
    a.setHeldBlock!('oak_log');
    const target = a.raycast!();
    a.input!('use', true);
    await a.tick!(1);
    a.input!('use', false);
    const adjacent = a.getBlock!(2, 66, 0);
    a.setBlock!(2, 66, 0, 'water');
    a.input!('use', true);
    await a.tick!(1);
    a.input!('use', false);
    const occupied = a.getBlock!(2, 66, 0);
    return { own, adjacent, occupied, target };
  });
  expect(result.own.id).toBe('air');
  expect(result.target).toMatchObject({ hit: true, block: [3, 66, 0], face: 'west' });
  expect(result.adjacent).toEqual({ id: 'oak_log', state: { axis: 'x' } });
  expect(result.occupied.id).toBe('water');
});

test('M07a creative breaking uploads a fresh section within two rendered frames and restores sky 15 below hole', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await page.evaluate(async () => {
    const a = window.__blockcraft!;
    a.fill!(2, 65, -1, 4, 67, 1, 'stone');
    a.setBlock!(3, 66, 0, 'air');
    a.teleport!(0.5, 65, 0.5, 0, 0);
    await a.waitForTerrain!(1);
  });
  // Break side block, then top roof from the open side; an enclosed hole initially has no sky.
  const before = await page.evaluate(() => window.__blockcraft!.getLight!(3, 66, 0).sky);
  expect(before).toBeLessThan(15);
  await page.evaluate(async () => {
    const a = window.__blockcraft!;
    a.setBlock!(2, 66, 0, 'air');
    a.setBlock!(2, 65, 0, 'air');
    a.teleport!(2.5, 65, 0.5, 0, Math.atan2(0.38, 1));
    await a.waitForTerrain!(1);
  });
  const beforeShot = await assertAndSaveScreenshot({ name: 'm07-before-break', milestone: 'M07a' });
  const result = await page.evaluate(async () => {
    const a = window.__blockcraft!;
    const ray = a.raycast!();
    const revision = a.getInteraction!().meshRevision;
    a.input!('attack', true);
    await a.tick!(1);
    a.input!('attack', false);
    for (let frame = 0; frame < 2; frame++)
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    return {
      ray,
      revision,
      interaction: a.getInteraction!(),
      light: a.getLight!(3, 66, 0),
      block: a.getBlock!(3, 67, 0),
    };
  });
  console.log('M07a edit evidence', JSON.stringify(result));
  expect(result.ray.block).toEqual([3, 67, 0]);
  expect(result.block.id).toBe('air');
  expect(result.light.sky).toBe(15);
  expect(result.interaction.meshRevision).toBeGreaterThan(result.revision);
  expect(result.interaction.meshFrame - result.interaction.editFrame).toBeLessThanOrEqual(2);
  const after = await assertAndSaveScreenshot({ name: 'm07-after-break', milestone: 'M07a' });
  expect(diffFraction(beforeShot, after)).toBeGreaterThan(0.001);
});

test('M07a survival cracks at half progress, release and target changes reset, bare hand stone takes 150 ticks', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  await page.evaluate(async () => {
    const a = window.__blockcraft!;
    a.setGameMode!('survival');
    a.setBlock!(3, 66, 0, 'stone');
    a.setBlock!(3, 66, 1, 'stone');
    a.teleport!(0.5, 65, 0.5, 0, 0);
    await a.waitForTerrain!(1);
    a.input!('attack', true);
    await a.tick!(75);
  });
  expect((await page.evaluate(() => window.__blockcraft!.getInteraction!())).progress).toBeCloseTo(
    0.5,
  );
  const shot = await assertAndSaveScreenshot({ name: 'm07-cracking', milestone: 'M07a' });
  assertNotBlank(shot);
  assertNoMissingTexture(shot);
  const reset = await page.evaluate(async () => {
    const a = window.__blockcraft!;
    a.input!('attack', false);
    const released = a.getInteraction!().progress;
    a.input!('attack', true);
    await a.tick!(20);
    a.look!(Math.atan2(1, 3), 0);
    await a.tick!(1);
    const changed = a.getInteraction!().progress;
    a.input!('attack', false);
    a.look!(0, 0);
    a.input!('attack', true);
    await a.tick!(149);
    const intact = a.getBlock!(3, 66, 0).id;
    await a.tick!(1);
    const broken = a.getBlock!(3, 66, 0).id;
    a.input!('attack', false);
    return { released, changed, intact, broken };
  });
  expect(reset.released).toBe(0);
  expect(reset.changed).toBeCloseTo(1 / 150);
  expect(reset.intact).toBe('stone');
  expect(reset.broken).toBe('air');
});

test('M07a middle pick uses default state; side torch tilts, emits light and bottom placement is rejected', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  const result = await page.evaluate(async () => {
    const a = window.__blockcraft!;
    a.fill!(3, 65, -1, 3, 69, 1, 'stone');
    a.setBlock!(3, 66, 0, 'oak_log', { axis: 'z' });
    await a.waitForTerrain!(1);
    a.input!('pick', true);
    await a.tick!(1);
    a.input!('pick', false);
    const picked = a.getInteraction!().heldBlock;
    a.input!('use', true);
    await a.tick!(1);
    a.input!('use', false);
    const log = a.getBlock!(2, 66, 0);
    a.setBlock!(2, 66, 0, 'air');
    a.setHeldBlock!('torch');
    a.input!('use', true);
    await a.tick!(1);
    a.input!('use', false);
    await a.waitForTerrain!(1);
    const wall = a.getBlock!(2, 66, 0),
      light = a.getLight!(2, 66, 0);
    a.teleport!(0.5, 65, -1, 0.45, 0.05);
    await a.tick!(1);
    return { picked, log, wall, light };
  });
  expect(result.picked).toBe('oak_log');
  expect(result.log.state.axis).toBe('x');
  expect(result.wall).toEqual({ id: 'wall_torch', state: { facing: 'west' } });
  expect(result.light.block).toBe(14);
  const shot = await assertAndSaveScreenshot({ name: 'm07-wall-torch', milestone: 'M07a' });
  assertNotBlank(shot);
  assertNoMissingTexture(shot);
  const bottom = await page.evaluate(async () => {
    const a = window.__blockcraft!;
    a.teleport!(0.5, 65, 0.5, 0, 0.5);
    a.fill!(3, 65, -1, 3, 69, 1, 'air');
    a.setBlock!(2, 66, 0, 'air');
    a.setBlock!(3, 68, 0, 'stone');
    a.look!(0, Math.atan2(68 - 66.62, 3 - 0.5));
    const ray = a.raycast!();
    a.input!('use', true);
    await a.tick!(1);
    a.input!('use', false);
    return { ray, block: a.getBlock!(3, 67, 0) };
  });
  expect(bottom.ray.face).toBe('bottom');
  expect(bottom.block.id).toBe('air');
});
