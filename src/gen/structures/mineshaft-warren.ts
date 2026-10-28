import { STRUCTURE_PLACEMENT_CONFIGS } from './placement';
import type { StructurePieceTemplate } from './jigsaw';
import type { StructureRegistration } from './stage';
import { PieceGrid } from './piece-grid';

const LINK = 'warren_link';
const RAIL_Z = { axis: 'z' } as const;
const RAIL_X = { axis: 'x' } as const;
const POST = { axis: 'y' } as const;

/** A timber frame across a tunnel running along Z: two posts and a plank beam over them. */
function frameZ(grid: PieceGrid, z: number, x0: number, x1: number, top: number): void {
  grid.fill('oak_log', [x0, 1, z], [x0, top - 1, z], POST);
  grid.fill('oak_log', [x1, 1, z], [x1, top - 1, z], POST);
  grid.fill('oak_planks', [x0, top, z], [x1, top, z]);
}

/**
 * The hub where the diggers stored their haul: a 9×6×9 cavern on a plank floor, four timber
 * posts, a chest, and a tunnel mouth on every side. Only the hollow is written; the rock stays.
 */
export function makeWarrenHub(): StructurePieceTemplate {
  const grid = new PieceGrid('warren_hub', [9, 6, 9]);
  grid.fill('oak_planks', [1, 0, 1], [7, 0, 7]);
  grid.fill('air', [1, 1, 1], [7, 4, 7]);
  grid.fill('air', [3, 1, 0], [5, 3, 0]);
  grid.fill('air', [3, 1, 8], [5, 3, 8]);
  grid.fill('air', [0, 1, 3], [0, 3, 5]);
  grid.fill('air', [8, 1, 3], [8, 3, 5]);
  for (const [x, z] of [
    [2, 2],
    [6, 2],
    [2, 6],
    [6, 6],
  ] as const) {
    grid.fill('oak_log', [x, 1, z], [x, 3, z], POST);
  }
  grid.fill('oak_planks', [2, 4, 2], [6, 4, 2]);
  grid.fill('oak_planks', [2, 4, 6], [6, 4, 6]);
  grid.fill('decorative_rail', [4, 1, 0], [4, 1, 8], RAIL_Z);
  grid.set('chest', 1, 1, 6, { facing: 'east', pair: 'single' });
  grid.set('silkmesh', 7, 4, 1);
  grid.set('silkmesh', 1, 4, 1);
  return grid.build([
    { pos: [4, 1, 0], facing: 'north', pool: 'warren_paths', target: LINK },
    { pos: [4, 1, 8], facing: 'south', pool: 'warren_paths', target: LINK },
    { pos: [0, 1, 4], facing: 'west', pool: 'warren_paths', target: LINK },
    { pos: [8, 1, 4], facing: 'east', pool: 'warren_paths', target: LINK },
  ]);
}

/**
 * A straight tunnel 3 wide, 3 tall and 12 long, framed every 4 blocks, with a rail down the middle,
 * webs in its upper corners and a side passage off each wall.
 */
export function makeWarrenTunnel(): StructurePieceTemplate {
  const grid = new PieceGrid('warren_tunnel', [5, 5, 12]);
  grid.fill('air', [1, 1, 0], [3, 3, 11]);
  for (const z of [2, 6, 10]) frameZ(grid, z, 1, 3, 3);
  grid.fill('decorative_rail', [2, 1, 0], [2, 1, 11], RAIL_Z);
  grid.fill('air', [0, 1, 4], [0, 2, 4]);
  grid.fill('air', [4, 1, 4], [4, 2, 4]);
  grid.set('silkmesh', 1, 3, 4);
  grid.set('silkmesh', 3, 3, 8);
  grid.set('silkmesh', 3, 1, 7);
  return grid.build([
    { pos: [2, 1, 0], facing: 'north', pool: 'warren_paths', target: LINK },
    { pos: [2, 1, 11], facing: 'south', pool: 'warren_paths', target: LINK },
    { pos: [0, 1, 4], facing: 'west', pool: 'warren_paths', target: LINK },
    { pos: [4, 1, 4], facing: 'east', pool: 'warren_paths', target: LINK },
  ]);
}

