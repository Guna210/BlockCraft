import { PRNG, deriveSeed } from '../../engine/rng';

export type StructurePoint = readonly [x: number, y: number, z: number];
export type StructureFacing = 'north' | 'east' | 'south' | 'west';
export type StructureBlockState = Readonly<Record<string, string | number>>;

export interface StructureTemplateBlock {
  readonly pos: StructurePoint;
  readonly paletteIndex: number;
  readonly state?: StructureBlockState;
}

export interface StructureTemplateBlocks {
  readonly palette: readonly string[];
  readonly blocks: readonly StructureTemplateBlock[];
}

export interface StructureConnector {
  readonly pos: StructurePoint;
  readonly facing: StructureFacing;
  readonly pool: string;
  readonly target: string;
}

export interface StructurePieceTemplate {
  readonly name: string;
  readonly size: StructurePoint;
  readonly blocks: StructureTemplateBlocks;
  readonly connectors: readonly StructureConnector[];
}

export interface StructurePoolEntry {
  readonly template: string;
  readonly weight: number;
}

export interface StructurePool {
  readonly name: string;
  readonly entries: readonly StructurePoolEntry[];
}

export interface PlacedStructurePiece {
  readonly template: string;
  readonly position: StructurePoint;
  /** Clockwise quarter-turns around +Y. */
  readonly rotation: 0 | 1 | 2 | 3;
  /** The root is depth 0. */
  readonly depth: number;
}

