import { World } from '../world/world';
import { BlockRegistry } from '../world/blocks/registry';

export const genStats = {
  genMsTimes: [] as number[],
  get genMsP95(): number {
    if (this.genMsTimes.length === 0) return 0;
    const sorted = [...this.genMsTimes].sort((a, b) => a - b);
    const p95Idx = Math.floor(sorted.length * 0.95);
    return sorted[p95Idx] ?? 0;
  },
};

export function generateFlatWorld(radiusChunks = 4, targetWorld?: World): World {
  const startTime = performance.now();
  const world = targetWorld || new World();
  const registry = BlockRegistry.getInstance();

  const stoneState = registry.getDefaultStateId('stone') ?? 1;
  const dirtState = registry.getDefaultStateId('dirt') ?? 1;
  const grassState = registry.getDefaultStateId('grass_block') ?? 1;

  for (let cx = -radiusChunks; cx <= radiusChunks; cx++) {
    for (let cz = -radiusChunks; cz <= radiusChunks; cz++) {
      const col = world.getColumn(cx, cz);
      if (!col) continue;

      // Section 0, 1, 2 (y=0..47) are 100% stone -> uniform section optimization
      for (let sy = 0; sy < 3; sy++) {
        const sec = col.getOrCreateSection(sy);
        if (sec) {
          sec.fill(stoneState);
        }
      }

      // Section 3 (y=48..63): y 48..60 is stone (yLocal 0..12), y 61..63 is dirt (yLocal 13..15)
      const sec3 = col.getOrCreateSection(3);
      if (sec3) {
        for (let yLocal = 0; yLocal <= 12; yLocal++) {
          for (let z = 0; z < 16; z++) {
            for (let x = 0; x < 16; x++) {
              sec3.setBlockStateId(x, yLocal, z, stoneState);
            }
          }
        }
        for (let yLocal = 13; yLocal <= 15; yLocal++) {
          for (let z = 0; z < 16; z++) {
            for (let x = 0; x < 16; x++) {
              sec3.setBlockStateId(x, yLocal, z, dirtState);
            }
          }
        }
      }

      // Section 4 (y=64..79): y 64 is grass_block (yLocal 0), y 65..79 is air (yLocal 1..15)
      const sec4 = col.getOrCreateSection(4);
      if (sec4) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) {
            sec4.setBlockStateId(x, 0, z, grassState);
          }
        }
      }
    }
  }

  const duration = performance.now() - startTime;
  genStats.genMsTimes.push(duration);
  if (genStats.genMsTimes.length > 100) {
    genStats.genMsTimes.shift();
  }

  return world;
}
