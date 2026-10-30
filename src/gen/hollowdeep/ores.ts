import { hash3 } from '../../engine/rng';
import { BlockRegistry } from '../../world/blocks/registry';
import type { TerrainStage } from '../pipeline';

export const SKYSHARD_PER_MILLION = 25;
export const SKYSHARD_MIN_Y = 5;
export const SKYSHARD_PEAK_Y = 20;
export const SKYSHARD_MAX_Y = 60;

/** Discrete triangular band, including both endpoints and peaking at Appendix A.4's y 20. */
function depthWeight(y: number): number {
  return y <= SKYSHARD_PEAK_Y
    ? (y - SKYSHARD_MIN_Y + 1) / (SKYSHARD_PEAK_Y - SKYSHARD_MIN_Y + 1)
    : (SKYSHARD_MAX_Y - y + 1) / (SKYSHARD_MAX_Y - SKYSHARD_PEAK_Y + 1);
}

/** The whole-height denominator sets rarity; only the y 5–60 band receives ore. */
export const hollowdeepOreStage: TerrainStage = {
  name: 'hollowdeep:ores',
  generate(seed, cx, cz, column) {
    const registry = BlockRegistry.getInstance();
    const hosts = new Set(
      ['duskrock', 'driftstone', 'emberite', 'voidglass'].map((name) => registry.getStateId(name)!),
    );
    const skyshard = registry.getStateId('skyshard_ore')!;
    let solid = 0;
    let weightedHosts = 0;
    // Generation-time counting only; no load-time work or Overworld stage changes.
    for (let y = SKYSHARD_MIN_Y; y < 192; y++) {
      const weight = y <= SKYSHARD_MAX_Y ? depthWeight(y) : 0;
      for (let z = 0; z < 16; z++)
        for (let x = 0; x < 16; x++) {
          if (!hosts.has(column.getBlockStateId(x, y, z))) continue;
          solid++;
          weightedHosts += weight;
        }
    }
    if (weightedHosts === 0) return;
    const scale = (SKYSHARD_PER_MILLION * solid) / (1_000_000 * weightedHosts);
    for (let y = SKYSHARD_MIN_Y; y <= SKYSHARD_MAX_Y; y++) {
      const probability = scale * depthWeight(y);
      for (let z = 0; z < 16; z++)
        for (let x = 0; x < 16; x++) {
          if (
            hosts.has(column.getBlockStateId(x, y, z)) &&
            hash3(seed, cx * 16 + x, y, cz * 16 + z) < probability
          )
            column.setBlockStateId(x, y, z, skyshard);
        }
    }
  },
};
