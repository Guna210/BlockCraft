import { emitFluidBlocks } from './fluids';
import { MODEL_WALL_TORCH, emitWallTorch } from './wall-torch';
import { SHAPE_VERTEX } from './vertex';
import { MODEL_SHAPE, MAX_SHAPE_QUADS_PER_BLOCK, emitShapeBlock } from './shapes';
import { doorFrontNormal, oppositeFacing, stateBoxes, type Facing } from '../world/shape-geometry';
import {
  MODEL_BOTTOM_SLAB,
  MODEL_TOP_SLAB,
  MODEL_WALL_NORTH,
  MODEL_TRACE,
  MODEL_TRIPWIRE,
  MODEL_NONE,
  emitWallBlock,
  emitSlabBlock,
} from './models';
import { sampleFaceCorners, canMergeCorners, shouldFlipQuad, FACE_NORMAL_STRIDES } from './ao';
import { packVertex } from './vertex';
import { emitCopperTrace, emitTripwire } from './current';
export { packVertex } from './vertex';
import type { BlockRegistry } from '../world/blocks/registry';
import type { BlockFaceDirection } from '../world/blocks/types';
import {
  MODEL_CUBE,
  MODEL_CROSS,
  CROSS_VERTICES_PER_BLOCK,
  CROSS_INDICES_PER_BLOCK,
  CROSS_QUADS_PER_BLOCK,
  emitCrossBlock,
} from './models';

export const DEFAULT_SKY_LIGHT = 15;
export const DEFAULT_BLOCK_LIGHT = 0;
export const DEFAULT_AO = 0;
export const DEFAULT_TINT_INDEX = 0;

export interface MeshBucketData {
  /** Worker-normalized vertices use the renderer's common quad index order. */
  canonicalQuads?: boolean;
  vertices: Uint32Array;
  indices: Uint32Array;
  vertexCount: number;
  quadCount: number;
}

export interface SectionMeshData {
  /** Worker-computed metadata; zero block light permits a smaller sky-only shader. */
  hasBlockLight?: boolean;
  opaque: MeshBucketData;
  cutout: MeshBucketData;
  translucent: MeshBucketData;
  /**
   * Geometry of non-cube blocks (plants, see models.ts). It is a separate bucket because the
   * greedy buckets hold merged cube faces only; the renderer draws it in the cutout pass.
   */
  models: MeshBucketData;
}

export interface MeshLookupTables {
  isOpaqueCube: Uint8Array; // numStates
  renderLayer: Uint8Array; // numStates (0=none/air, 1=opaque, 2=cutout, 3=translucent)
  translucentGroup: Uint16Array; // numStates (unique ID per translucent type, 0 for non-translucent)
  logAxis: Uint8Array; // numStates (0=y or none, 1=x, 2=z)
  tileIndices: Uint16Array; // numStates * 6 (faces: 0=+X, 1=-X, 2=+Y, 3=-Y, 4=+Z, 5=-Z)
  tintIndices: Uint8Array; // numStates * 6 (0=none, 1=grass, 2=foliage)
  fluidKind?: Uint8Array;
  fluidHeight?: Uint8Array;
  fluidFalling?: Uint8Array;
  modelKind: Uint8Array; // numStates (cube, cross or slab, see models.ts)
  /** Boxes of multi-box states (stairs, fences, doors, trapdoors); see shapes.ts. */
  shapeStart?: Uint32Array;
  shapeCount?: Uint8Array;
  shapeBoxes?: Float32Array;
}

const FACING_FACE: Record<Facing, number> = { east: 0, west: 1, south: 4, north: 5 };
const SHAPE_MODELS = new Set([
  'stairs',
  'fence',
  'door',
  'trapdoor',
  'pressure_plate',
  'piston_head',
]);

const FACE_NAMES: BlockFaceDirection[] = ['east', 'west', 'top', 'bottom', 'south', 'north'];

/**
 * Builds flat typed-array lookup tables from the BlockRegistry and a pure tile-index mapping function.
 */
