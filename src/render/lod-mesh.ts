import { deriveSeed } from '../engine/rng';
import { BIOME_DEFINITIONS, OVERWORLD_BIOME_IDS, sampleBiome } from '../gen/biomes';
import { SEA_LEVEL } from '../gen/terrain';
import { sampleTerrainTopY } from '../gen/terrain-height';
import { withTerrainVariant, type TerrainVariant } from '../gen/world-options';
import { columnKey } from '../world/streaming-plan';
import type { LodColors } from './lod-colors';

export const LOD_TILE_COLUMNS = 4;
export const LOD_TILE_SIZE = LOD_TILE_COLUMNS * 16;
export const LOD_STEP = 4;
const CELLS = LOD_TILE_SIZE / LOD_STEP;
export const LOD_VERTEX_WORDS = 5;
export const LOD_TILE_VERTICES = (CELLS ** 2 + LOD_TILE_COLUMNS ** 2 * 16) * 6;

export interface LodJob {
  tx: number;
  tz: number;
  seed: number;
  variant: TerrainVariant;
  colors: LodColors;
}

export interface LodMesh {
  vertices: Int32Array;
  maxY: number;
}

/** The shared lattice is sampled at absolute coordinates so neighbouring tiles agree at borders. */
export function buildLodMesh(job: LodJob): LodMesh {
  return withTerrainVariant(job.variant, () => sampleTile(job));
}

function sampleTile({ tx, tz, seed, variant, colors }: LodJob): LodMesh {
  const terrainSeed = deriveSeed(seed, 'terrain_shape');
  const x0 = tx * LOD_TILE_SIZE;
  const z0 = tz * LOD_TILE_SIZE;
  const stride = CELLS + 1;
  const tops = new Uint16Array(stride ** 2);
  const heights = new Uint16Array(tops.length);
  let maxY = 0;
  for (let z = 0; z <= CELLS; z++) {
    for (let x = 0; x <= CELLS; x++) {
      const i = x + z * stride;
      const top =
        variant.type === 'flat'
          ? 64
          : sampleTerrainTopY(terrainSeed, x0 + x * LOD_STEP, z0 + z * LOD_STEP);
      const y = Math.max(SEA_LEVEL, top + 1);
      tops[i] = Math.max(0, top);
      heights[i] = y;
      maxY = Math.max(maxY, y);
    }
  }

  const vertices = new Int32Array(LOD_TILE_VERTICES * LOD_VERTEX_WORDS);
  let cursor = 0;
  let owner = 0;
  let color = 0;
  let edge = 0;
  const vertex = (x: number, y: number, z: number, lower = false) => {
    vertices[cursor++] = x;
    vertices[cursor++] = y | (edge << 9) | (lower ? 1 << 12 : 0);
    vertices[cursor++] = z;
    vertices[cursor++] = color;
    vertices[cursor++] = owner;
  };
  const skirt = (
    direction: number,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
  ) => {
    const atTileEdge =
      direction === 1
        ? ax === x0
        : direction === 2
          ? ax === x0 + LOD_TILE_SIZE
          : direction === 3
            ? az === z0
            : az === z0 + LOD_TILE_SIZE;
    edge = direction | (atTileEdge ? 16 : 0);
    vertex(ax, ay, az);
    vertex(bx, by, bz);
    vertex(ax, 0, az, true);
    vertex(bx, by, bz);
    vertex(bx, 0, bz, true);
    vertex(ax, 0, az, true);
  };

  for (let z = 0; z < CELLS; z++) {
    for (let x = 0; x < CELLS; x++) {
      const i = x + z * stride;
      const a = heights[i]!;
      const b = heights[i + 1]!;
      const c = heights[i + stride]!;
      const d = heights[i + stride + 1]!;
      const wx = x0 + x * LOD_STEP;
      const wz = z0 + z * LOD_STEP;
      const ex = wx + LOD_STEP;
      const ez = wz + LOD_STEP;
      const biome = variant.type === 'flat' ? 'plains' : sampleBiome(seed, wx + 2, wz + 2);
      const rules = BIOME_DEFINITIONS[biome].surfaceRules;
      const top = (tops[i]! + tops[i + 1]! + tops[i + stride]! + tops[i + stride + 1]!) / 4;
      const rgb =
        Math.max(a, b, c, d) <= SEA_LEVEL
          ? colors.water
          : rules.hasSnowTop && top >= (rules.snowlineY ?? SEA_LEVEL)
            ? colors.snow
            : colors.ground[OVERWORLD_BIOME_IDS.indexOf(biome)]!;
      owner = columnKey(Math.floor(wx / 16), Math.floor(wz / 16));
      edge = 0;
      color = rgb | (shade(b - a, c - a) << 24);
      vertex(wx, a, wz);
      vertex(wx, c, ez);
      vertex(ex, b, wz);
      color = rgb | (shade(d - c, d - b) << 24);
      vertex(ex, b, wz);
      vertex(wx, c, ez);
      vertex(ex, d, ez);
      color = rgb | (184 << 24);
      if (x % 4 === 0) skirt(1, wx, a, wz, wx, c, ez);
      if (x % 4 === 3) skirt(2, ex, d, ez, ex, b, wz);
      if (z % 4 === 0) skirt(3, ex, b, wz, wx, a, wz);
      if (z % 4 === 3) skirt(4, wx, c, ez, ex, d, ez);
    }
  }
  return { vertices, maxY };
}

function shade(dx: number, dz: number): number {
  const normalLength = Math.hypot(dx, LOD_STEP, dz);
  return Math.round(
    255 *
      (0.69 +
        0.31 * Math.max(0, (4 + 0.35 * dx + 0.2 * dz) / (normalLength * Math.hypot(1, 0.35, 0.2)))),
  );
}
