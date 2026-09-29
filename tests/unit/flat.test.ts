import { describe, test, expect } from 'vitest';
import { generateFlatWorld, genStats } from '../../src/gen/flat';

describe('Flat World Generator (M02c)', () => {
  test('generates stone to y=60, dirt to y=63, grass at y=64, air above y=64', () => {
    const world = generateFlatWorld(4);

    const stone = world.getBlock(0, 60, 0);
    expect(stone.id).toBe('stone');

    const dirt61 = world.getBlock(0, 61, 0);
    expect(dirt61.id).toBe('dirt');

    const dirt63 = world.getBlock(0, 63, 0);
    expect(dirt63.id).toBe('dirt');

    const grass = world.getBlock(0, 64, 0);
    expect(grass.id).toBe('grass_block');

    const air65 = world.getBlock(0, 65, 0);
    expect(air65.id).toBe('air');

    // Check bounds of render distance 4 (-4 to +4)
    const edgeGrass = world.getBlock(-64, 64, 64); // (-4*16, 64, 4*16)
    expect(edgeGrass.id).toBe('grass_block');

    expect(genStats.genMsP95).toBeGreaterThanOrEqual(0);
  });
});
