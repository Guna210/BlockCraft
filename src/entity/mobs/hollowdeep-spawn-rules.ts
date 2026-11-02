import { registerSpawnRule } from '../spawning';
import type { World } from '../../world/world';
import { MAGMA_LEVEL } from '../../gen/hollowdeep/shape';
import { isLava } from './magmaw';
import { GLOWWING } from './glowwing';
import { MAGMAW } from './magmaw';

const AIR = 0;

/** Open cavern air: free cells around and three free cells below, above the magma sea. */
export function glowwingSpot(world: World, x: number, y: number, z: number): boolean {
  if (y <= MAGMA_LEVEL + 4) return false;
  for (let dy = -3; dy <= 1; dy++) if (world.getBlockStateId(x, y + dy, z) !== AIR) return false;
  return (
    world.getBlockStateId(x + 1, y, z) === AIR &&
    world.getBlockStateId(x - 1, y, z) === AIR &&
    world.getBlockStateId(x, y, z + 1) === AIR &&
    world.getBlockStateId(x, y, z - 1) === AIR
  );
}

/** Magma-sea lava: a lava cell with lava below, at or under the sea level. */
export function magmawSpot(world: World, x: number, y: number, z: number): boolean {
  return y <= MAGMA_LEVEL && isLava(world, x, y, z) && isLava(world, x, y - 1, z);
}

// M20c: Hollowdeep creatures spawn only in the Hollowdeep, and only these spawn there.
registerSpawnRule(
  {
    type: GLOWWING,
    category: 'hostile',
    biomes: [],
    groupSize: [1, 2],
    weight: 20,
    spot: glowwingSpot,
  },
  'hollowdeep',
);
registerSpawnRule(
  {
    type: MAGMAW,
    category: 'hostile',
    biomes: ['magma_sea', 'driftstone_expanse'],
    groupSize: 1,
    weight: 12,
    spot: magmawSpot,
  },
  'hollowdeep',
);