export function buildMeshLookupTables(
  registry: BlockRegistry,
  tileResolver: (texName: string) => number,
  options: { fastLeaves?: boolean } = {},
): MeshLookupTables {
  const stateIds = registry.getAllStateIds();
  const maxStateId = stateIds.length > 0 ? Math.max(...stateIds) : 0;
  const numStates = maxStateId + 1;

  const isOpaqueCube = new Uint8Array(numStates);
  const renderLayer = new Uint8Array(numStates);
  const translucentGroup = new Uint16Array(numStates);
  const logAxis = new Uint8Array(numStates);
  const tileIndices = new Uint16Array(numStates * 6);
  const tintIndices = new Uint8Array(numStates * 6);
  const modelKind = new Uint8Array(numStates);
  const fluidKind = new Uint8Array(numStates);
  const fluidHeight = new Uint8Array(numStates);
  const fluidFalling = new Uint8Array(numStates);
  const shapeStart = new Uint32Array(numStates);
  const shapeCount = new Uint8Array(numStates);
  const shapeBoxList: number[] = [];

  const translucentTypeMap = new Map<string, number>();
  let nextTranslucentGroupId = 1;

  for (const stateId of stateIds) {
    const resolved = registry.getResolvedState(stateId);
    if (!resolved || resolved.blockId === 'air') {
      continue;
    }

    const def = resolved.definition;
    if (def.id === 'water' || def.id === 'lava') {
      fluidKind[stateId] = def.id === 'water' ? 1 : 2;
      fluidFalling[stateId] = resolved.properties.falling === 'true' ? 1 : 0;
      fluidHeight[stateId] = fluidFalling[stateId]
        ? 64
        : 56 - Number(resolved.properties.level ?? 0) * 7;
    }
    // Fast leaves are opaque cubes: their inner faces and faces behind them are never drawn.
    isOpaqueCube[stateId] =
      def.fullOpaqueCube || (options.fastLeaves && def.id.endsWith('_leaves')) ? 1 : 0;
    const boxes = SHAPE_MODELS.has(String(def.model)) ? stateBoxes(resolved) : null;
    if (boxes) {
      shapeStart[stateId] = shapeBoxList.length / 6;
      shapeCount[stateId] = boxes.length;
      for (const box of boxes) shapeBoxList.push(...box);
    }
    modelKind[stateId] = boxes
      ? MODEL_SHAPE
      : def.model === 'wall_torch'
        ? MODEL_WALL_TORCH +
          ['north', 'south', 'east', 'west'].indexOf(String(resolved.properties.facing))
        : def.model === 'trace'
          ? MODEL_TRACE
          : def.model === 'tripwire'
            ? MODEL_TRIPWIRE
            : def.model === 'cross'
              ? MODEL_CROSS
              : def.model === 'slab'
                ? resolved.properties.half === 'top'
                  ? MODEL_TOP_SLAB
                  : MODEL_BOTTOM_SLAB
                : def.model === 'wall'
                  ? MODEL_WALL_NORTH +
                    ['north', 'south', 'east', 'west'].indexOf(String(resolved.properties.facing))
                  : MODEL_CUBE;

    if (def.renderLayer === 'opaque') {
      renderLayer[stateId] = 1;
    } else if (def.renderLayer === 'cutout') {
      renderLayer[stateId] = 2;
    } else if (def.renderLayer === 'translucent') {
      renderLayer[stateId] = 3;
      let groupId = translucentTypeMap.get(def.id);
      if (groupId === undefined) {
        groupId = nextTranslucentGroupId++;
        translucentTypeMap.set(def.id, groupId);
      }
      translucentGroup[stateId] = groupId;
    }

    const axisProp = resolved.properties['axis'] as string | undefined;
    if (axisProp === 'x') {
      logAxis[stateId] = 1;
    } else if (axisProp === 'z') {
      logAxis[stateId] = 2;
    } else {
      logAxis[stateId] = 0;
    }

    for (let f = 0; f < 6; f++) {
      const faceName = FACE_NAMES[f]!;
      const texName = registry.getFaceTexture(stateId, faceName);
      if (texName) {
        tileIndices[stateId * 6 + f] = tileResolver(texName);
      }

      // Assign tint category per face: 1=grass_top, 2=foliage (oak_leaves), 3=grass_side
      if (resolved.blockId === 'grass_block') {
        if (f === 2) {
          tintIndices[stateId * 6 + f] = 1; // grass_top
        } else if (f !== 3) {
          tintIndices[stateId * 6 + f] = 3; // grass_side
        } else {
          tintIndices[stateId * 6 + f] = 0; // dirt bottom
        }
      } else if (
        resolved.blockId === 'vine' ||
        resolved.blockId === 'oak_leaves' ||
        resolved.blockId === 'rainwood_leaves' ||
        resolved.blockId === 'acacia_leaves'
      ) {
        // Foliage tint. Rainwood and acacia leaves are neutral tiles like oak leaves, so each
        // biome tints them (deep green in rainforest, olive in savanna); birch and pine keep
        // their fixed colours.
        tintIndices[stateId * 6 + f] = 2;
      } else if (resolved.blockId === 'tall_grass') {
        tintIndices[stateId * 6 + f] = 1; // grass tint, like the top of a grass block
      } else {
        tintIndices[stateId * 6 + f] = 0; // none
      }
    }

    if (boxes && def.textures) applyShapeTiles(stateId, resolved, tileIndices, tileResolver);
    if (boxes)
      for (let f = 0; f < 6; f++)
        if (tileIndices[stateId * 6 + f]! > SHAPE_VERTEX.tileMask)
          throw new Error(`${resolved.blockId}: tile index exceeds the shape vertex's 10 bits`);
  }

  return {
    fluidKind,
    fluidHeight,
    fluidFalling,
    isOpaqueCube,
    renderLayer,
    translucentGroup,
    logAxis,
    tileIndices,
    tintIndices,
    modelKind,
    shapeStart,
    shapeCount,
    shapeBoxes: new Float32Array(shapeBoxList),
  };
}

