import { deriveSeed, hash3 } from '../../engine/rng';
import { BlockRegistry } from '../../world/blocks/registry';
import { makeSimplex2D } from '../noise';
import type { TerrainStage } from '../pipeline';

export const HOLLOWDEEP_BIOME_IDS = [
  'glowcap_forest',
  'magma_sea',
  'driftstone_expanse',
  'voidglass_geodes',
] as const;
export const HOLLOWDEEP_TOP = 192;
export const MAGMA_LEVEL = 40;

/** A sampler is local to a stage invocation, never a mutable seed cache. */
export function hollowdeepHeights(
  seed: number,
): (x: number, z: number) => { floor: number; ceiling: number; forest: boolean } {
  const broad = makeSimplex2D(seed);
  const detail = makeSimplex2D(deriveSeed(seed, 'detail'));
  return (x, z) => {
    const n = broad((x + 1831) / 190, (z - 731) / 190);
    return {
      floor: Math.floor(42 + n * 31 + detail(x / 43, z / 43) * 6),
      ceiling: Math.floor(172 + detail((x + 571) / 110, (z - 331) / 110) * 14),
      forest: n > 0.03,
    };
  };
}

export const hollowdeepShapeStage: TerrainStage = {
  name: 'hollowdeep:shape',
  generate(seed, cx, cz, column) {
    const registry = BlockRegistry.getInstance();
    const dusk = registry.getStateId('duskrock')!;
    const foundation = registry.getStateId('foundation_stone')!;
    const lava = registry.getStateId('lava')!;
    const emberite = registry.getStateId('emberite')!;
    const heights = hollowdeepHeights(seed);
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const wx = cx * 16 + x;
        const wz = cz * 16 + z;
        const { floor, ceiling } = heights(wx, wz);
        column.biomes[z * 16 + x] =
          floor >= MAGMA_LEVEL ? 'glowcap_forest' : floor < 32 ? 'driftstone_expanse' : 'magma_sea';
        for (let y = 0; y <= HOLLOWDEEP_TOP; y++) {
          let state = 0;
          if (y <= 4) state = foundation;
          else if (y <= floor || y >= ceiling) state = dusk;
          else if (y <= MAGMA_LEVEL) state = lava;
          // Small heat-fused nodules just below the magma shore.
          if (state === dusk && y >= 28 && y <= 40 && hash3(seed, wx >> 1, y >> 1, wz >> 1) < 0.025)
            state = emberite;
          if (state) column.setBlockStateId(x, y, z, state);
        }
      }
    }
  },
};
