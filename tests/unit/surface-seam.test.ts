import { describe, it, expect, beforeEach } from 'vitest';
import { createDefaultPipeline } from '../../src/gen/pipeline';
import { terrainShapeStage } from '../../src/gen/terrain';
import { biomeSurfaceStage } from '../../src/gen/surface';
import { sampleTerrainTopY } from '../../src/gen/terrain-height';
import { BIOME_DEFINITIONS, OVERWORLD_BIOME_IDS, OverworldBiomeId } from '../../src/gen/biomes';
import { ChunkColumn } from '../../src/world/column';
import { hashString, deriveSeed } from '../../src/engine/rng';
import { BlockRegistry } from '../../src/world/blocks/registry';

const SPAN = 24; // chunk columns per side (384 x 384 blocks)

// Biomes whose own surface rule puts stone on top (mountains and the stony shore). A stone top
// there is legitimate, so only the remaining biomes can show the border seam.
const STONE_RULE_BIOMES = new Set<string>(
  OVERWORLD_BIOME_IDS.filter(
    (id) => BIOME_DEFINITIONS[id as OverworldBiomeId].surfaceRules.topBlock === 'stone',
  ),
);

interface SeedCase {
  name: string;
  seed: string;
  originCx: number;
  originCz: number;
}

const CASES: SeedCase[] = [
  { name: 'standard', seed: 'blockcraft-test-seed-42', originCx: 0, originCz: 0 },
  { name: 'probe-seed-gamma', seed: 'probe-seed-gamma', originCx: 0, originCz: 0 },
];

function topSolid(col: ChunkColumn, x: number, z: number, water: number): number {
  for (let y = 319; y >= 0; y--) {
    const s = col.getBlockStateId(x, y, z);
    if (s !== 0 && s !== water) return y;
  }
  return -1;
}

