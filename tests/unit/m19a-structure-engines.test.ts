import { describe, expect, it, vi } from 'vitest';
import { deriveSeed } from '../../src/engine/rng';
import { ChunkColumn } from '../../src/world/column';
import { createDefaultPipeline } from '../../src/gen/pipeline';
import { OVERWORLD_BIOME_IDS, sampleBiome } from '../../src/gen/biomes';
import { adaptPieceToTerrain } from '../../src/gen/structures/adapt';
import {
  assembleJigsaw,
  getPlacedConnector,
  getPlacedPieceAabb,
  structureAabbsIntersect,
  type PlacedStructurePiece,
  type StructureConnector,
  type StructureFacing,
  type StructurePieceTemplate,
} from '../../src/gen/structures/jigsaw';
import {
  createPlacementGrid,
  STRUCTURE_PLACEMENT_CONFIGS,
} from '../../src/gen/structures/placement';
import { createStructureStage } from '../../src/gen/structures/stage';

const hamletConfig = STRUCTURE_PLACEMENT_CONFIGS.find((config) => config.id === 'wayfarer_hamlet')!;

function testTemplates(): StructurePieceTemplate[] {
  const connector = (
    x: number,
    y: number,
    z: number,
    facing: StructureFacing,
  ): StructureConnector => ({
    pos: [x, y, z],
    facing,
    pool: 'hamlet_rooms',
    target: 'walkway',
  });
  const block = { paletteIndex: 0, pos: [1, 0, 1] as const };
  return [
    {
      name: 'start',
      size: [4, 3, 4],
      blocks: { palette: ['stone'], blocks: [block] },
      connectors: [
        connector(3, 1, 1, 'east'),
        connector(0, 1, 2, 'west'),
        connector(1, 1, 0, 'north'),
        connector(2, 1, 3, 'south'),
      ],
    },
    {
      name: 'room_short',
      size: [3, 3, 3],
      blocks: { palette: ['cobblestone'], blocks: [block] },
      connectors: [
        connector(2, 1, 1, 'east'),
        connector(0, 1, 1, 'west'),
        connector(1, 1, 0, 'north'),
        connector(1, 1, 2, 'south'),
      ],
    },
    {
      name: 'room_long',
      size: [5, 3, 3],
      blocks: { palette: ['mossy_cobblestone'], blocks: [block] },
      connectors: [
        connector(4, 1, 1, 'east'),
        connector(0, 1, 1, 'west'),
        connector(2, 1, 0, 'north'),
        connector(2, 1, 2, 'south'),
      ],
    },
  ];
}

function templateMap(templates: readonly StructurePieceTemplate[]) {
  return new Map(templates.map((template) => [template.name, template]));
}

function hasAlignedParent(
  child: PlacedStructurePiece,
  pieces: readonly PlacedStructurePiece[],
  templates: ReadonlyMap<string, StructurePieceTemplate>,
): boolean {
  const vectors: Record<StructureFacing, readonly [number, number, number]> = {
    north: [0, 0, -1],
    east: [1, 0, 0],
    south: [0, 0, 1],
    west: [-1, 0, 0],
  };
  const childTemplate = templates.get(child.template)!;
  return pieces.some((parent) => {
    if (parent.depth !== child.depth - 1) return false;
    const parentTemplate = templates.get(parent.template)!;
    return parentTemplate.connectors.some((parentConnector) => {
      const parentWorld = getPlacedConnector(parentTemplate, parent, parentConnector);
      const vector = vectors[parentWorld.facing];
      return childTemplate.connectors.some((childConnector) => {
        if (childConnector.target !== parentConnector.target) return false;
        const childWorld = getPlacedConnector(childTemplate, child, childConnector);
        const opposite = vectors[childWorld.facing];
        return (
          parentWorld.pos[0] + vector[0] === childWorld.pos[0] &&
          parentWorld.pos[1] + vector[1] === childWorld.pos[1] &&
          parentWorld.pos[2] + vector[2] === childWorld.pos[2] &&
          opposite[0] === -vector[0] &&
          opposite[1] === -vector[1] &&
          opposite[2] === -vector[2]
        );
      });
    });
  });
}

