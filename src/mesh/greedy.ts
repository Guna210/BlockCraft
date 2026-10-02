import type { BlockRegistry } from '../world/blocks/registry';
import type { BlockFaceDirection } from '../world/blocks/types';

export const DEFAULT_SKY_LIGHT = 15;
export const DEFAULT_BLOCK_LIGHT = 0;
export const DEFAULT_AO = 0;
export const DEFAULT_TINT_INDEX = 0;

export interface MeshBucketData {
  vertices: Uint32Array;
  indices: Uint32Array;
  vertexCount: number;
  quadCount: number;
}

export interface SectionMeshData {
  opaque: MeshBucketData;
  cutout: MeshBucketData;
  translucent: MeshBucketData;
}

export interface MeshLookupTables {
  isOpaqueCube: Uint8Array; // numStates
  renderLayer: Uint8Array; // numStates (0=none/air, 1=opaque, 2=cutout, 3=translucent)
  translucentGroup: Uint16Array; // numStates (unique ID per translucent type, 0 for non-translucent)
  logAxis: Uint8Array; // numStates (0=y or none, 1=x, 2=z)
  tileIndices: Uint16Array; // numStates * 6 (faces: 0=+X, 1=-X, 2=+Y, 3=-Y, 4=+Z, 5=-Z)
  tintIndices: Uint8Array; // numStates * 6 (0=none, 1=grass, 2=foliage)
}

const FACE_NAMES: BlockFaceDirection[] = ['east', 'west', 'top', 'bottom', 'south', 'north'];

/**
 * Builds flat typed-array lookup tables from the BlockRegistry and a pure tile-index mapping function.
 */
export function buildMeshLookupTables(
  registry: BlockRegistry,
  tileResolver: (texName: string) => number,
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

  const translucentTypeMap = new Map<string, number>();
  let nextTranslucentGroupId = 1;

  for (const stateId of stateIds) {
    const resolved = registry.getResolvedState(stateId);
    if (!resolved || resolved.blockId === 'air') {
      continue;
    }

    const def = resolved.definition;
    isOpaqueCube[stateId] = def.fullOpaqueCube ? 1 : 0;

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
      } else if (resolved.blockId === 'oak_leaves') {
        tintIndices[stateId * 6 + f] = 2; // foliage tint
      } else {
        tintIndices[stateId * 6 + f] = 0; // none
      }
    }
  }

  return {
    isOpaqueCube,
    renderLayer,
    translucentGroup,
    logAxis,
    tileIndices,
    tintIndices,
  };
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

// Pre-allocated per-bucket vertex/index buffers
// Max quads per bucket: 24,576 (e.g., 16³ leaf-leaf checkerboard has all 24,576 faces exposed)
// 24,576 quads * 4 verts/quad = 98,304 verts * 2 uint32/vert = 196,608 uint32s
// 24,576 quads * 6 indices/quad = 147,456 uint32s
const MAX_VERTS_PER_BUCKET = 24576 * 4 * 2; // 196,608
const MAX_INDICES_PER_BUCKET = 24576 * 6; // 147,456

interface BucketScratch {
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

function resetBucketScratch(scratch: BucketScratch): void {
  scratch.vertOffset = 0;
  scratch.indexOffset = 0;
  scratch.quadCount = 0;
}

function packVertex(
  x: number,
  y: number,
  z: number,
  normalIndex: number,
  ao: number,
  skyLight: number,
  blockLight: number,
  tintIndex: number,
  tileIndex: number,
  u: number,
  v: number,
  target: Uint32Array,
  offset: number,
): void {
  const word0 =
    (x & 31) |
    ((y & 31) << 5) |
    ((z & 31) << 10) |
    ((normalIndex & 7) << 15) |
    ((ao & 3) << 18) |
    ((skyLight & 15) << 20) |
    ((blockLight & 15) << 24) |
    ((tintIndex & 15) << 28);

  const word1 = (tileIndex & 65535) | ((u & 255) << 16) | ((v & 255) << 24);

  target[offset] = word0;
  target[offset + 1] = word1;
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
    DEFAULT_AO,
    DEFAULT_SKY_LIGHT,
    DEFAULT_BLOCK_LIGHT,
    tintIndex,
    tileIndex,
    u0_val,
    v0_val,
    scratch.vertices,
    scratch.vertOffset,
  );
  packVertex(
    x1,
    y1,
    z1,
    f,
    DEFAULT_AO,
    DEFAULT_SKY_LIGHT,
    DEFAULT_BLOCK_LIGHT,
    tintIndex,
    tileIndex,
    u1_val,
    v1_val,
    scratch.vertices,
    scratch.vertOffset + 2,
  );
  packVertex(
    x2,
    y2,
    z2,
    f,
    DEFAULT_AO,
    DEFAULT_SKY_LIGHT,
    DEFAULT_BLOCK_LIGHT,
    tintIndex,
    tileIndex,
    u2_val,
    v2_val,
    scratch.vertices,
    scratch.vertOffset + 4,
  );
  packVertex(
    x3,
    y3,
    z3,
    f,
    DEFAULT_AO,
    DEFAULT_SKY_LIGHT,
    DEFAULT_BLOCK_LIGHT,
    tintIndex,
    tileIndex,
    u3_val,
    v3_val,
    scratch.vertices,
    scratch.vertOffset + 6,
  );