describe('M03c-fix2 — surface border seam', () => {
  beforeEach(() => {
    BlockRegistry.resetInstance();
    BlockRegistry.getInstance();
  });

  for (const c of CASES) {
    it(`stone-topped fraction on flat non-mountain land is < 1% for border and interior cells (${c.name})`, () => {
      const registry = BlockRegistry.getInstance();
      const waterState = registry.getDefaultStateId('water')!;
      const stoneState = registry.getDefaultStateId('stone')!;
      const worldSeed = hashString(c.seed);

      // The true terrain heights are read after the terrain-shape stage alone; the surface stage is
      // then run on the same column, so its output can be compared with the real slopes.
      const shapeSeed = deriveSeed(worldSeed, terrainShapeStage.name);
      const surfaceSeed = deriveSeed(worldSeed, biomeSurfaceStage.name);

      const dim = SPAN * 16;
      const trueTop = new Int16Array(dim * dim);
      const surfaceTop = new Uint16Array(dim * dim); // state id of the top solid block
      const biomeAt: string[] = new Array<string>(dim * dim);
      const hasWater = new Uint8Array(dim * dim);

      for (let ci = 0; ci < SPAN; ci++) {
        for (let cj = 0; cj < SPAN; cj++) {
          const cx = c.originCx + ci;
          const cz = c.originCz + cj;
          const col = new ChunkColumn(cx, cz);
          col.worldSeed = worldSeed;
          terrainShapeStage.generate(shapeSeed, cx, cz, col);

          for (let z = 0; z < 16; z++) {
            for (let x = 0; x < 16; x++) {
              const gi = (cj * 16 + z) * dim + (ci * 16 + x);
              trueTop[gi] = topSolid(col, x, z, waterState);
            }
          }

          biomeSurfaceStage.generate(surfaceSeed, cx, cz, col);
          for (let z = 0; z < 16; z++) {
            for (let x = 0; x < 16; x++) {
              const gi = (cj * 16 + z) * dim + (ci * 16 + x);
              const sy = topSolid(col, x, z, waterState);
              surfaceTop[gi] = sy >= 0 ? col.getBlockStateId(x, sy, z) : 0;
              hasWater[gi] = sy >= 0 && col.getBlockStateId(x, sy + 1, z) === waterState ? 1 : 0;
              biomeAt[gi] = col.biomes[z * 16 + x]!;
            }
          }
        }
      }

      let borderEligible = 0;
      let borderStone = 0;
      let interiorEligible = 0;
      let interiorStone = 0;

      // Skip the outermost ring of the region: its neighbours were not generated.
      for (let gz = 1; gz < dim - 1; gz++) {
        for (let gx = 1; gx < dim - 1; gx++) {
          const gi = gz * dim + gx;
          if (STONE_RULE_BIOMES.has(biomeAt[gi]!)) continue;
          if (hasWater[gi] || trueTop[gi]! < 0) continue;
          const h = trueTop[gi]!;
          const slope = Math.max(
            Math.abs(h - trueTop[gi - 1]!),
            Math.abs(h - trueTop[gi + 1]!),
            Math.abs(h - trueTop[gi - dim]!),
            Math.abs(h - trueTop[gi + dim]!),
          );
          if (slope > 1) continue;

          const lx = gx & 15;
          const lz = gz & 15;
          const isBorder = lx === 0 || lx === 15 || lz === 0 || lz === 15;
          const isStone = surfaceTop[gi] === stoneState;
          if (isBorder) {
            borderEligible++;
            if (isStone) borderStone++;
          } else {
            interiorEligible++;
            if (isStone) interiorStone++;
          }
        }
      }

      const borderFrac = borderStone / borderEligible;
      const interiorFrac = interiorStone / interiorEligible;
      console.log(
        `[surface-seam ${c.name}] border ${borderStone}/${borderEligible} = ${(borderFrac * 100).toFixed(2)}% · interior ${interiorStone}/${interiorEligible} = ${(interiorFrac * 100).toFixed(2)}%`,
      );

      // Guard against a vacuous pass: the region must contain plenty of flat land.
      expect(borderEligible).toBeGreaterThanOrEqual(1000);
      expect(interiorEligible).toBeGreaterThanOrEqual(10000);
      expect(borderFrac).toBeLessThan(0.01);
      expect(interiorFrac).toBeLessThan(0.01);
    }, 20000);
  }

  it('sampleTerrainTopY matches the real terrain-shape top block exactly', () => {
    const registry = BlockRegistry.getInstance();
    const waterState = registry.getDefaultStateId('water')!;
    let checked = 0;
    for (const c of CASES) {
      const worldSeed = hashString(c.seed);
      const shapeSeed = deriveSeed(worldSeed, terrainShapeStage.name);
      // Sparse columns spread over land, coast, rivers and mountains.
      for (let ci = -12; ci < 12; ci += 3) {
        for (let cj = -12; cj < 12; cj += 3) {
          const col = new ChunkColumn(ci, cj);
          col.worldSeed = worldSeed;
          terrainShapeStage.generate(shapeSeed, ci, cj, col);
          for (let z = 0; z < 16; z += 3) {
            for (let x = 0; x < 16; x += 3) {
              const real = topSolid(col, x, z, waterState);
              const sampled = sampleTerrainTopY(shapeSeed, ci * 16 + x, cj * 16 + z);
              expect(sampled).toBe(real);
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(1000);
  }, 20000);

  it('generated columns are identical whatever order their neighbours are generated in', () => {
    const worldSeed = hashString('blockcraft-test-seed-42');
    const pipeline = createDefaultPipeline();
    const coords: [number, number][] = [];
    for (let cx = 0; cx < 2; cx++) for (let cz = 0; cz < 2; cz++) coords.push([cx, cz]);

    const generate = (order: [number, number][]): Map<string, Uint16Array> => {
      const out = new Map<string, Uint16Array>();
      for (const [cx, cz] of order) {
        const col = new ChunkColumn(cx, cz);
        pipeline.generateColumn(worldSeed, cx, cz, col);
        const states = new Uint16Array(16 * 320 * 16);
        let i = 0;
        for (let y = 0; y < 320; y++)
          for (let z = 0; z < 16; z++)
            for (let x = 0; x < 16; x++) states[i++] = col.getBlockStateId(x, y, z);
        out.set(`${cx},${cz}`, states);
      }
      return out;
    };

    const forward = generate(coords);
    const backward = generate([...coords].reverse());
    for (const [key, states] of forward) expect(backward.get(key)).toEqual(states);
  }, 20000);
});