/** Door and trapdoor faces pick their tile from the state: see decisions/BLOCKS-shapes.md. */
function applyShapeTiles(
  stateId: number,
  resolved: NonNullable<ReturnType<BlockRegistry['getResolvedState']>>,
  tileIndices: Uint16Array,
  tileResolver: (texName: string) => number,
): void {
  const model = resolved.definition.model;
  const tex = resolved.definition.textures!;
  const props = resolved.properties;
  const facing = String(props.facing) as Facing;
  const open = String(props.open) === 'true';
  if (model === 'door') {
    const lower = String(props.half) !== 'upper';
    const hinge = String(props.hinge);
    const frontNormal = doorFrontNormal(facing, hinge, open);
    const front = FACING_FACE[frontNormal];
    const back = FACING_FACE[oppositeFacing(frontNormal)];
    const base = lower ? tex.lower! : tex.upper!;
    const flip = lower ? tex.lower_flip! : tex.upper_flip!;
    tileIndices[stateId * 6 + front] = tileResolver(hinge === 'right' ? flip : base);
    tileIndices[stateId * 6 + back] = tileResolver(hinge === 'left' ? flip : base);
  } else if (model === 'trapdoor') {
    const planks = tileResolver(tex.side!);
    const leaf = tileResolver(tex.top!);
    for (let f = 0; f < 6; f++) tileIndices[stateId * 6 + f] = planks;
    if (open) {
      const broad = FACING_FACE[facing];
      tileIndices[stateId * 6 + broad] = leaf;
      tileIndices[stateId * 6 + (broad ^ 1)] = leaf;
    } else {
      tileIndices[stateId * 6 + 2] = leaf;
      tileIndices[stateId * 6 + 3] = leaf;
    }
  }
}

/**
 * Checks if a face between selfState and neighborState should be culled.
 */
export function shouldCullFace(
  selfState: number,
  neighborState: number,
  tables: MeshLookupTables,
): boolean {
  if (selfState === 0) return true; // Air has no faces
  if (tables.modelKind[selfState] !== MODEL_CUBE) return true; // Plants are drawn by the model pass

  if (tables.fluidKind?.[selfState]) {
    return (
      tables.isOpaqueCube[neighborState] === 1 ||
      tables.fluidKind[selfState] === tables.fluidKind[neighborState]
    );
  }

  // Rule 1: A face is hidden when its neighbor is a full opaque cube.
  if (tables.isOpaqueCube[neighborState] === 1) {
    return true;
  }

  // Rule 2: Two adjacent blocks of the same translucent type (water–water, glass–glass) hide their shared faces.
  const selfGroup = tables.translucentGroup[selfState];
  if (selfGroup !== 0 && selfGroup === tables.translucentGroup[neighborState]) {
    return true;
  }

  // Rule 3: Leaves are cutout and keep faces between each other.
  // Since neighbor is not full opaque cube (checked above), leaves adjacent to leaves returns false (kept).

  return false;
}

// Scratch buffers pre-allocated to avoid heap allocations in inner loops
const SCRATCH_MASK = new Uint32Array(16 * 16);
const SCRATCH_VISITED = new Uint8Array(16 * 16);
const FACE_U_STRIDES = [324, 324, 1, 1, 1, 1];
const FACE_V_STRIDES = [18, 18, 324, 324, 18, 18];
const FACE_D_STRIDES = [1, 1, 18, 18, 324, 324];
const QUAD_ORDER = [0, 1, 2, 0, 2, 3];
const FLIPPED_QUAD_ORDER = [0, 1, 3, 1, 2, 3];
const SCRATCH_CORNERS = new Uint32Array(16 * 16 * 4);

// Pre-allocated per-bucket vertex/index buffers
// Max quads per bucket: 24,576 (e.g., 16³ leaf-leaf checkerboard has all 24,576 faces exposed)
// 24,576 quads * 4 verts/quad = 98,304 verts * 2 uint32/vert = 196,608 uint32s
// 24,576 quads * 6 indices/quad = 147,456 uint32s
const MAX_VERTS_PER_BUCKET = 24576 * 4 * 2; // 196,608
const MAX_INDICES_PER_BUCKET = 24576 * 6; // 147,456

