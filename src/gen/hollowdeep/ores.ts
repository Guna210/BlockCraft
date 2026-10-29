import { hash3 } from '../../engine/rng';
import { BlockRegistry } from '../../world/blocks/registry';
import type { TerrainStage } from '../pipeline';

export const SKYSHARD_PER_MILLION = 25;

/** Whole-height rarity per mineable terrain block; the sealed floor and ceiling are preserved. */
export const hollowdeepOreStage: TerrainStage = {
  name: 'hollowdeep:ores',
  generate(seed, cx, cz, column) {
    const registry = BlockRegistry.getInstance();
    const hosts = new Set(
      ['duskrock', 'driftstone', 'emberite', 'voidglass'].map((name) => registry.getStateId(name)!),
    );
    const skyshard = registry.getStateId('skyshard_ore')!;
    for (let y = 5; y < 192; y++)
      for (let z = 0; z < 16; z++)
        for (let x = 0; x < 16; x++) {
          if (
            hosts.has(column.getBlockStateId(x, y, z)) &&
            hash3(seed, cx * 16 + x, y, cz * 16 + z) < SKYSHARD_PER_MILLION / 1_000_000
          )
            column.setBlockStateId(x, y, z, skyshard);
        }
  },
};
