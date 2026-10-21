import { deriveSeed } from '../../engine/rng';
import { SEA_LEVEL } from '../terrain';
import { sampleTerrainTopY } from '../terrain-height';
import type { StructurePoint } from './jigsaw';

export interface TerrainPiece {
  readonly position: StructurePoint;
  readonly size: StructurePoint;
}

export interface TerrainAdaptationOptions {
  readonly foundationBlock: string;
  readonly stiltsBlock?: string;
  readonly seaLevel?: number;
  readonly postSpacing?: number;
}

export interface AdaptedTerrainBlock {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly id: string;
}

export type TerrainHeightSampler = (terrainStageSeed: number, x: number, z: number) => number;

function validPiece(piece: TerrainPiece): void {
  if (
    !piece.position.every(Number.isSafeInteger) ||
    !piece.size.every((size) => Number.isSafeInteger(size) && size > 0)
  ) {
    throw new Error('Invalid terrain adaptation piece');
  }
}

function isPostCoordinate(index: number, size: number, spacing: number): boolean {
  return index === 0 || index === size - 1 || index % spacing === 0;
}

/**
 * Produces foundation or stilt blocks beneath a piece without reading generated column data.
 * Height comes from the same pure terrain sampler used by the terrain generator.
 *
 * For stilts, support columns are placed on a grid no wider than postSpacing blocks, including
 * the footprint edges, and each column continues to the seabed. The durability of this result
 * does not depend on which neighboring column has generated first.
 */
export function adaptPieceToTerrain(
  worldSeed: number,
  piece: TerrainPiece,
  options: TerrainAdaptationOptions,
  heightSampler: TerrainHeightSampler = sampleTerrainTopY,
): AdaptedTerrainBlock[] {
  validPiece(piece);
  if (!options.foundationBlock) throw new Error('A foundation block is required');
  const seaLevel = options.seaLevel ?? SEA_LEVEL;
  const postSpacing = options.postSpacing ?? 3;
  if (!Number.isSafeInteger(seaLevel) || !Number.isSafeInteger(postSpacing) || postSpacing < 1) {
    throw new Error('Invalid terrain adaptation options');
  }

  const terrainStageSeed = deriveSeed(worldSeed, 'terrain_shape');
  const stiltsBlock = options.stiltsBlock ?? options.foundationBlock;
  const blocks: AdaptedTerrainBlock[] = [];
  const [originX, baseY, originZ] = piece.position;
  const [width, , depth] = piece.size;

  for (let localZ = 0; localZ < depth; localZ++) {
    for (let localX = 0; localX < width; localX++) {
      const x = originX + localX;
      const z = originZ + localZ;
      const groundY = heightSampler(terrainStageSeed, x, z);
      if (!Number.isSafeInteger(groundY) || groundY >= baseY - 1) continue;

      const underwater = groundY < seaLevel;
      if (
        underwater &&
        !(
          isPostCoordinate(localX, width, postSpacing) &&
          isPostCoordinate(localZ, depth, postSpacing)
        )
      ) {
        continue;
      }
      const blockId = underwater ? stiltsBlock : options.foundationBlock;
      for (let y = groundY + 1; y < baseY; y++) {
        blocks.push({ x, y, z, id: blockId });
      }
    }
  }
  return blocks;
}