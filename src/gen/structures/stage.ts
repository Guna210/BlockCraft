import { BlockRegistry } from '../../world/blocks/registry';
import { ChunkColumn } from '../../world/column';
import { deriveSeed } from '../../engine/rng';
import { SEA_LEVEL } from '../terrain';
import { sampleTerrainTopY } from '../terrain-height';
import type { TerrainStage } from '../pipeline';
import { adaptPieceToTerrain } from './adapt';
import {
  assembleJigsaw,
  rotateStructureFacing,
  rotateStructurePoint,
  type StructurePieceTemplate,
  type StructurePool,
  type StructurePoint,
} from './jigsaw';
import {
  createPlacementGrid,
  STRUCTURE_PLACEMENT_CONFIGS,
  type StructurePlacementConfig,
} from './placement';

export interface StructureRegistration {
  readonly config: StructurePlacementConfig;
  readonly startTemplate: string;
  readonly templates: readonly StructurePieceTemplate[];
  readonly pools: readonly StructurePool[];
  readonly maxDepth: number;
  readonly maxPieces: number;
  readonly foundationBlock: string;
  readonly stiltsBlock?: string;
}

interface StructureCell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly stateId: number;
}

const ASSEMBLY_CACHE_LIMIT = 256;

function rotatedState(
  state: StructurePieceTemplate['blocks']['blocks'][number]['state'],
  rotation: number,
): Record<string, string | number> | undefined {
  if (!state) return undefined;
  const result = { ...state };
  const facing = result['facing'];
  if (
    typeof facing === 'string' &&
    (facing === 'north' || facing === 'east' || facing === 'south' || facing === 'west')
  ) {
    result['facing'] = rotateStructureFacing(facing, rotation);
  }
  if ((rotation & 1) === 1 && (result['axis'] === 'x' || result['axis'] === 'z')) {
    result['axis'] = result['axis'] === 'x' ? 'z' : 'x';
  }
  return result;
}

function structureRadius(registration: StructureRegistration): number {
  const maxHorizontalSize = registration.templates.reduce(
    (max, template) => Math.max(max, template.size[0], template.size[2]),
    0,
  );
  return (registration.maxDepth + 1) * maxHorizontalSize * 2 + 16;
}

function blockStateId(
  registry: BlockRegistry,
  blockId: string,
  state?: Record<string, string | number>,
): number {
  const id = registry.getStateId(blockId, state);
  if (id === undefined) throw new Error('Unknown structure block or state: ' + blockId);
  return id;
}

function buildStartCells(
  worldSeed: number,
  startX: number,
  startZ: number,
  registration: StructureRegistration,
  registry: BlockRegistry,
): StructureCell[] {
  const terrainStageSeed = deriveSeed(worldSeed, 'terrain_shape');
  const surfaceY = sampleTerrainTopY(terrainStageSeed, startX, startZ);
  const startY = surfaceY < SEA_LEVEL ? SEA_LEVEL + 1 : surfaceY + 1;
  const pieces = assembleJigsaw({
    worldSeed,
    startTemplate: registration.startTemplate,
    templates: registration.templates,
    pools: registration.pools,
    maxDepth: registration.maxDepth,
    maxPieces: registration.maxPieces,
  });
  const templateByName = new Map(
    registration.templates.map((template) => [template.name, template]),
  );
  const cellsByPosition = new Map<string, StructureCell>();

  for (const piece of pieces) {
    const template = templateByName.get(piece.template);
    if (!template) throw new Error('Missing assembled structure template: ' + piece.template);
    const rotatedSize: StructurePoint =
      piece.rotation % 2 === 0
        ? [template.size[0], template.size[1], template.size[2]]
        : [template.size[2], template.size[1], template.size[0]];
    const pieceOrigin: StructurePoint = [
      startX + piece.position[0],
      startY + piece.position[1],
      startZ + piece.position[2],
    ];

    for (const block of template.blocks.blocks) {
      const point = rotateStructurePoint(block.pos, template.size, piece.rotation);
      const blockId = template.blocks.palette[block.paletteIndex]!;
      const stateId = blockStateId(registry, blockId, rotatedState(block.state, piece.rotation));
      const x = pieceOrigin[0] + point[0];
      const y = pieceOrigin[1] + point[1];
      const z = pieceOrigin[2] + point[2];
      cellsByPosition.set(x + ',' + y + ',' + z, { x, y, z, stateId });
    }

    const adapted = adaptPieceToTerrain(
      worldSeed,
      { position: pieceOrigin, size: rotatedSize },
      {
        foundationBlock: registration.foundationBlock,
        stiltsBlock: registration.stiltsBlock,
      },
    );
    for (const block of adapted) {
      const stateId = blockStateId(registry, block.id);
      cellsByPosition.set(block.x + ',' + block.y + ',' + block.z, {
        x: block.x,
        y: block.y,
        z: block.z,
        stateId,
      });
    }
  }

  return [...cellsByPosition.values()];
}

