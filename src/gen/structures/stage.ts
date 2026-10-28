import { BlockRegistry } from '../../world/blocks/registry';
import { ChunkColumn } from '../../world/column';
import { deriveSeed, hash3 } from '../../engine/rng';
import { SEA_LEVEL } from '../terrain';
import { sampleTerrainTopY } from '../terrain-height';
import { terrainVariant } from '../world-options';
import { sampleBiome } from '../biomes';
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
  /** The chest loot table (data/loot/chests/) rolled into this structure's generated chests. */
  readonly lootTable?: string;
  /** Creatures a generated spawner may hold; each spawner picks one from its position. */
  readonly spawnerCreatures?: readonly string[];
  /**
   * Sinks the structure so its highest cell is `cover` blocks below the lowest ground around it,
   * but never below `minY`. Buried structures get no foundations.
   */
  readonly buried?: { readonly cover: number; readonly minY: number };
  /** Share (0–1) of blocks a ruin loses at its top; less lower down, none on piece floors. */
  readonly decay?: number;
}

/** A generated block that needs a block entity set up once its column is in the world. */
export type StructureMarker =
  | {
      readonly kind: 'chest';
      readonly x: number;
      readonly y: number;
      readonly z: number;
      readonly table: string;
    }
  | {
      readonly kind: 'spawner';
      readonly x: number;
      readonly y: number;
      readonly z: number;
      readonly creature: string;
    };

/** The structures stage, plus the markers of the column it generated last. */
export interface StructureStage extends TerrainStage {
  takeMarkers(cx: number, cz: number): StructureMarker[];
}

interface StructureCell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly stateId: number;
  readonly marker?: StructureMarker;
}

/** Ground sampled every BURIED_SAMPLE_STEP blocks, BURIED_MARGIN beyond each buried piece. */
const BURIED_SAMPLE_STEP = 4;
const BURIED_MARGIN = 8;

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
  return (registration.maxDepth + 1) * maxHorizontalSize + 16;
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

interface StartPlan {
  readonly plans: ReadonlyArray<{
    piece: ReturnType<typeof assembleJigsaw>[number];
    template: StructurePieceTemplate;
    rotatedSize: StructurePoint;
  }>;
  readonly startY: number;
  readonly surfaceAt: (x: number, z: number) => number;
}

function planStart(
  worldSeed: number,
  startX: number,
  startZ: number,
  startChunkX: number,
  startChunkZ: number,
  registration: StructureRegistration,
): StartPlan {
  const terrainStageSeed = deriveSeed(worldSeed, 'terrain_shape');
  const pieces = assembleJigsaw({
    worldSeed,
    startTemplate: registration.startTemplate,
    startChunk: [startChunkX, startChunkZ],
    templates: registration.templates,
    pools: registration.pools,
    maxDepth: registration.maxDepth,
    maxPieces: registration.maxPieces,
  });
  const templateByName = new Map(
    registration.templates.map((template) => [template.name, template]),
  );
  const plans = pieces.map((piece) => {
    const template = templateByName.get(piece.template);
    if (!template) throw new Error('Missing assembled structure template: ' + piece.template);
    const rotatedSize: StructurePoint =
      piece.rotation % 2 === 0
        ? [template.size[0], template.size[1], template.size[2]]
        : [template.size[2], template.size[1], template.size[0]];
    return { piece, template, rotatedSize };
  });
  const groundByColumn = new Map<string, number>();
  const flat = terrainVariant().type === 'flat';
  const surfaceAt = (x: number, z: number): number => {
    const key = x + ',' + z;
    const cached = groundByColumn.get(key);
    if (cached !== undefined) return cached;
    const height = flat ? 64 : sampleTerrainTopY(terrainStageSeed, x, z);
    groundByColumn.set(key, height);
    return height;
  };
  if (registration.buried) {
    let lowestGround = Infinity;
    let top = 0;
    for (const { piece, rotatedSize } of plans) {
      top = Math.max(top, piece.position[1] + rotatedSize[1]);
      const minX = startX + piece.position[0] - BURIED_MARGIN;
      const minZ = startZ + piece.position[2] - BURIED_MARGIN;
      const maxX = startX + piece.position[0] + rotatedSize[0] - 1 + BURIED_MARGIN;
      const maxZ = startZ + piece.position[2] + rotatedSize[2] - 1 + BURIED_MARGIN;
      for (let x = minX; x <= maxX + BURIED_SAMPLE_STEP - 1; x += BURIED_SAMPLE_STEP) {
        for (let z = minZ; z <= maxZ + BURIED_SAMPLE_STEP - 1; z += BURIED_SAMPLE_STEP) {
          lowestGround = Math.min(lowestGround, surfaceAt(Math.min(x, maxX), Math.min(z, maxZ)));
        }
      }
    }
    const startY = Math.max(
      registration.buried.minY,
      lowestGround - registration.buried.cover - top,
    );
    return { plans, startY, surfaceAt };
  }
  let startY = SEA_LEVEL + 1;
  for (const { piece, template } of plans) {
    for (const block of template.blocks.blocks) {
      const point = rotateStructurePoint(block.pos, template.size, piece.rotation);
      startY = Math.max(
        startY,
        surfaceAt(startX + piece.position[0] + point[0], startZ + piece.position[2] + point[2]) + 1,
      );
    }
  }
  return { plans, startY, surfaceAt };
}

