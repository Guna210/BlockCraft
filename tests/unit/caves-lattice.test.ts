import { describe, it, expect, beforeEach } from 'vitest';
import { createDefaultPipeline } from '../../src/gen/pipeline';
import { hashString } from '../../src/engine/rng';
import { ChunkColumn } from '../../src/world/column';
import { BlockRegistry } from '../../src/world/blocks/registry';

// M03d-fix: caves are sampled on a world-aligned lattice and generation reuses module scratch
// buffers, so a column must come out identical whatever was generated before it.

function columnFingerprint(col: ChunkColumn): number {
  let h = 2166136261;
  for (let y = 0; y < 160; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        h = Math.imul(h ^ (col.getBlockStateId(x, y, z) + 1), 16777619) >>> 0;
      }
    }
  }
  return h;
}

describe('M03d-fix — cave lattice sampling is order independent', () => {
  beforeEach(() => {
    BlockRegistry.resetInstance();
    BlockRegistry.getInstance();
  });

  for (const seedStr of ['blockcraft-test-seed-42', 'blockcraft-alt-seed-7']) {
    it(`every column is identical in forward, reverse and shuffled order (${seedStr})`, () => {
      const pipeline = createDefaultPipeline();
      const seed = hashString(seedStr);
      const coords: [number, number][] = [];
      for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) coords.push([cx, cz]);

      const run = (order: [number, number][]) => {
        const out = new Map<string, number>();
        for (const [cx, cz] of order) {
          const col = new ChunkColumn(cx, cz);
          pipeline.generateColumn(seed, cx, cz, col);
          out.set(`${cx},${cz}`, columnFingerprint(col));
        }
        return out;
      };

      const forward = run(coords);
      const reverse = run([...coords].reverse());
      // deterministic shuffle (no Math.random)
      const shuffled = [...coords];
      let state = 12345;
      for (let i = shuffled.length - 1; i > 0; i--) {
        state = (Math.imul(state, 1103515245) + 12345) >>> 0;
        const j = state % (i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      const mixed = run(shuffled);

      for (const [key, value] of forward) {
        expect(reverse.get(key), `column ${key} differs in reverse order`).toBe(value);
        expect(mixed.get(key), `column ${key} differs in shuffled order`).toBe(value);
      }
    });
  }
});
