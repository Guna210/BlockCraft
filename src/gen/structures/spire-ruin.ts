import { STRUCTURE_PLACEMENT_CONFIGS } from './placement';
import type { StructurePieceTemplate } from './jigsaw';
import type { StructureRegistration } from './stage';
import { cellNoise, PieceGrid } from './piece-grid';

const LINK = 'spire_link';

/** Weathered tower stone: mostly cobblestone, banded with stone and patches of moss. */
function towerStone(salt: number) {
  return (x: number, y: number, z: number): string => {
    const n = cellNoise(x, y, z, salt);
    if (y % 6 === 0) return n < 0.6 ? 'stone' : 'cobblestone';
    return n < 0.2 ? 'mossy_cobblestone' : 'cobblestone';
  };
}

/** A hollow square tower of `height` with floors every 6 blocks and arrow slits. */
function tower(grid: PieceGrid, height: number, salt: number): void {
  const [sx, , sz] = grid.size;
  grid.fill(towerStone(salt), [0, 0, 0], [sx - 1, height - 1, sz - 1]);
  for (let y = 1; y < height; y++) {
    if (y % 6 === 0) continue;
    grid.fill('air', [1, y, 1], [sx - 2, y, sz - 2]);
  }
  const mid = Math.floor(sx / 2);
  for (let y = 3; y < height - 1; y += 6) {
    grid.fill('air', [mid, y, 0], [mid, y + 1, 0]);
    grid.fill('air', [mid, y, sz - 1], [mid, y + 1, sz - 1]);
    grid.fill('air', [0, y, mid], [0, y + 1, mid]);
    grid.fill('air', [sx - 1, y, mid], [sx - 1, y + 1, mid]);
  }
}

/**
 * The spire: a 7×7 tower 19 blocks tall with two upper floors and a crenellated top, a chest on
 * its ground floor and two gaps where its annexes join. Decay eats it away, the top most of all.
 */
export function makeSpireBase(): StructurePieceTemplate {
  const grid = new PieceGrid('spire_base', [7, 20, 7]);
  tower(grid, 19, 11);
  // A hole through each upper floor where a ladder once stood.
  grid.set('air', 4, 6, 4);
  grid.set('air', 4, 12, 4);
  for (let x = 0; x < 7; x++)
    for (let z = 0; z < 7; z++) {
      const edge = x === 0 || z === 0 || x === 6 || z === 6;
      if (edge && (x + z) % 2 === 0) grid.set('cobblestone', x, 19, z);
    }
  grid.fill('air', [3, 1, 6], [3, 2, 6]);
  grid.fill('air', [6, 1, 3], [6, 2, 3]);
  grid.set('chest', 1, 1, 1, { facing: 'south', pair: 'single' });
  grid.set('cobblestone_slab', 5, 1, 1);
  grid.set('silkmesh', 5, 11, 5);
  return grid.build([
    { pos: [3, 1, 6], facing: 'south', pool: 'spire_annex', target: LINK },
    { pos: [6, 1, 3], facing: 'east', pool: 'spire_annex', target: LINK },
  ]);
}

/** A curtain wall fragment running off the spire, 7 long, with a broken walkway on top. */
export function makeSpireWall(): StructurePieceTemplate {
  const grid = new PieceGrid('spire_wall', [7, 6, 3]);
  grid.fill(towerStone(12), [0, 0, 0], [6, 0, 2]);
  grid.fill(towerStone(13), [0, 1, 1], [6, 4, 1]);
  grid.fill('cobblestone_slab', [0, 5, 0], [4, 5, 2]);
  grid.set('air', 3, 2, 1);
  return grid.build([{ pos: [0, 1, 1], facing: 'west', pool: 'spire_annex', target: LINK }]);
}

/** The stump of a smaller watchtower: a 5×5 shell 9 blocks tall with one floor. */
export function makeSpireStump(): StructurePieceTemplate {
  const grid = new PieceGrid('spire_stump', [5, 9, 5]);
  tower(grid, 9, 14);
  grid.fill('air', [2, 1, 0], [2, 2, 0]);
  grid.set('air', 2, 6, 2);
  return grid.build([{ pos: [2, 1, 0], facing: 'north', pool: 'spire_annex', target: LINK }]);
}

const placement = STRUCTURE_PLACEMENT_CONFIGS.find((config) => config.id === 'spire_ruin');
if (!placement) throw new Error('Missing spire_ruin placement data');

export const SPIRE_RUIN_REGISTRATION: StructureRegistration = {
  config: placement,
  startTemplate: 'spire_base',
  templates: [makeSpireBase(), makeSpireWall(), makeSpireStump()],
  pools: [
    {
      name: 'spire_annex',
      entries: [
        { template: 'spire_wall', weight: 2 },
        { template: 'spire_stump', weight: 1 },
      ],
    },
  ],
  maxDepth: 1,
  maxPieces: 3,
  foundationBlock: 'cobblestone',
  lootTable: 'spire_ruin',
  decay: 0.55,
};
