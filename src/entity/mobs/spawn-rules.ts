import { sunElevationSin } from '../../world/time';
import { registerSpawnRule } from '../spawning';
import type { World } from '../../world/world';

const allBiomes: readonly string[] = [];
const grass: readonly string[] = ['grass_block'];
const mossbackGround: readonly string[] = ['grass_block', 'sand'];

function nearWater(world: World, x: number, y: number, z: number): boolean {
  // Nine horizontal probes and three vertical levels keep this check fixed and local.
  for (const dy of [-1, 0, 1])
    for (const dx of [-4, 0, 4])
      for (const dz of [-4, 0, 4])
        if (world.getBlock(x + dx, y + dy, z + dz).id === 'water') return true;
  return false;
}

function mothConditions(world: World, x: number, y: number, z: number): boolean {
  return (
    sunElevationSin() < 0 &&
    world.getBlock(x, y, z).id === 'air' &&
    world.getLight(x, y, z).block >= 8
  );
}

function sporeburstWeight(world: World, x: number, y: number, z: number): number {
  if (y >= world.getHeight(x, z) - 4) return 60;
  let mushrooms = 0;
  // A bounded 3×3×3 probe recognizes mushroom-heavy caves without column scans.
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -2; dx <= 2; dx += 2)
      for (let dz = -2; dz <= 2; dz += 2) {
        const block = world.getBlock(x + dx, y + dy, z + dz).id;
        if (block === 'brown_mushroom' || block === 'red_mushroom' || block === 'glowcap')
          mushrooms++;
      }
  return mushrooms >= 3 ? 180 : 60;
}

// M13e: each passive species forms groups of 2–4 in its listed overworld biomes.
registerSpawnRule({
  type: 'tuftbuck',
  category: 'passive',
  biomes: ['plains', 'meadow', 'savanna'],
  groupSize: [2, 4],
  weight: 10,
  ground: grass,
});
registerSpawnRule({
  type: 'rootboar',
  category: 'passive',
  biomes: ['oakwood_forest', 'birch_grove', 'pine_taiga'],
  groupSize: [2, 4],
  weight: 10,
  ground: grass,
});
registerSpawnRule({
  type: 'dapplefowl',
  category: 'passive',
  biomes: ['plains', 'savanna'],
  groupSize: [2, 4],
  weight: 8,
  ground: grass,
});
registerSpawnRule({
  type: 'mossback',
  category: 'passive',
  biomes: ['swampland', 'river', 'beach'],
  groupSize: [2, 4],
  weight: 6,
  ground: mossbackGround,
  where: nearWater,
});

// Moths need a lit air cell after sunset; the block-light threshold keeps them near light sources.
registerSpawnRule({
  type: 'glimmer_moth',
  category: 'ambient',
  biomes: allBiomes,
  groupSize: [2, 4],
  weight: 10,
  where: mothConditions,
});

// M13f: all hostiles use M13c's zero-block-light and dark-sky spot test.
registerSpawnRule({
  type: 'hollow',
  category: 'hostile',
  biomes: allBiomes,
  groupSize: [2, 4],
  weight: 100,
});
registerSpawnRule({
  type: 'thornling',
  category: 'hostile',
  biomes: allBiomes,
  groupSize: [1, 3],
  weight: 80,
});
registerSpawnRule({
  type: 'skitterer',
  category: 'hostile',
  biomes: allBiomes,
  groupSize: [1, 2],
  weight: 80,
});
registerSpawnRule({
  type: 'sporeburst',
  category: 'hostile',
  biomes: allBiomes,
  groupSize: 1,
  weight: 60,
  weightAt: sporeburstWeight,
});

// M13h: rare, solitary Cinderwraiths join the hostile mob cap.
registerSpawnRule({
  type: 'cinderwraith',
  category: 'hostile',
  biomes: allBiomes,
  groupSize: 1,
  weight: 10,
});
