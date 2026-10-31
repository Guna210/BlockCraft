import { deriveSeed, hash3 } from '../../engine/rng';
import { BlockRegistry } from '../../world/blocks/registry';
import type { TerrainStage } from '../pipeline';
import { hollowdeepHeights, HOLLOWDEEP_BIOME_IDS, MAGMA_LEVEL } from './shape';

/** Finite feature cells are evaluated by every intersecting column, including negative coordinates. */
export const hollowdeepFeatureStage: TerrainStage = {
  name: 'hollowdeep:features',
  generate(seed, cx, cz, column) {
    const registry = BlockRegistry.getInstance();
    const id = (name: string): number => registry.getStateId(name)!;
    const dusk = id('duskrock');
    const drift = id('driftstone');
    const glass = id('voidglass');
    const stem = id('glowcap_stem');
    const cap = id('glowcap');
    const gills = id('glowcap_gills');
    const vine = id('veilroot');
    const lava = id('lava');
    const shapeSeed = deriveSeed(column.worldSeed!, 'hollowdeep:shape');
    const heights = hollowdeepHeights(shapeSeed);
    const x0 = cx * 16;
    const z0 = cz * 16;
    const put = (x: number, y: number, z: number, state: number, airOnly = false): void => {
      if (x < x0 || x >= x0 + 16 || z < z0 || z >= z0 + 16 || y <= 4 || y >= 192) return;
      const old = column.getBlockStateId(x - x0, y, z - z0);
      if (airOnly && old !== 0) return;
      column.setBlockStateId(x - x0, y, z - z0, state);
    };
    // Broad flattened islands over the lowest sea chasms; each has a pointed underside.
    for (let gz = Math.floor((z0 - 20) / 64); gz <= Math.floor((z0 + 35) / 64); gz++) {
      for (let gx = Math.floor((x0 - 20) / 64); gx <= Math.floor((x0 + 35) / 64); gx++) {
        const x = gx * 64 + 16 + Math.floor(hash3(seed, gx, 1, gz) * 32);
        const z = gz * 64 + 16 + Math.floor(hash3(seed, gx, 2, gz) * 32);
        const floor = heights(x, z).floor;
        if (floor > 40) continue;
        const top = 85 + Math.floor(hash3(seed, gx, 3, gz) * 35);
        for (let dz = -17; dz <= 17; dz++)
          for (let dx = -17; dx <= 17; dx++) {
            const r = (dx * dx) / 289 + (dz * dz) / 196;
            if (r > 1) continue;
            const depth = Math.floor((1 - r) * 13) + 2;
            for (let y = top - depth; y <= top; y++) put(x + dx, y, z + dz, drift, true);
            if (x + dx >= x0 && x + dx < x0 + 16 && z + dz >= z0 && z + dz < z0 + 16)
              column.biomes[(z + dz - z0) * 16 + x + dx - x0] = 'driftstone_expanse';
          }
      }
    }
    // Hollow geodes embedded in the cavern floor: stone rind, tinted crystal shell, air core.
    for (let gz = Math.floor((z0 - 9) / 64); gz <= Math.floor((z0 + 24) / 64); gz++) {
      for (let gx = Math.floor((x0 - 9) / 64); gx <= Math.floor((x0 + 24) / 64); gx++) {
        if (hash3(seed, gx, 9, gz) > 0.28) continue;
        const x = gx * 64 + 12 + Math.floor(hash3(seed, gx, 10, gz) * 40);
        const z = gz * 64 + 12 + Math.floor(hash3(seed, gx, 11, gz) * 40);
        const y = Math.max(15, heights(x, z).floor - 3);
        for (let dz = -8; dz <= 8; dz++)
          for (let dx = -8; dx <= 8; dx++)
            for (let dy = -8; dy <= 8; dy++) {
              const r = dx * dx + dy * dy + dz * dz;
              if (r > 64) continue;
              put(x + dx, y + dy, z + dz, r > 49 ? dusk : r > 30 ? glass : 0);
              if (x + dx >= x0 && x + dx < x0 + 16 && z + dz >= z0 && z + dz < z0 + 16)
                column.biomes[(z + dz - z0) * 16 + x + dx - x0] = 'voidglass_geodes';
            }
      }
    }
    // Jittered trees, clipped at column boundaries. The same anchor is recomputed on both sides.
    for (let gz = Math.floor((z0 - 4) / 12); gz <= Math.floor((z0 + 19) / 12); gz++) {
      for (let gx = Math.floor((x0 - 4) / 12); gx <= Math.floor((x0 + 19) / 12); gx++) {
        const x = gx * 12 + 3 + Math.floor(hash3(seed, gx, 20, gz) * 6);
        const z = gz * 12 + 3 + Math.floor(hash3(seed, gx, 21, gz) * 6);
        const { floor, forest } = heights(x, z);
        if (!forest || floor <= MAGMA_LEVEL || hash3(seed, gx, 22, gz) > 0.8) continue;
        const top = floor + 7 + Math.floor(hash3(seed, gx, 23, gz) * 5);
        for (let y = floor + 1; y < top; y++) put(x, y, z, stem, true);
        for (let dz = -4; dz <= 4; dz++)
          for (let dx = -4; dx <= 4; dx++) {
            const r = dx * dx + dz * dz;
            if (r > 17) continue;
            put(x + dx, top - 1, z + dz, gills, true);
            put(x + dx, top, z + dz, cap, true);
            if (r < 10) put(x + dx, top + 1, z + dz, cap, true);
            if (r >= 10 && hash3(seed, x + dx, 24, z + dz) < 0.22)
              for (let k = 2; k < 6; k++) put(x + dx, top - k, z + dz, vine, true);
          }
      }
    }
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        const wx = x0 + x;
        const wz = z0 + z;
        const { floor, ceiling } = heights(wx, wz);
        // Ceiling falls are coherent 2x2 shafts, descending all the way into the magma sea.
        if (hash3(seed, wx >> 1, 30, wz >> 1) < 0.0015) {
          for (let y = Math.max(floor + 1, MAGMA_LEVEL + 1); y <= ceiling; y++)
            put(wx, y, wz, lava);
        } else if (hash3(seed, wx, 31, wz) < 0.025) {
          const length = 3 + Math.floor(hash3(seed, wx, 32, wz) * 9);
          for (let k = 1; k <= length; k++) put(wx, ceiling - k, wz, vine, true);
        }
      }
    for (let i = 0; i < 256; i++)
      column.biomeIndices[i] = HOLLOWDEEP_BIOME_IDS.indexOf(
        column.biomes[i] as (typeof HOLLOWDEEP_BIOME_IDS)[number],
      );
  },
};