export interface BucketScratch {
  vertices: Uint32Array;
  indices: Uint32Array;
  vertOffset: number;
  indexOffset: number;
  quadCount: number;
}

function createBucketScratch(): BucketScratch {
  return {
    vertices: new Uint32Array(MAX_VERTS_PER_BUCKET),
    indices: new Uint32Array(MAX_INDICES_PER_BUCKET),
    vertOffset: 0,
    indexOffset: 0,
    quadCount: 0,
  };
}

const opaqueScratch = createBucketScratch();
const cutoutScratch = createBucketScratch();
const translucentScratch = createBucketScratch();
const modelScratch = createBucketScratch();

/** Models can emit double-sided quads, so reserve up to 12 indices per quad. */
function reserveQuads(scratch: BucketScratch, quads: number): void {
  const neededVertices = scratch.vertOffset + quads * 8;
  const neededIndices = scratch.indexOffset + quads * 12;
  if (neededVertices <= scratch.vertices.length && neededIndices <= scratch.indices.length) return;

  let vertexCapacity = scratch.vertices.length;
  let indexCapacity = scratch.indices.length;
  while (vertexCapacity < neededVertices) vertexCapacity *= 2;
  while (indexCapacity < neededIndices) indexCapacity *= 2;
  if (vertexCapacity === scratch.vertices.length && indexCapacity === scratch.indices.length)
    return;

  if (vertexCapacity !== scratch.vertices.length) {
    const vertices = new Uint32Array(vertexCapacity);
    vertices.set(scratch.vertices.subarray(0, scratch.vertOffset));
    scratch.vertices = vertices;
  }
  if (indexCapacity !== scratch.indices.length) {
    const indices = new Uint32Array(indexCapacity);
    indices.set(scratch.indices.subarray(0, scratch.indexOffset));
    scratch.indices = indices;
  }
}

function resetBucketScratch(scratch: BucketScratch): void {
  scratch.vertOffset = 0;
  scratch.indexOffset = 0;
  scratch.quadCount = 0;
}