describe('M19a placement grid', () => {
  it('returns stable biome-filtered positions and keeps hamlets at least 256 blocks apart', () => {
    expect(hamletConfig).toMatchObject({
      id: 'wayfarer_hamlet',
      spacing: 34,
      separation: 16,
      biomes: ['plains', 'savanna', 'meadow'],
    });
    const seeds = [7, 42, 8675309];
    const bounds = { minX: -24000, minZ: -24000, maxX: 24000, maxZ: 24000 };

    for (const seed of seeds) {
      const first = createPlacementGrid(seed);
      const second = createPlacementGrid(seed);
      expect(first.within(hamletConfig.id, bounds)).toEqual(second.within(hamletConfig.id, bounds));

      const candidates = new Map<string, ReturnType<typeof first.candidateAtRegion>>();
      for (let regionZ = -24; regionZ <= 24; regionZ++) {
        for (let regionX = -24; regionX <= 24; regionX++) {
          candidates.set(
            regionX + ',' + regionZ,
            first.candidateAtRegion(hamletConfig.id, regionX, regionZ),
          );
        }
      }
      for (let regionZ = -24; regionZ <= 24; regionZ++) {
        for (let regionX = -24; regionX <= 24; regionX++) {
          const start = candidates.get(regionX + ',' + regionZ);
          if (!start) continue;
          const offsetX = start.chunkX - start.regionX * hamletConfig.spacing;
          const offsetZ = start.chunkZ - start.regionZ * hamletConfig.spacing;
          const offsetRange = hamletConfig.spacing - hamletConfig.separation;
          expect(hamletConfig.biomes).toContain(sampleBiome(seed, start.x, start.z));
          expect(offsetX).toBeGreaterThanOrEqual(0);
          expect(offsetX).toBeLessThan(offsetRange);
          expect(offsetZ).toBeGreaterThanOrEqual(0);
          expect(offsetZ).toBeLessThan(offsetRange);
          for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dz === 0) continue;
              if (dx < 0 || (dx === 0 && dz < 0)) continue;
              const neighbor = candidates.get(regionX + dx + ',' + (regionZ + dz));
              if (!neighbor) continue;
              expect(Math.hypot(start.x - neighbor.x, start.z - neighbor.z)).toBeGreaterThanOrEqual(
                256,
              );
            }
          }
        }
      }
    }

    expect(createPlacementGrid(seeds[0]!).within(hamletConfig.id, bounds)).not.toEqual(
      createPlacementGrid(seeds[1]!).within(hamletConfig.id, bounds),
    );
  });

  it('locates the nearest eligible start by block distance', () => {
    const grid = createPlacementGrid(42);
    const start = grid.within(hamletConfig.id, {
      minX: -10000,
      minZ: -10000,
      maxX: 10000,
      maxZ: 10000,
    })[0]!;
    expect(grid.locateNearest(hamletConfig.id, [start.x, 64, start.z], 1)).toEqual(start);
    expect(grid.locateNearest('unknown_structure', [0, 0], 1000)).toBeNull();
  });
});

describe('M19a connector jigsaw', () => {
  it('is deterministic and produces aligned, non-overlapping pieces for 100 seeds', () => {
    const templates = testTemplates();
    const pools = [
      {
        name: 'hamlet_rooms',
        entries: [
          { template: 'room_short', weight: 3 },
          { template: 'room_long', weight: 2 },
        ],
      },
    ];
    const templateByName = templateMap(templates);

    for (let worldSeed = 0; worldSeed < 100; worldSeed++) {
      const options = {
        worldSeed,
        startTemplate: 'start',
        startChunk: [0, 0] as const,
        templates,
        pools,
        maxDepth: 5,
        maxPieces: 20,
      };
      const pieces = assembleJigsaw(options);
      expect(assembleJigsaw(options)).toEqual(pieces);
      expect(pieces.length).toBeGreaterThan(1);

      for (let i = 0; i < pieces.length; i++) {
        const piece = pieces[i]!;
        if (piece.depth > 0) expect(hasAlignedParent(piece, pieces, templateByName)).toBe(true);
        const aabb = getPlacedPieceAabb(templateByName.get(piece.template)!, piece);
        for (let j = i + 1; j < pieces.length; j++) {
          const other = pieces[j]!;
          const otherAabb = getPlacedPieceAabb(templateByName.get(other.template)!, other);
          expect(structureAabbsIntersect(aabb, otherAabb)).toBe(false);
        }
      }
    }
  });

  it('seeds layouts with the start chunk while keeping each start repeatable', () => {
    const options = {
      worldSeed: 4219,
      startTemplate: 'start',
      startChunk: [0, 0] as const,
      templates: testTemplates(),
      pools: [
        {
          name: 'hamlet_rooms',
          entries: [
            { template: 'room_short', weight: 3 },
            { template: 'room_long', weight: 2 },
          ],
        },
      ],
      maxDepth: 5,
      maxPieces: 20,
    };
    const first = assembleJigsaw(options);
    expect(assembleJigsaw(options)).toEqual(first);
    expect(assembleJigsaw({ ...options, startChunk: [1, 0] })).not.toEqual(first);
  });

  it('allows pieces to touch faces while rejecting positive-volume intersections', () => {
    const a = { minX: 0, minY: 0, minZ: 0, maxX: 2, maxY: 2, maxZ: 2 };
    const touching = { minX: 2, minY: 0, minZ: 0, maxX: 4, maxY: 2, maxZ: 2 };
    const overlapping = { minX: 1, minY: 0, minZ: 0, maxX: 3, maxY: 2, maxZ: 2 };
    expect(structureAabbsIntersect(a, touching)).toBe(false);
    expect(structureAabbsIntersect(a, overlapping)).toBe(true);
  });
});

