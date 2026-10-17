import { expect, it } from 'vitest';
import armorItems from '../../data/items/armor.json';
import { FrameStats } from '../../src/engine/frame-stats';
import { Player } from '../../src/entity/player';
import { equippedArmorPoints } from '../../src/ui/hud';

it('gives armor items valid display points with full sets capped at 20', () => {
  const copper = ['copper_helmet', 'copper_chestplate', 'copper_leggings', 'copper_boots'];
  const iron = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'];
  for (const item of Object.values(armorItems)) {
    expect(
      Number.isInteger(item.armorPoints) && item.armorPoints >= 0 && item.armorPoints <= 20,
    ).toBe(true);
  }
  const total = (ids: string[]) =>
    ids.reduce((sum, id) => sum + armorItems[id as keyof typeof armorItems].armorPoints, 0);
  expect(total(copper)).toBe(10);
  expect(total(iron)).toBe(15);
  expect(Math.max(total(copper), total(iron))).toBeLessThanOrEqual(20);
});

it('totals armor from the four equipped slots only', () => {
  const slots = Array.from(
    { length: 41 },
    () => null as { slot: number; id: string; count: number } | null,
  );
  slots[0] = { slot: 0, id: 'iron_chestplate', count: 1 };
  slots[36] = { slot: 36, id: 'copper_helmet', count: 1 };
  slots[37] = { slot: 37, id: 'iron_chestplate', count: 1 };
  slots[39] = { slot: 39, id: 'copper_boots', count: 1 };
  const player = { inventory: { slots } } as unknown as Pick<Player, 'inventory'>;
  expect(equippedArmorPoints(player)).toBe(9);
});

it('exposes recent frame CPU samples as a bounded ring buffer', () => {
  const stats = new FrameStats();
  for (let frame = 1; frame <= 125; frame++) stats.record(frame, 0, 0);
  expect(stats.recentFrameTimes()).toHaveLength(120);
  expect(stats.recentFrameTimes(3)).toEqual([123, 124, 125]);
  stats.reset();
  expect(stats.recentFrameTimes()).toEqual([]);
});

it('adds XP fields to a new player at their zero defaults and snapshot', () => {
  const player = new Player({} as never, () => true);
  expect(player.xpLevel).toBe(0);
  expect(player.xpProgress).toBe(0);
  expect(player.snapshot()).toMatchObject({ xpLevel: 0, xpProgress: 0 });
});
