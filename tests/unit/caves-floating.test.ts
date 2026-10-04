import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '../../src/world/world';
import { createDefaultPipeline } from '../../src/gen/pipeline';
import { hashString } from '../../src/engine/rng';
import { BlockRegistry } from '../../src/world/blocks/registry';

// M03d-fix: the bedrock fade at the bottom of the cave volume must not leave isolated solid
// blocks. Scope is y 0–20 only; M03f owns the full-height "no floating terrain" criterion.

const SEEDS = ['blockcraft-test-seed-42', 'blockcraft-alt-seed-7'];
const COLUMNS = 4; // 4×4 columns = 64×64 blocks; the 62×62 interior is checked (≥ 32×32)
const MAX_Y = 20;

describe('M03d-fix — no isolated solid blocks in y 0–20', () => {
  beforeEach(() => {
    BlockRegistry.resetInstance();
    BlockRegistry.getInstance();
  });

  for (const seedStr of SEEDS) {
    it(`zero solid blocks in y 0-${MAX_Y} with six air/fluid neighbours (${seedStr})`, () => {
      const pipeline = createDefaultPipeline();
      const worldSeed = hashString(seedStr);
      const world = new World(false);
      for (let cx = 0; cx < COLUMNS; cx++) {
        for (let cz = 0; cz < COLUMNS; cz++) {
          pipeline.generateColumn(worldSeed, cx, cz, world.getColumn(cx, cz, true)!);
        }
      }

      const isOpenCell = (x: number, y: number, z: number): boolean => {
        if (y < 0) return false; // below the world floor counts as solid
        const id = world.getBlock(x, y, z).id;
        return id === 'air' || id === 'water' || id === 'lava';
      };

      const size = COLUMNS * 16;
      const isolated: string[] = [];
      let solidChecked = 0;
      for (let z = 1; z < size - 1; z++) {
        for (let x = 1; x < size - 1; x++) {
          for (let y = 0; y <= MAX_Y; y++) {
            if (isOpenCell(x, y, z)) continue;
            solidChecked++;
            if (
              isOpenCell(x + 1, y, z) &&
              isOpenCell(x - 1, y, z) &&
              isOpenCell(x, y, z + 1) &&
              isOpenCell(x, y, z - 1) &&
              isOpenCell(x, y + 1, z) &&
              isOpenCell(x, y - 1, z)
            ) {
              isolated.push(`(${x},${y},${z})`);
            }
          }
        }
      }

      expect(solidChecked).toBeGreaterThan(10000); // the sample really contains terrain
      expect(
        isolated,
        `${isolated.length} isolated solid blocks, first: ${isolated.slice(0, 20).join(' ')}`,
      ).toEqual([]);
    });
  }
});