describe('M19a terrain adaptation and stage', () => {
  it('fills dry foundations to terrain and places three-block-spaced stilts to the seabed', () => {
    const foundation = adaptPieceToTerrain(
      4,
      { position: [20, 74, 30], size: [4, 2, 4] },
      { foundationBlock: 'stone' },
      () => 70,
    );
    expect(foundation).toHaveLength(4 * 4 * 3);
    expect(foundation.every((block) => block.id === 'stone' && block.y >= 71 && block.y < 74)).toBe(
      true,
    );

    const stilts = adaptPieceToTerrain(
      4,
      { position: [20, 65, 30], size: [7, 2, 7] },
      { foundationBlock: 'stone', stiltsBlock: 'oak_log' },
      () => 50,
    );
    const supports = new Set(stilts.map((block) => block.x + ',' + block.z));
    expect(supports).toEqual(
      new Set([0, 3, 6].flatMap((x) => [0, 3, 6].map((z) => 20 + x + ',' + (30 + z)))),
    );
    expect(stilts).toHaveLength(9 * 14);
    expect(stilts.every((block) => block.id === 'oak_log' && block.y >= 51 && block.y < 65)).toBe(
      true,
    );
  });

  it('registers after features and writes nothing until a template set is supplied', () => {
    const stages = createDefaultPipeline()
      .getStages()
      .map((stage) => stage.name);
    expect(stages.indexOf('structures')).toBe(stages.indexOf('features') + 1);

    const column = new ChunkColumn(0, 0);
    column.worldSeed = 42;
    const before = Array.from({ length: ChunkColumn.SECTION_COUNT }, (_, sectionY) =>
      column.getSection(sectionY),
    );
    createStructureStage().generate(deriveSeed(42, 'structures'), 0, 0, column);
    expect(
      Array.from({ length: ChunkColumn.SECTION_COUNT }, (_, sectionY) =>
        column.getSection(sectionY),
      ),
    ).toEqual(before);
  });

  it('generates a registered structure identically across columns in either order', () => {
    const worldSeed = 314159;
    const config = {
      id: 'stage_test',
      spacing: 64,
      separation: 48,
      salt: 'stage_test',
      biomes: OVERWORLD_BIOME_IDS,
    } as const;
    const start = createPlacementGrid(worldSeed, [config]).candidateAtRegion(config.id, 0, 0)!;
    const registration = {
      config,
      startTemplate: 'start',
      templates: testTemplates(),
      pools: [
        {
          name: 'hamlet_rooms',
          entries: [
            { template: 'room_short', weight: 3 },
            { template: 'room_long', weight: 2 },
          ],
        },
      ],
      maxDepth: 4,
      maxPieces: 14,
      foundationBlock: 'stone',
    };
    const columns = Array.from(
      { length: 25 },
      (_, index) =>
        [start.chunkX + (index % 5) - 2, start.chunkZ + Math.floor(index / 5) - 2] as const,
    );

    const generateInOrder = (order: readonly (readonly [number, number])[]) => {
      const stage = createStructureStage([registration]);
      const blocks = new Map<string, number>();
      for (const [cx, cz] of order) {
        const column = new ChunkColumn(cx, cz);
        column.worldSeed = worldSeed;
        const write = column.setBlockStateId.bind(column);
        vi.spyOn(column, 'setBlockStateId').mockImplementation((x, y, z, stateId) => {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThan(16);
          expect(z).toBeGreaterThanOrEqual(0);
          expect(z).toBeLessThan(16);
          write(x, y, z, stateId);
          blocks.set(cx * 16 + x + ',' + y + ',' + (cz * 16 + z), stateId);
        });
        stage.generate(deriveSeed(worldSeed, 'structures'), cx, cz, column);
      }
      return blocks;
    };

    const forward = generateInOrder(columns);
    const reverse = generateInOrder([...columns].reverse());
    const canonical = (blocks: Map<string, number>) =>
      [...blocks.entries()].sort(([left], [right]) => left.localeCompare(right));
    expect(forward.size).toBeGreaterThan(0);
    expect(canonical(reverse)).toEqual(canonical(forward));
    const touchedChunks = new Set(
      [...forward.keys()].map((coordinate) => {
        const [x, , z] = coordinate.split(',').map(Number);
        return Math.floor(x! / 16) + ',' + Math.floor(z! / 16);
      }),
    );
    expect(touchedChunks.size).toBeGreaterThan(1);
  });
});