/** A crossing chamber 7×5×7 where four tunnels meet under a timber ring, with crossed rails. */
export function makeWarrenCrossing(): StructurePieceTemplate {
  const grid = new PieceGrid('warren_crossing', [7, 5, 7]);
  grid.fill('air', [1, 1, 1], [5, 3, 5]);
  grid.fill('air', [2, 1, 0], [4, 3, 0]);
  grid.fill('air', [2, 1, 6], [4, 3, 6]);
  grid.fill('air', [0, 1, 2], [0, 3, 4]);
  grid.fill('air', [6, 1, 2], [6, 3, 4]);
  for (const [x, z] of [
    [1, 1],
    [5, 1],
    [1, 5],
    [5, 5],
  ] as const) {
    grid.fill('oak_log', [x, 1, z], [x, 3, z], POST);
  }
  grid.fill('oak_planks', [1, 4, 1], [5, 4, 1]);
  grid.fill('oak_planks', [1, 4, 5], [5, 4, 5]);
  grid.fill('oak_planks', [1, 4, 2], [1, 4, 4]);
  grid.fill('oak_planks', [5, 4, 2], [5, 4, 4]);
  grid.fill('decorative_rail', [3, 1, 0], [3, 1, 6], RAIL_Z);
  grid.fill('decorative_rail', [0, 1, 3], [2, 1, 3], RAIL_X);
  grid.fill('decorative_rail', [4, 1, 3], [6, 1, 3], RAIL_X);
  grid.set('silkmesh', 2, 3, 1);
  grid.set('silkmesh', 4, 3, 5);
  return grid.build([
    { pos: [3, 1, 0], facing: 'north', pool: 'warren_paths', target: LINK },
    { pos: [3, 1, 6], facing: 'south', pool: 'warren_paths', target: LINK },
    { pos: [0, 1, 3], facing: 'west', pool: 'warren_paths', target: LINK },
    { pos: [6, 1, 3], facing: 'east', pool: 'warren_paths', target: LINK },
  ]);
}

/** A dead-end store: a short framed bay with a chest at its end, half wrapped in silk. */
export function makeWarrenStore(): StructurePieceTemplate {
  const grid = new PieceGrid('warren_store', [5, 5, 6]);
  grid.fill('air', [1, 1, 0], [3, 3, 4]);
  frameZ(grid, 1, 1, 3, 3);
  grid.fill('decorative_rail', [2, 1, 0], [2, 1, 3], RAIL_Z);
  grid.set('chest', 2, 1, 4, { facing: 'north', pair: 'single' });
  grid.set('silkmesh', 1, 2, 4);
  grid.set('silkmesh', 3, 2, 4);
  grid.set('silkmesh', 1, 3, 3);
  return grid.build([{ pos: [2, 1, 0], facing: 'north', pool: 'warren_paths', target: LINK }]);
}

/** A caved-in end: the tunnel runs a few blocks into a slope of gravel. */
export function makeWarrenCaveIn(): StructurePieceTemplate {
  const grid = new PieceGrid('warren_cave_in', [5, 5, 5]);
  grid.fill('air', [1, 1, 0], [3, 3, 3]);
  frameZ(grid, 0, 1, 3, 3);
  grid.fill('gravel', [1, 1, 2], [3, 1, 3]);
  grid.fill('gravel', [1, 2, 3], [3, 2, 3]);
  grid.set('decorative_rail', 2, 1, 1, RAIL_Z);
  grid.set('silkmesh', 3, 3, 2);
  return grid.build([{ pos: [2, 1, 0], facing: 'north', pool: 'warren_paths', target: LINK }]);
}

const placement = STRUCTURE_PLACEMENT_CONFIGS.find((config) => config.id === 'mineshaft_warren');
if (!placement) throw new Error('Missing mineshaft_warren placement data');

export const MINESHAFT_WARREN_REGISTRATION: StructureRegistration = {
  config: placement,
  startTemplate: 'warren_hub',
  templates: [
    makeWarrenHub(),
    makeWarrenTunnel(),
    makeWarrenCrossing(),
    makeWarrenStore(),
    makeWarrenCaveIn(),
  ],
  pools: [
    {
      name: 'warren_paths',
      entries: [
        { template: 'warren_tunnel', weight: 5 },
        { template: 'warren_crossing', weight: 2 },
        { template: 'warren_store', weight: 1 },
        { template: 'warren_cave_in', weight: 1 },
      ],
    },
  ],
  maxDepth: 5,
  maxPieces: 14,
  foundationBlock: 'cobblestone',
  lootTable: 'mineshaft_warren',
  buried: { cover: 10, minY: 8 },
};