function emitQuad(
  f: number,
  sliceD: number,
  u0: number,
  v0: number,
  W: number,
  H: number,
  tileIndex: number,
  tintIndex: number,
  logAxis: number,
  scratch: BucketScratch,
  corners: Uint32Array,
  cornerOffset: number,
): void {
  const vertBase = scratch.vertOffset / 2;

  // Determine standard vs swapped UVs for log orientation
  let isUVRotated = false;
  if (logAxis === 1) {
    // X-axis log: long faces are Top (2), Bottom (3), South (4), North (5)
    isUVRotated = f === 2 || f === 3 || f === 4 || f === 5;
  } else if (logAxis === 2) {
    // Z-axis log: long faces with Z along slice U are East (0), West (1)
    isUVRotated = f === 0 || f === 1;
  }

  let u0_val: number, v0_val: number;
  let u1_val: number, v1_val: number;
  let u2_val: number, v2_val: number;
  let u3_val: number, v3_val: number;

  const isSideFace = f !== 2 && f !== 3;

  if (isUVRotated) {
    u0_val = 0;
    v0_val = 0;
    u1_val = 0;
    v1_val = W;
    u2_val = H;
    v2_val = W;
    u3_val = H;
    v3_val = 0;
  } else if (isSideFace) {
    if (f === 0 || f === 1) {
      u0_val = W;
      v0_val = H;
      u1_val = 0;
      v1_val = H;
      u2_val = 0;
      v2_val = 0;
      u3_val = W;
      v3_val = 0;
    } else {
      u0_val = 0;
      v0_val = H;
      u1_val = W;
      v1_val = H;
      u2_val = W;
      v2_val = 0;
      u3_val = 0;
      v3_val = 0;
    }
  } else {
    u0_val = 0;
    v0_val = 0;
    u1_val = W;
    v1_val = 0;
    u2_val = W;
    v2_val = H;
    u3_val = 0;
    v3_val = H;
  }

  // Quad corner 3D section positions depending on face direction f
  let x0 = 0,
    y0 = 0,
    z0 = 0;
  let x1 = 0,
    y1 = 0,
    z1 = 0;
  let x2 = 0,
    y2 = 0,
    z2 = 0;
  let x3 = 0,
    y3 = 0,
    z3 = 0;

  switch (f) {
    case 0: {
      // East (+X)
      const x = sliceD + 1;
      x0 = x;
      y0 = v0;
      z0 = u0;
      x1 = x;
      y1 = v0;
      z1 = u0 + W;
      x2 = x;
      y2 = v0 + H;
      z2 = u0 + W;
      x3 = x;
      y3 = v0 + H;
      z3 = u0;
      break;
    }
    case 1: {
      // West (-X)
      const x = sliceD;
      x0 = x;
      y0 = v0;
      z0 = u0 + W;
      x1 = x;
      y1 = v0;
      z1 = u0;
      x2 = x;
      y2 = v0 + H;
      z2 = u0;
      x3 = x;
      y3 = v0 + H;
      z3 = u0 + W;
      break;
    }
    case 2: {
      // Top (+Y)
      const y = sliceD + 1;
      x0 = u0;
      y0 = y;
      z0 = v0 + H;
      x1 = u0 + W;
      y1 = y;
      z1 = v0 + H;
      x2 = u0 + W;
      y2 = y;
      z2 = v0;
      x3 = u0;
      y3 = y;
      z3 = v0;
      break;
    }
    case 3: {
      // Bottom (-Y)
      const y = sliceD;
      x0 = u0;
      y0 = y;
      z0 = v0;
      x1 = u0 + W;
      y1 = y;
      z1 = v0;
      x2 = u0 + W;
      y2 = y;
      z2 = v0 + H;
      x3 = u0;
      y3 = y;
      z3 = v0 + H;
      break;
    }
    case 4: {
      // South (+Z)
      const z = sliceD + 1;
      x0 = u0;
      y0 = v0;
      z0 = z;
      x1 = u0 + W;
      y1 = v0;
      z1 = z;
      x2 = u0 + W;
      y2 = v0 + H;
      z2 = z;
      x3 = u0;
      y3 = v0 + H;
      z3 = z;
      break;
    }
    case 5: {
      // North (-Z)
      const z = sliceD;
      x0 = u0 + W;
      y0 = v0;
      z0 = z;
      x1 = u0;
      y1 = v0;
      z1 = z;
      x2 = u0;
      y2 = v0 + H;
      z2 = z;
      x3 = u0 + W;
      y3 = v0 + H;
      z3 = z;
      break;
    }
  }

  // Pack 4 vertices
  packVertex(
    x0,
    y0,
    z0,
    f,
    corners[cornerOffset + 0]! >>> 16,
    corners[cornerOffset + 0]! & 15,
    (corners[cornerOffset + 0]! >>> 4) & 15,
    tintIndex,
    tileIndex,
    u0_val,
    v0_val,
    scratch.vertices,
    scratch.vertOffset,
    (corners[cornerOffset + 0]! >>> 8) & 15,
    (corners[cornerOffset + 0]! >>> 12) & 15,
  );
  packVertex(
    x1,
    y1,
    z1,
    f,
    corners[cornerOffset + 1]! >>> 16,
    corners[cornerOffset + 1]! & 15,
    (corners[cornerOffset + 1]! >>> 4) & 15,
    tintIndex,
    tileIndex,
    u1_val,
    v1_val,
    scratch.vertices,
    scratch.vertOffset + 2,
    (corners[cornerOffset + 1]! >>> 8) & 15,
    (corners[cornerOffset + 1]! >>> 12) & 15,
  );
  packVertex(
    x2,
    y2,
    z2,
    f,
    corners[cornerOffset + 2]! >>> 16,
    corners[cornerOffset + 2]! & 15,
    (corners[cornerOffset + 2]! >>> 4) & 15,
    tintIndex,
    tileIndex,
    u2_val,
    v2_val,
    scratch.vertices,
    scratch.vertOffset + 4,
    (corners[cornerOffset + 2]! >>> 8) & 15,
    (corners[cornerOffset + 2]! >>> 12) & 15,
  );
  packVertex(
    x3,
    y3,
    z3,
    f,
    corners[cornerOffset + 3]! >>> 16,
    corners[cornerOffset + 3]! & 15,
    (corners[cornerOffset + 3]! >>> 4) & 15,
    tintIndex,
    tileIndex,
    u3_val,
    v3_val,
    scratch.vertices,
    scratch.vertOffset + 6,
    (corners[cornerOffset + 3]! >>> 8) & 15,
    (corners[cornerOffset + 3]! >>> 12) & 15,
  );

  scratch.vertOffset += 8;

  const idx = scratch.indexOffset;
  const flipped = shouldFlipQuad(corners, cornerOffset);
  const order = flipped ? FLIPPED_QUAD_ORDER : QUAD_ORDER;
  for (let t = 0; t < 6; t += 3) {
    scratch.indices[idx + t] = vertBase + order[t]!;
    scratch.indices[idx + t + 1] = vertBase + order[t + (f === 0 || f === 1 ? 2 : 1)]!;
    scratch.indices[idx + t + 2] = vertBase + order[t + (f === 0 || f === 1 ? 1 : 2)]!;
  }

  scratch.indexOffset += 6;
  scratch.quadCount++;
}

