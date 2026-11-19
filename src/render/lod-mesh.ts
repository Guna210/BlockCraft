import { deriveSeed } from '../engine/rng';
import { BIOME_DEFINITIONS, OVERWORLD_BIOME_IDS, sampleBiome } from '../gen/biomes';
import { SEA_LEVEL } from '../gen/terrain';
import { sampleTerrainTopY } from '../gen/terrain-height';
import { withTerrainVariant, type TerrainVariant } from '../gen/world-options';
import { LOD_GRAVEL, LOD_SAND, LOD_SNOW, LOD_STONE, LOD_WATER } from './lod-colors';
import type { LodStep } from './lod-plan';

export const LOD_TILE_COLUMNS = 4;
export const LOD_TILE_SIZE = LOD_TILE_COLUMNS * 16;
export const LOD_QUAD_WORDS = 4;

export interface LodJob {
  tx: number;
  tz: number;
  seed: number;
  variant: TerrainVariant;
  step: LodStep;
}

export interface LodMesh {
  quads: Int32Array;
  opaqueCount: number;
  maxY: number;
  samplingMs: number;
}

/** Absolute coordinates keep cell sampling stable across plans and rebuilds. */
export function buildLodMesh(job: LodJob): LodMesh {
  return withTerrainVariant(job.variant, () => sampleTile(job));
}

function sampleTile({ tx, tz, seed, variant, step }: LodJob): LodMesh {
  const terrainSeed = deriveSeed(seed, 'terrain_shape');
  const x0 = tx * LOD_TILE_SIZE;
  const z0 = tz * LOD_TILE_SIZE;
  const cells = LOD_TILE_SIZE / step;
  const heights = new Uint16Array(cells * cells);
  const materials = new Uint8Array(heights.length);
  let maxY = 0;
  const started = performance.now();
  for (let z = 0; z < cells; z++) {
    for (let x = 0; x < cells; x++) {
      const wx = x0 + x * step + (step >> 1);
      const wz = z0 + z * step + (step >> 1);
      const top = variant.type === 'flat' ? SEA_LEVEL : sampleTerrainTopY(terrainSeed, wx, wz);
      const biome = variant.type === 'flat' ? 'plains' : sampleBiome(seed, wx, wz);
      const rules = BIOME_DEFINITIONS[biome].surfaceRules;
      const i = x + z * cells;
      heights[i] = Math.max(1, top + 1);
      materials[i] =
        top < SEA_LEVEL
          ? SEA_LEVEL - top > 8 || biome === 'deep_ocean'
            ? LOD_GRAVEL
            : LOD_SAND
          : rules.hasSnowTop && top >= (rules.snowlineY ?? SEA_LEVEL)
            ? LOD_SNOW
            : OVERWORLD_BIOME_IDS.indexOf(biome);
      maxY = Math.max(maxY, heights[i]!);
    }
  }
  for (let z = 0; z < cells; z++) {
    for (let x = 0; x < cells; x++) {
      const i = x + z * cells;
      const y = heights[i]!;
      const slope = Math.max(
        Math.abs(y - heights[z * cells + Math.max(0, x - 1)]!),
        Math.abs(y - heights[z * cells + Math.min(cells - 1, x + 1)]!),
        Math.abs(y - heights[Math.max(0, z - 1) * cells + x]!),
        Math.abs(y - heights[Math.min(cells - 1, z + 1) * cells + x]!),
      );
      if (slope >= 4 * step) materials[i] = LOD_STONE;
    }
  }
  const samplingMs = performance.now() - started;
  const quads: number[] = [];
  const emit = (
    x: number,
    z: number,
    width: number,
    depth: number,
    low: number,
    high: number,
    face: number,
    material: number,
    skirt = 0,
  ) => {
    quads.push(
      x0 + x * step,
      z0 + z * step,
      low | (high << 9),
      width | (depth << 5) | (face << 10) | (material << 13) | (skirt << 19),
    );
  };
  const column = 16 / step;
  for (let z = 0; z < cells; z++) {
    for (let x = 0; x < cells;) {
      const i = z * cells + x;
      const height = heights[i]!;
      const material = materials[i]!;
      let end = x + 1;
      const boundary = (Math.floor(x / column) + 1) * column;
      while (
        end < boundary &&
        heights[z * cells + end] === height &&
        materials[z * cells + end] === material
      )
        end++;
      emit(x, z, (end - x) * step, step, height, height, 2, material);
      x = end;
    }
  }
  for (let z = 0; z < cells; z++) {
    for (let x = 0; x < cells; x++) {
      const i = z * cells + x;
      const height = heights[i]!;
      const material = materials[i]!;
      for (let side = 0; side < 4; side++) {
        const dx = side === 0 ? 1 : side === 1 ? -1 : 0;
        const dz = side === 2 ? 1 : side === 3 ? -1 : 0;
        const nx = x + dx;
        const nz = z + dz;
        const face = side < 2 ? side : side + 2;
        if (nx < 0 || nx >= cells || nz < 0 || nz >= cells) {
          emit(x, z, step, step, 0, height, face, material, 2);
          continue;
        }
        const adjacent = heights[nz * cells + nx]!;
        if (height > adjacent) emit(x, z, step, step, adjacent, height, face, material);
        if (
          Math.floor(x / column) !== Math.floor(nx / column) ||
          Math.floor(z / column) !== Math.floor(nz / column)
        ) {
          emit(x, z, step, step, 0, Math.min(height, adjacent), face, material, 1);
        }
      }
    }
  }
  const opaqueCount = quads.length / LOD_QUAD_WORDS;
  for (let z = 0; z < cells; z++) {
    for (let x = 0; x < cells; x++) {
      if (heights[z * cells + x]! > SEA_LEVEL) continue;
      // A merged row interpolates the wave differently along the adjacent cell edge.
      emit(x, z, step, step, SEA_LEVEL, SEA_LEVEL, 2, LOD_WATER);
      maxY = Math.max(maxY, SEA_LEVEL + 1);
    }
  }
  return { quads: Int32Array.from(quads), opaqueCount, maxY, samplingMs };
}