export interface StructureAabb {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

export interface JigsawAssemblyOptions {
  readonly worldSeed: number;
  readonly startTemplate: string;
  readonly startChunk: readonly [cx: number, cz: number];
  readonly templates: readonly StructurePieceTemplate[];
  readonly pools: readonly StructurePool[];
  readonly maxDepth: number;
  readonly maxPieces: number;
}

interface ConnectorWorkItem {
  readonly pieceIndex: number;
  readonly connectorIndex: number;
}

interface WorldConnector {
  readonly pos: StructurePoint;
  readonly facing: StructureFacing;
}

const FACING_VECTOR: Readonly<Record<StructureFacing, StructurePoint>> = {
  north: [0, 0, -1],
  east: [1, 0, 0],
  south: [0, 0, 1],
  west: [-1, 0, 0],
};

const FACING_ORDER: readonly StructureFacing[] = ['north', 'east', 'south', 'west'];

function isFacing(value: string): value is StructureFacing {
  return FACING_ORDER.includes(value as StructureFacing);
}

function dimensionsForRotation(size: StructurePoint, rotation: number): StructurePoint {
  return rotation % 2 === 0 ? [size[0], size[1], size[2]] : [size[2], size[1], size[0]];
}

/** Rotates a cell coordinate within a piece, keeping the transformed coordinates non-negative. */
export function rotateStructurePoint(
  point: StructurePoint,
  size: StructurePoint,
  rotation: number,
): StructurePoint {
  switch (((rotation % 4) + 4) % 4) {
    case 0:
      return [point[0], point[1], point[2]];
    case 1:
      return [size[2] - 1 - point[2], point[1], point[0]];
    case 2:
      return [size[0] - 1 - point[0], point[1], size[2] - 1 - point[2]];
    default:
      return [point[2], point[1], size[0] - 1 - point[0]];
  }
}

export function rotateStructureFacing(facing: StructureFacing, rotation: number): StructureFacing {
  const index = FACING_ORDER.indexOf(facing);
  return FACING_ORDER[(index + rotation + 8) % 4]!;
}

export function getPlacedConnector(
  template: StructurePieceTemplate,
  piece: PlacedStructurePiece,
  connector: StructureConnector,
): WorldConnector {
  const point = rotateStructurePoint(connector.pos, template.size, piece.rotation);
  return {
    pos: [piece.position[0] + point[0], piece.position[1] + point[1], piece.position[2] + point[2]],
    facing: rotateStructureFacing(connector.facing, piece.rotation),
  };
}

export function getPlacedPieceAabb(
  template: StructurePieceTemplate,
  piece: PlacedStructurePiece,
): StructureAabb {
  const size = dimensionsForRotation(template.size, piece.rotation);
  return {
    minX: piece.position[0],
    minY: piece.position[1],
    minZ: piece.position[2],
    maxX: piece.position[0] + size[0],
    maxY: piece.position[1] + size[1],
    maxZ: piece.position[2] + size[2],
  };
}

/** AABB intersection is strict so pieces may share a face without overlapping. */
export function structureAabbsIntersect(a: StructureAabb, b: StructureAabb): boolean {
  return (
    a.minX < b.maxX &&
    a.maxX > b.minX &&
    a.minY < b.maxY &&
    a.maxY > b.minY &&
    a.minZ < b.maxZ &&
    a.maxZ > b.minZ
  );
}

function validateTemplate(template: StructurePieceTemplate): void {
  const [sx, sy, sz] = template.size;
  if (
    !template.name ||
    ![sx, sy, sz].every((size) => Number.isSafeInteger(size) && size > 0) ||
    !Array.isArray(template.blocks.palette) ||
    !Array.isArray(template.blocks.blocks) ||
    !Array.isArray(template.connectors)
  ) {
    throw new Error('Invalid structure piece template');
  }
  for (const block of template.blocks.blocks) {
    if (
      !Number.isInteger(block.paletteIndex) ||
      block.paletteIndex < 0 ||
      block.paletteIndex >= template.blocks.palette.length ||
      !block.pos.every(Number.isInteger) ||
      block.pos[0] < 0 ||
      block.pos[0] >= sx ||
      block.pos[1] < 0 ||
      block.pos[1] >= sy ||
      block.pos[2] < 0 ||
      block.pos[2] >= sz
    ) {
      throw new Error('Invalid block in structure piece template: ' + template.name);
    }
  }
  for (const connector of template.connectors) {
    if (
      !connector.pos.every(Number.isInteger) ||
      connector.pos[0] < 0 ||
      connector.pos[0] >= sx ||
      connector.pos[1] < 0 ||
      connector.pos[1] >= sy ||
      connector.pos[2] < 0 ||
      connector.pos[2] >= sz ||
      !isFacing(connector.facing) ||
      !connector.pool ||
      !connector.target
    ) {
      throw new Error('Invalid connector in structure piece template: ' + template.name);
    }
  }
}

function weightedOrder(pool: StructurePool, rng: PRNG): StructurePoolEntry[] {
  const remaining = [...pool.entries];
  const order: StructurePoolEntry[] = [];
  while (remaining.length > 0) {
    const total = remaining.reduce((sum, entry) => sum + entry.weight, 0);
    let selected = rng.next() * total;
    let index = 0;
    while (index < remaining.length - 1 && selected >= remaining[index]!.weight) {
      selected -= remaining[index]!.weight;
      index++;
    }
    order.push(remaining.splice(index, 1)[0]!);
  }
  return order;
}

function shuffledRotations(rng: PRNG): Array<0 | 1 | 2 | 3> {
  const rotations: Array<0 | 1 | 2 | 3> = [0, 1, 2, 3];
  for (let i = rotations.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [rotations[i], rotations[j]] = [rotations[j]!, rotations[i]!];
  }
  return rotations;
}

function facingOpposite(a: StructureFacing, b: StructureFacing): boolean {
  return (
    FACING_VECTOR[a][0] === -FACING_VECTOR[b][0] &&
    FACING_VECTOR[a][1] === -FACING_VECTOR[b][1] &&
    FACING_VECTOR[a][2] === -FACING_VECTOR[b][2]
  );
}

function isClear(
  candidate: StructureAabb,
  placed: readonly PlacedStructurePiece[],
  templates: ReadonlyMap<string, StructurePieceTemplate>,
): boolean {
  return placed.every((piece) => {
    const template = templates.get(piece.template)!;
    return !structureAabbsIntersect(candidate, getPlacedPieceAabb(template, piece));
  });
}

/**
 * Builds a deterministic breadth-first jigsaw assembly. Pool entries are considered in a seeded
 * weighted order, each piece can rotate to any of four horizontal orientations, and a connector
 * attaches only to a matching target that faces the opposite direction.
 */
export function assembleJigsaw(options: JigsawAssemblyOptions): PlacedStructurePiece[] {
  if (
    !Number.isSafeInteger(options.maxDepth) ||
    options.maxDepth < 0 ||
    !Number.isSafeInteger(options.maxPieces) ||
    options.maxPieces < 1
  ) {
    throw new Error('Invalid jigsaw depth or piece limit');
  }

  const templates = new Map<string, StructurePieceTemplate>();
  for (const template of options.templates) {
    validateTemplate(template);
    if (templates.has(template.name))
      throw new Error('Duplicate structure template: ' + template.name);
    templates.set(template.name, template);
  }
  const pools = new Map<string, StructurePool>();
  for (const pool of options.pools) {
    if (!pool.name || pools.has(pool.name) || !Array.isArray(pool.entries)) {
      throw new Error('Invalid or duplicate structure pool');
    }
    for (const entry of pool.entries) {
      if (!templates.has(entry.template) || !Number.isFinite(entry.weight) || entry.weight <= 0) {
        throw new Error('Invalid structure pool entry in ' + pool.name);
      }
    }
    pools.set(pool.name, pool);
  }

  const rootTemplate = templates.get(options.startTemplate);
  if (!rootTemplate)
    throw new Error('Unknown starting structure template: ' + options.startTemplate);

  const rng = new PRNG(
    deriveSeed(
      options.worldSeed,
      'jigsaw:' + options.startTemplate + ':' + options.startChunk[0] + ':' + options.startChunk[1],
    ),
  );
  const root: PlacedStructurePiece = {
    template: rootTemplate.name,
    position: [0, 0, 0],
    rotation: Math.floor(rng.next() * 4) as 0 | 1 | 2 | 3,
    depth: 0,
  };
  const placed: PlacedStructurePiece[] = [root];
  const queue: ConnectorWorkItem[] = rootTemplate.connectors.map((_, connectorIndex) => ({
    pieceIndex: 0,
    connectorIndex,
  }));

  for (
    let queueIndex = 0;
    queueIndex < queue.length && placed.length < options.maxPieces;
    queueIndex++
  ) {
    const work = queue[queueIndex]!;
    const parent = placed[work.pieceIndex]!;
    if (parent.depth >= options.maxDepth) continue;
    const parentTemplate = templates.get(parent.template)!;
    const parentConnector = parentTemplate.connectors[work.connectorIndex];
    if (!parentConnector) continue;
    const pool = pools.get(parentConnector.pool);
    if (!pool || pool.entries.length === 0) continue;
    const parentWorldConnector = getPlacedConnector(parentTemplate, parent, parentConnector);
    const outward = FACING_VECTOR[parentWorldConnector.facing];

    let attached = false;
    for (const entry of weightedOrder(pool, rng)) {
      if (placed.length >= options.maxPieces) break;
      const childTemplate = templates.get(entry.template)!;
      const childConnectors = childTemplate.connectors.filter(
        (connector) => connector.target === parentConnector.target,
      );
      if (childConnectors.length === 0) continue;

      for (const rotation of shuffledRotations(rng)) {
        for (const childConnector of childConnectors) {
          const rotatedFacing = rotateStructureFacing(childConnector.facing, rotation);
          if (!facingOpposite(parentWorldConnector.facing, rotatedFacing)) continue;
          const rotatedPoint = rotateStructurePoint(
            childConnector.pos,
            childTemplate.size,
            rotation,
          );
          const childPosition: StructurePoint = [
            parentWorldConnector.pos[0] + outward[0] - rotatedPoint[0],
            parentWorldConnector.pos[1] + outward[1] - rotatedPoint[1],
            parentWorldConnector.pos[2] + outward[2] - rotatedPoint[2],
          ];
          const candidate: PlacedStructurePiece = {
            template: childTemplate.name,
            position: childPosition,
            rotation,
            depth: parent.depth + 1,
          };
          if (!isClear(getPlacedPieceAabb(childTemplate, candidate), placed, templates)) continue;

          const childIndex = placed.length;
          placed.push(candidate);
          for (
            let connectorIndex = 0;
            connectorIndex < childTemplate.connectors.length;
            connectorIndex++
          ) {
            if (childTemplate.connectors[connectorIndex] !== childConnector) {
              queue.push({ pieceIndex: childIndex, connectorIndex });
            }
          }
          attached = true;
          break;
        }
        if (attached) break;
      }
      if (attached) break;
    }
  }

  return placed;
}
