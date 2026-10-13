import { it, expect } from 'vitest';
import { breakSeconds } from '../../src/gameplay/mining';
import { BlockRegistry } from '../../src/world/blocks/registry';
it('M07a Appendix A.1 bare hand, correct/wrong tools, tiers and independent penalties', () => {
  const r = BlockRegistry.getInstance(),
    stone = r.getBlockDefinition('stone')!,
    log = r.getBlockDefinition('oak_log')!;
  expect(breakSeconds(stone)).toBe(7.5);
  expect(breakSeconds(log)).toBe(3);
  expect(breakSeconds(stone, { type: 'pickaxe', tier: 0, speed: 2 })).toBe(1.125);
  expect(breakSeconds(stone, { type: 'axe', tier: 4, speed: 9 })).toBe(7.5);
  expect(breakSeconds(stone, undefined, true)).toBe(37.5);
  expect(breakSeconds(stone, undefined, false, true)).toBe(37.5);
  expect(breakSeconds(stone, undefined, true, true)).toBe(187.5);
  expect(breakSeconds(r.getBlockDefinition('torch')!)).toBe(0);
  expect(breakSeconds(r.getBlockDefinition('foundation_stone')!)).toBe(Infinity);
});