  scratch.vertOffset += 8;

  // Pack 6 indices (2 triangles)
  const idx = scratch.indexOffset;
  scratch.indices[idx] = vertBase;
  scratch.indices[idx + 1] = vertBase + 1;
  scratch.indices[idx + 2] = vertBase + 2;
  scratch.indices[idx + 3] = vertBase;
  scratch.indices[idx + 4] = vertBase + 2;
  scratch.indices[idx + 5] = vertBase + 3;

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
export function greedyMesh(paddedSection: Uint16Array, tables: MeshLookupTables): SectionMeshData {
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
      };
    }
  }

  // Reset scratch buffers
  resetBucketScratch(opaqueScratch);
  resetBucketScratch(cutoutScratch);
  resetBucketScratch(translucentScratch);

  // Process all 6 face directions
  for (let f = 0; f < 6; f++) {
    // Sweep through 16 slice planes (d = 0..15)
    for (let d = 0; d < 16; d++) {
      // Clear scratch mask and visited arrays
      SCRATCH_MASK.fill(0);
      SCRATCH_VISITED.fill(0);

      // Populate 16x16 mask for current slice plane d and face direction f
      for (let v = 0; v < 16; v++) {
        for (let u = 0; u < 16; u++) {
          let selfPx = 0,
            selfPy = 0,
            selfPz = 0;
          let neighPx = 0,
            neighPy = 0,
            neighPz = 0;

          switch (f) {
            case 0: // East (+X)
              selfPx = d + 1;
              selfPy = v + 1;
              selfPz = u + 1;
              neighPx = d + 2;
              neighPy = v + 1;
              neighPz = u + 1;
              break;
            case 1: // West (-X)
              selfPx = d + 1;
              selfPy = v + 1;
              selfPz = u + 1;
              neighPx = d;
              neighPy = v + 1;
              neighPz = u + 1;
              break;
            case 2: // Top (+Y)
              selfPx = u + 1;
              selfPy = d + 1;
              selfPz = v + 1;
              neighPx = u + 1;
              neighPy = d + 2;
              neighPz = v + 1;
              break;
            case 3: // Bottom (-Y)
              selfPx = u + 1;
              selfPy = d + 1;
              selfPz = v + 1;
              neighPx = u + 1;
              neighPy = d;
              neighPz = v + 1;
              break;
            case 4: // South (+Z)
              selfPx = u + 1;
              selfPy = v + 1;
              selfPz = d + 1;
              neighPx = u + 1;
              neighPy = v + 1;
              neighPz = d + 2;
              break;
            case 5: // North (-Z)
              selfPx = u + 1;
              selfPy = v + 1;
              selfPz = d + 1;
              neighPx = u + 1;
              neighPy = v + 1;
              neighPz = d;
              break;
          }

          const selfState = paddedSection[selfPx + 18 * (selfPy + 18 * selfPz)]!;
          const neighState = paddedSection[neighPx + 18 * (neighPy + 18 * neighPz)]!;

          if (!shouldCullFace(selfState, neighState, tables)) {
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
              SCRATCH_MASK[u + W + v * 16] === key
            ) {
              W++;
            }

            // Expand along height (V)
            let H = 1;
            let canGrowHeight = true;
            while (v + H < 16 && canGrowHeight) {
              for (let du = 0; du < W; du++) {
                const checkIdx = u + du + (v + H) * 16;
                if (SCRATCH_VISITED[checkIdx] !== 0 || SCRATCH_MASK[checkIdx] !== key) {
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
            emitQuad(f, d, u, v, W, H, tileIdx, tintIdx, logAxis, bucket);
          }
        }
      }
    }
  }

  return {
    opaque: finishBucketData(opaqueScratch),
    cutout: finishBucketData(cutoutScratch),
    translucent: finishBucketData(translucentScratch),
  };
}