/**
 * Makes one independent generation stage. Its bounded cache belongs to the pipeline instance,
 * which is created once in each worker. Cached output is derived only from the world seed and
 * start key, so revisiting a key cannot affect generated blocks.
 */
export function createStructureStage(
  registrations: readonly StructureRegistration[] = [],
): TerrainStage {
  const validRegistrations = registrations.filter(
    (registration) => registration.templates.length > 0,
  );
  const registry = validRegistrations.length > 0 ? BlockRegistry.getInstance() : null;
  const assembledByStart = new Map<string, readonly StructureCell[]>();

  function getCells(
    worldSeed: number,
    registration: StructureRegistration,
    startX: number,
    startZ: number,
  ): readonly StructureCell[] {
    const key =
      worldSeed +
      ':' +
      registration.config.id +
      ':' +
      Math.floor((startX - 8) / 16) +
      ':' +
      Math.floor((startZ - 8) / 16);
    const cached = assembledByStart.get(key);
    if (cached) {
      assembledByStart.delete(key);
      assembledByStart.set(key, cached);
      return cached;
    }
    const cells = buildStartCells(worldSeed, startX, startZ, registration, registry!);
    assembledByStart.set(key, cells);
    if (assembledByStart.size > ASSEMBLY_CACHE_LIMIT) {
      const oldest = assembledByStart.keys().next().value as string | undefined;
      if (oldest !== undefined) assembledByStart.delete(oldest);
    }
    return cells;
  }

  return {
    name: 'structures',
    generate(_stageSeed, cx, cz, column: ChunkColumn): void {
      const worldSeed = column.worldSeed;
      if (worldSeed === undefined || validRegistrations.length === 0) return;
      const minWorldX = cx * 16;
      const minWorldZ = cz * 16;
      const maxWorldX = minWorldX + 15;
      const maxWorldZ = minWorldZ + 15;

      for (const registration of validRegistrations) {
        const radius = structureRadius(registration);
        const grid = createPlacementGrid(worldSeed, [registration.config]);
        const starts = grid.within(registration.config.id, {
          minX: minWorldX - radius,
          minZ: minWorldZ - radius,
          maxX: maxWorldX + radius,
          maxZ: maxWorldZ + radius,
        });
        for (const start of starts) {
          for (const cell of getCells(worldSeed, registration, start.x, start.z)) {
            if (
              cell.x < minWorldX ||
              cell.x > maxWorldX ||
              cell.z < minWorldZ ||
              cell.z > maxWorldZ ||
              cell.y < ChunkColumn.MIN_Y ||
              cell.y > ChunkColumn.MAX_Y
            ) {
              continue;
            }
            column.setBlockStateId(cell.x & 15, cell.y, cell.z & 15, cell.stateId);
          }
        }
      }
    },
  };
}

export const structurePlacementConfigs = STRUCTURE_PLACEMENT_CONFIGS;