function finishBucketData(scratch: BucketScratch): MeshBucketData {
  return {
    vertices: scratch.vertices.slice(0, scratch.vertOffset),
    indices: scratch.indices.slice(0, scratch.indexOffset),
    vertexCount: scratch.vertOffset / 2,
    quadCount: scratch.quadCount,
  };
}

function emptyBucketData(): MeshBucketData {
  return {
    vertices: new Uint32Array(0),
    indices: new Uint32Array(0),
    vertexCount: 0,
    quadCount: 0,
  };
}

/**
 * Pure greedy mesher: generates typed arrays per bucket (opaque, cutout, translucent)
 * from an 18x18x18 Uint16Array padded section and registry lookup tables.
 */
export function greedyMesh(
  paddedSection: Uint16Array,
  tables: MeshLookupTables,
  lightInput?: Uint16Array | (() => Uint16Array),
): SectionMeshData {
  // Fast path 1: Check if core 16x16x16 section is all air
  let isAllAir = true;
  let isAllOpaque = true;

  for (let pz = 1; pz <= 16; pz++) {
    const zOff = pz * 18 * 18;
    for (let py = 1; py <= 16; py++) {
      const yzOff = py * 18 + zOff;
      for (let px = 1; px <= 16; px++) {
        const state = paddedSection[px + yzOff]!;
        if (state !== 0) {
          isAllAir = false;
        }
        if (tables.isOpaqueCube[state] === 0) {
          isAllOpaque = false;
        }
        if (!isAllAir && !isAllOpaque) break;
      }
      if (!isAllAir && !isAllOpaque) break;
    }
    if (!isAllAir && !isAllOpaque) break;
  }

  if (isAllAir) {
    return {
      opaque: emptyBucketData(),
      cutout: emptyBucketData(),
      translucent: emptyBucketData(),
      models: emptyBucketData(),
    };
  }

  // Fast path 2: If core is all opaque cubes AND all 6 boundary faces are full opaque cubes, return 0 quads
  if (isAllOpaque) {
    let allBoundariesOpaque = true;
    for (let pz = 0; pz < 18; pz++) {
      const zOff = pz * 18 * 18;
      for (let py = 0; py < 18; py++) {
        const yzOff = py * 18 + zOff;
        for (let px = 0; px < 18; px++) {
          // Check outer shell
          if (px === 0 || px === 17 || py === 0 || py === 17 || pz === 0 || pz === 17) {
            const st = paddedSection[px + yzOff]!;
            if (tables.isOpaqueCube[st] === 0) {
              allBoundariesOpaque = false;
              break;
            }
          }
        }
        if (!allBoundariesOpaque) break;
      }
      if (!allBoundariesOpaque) break;
    }

    if (allBoundariesOpaque) {
      return {
        opaque: emptyBucketData(),
        cutout: emptyBucketData(),
        translucent: emptyBucketData(),
        models: emptyBucketData(),
      };
    }
  }

  // Empty and fully enclosed sections need no light padding. Workers can defer
  // its expansion until the section actually has geometry to shade.
  const paddedLight = typeof lightInput === 'function' ? lightInput() : lightInput;

  // Reset scratch buffers
  resetBucketScratch(opaqueScratch);
  resetBucketScratch(cutoutScratch);
  resetBucketScratch(translucentScratch);
  resetBucketScratch(modelScratch);

  emitFluidBlocks(paddedSection, tables, paddedLight, opaqueScratch, translucentScratch);

  // Process all 6 face directions
  for (let f = 0; f < 6; f++) {
    // Sweep through 16 slice planes (d = 0..15)
    for (let d = 0; d < 16; d++) {
      // Clear scratch mask and visited arrays
      SCRATCH_MASK.fill(0);
      SCRATCH_VISITED.fill(0);

      // Populate 16x16 mask for current slice plane d and face direction f
      const uStride = FACE_U_STRIDES[f]!;
      const vStride = FACE_V_STRIDES[f]!;
      const normalStride = FACE_NORMAL_STRIDES[f]!;
      const sliceStart = 343 + d * FACE_D_STRIDES[f]!;
      for (let v = 0; v < 16; v++) {
        let ownIndex = sliceStart + v * vStride;
        for (let u = 0; u < 16; u++, ownIndex += uStride) {
          const selfState = paddedSection[ownIndex]!;
          const neighState = paddedSection[ownIndex + normalStride]!;

          if (!tables.fluidKind?.[selfState] && !shouldCullFace(selfState, neighState, tables)) {
            const tileIdx = tables.tileIndices[selfState * 6 + f]!;
            const tintIdx = tables.tintIndices ? tables.tintIndices[selfState * 6 + f]! : 0;
            const layer = tables.renderLayer[selfState]!;
            const axis = tables.logAxis[selfState]!;
            // Encode tileIdx, tintIdx, layer, axis into mask value (key)
            // layer: 2 bits (1=opaque, 2=cutout, 3=translucent)
            // axis: 2 bits (0..2)
            // tintIdx: 2 bits (0..2)
            // tileIdx: 16 bits
            const key = (tileIdx << 6) | (tintIdx << 4) | (axis << 2) | layer;
            SCRATCH_MASK[u + v * 16] = key;
            sampleFaceCorners(
              paddedSection,
              paddedLight,
              tables.isOpaqueCube,
              ownIndex,
              f,
              layer === 3,
              SCRATCH_CORNERS,
              (u + v * 16) * 4,
            );
          }
        }
      }

      // 2D Greedy Merging over 16x16 mask
      for (let v = 0; v < 16; v++) {
        for (let u = 0; u < 16; u++) {
          const idx = u + v * 16;
          if (SCRATCH_VISITED[idx] === 0 && SCRATCH_MASK[idx] !== 0) {
            const key = SCRATCH_MASK[idx]!;
            const layer = key & 3;
            const logAxis = (key >> 2) & 3;
            const tintIdx = (key >> 4) & 3;
            const tileIdx = key >> 6;

            // Expand along width (U)
            let W = 1;
            while (
              u + W < 16 &&
              SCRATCH_VISITED[u + W + v * 16] === 0 &&
              SCRATCH_MASK[u + W + v * 16] === key &&
              canMergeCorners(SCRATCH_CORNERS, idx * 4, (u + W + v * 16) * 4)
            ) {
              W++;
            }

            // Expand along height (V)
            let H = 1;
            let canGrowHeight = true;
            while (v + H < 16 && canGrowHeight) {
              for (let du = 0; du < W; du++) {
                const checkIdx = u + du + (v + H) * 16;
                if (
                  SCRATCH_VISITED[checkIdx] !== 0 ||
                  SCRATCH_MASK[checkIdx] !== key ||
                  !canMergeCorners(SCRATCH_CORNERS, idx * 4, checkIdx * 4)
                ) {
                  canGrowHeight = false;
                  break;
                }
              }
              if (canGrowHeight) {
                H++;
              }
            }

            // Mark cells as visited
            for (let dv = 0; dv < H; dv++) {
              for (let du = 0; du < W; du++) {
                SCRATCH_VISITED[u + du + (v + dv) * 16] = 1;
              }
            }

            // Select bucket scratch buffer
            let bucket: BucketScratch;
            if (layer === 1) {
              bucket = opaqueScratch;
            } else if (layer === 2) {
              bucket = cutoutScratch;
            } else {
              bucket = translucentScratch;
            }

            // Emit quad
            emitQuad(f, d, u, v, W, H, tileIdx, tintIdx, logAxis, bucket, SCRATCH_CORNERS, idx * 4);
          }
        }
      }
    }
  }

  // Model pass: blocks that are not cubes emit their own geometry
  for (let pz = 1; pz <= 16; pz++) {
    const zOff = pz * 18 * 18;
    for (let py = 1; py <= 16; py++) {
      const yzOff = py * 18 + zOff;
      for (let px = 1; px <= 16; px++) {
        const state = paddedSection[px + yzOff]!;
        if (tables.modelKind[state] === MODEL_NONE) continue;
        if (tables.modelKind[state] !== MODEL_CUBE)
          reserveQuads(modelScratch, MAX_SHAPE_QUADS_PER_BLOCK);
        if (tables.modelKind[state] === MODEL_SHAPE) {
          const bucket = modelScratch;
          const quads = emitShapeBlock(
            tables as Required<MeshLookupTables>,
            state,
            paddedSection,
            paddedLight,
            px + yzOff,
            px - 1,
            py - 1,
            pz - 1,
            bucket.vertices,
            bucket.vertOffset,
            bucket.indices,
            bucket.indexOffset,
          );
          bucket.vertOffset += quads * 8;
          bucket.indexOffset += quads * 6;
          bucket.quadCount += quads;
          continue;
        }
        if (tables.modelKind[state] === MODEL_TRACE) {
          const bucket = modelScratch;
          const quads = emitCopperTrace(
            tables,
            paddedSection,
            paddedLight,
            state,
            px + yzOff,
            px - 1,
            py - 1,
            pz - 1,
            bucket.vertices,
            bucket.vertOffset,
            bucket.indices,
            bucket.indexOffset,
          );
          bucket.vertOffset += quads * 8;
          bucket.indexOffset += quads * 6;
          bucket.quadCount += quads;
          continue;
        }
        if (tables.modelKind[state] === MODEL_TRIPWIRE) {
          const bucket = modelScratch;
          const quads = emitTripwire(
            state,
            tables,
            paddedLight,
            px + yzOff,
            px - 1,
            py - 1,
            pz - 1,
            bucket.vertices,
            bucket.vertOffset,
            bucket.indices,
            bucket.indexOffset,
          );
          bucket.vertOffset += quads * 8;
          bucket.indexOffset += quads * 6;
          bucket.quadCount += quads;
          continue;
        }
        if (
          tables.modelKind[state] === MODEL_BOTTOM_SLAB ||
          tables.modelKind[state] === MODEL_TOP_SLAB
        ) {
          const bucket = modelScratch;
          const light = paddedLight ? paddedLight[px + yzOff]! : 0xf000;
          emitSlabBlock(
            packVertex,
            bucket.vertices,
            bucket.vertOffset,
            bucket.indices,
            bucket.indexOffset,
            px - 1,
            py - 1,
            pz - 1,
            tables.modelKind[state] === MODEL_TOP_SLAB,
            tables.tileIndices[state * 6 + 2]!,
            light >>> 12,
            (light >>> 8) & 15,
            (light >>> 4) & 15,
            light & 15,
          );
          bucket.vertOffset += 48;
          bucket.indexOffset += 36;
          bucket.quadCount += 6;
          continue;
        }
        if (tables.modelKind[state]! >= MODEL_WALL_TORCH) {
          const bucket = modelScratch;
          emitWallTorch(
            packVertex,
            bucket.vertices,
            bucket.vertOffset,
            bucket.indices,
            bucket.indexOffset,
            px - 1,
            py - 1,
            pz - 1,
            tables.modelKind[state]! - MODEL_WALL_TORCH,
            tables.tileIndices[state * 6 + 2]!,
            paddedLight ? paddedLight[px + yzOff]! : 0xf000,
          );
          bucket.vertOffset += 16;
          bucket.indexOffset += 24;
          bucket.quadCount += 2;
          continue;
        }
        if (tables.modelKind[state]! >= MODEL_WALL_NORTH) {
          const bucket = modelScratch;
          const light = paddedLight ? paddedLight[px + yzOff]! : 0xf000;
          emitWallBlock(
            packVertex,
            bucket.vertices,
            bucket.vertOffset,
            bucket.indices,
            bucket.indexOffset,
            px - 1,
            py - 1,
            pz - 1,
            tables.modelKind[state]! - MODEL_WALL_NORTH,
            tables.tileIndices[state * 6 + 2]!,
            tables.tintIndices[state * 6 + 2]!,
            light >>> 12,
            (light >>> 8) & 15,
            (light >>> 4) & 15,
            light & 15,
          );
          bucket.vertOffset += 16;
          bucket.indexOffset += 12;
          bucket.quadCount += 2;
          continue;
        }
        if (tables.modelKind[state] !== MODEL_CROSS) continue;
        const bucket = modelScratch;
        emitCrossBlock(
          packVertex,
          bucket.vertices,
          bucket.vertOffset,
          bucket.indices,
          bucket.indexOffset,
          px - 1,
          py - 1,
          pz - 1,
          tables.tileIndices[state * 6 + 2]!,
          tables.tintIndices[state * 6 + 2]!,
          DEFAULT_AO,
          paddedLight ? paddedLight[px + yzOff]! >>> 12 : DEFAULT_SKY_LIGHT,
          paddedLight ? (paddedLight[px + yzOff]! >>> 8) & 15 : DEFAULT_BLOCK_LIGHT,
          paddedLight ? (paddedLight[px + yzOff]! >>> 4) & 15 : DEFAULT_BLOCK_LIGHT,
          paddedLight ? paddedLight[px + yzOff]! & 15 : DEFAULT_BLOCK_LIGHT,
        );
        bucket.vertOffset += CROSS_VERTICES_PER_BLOCK * 2;
        bucket.indexOffset += CROSS_INDICES_PER_BLOCK;
        bucket.quadCount += CROSS_QUADS_PER_BLOCK;
      }
    }
  }

  return {
    opaque: finishBucketData(opaqueScratch),
    cutout: finishBucketData(cutoutScratch),
    translucent: finishBucketData(translucentScratch),
    models: finishBucketData(modelScratch),
  };
}
