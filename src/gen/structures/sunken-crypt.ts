import { STRUCTURE_PLACEMENT_CONFIGS } from './placement';
import type { StructurePieceTemplate } from './jigsaw';
import type { StructureRegistration } from './stage';
import { cellNoise, PieceGrid } from './piece-grid';

const DOOR = 'crypt_door';

/** Old crypt masonry: cobblestone overgrown with moss, a few cracked stone blocks. */
function masonry(salt: number) {
  return (x: number, y: number, z: number): string => {
    const n = cellNoise(x, y, z, salt);
    return n < 0.45 ? 'mossy_cobblestone' : n < 0.85 ? 'cobblestone' : 'stone';
  };
}

/** A shelled room: solid masonry box with its inside carved to air. */
function shell(grid: PieceGrid, salt: number): void {
  const [sx, sy, sz] = grid.size;
  grid.fill(masonry(salt), [0, 0, 0], [sx - 1, sy - 1, sz - 1]);
  grid.fill('air', [1, 1, 1], [sx - 2, sy - 2, sz - 2]);
}

/** The central hall: 11×7×11 with a spawner in the middle, two chests and a doorway on each side. */
export function makeCryptHall(): StructurePieceTemplate {
  const grid = new PieceGrid('crypt_hall', [11, 7, 11]);
  shell(grid, 1);
  // Doorways 3 wide and 3 tall in the middle of every wall.
  grid.fill('air', [4, 1, 0], [6, 3, 0]);
  grid.fill('air', [4, 1, 10], [6, 3, 10]);
  grid.fill('air', [0, 1, 4], [0, 3, 6]);
  grid.fill('air', [10, 1, 4], [10, 3, 6]);
  // Corner pillars and a raised dais under the spawner.
  for (const [x, z] of [
    [1, 1],
    [9, 1],
    [1, 9],
    [9, 9],
  ] as const) {
    grid.fill('mossy_cobblestone', [x, 1, z], [x, 5, z]);
  }
  grid.set('spawner', 5, 1, 5);
  for (const [x, z] of [
    [4, 4],
    [6, 4],
    [4, 6],
    [6, 6],
  ] as const) {
    grid.set('cobblestone_slab', x, 1, z);
  }
  grid.set('chest', 2, 1, 1, { facing: 'south', pair: 'single' });
  grid.set('chest', 8, 1, 9, { facing: 'north', pair: 'single' });
  grid.set('silkmesh', 2, 5, 1);
  grid.set('silkmesh', 1, 5, 2);
  grid.set('silkmesh', 9, 5, 8);
  grid.set('silkmesh', 8, 4, 9);
  grid.set('brown_mushroom', 7, 1, 2);
  return grid.build([
    { pos: [5, 1, 0], facing: 'north', pool: 'crypt_branches', target: DOOR },
    { pos: [5, 1, 10], facing: 'south', pool: 'crypt_branches', target: DOOR },
    { pos: [0, 1, 5], facing: 'west', pool: 'crypt_branches', target: DOOR },
    { pos: [10, 1, 5], facing: 'east', pool: 'crypt_branches', target: DOOR },
  ]);
}

/** A vaulted passage 5 wide and 9 long, open at both ends. */
export function makeCryptCorridor(): StructurePieceTemplate {
  const grid = new PieceGrid('crypt_corridor', [5, 5, 9]);
  shell(grid, 2);
  grid.fill('air', [1, 1, 0], [3, 3, 0]);
  grid.fill('air', [1, 1, 8], [3, 3, 8]);
  // Niches with bones of moss and webs along the walls.
  grid.set('air', 0, 2, 3);
  grid.set('air', 4, 2, 5);
  grid.set('silkmesh', 1, 3, 4);
  grid.set('silkmesh', 3, 3, 2);
  grid.set('red_mushroom', 3, 1, 6);
  return grid.build([
    { pos: [2, 1, 0], facing: 'north', pool: 'crypt_rooms', target: DOOR },
    { pos: [2, 1, 8], facing: 'south', pool: 'crypt_rooms', target: DOOR },
  ]);
}

/** A side tomb: a stone sarcophagus, a chest at its head and webs in the corners. */
export function makeCryptTomb(): StructurePieceTemplate {
  const grid = new PieceGrid('crypt_tomb', [7, 6, 7]);
  shell(grid, 3);
  grid.fill('air', [2, 1, 6], [4, 3, 6]);
  grid.fill('stone', [2, 1, 2], [4, 1, 3]);
  grid.fill('stone_slab', [2, 2, 2], [4, 2, 3]);
  grid.set('chest', 3, 1, 1, { facing: 'south', pair: 'single' });
  grid.set('silkmesh', 1, 4, 1);
  grid.set('silkmesh', 5, 4, 1);
  grid.set('silkmesh', 5, 3, 5);
  return grid.build([{ pos: [3, 1, 6], facing: 'south', pool: 'crypt_rooms', target: DOOR }]);
}

/** A collapsed passage end: rubble of gravel and cobblestone under a sagging roof. */
export function makeCryptCollapse(): StructurePieceTemplate {
  const grid = new PieceGrid('crypt_collapse', [5, 5, 5]);
  shell(grid, 4);
  grid.fill('air', [1, 1, 4], [3, 3, 4]);
  grid.fill('gravel', [1, 1, 1], [3, 1, 2]);
  grid.fill('gravel', [1, 2, 1], [3, 2, 1]);
  grid.set('cobblestone', 2, 3, 1);
  grid.set('silkmesh', 3, 3, 3);
  return grid.build([{ pos: [2, 1, 4], facing: 'south', pool: 'crypt_rooms', target: DOOR }]);
}

const placement = STRUCTURE_PLACEMENT_CONFIGS.find((config) => config.id === 'sunken_crypt');
if (!placement) throw new Error('Missing sunken_crypt placement data');

/** Hollow, Skitterer and Sporeburst: the creatures a crypt spawner may hold. */
export const CRYPT_SPAWNER_CREATURES = ['hollow', 'skitterer', 'sporeburst'] as const;

export const SUNKEN_CRYPT_REGISTRATION: StructureRegistration = {
  config: placement,
  startTemplate: 'crypt_hall',
  templates: [makeCryptHall(), makeCryptCorridor(), makeCryptTomb(), makeCryptCollapse()],
  pools: [
    {
      name: 'crypt_branches',
      entries: [
        { template: 'crypt_corridor', weight: 3 },
        { template: 'crypt_tomb', weight: 2 },
        { template: 'crypt_collapse', weight: 1 },
      ],
    },
    {
      name: 'crypt_rooms',
      entries: [
        { template: 'crypt_tomb', weight: 2 },
        { template: 'crypt_collapse', weight: 1 },
      ],
    },
  ],
  maxDepth: 2,
  maxPieces: 7,
  foundationBlock: 'cobblestone',
  lootTable: 'sunken_crypt',
  spawnerCreatures: CRYPT_SPAWNER_CREATURES,
  buried: { cover: 12, minY: 6 },
};