/** The floor height of a structure start's first piece (what locating a structure reports). */
export function structureStartY(
  worldSeed: number,
  registration: StructureRegistration,
  startX: number,
  startZ: number,
  startChunkX: number,
  startChunkZ: number,
): number {
  return planStart(worldSeed, startX, startZ, startChunkX, startChunkZ, registration).startY;
}

function buildStartCells(
  worldSeed: number,
  startX: number,
  startZ: number,
  startChunkX: number,
  startChunkZ: number,
  registration: StructureRegistration,
  registry: BlockRegistry,
): StructureCell[] {
  const { plans, startY, surfaceAt } = planStart(
    worldSeed,
    startX,
    startZ,
    startChunkX,
    startChunkZ,
    registration,
  );
  const decaySeed = deriveSeed(worldSeed, 'structure_decay:' + registration.config.id);
  const creatureSeed = deriveSeed(worldSeed, 'structure_spawner:' + registration.config.id);
  const markerFor = (
    blockId: string,
    x: number,
    y: number,
    z: number,
  ): StructureMarker | undefined => {
    if (blockId === 'chest' && registration.lootTable) {
      return { kind: 'chest', x, y, z, table: registration.lootTable };
    }
    const creatures = registration.spawnerCreatures;
    if (blockId === 'spawner' && creatures && creatures.length > 0) {
      const index = Math.floor(hash3(creatureSeed, x, y, z) * creatures.length);
      return {
        kind: 'spawner',
        x,
        y,
        z,
        creature: creatures[Math.min(index, creatures.length - 1)]!,
      };
    }
    return undefined;
  };

  const cellsByPosition = new Map<string, StructureCell>();
  const pathCells = new Map<
    string,
    { x: number; z: number; y: number; originalY: number; stateId: number }
  >();

  for (const { piece, template, rotatedSize } of plans) {
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
      const groundY = surfaceAt(x, pieceOrigin[2] + point[2]);
      const y = block.surfacePath
        ? block.surfacePathAnchor
          ? pieceOrigin[1] + point[1]
          : groundY + 1
        : pieceOrigin[1] + point[1];
      const z = pieceOrigin[2] + point[2];
      if (
        registration.decay &&
        point[1] > 0 &&
        blockId !== 'air' &&
        blockId !== 'chest' &&
        hash3(decaySeed, x >> 1, y >> 1, z >> 1) <
          registration.decay * (0.2 + (0.8 * point[1]) / Math.max(1, rotatedSize[1] - 1))
      ) {
        continue;
      }
      const marker = markerFor(blockId, x, y, z);
      cellsByPosition.set(
        x + ',' + y + ',' + z,
        marker ? { x, y, z, stateId, marker } : { x, y, z, stateId },
      );
      if (block.surfacePath) pathCells.set(x + ',' + z, { x, z, y, originalY: y, stateId });
    }

    if (registration.buried) continue;
    const supportFootprint = [
      ...new Set(
        template.blocks.blocks
          .filter((block) => !block.surfacePath)
          .map((block) => {
            const point = rotateStructurePoint(block.pos, template.size, piece.rotation);
            return point[0] + ',' + point[2];
          }),
      ),
    ].map((key) => key.split(',').map(Number) as [number, number]);
    const adapted = adaptPieceToTerrain(
      worldSeed,
      { position: pieceOrigin, size: rotatedSize },
      {
        foundationBlock: registration.foundationBlock,
        stiltsBlock: registration.stiltsBlock,
        supportFootprint,
      },
      (_seed, x, z) => surfaceAt(x, z),
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

  // Raise low path cells until every horizontal step is no taller than one block. Path cells
  // remain at or above the terrain surface; anchored cells stay level with their doors.
  const pathQueue = [...pathCells.values()];
  for (let index = 0; index < pathQueue.length; index++) {
    const current = pathQueue[index]!;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const neighbor = pathCells.get(current.x + dx + ',' + (current.z + dz));
      if (neighbor && neighbor.y < current.y - 1) {
        neighbor.y = current.y - 1;
        pathQueue.push(neighbor);
      }
    }
  }
  for (const { x, z, y, originalY, stateId } of pathCells.values()) {
    cellsByPosition.delete(x + ',' + originalY + ',' + z);
    cellsByPosition.set(x + ',' + y + ',' + z, { x, y, z, stateId });
    const groundY = surfaceAt(x, z);
    for (let supportY = groundY + 1; supportY < y; supportY++) {
      const supportId = blockStateId(registry, registration.foundationBlock);
      cellsByPosition.set(x + ',' + supportY + ',' + z, {
        x,
        y: supportY,
        z,
        stateId: supportId,
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
): StructureStage {
  const validRegistrations = registrations.filter(
    (registration) => registration.templates.length > 0,
  );
  const registry = validRegistrations.length > 0 ? BlockRegistry.getInstance() : null;
  const assembledByStart = new Map<string, readonly StructureCell[]>();
  const placementsBySeed = new Map<string, ReturnType<typeof createPlacementGrid>>();
  const placementCacheLimit = Math.max(4, validRegistrations.length * 2);
  let markerColumn = '';
  let markers: StructureMarker[] = [];

  function getCells(
    worldSeed: number,
    registration: StructureRegistration,
    startX: number,
    startZ: number,
    startChunkX: number,
    startChunkZ: number,
  ): readonly StructureCell[] {
    const key = worldSeed + ':' + registration.config.id + ':' + startChunkX + ':' + startChunkZ;
    const cached = assembledByStart.get(key);
    if (cached) {
      assembledByStart.delete(key);
      assembledByStart.set(key, cached);
      return cached;
    }
    const cells = buildStartCells(
      worldSeed,
      startX,
      startZ,
      startChunkX,
      startChunkZ,
      registration,
      registry!,
    );
    assembledByStart.set(key, cells);
    if (assembledByStart.size > ASSEMBLY_CACHE_LIMIT) {
      const oldest = assembledByStart.keys().next().value as string | undefined;
      if (oldest !== undefined) assembledByStart.delete(oldest);
    }
    return cells;
  }

  return {
    name: 'structures',
    takeMarkers(cx: number, cz: number): StructureMarker[] {
      const taken = markerColumn === cx + ',' + cz ? markers : [];
      markerColumn = '';
      markers = [];
      return taken;
    },
    generate(_stageSeed, cx, cz, column: ChunkColumn): void {
      markerColumn = cx + ',' + cz;
      markers = [];
      const worldSeed = column.worldSeed;
      if (worldSeed === undefined || validRegistrations.length === 0) return;
      const minWorldX = cx * 16;
      const minWorldZ = cz * 16;
      const maxWorldX = minWorldX + 15;
      const maxWorldZ = minWorldZ + 15;

      for (const registration of validRegistrations) {
        const radius = structureRadius(registration);
        const variant = terrainVariant();
        const placementKey = `${worldSeed}:${variant.type}:${variant.biome ?? ''}:${registration.config.id}`;
        let grid = placementsBySeed.get(placementKey);
        if (!grid) {
          const isFlat = variant.type === 'flat';
          const biomeByPosition = new Map<string, string>();
          const biomeSampler = (seed: number, x: number, z: number): string => {
            if (isFlat) return 'plains';
            const key = x + ',' + z;
            const cached = biomeByPosition.get(key);
            if (cached !== undefined) {
              biomeByPosition.delete(key);
              biomeByPosition.set(key, cached);
              return cached;
            }
            const biome = sampleBiome(seed, x, z);
            biomeByPosition.set(key, biome);
            if (biomeByPosition.size > 512) {
              const oldest = biomeByPosition.keys().next().value as string | undefined;
              if (oldest !== undefined) biomeByPosition.delete(oldest);
            }
            return biome;
          };
          grid = createPlacementGrid(worldSeed, [registration.config], biomeSampler);
          placementsBySeed.set(placementKey, grid);
          if (placementsBySeed.size > placementCacheLimit) {
            const oldest = placementsBySeed.keys().next().value as string | undefined;
            if (oldest !== undefined) placementsBySeed.delete(oldest);
          }
        }
        const starts = grid.within(registration.config.id, {
          minX: minWorldX - radius,
          minZ: minWorldZ - radius,
          maxX: maxWorldX + radius,
          maxZ: maxWorldZ + radius,
        });
        for (const start of starts) {
          for (const cell of getCells(
            worldSeed,
            registration,
            start.x,
            start.z,
            start.chunkX,
            start.chunkZ,
          )) {
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
            if (cell.marker) markers.push(cell.marker);
          }
        }
      }
    },
  };
}

export const structurePlacementConfigs = STRUCTURE_PLACEMENT_CONFIGS;
