import { quadIndices, writeCanonicalQuadVertices } from '../render/shared-quads';
import { buildSnapshotPadding, type BlockPaddingInput } from '../world/block-snapshot';
import { buildPaddedLight, type LightPaddingInput } from '../world/light-padding';
import { greedyMesh } from '../mesh/greedy';
import type { MeshLookupTables } from '../mesh/greedy';
import { isShapeVertex, vertexHasBlockLight } from '../mesh/vertex';
import { sectionVisibility, trivialVisibilityMasks } from '../mesh/visibility';

const ctx: Worker = self as unknown as Worker;

export function processMeshMessage(event: MessageEvent): void {
  const { id, paddedSection, tables, light, trivialSections } = event.data as {
    id: number;
    paddedSection: Uint16Array | BlockPaddingInput;
    tables: MeshLookupTables;
    light?: LightPaddingInput;
    trivialSections?: Int8Array;
  };

  const start = performance.now();
  const blocks =
    paddedSection instanceof Uint16Array ? paddedSection : buildSnapshotPadding(paddedSection);
  const greedyStart = performance.now();
  const meshData = greedyMesh(blocks, tables, light ? () => buildPaddedLight(light) : undefined);
  const greedyMs = performance.now() - greedyStart;
  const visibilityStart = performance.now();
  meshData.visibilityMask = sectionVisibility(blocks, tables.isOpaqueCube);
  const visibilityMs = performance.now() - visibilityStart;
  const trivialMasks = trivialSections ? trivialVisibilityMasks(trivialSections) : undefined;

  // Build the renderer's three pass buffers directly in the worker. In particular, leaves and
  // model geometry are packed together for the cutout arena, avoiding a main-thread merge.
  const opaque = meshData.opaque;
  const cutout = meshData.cutout;
  const translucent = meshData.translucent;
  const models = meshData.models;
  for (const bucket of [opaque, cutout, translucent, models])
    bucket.quadCount = bucket.indices.length / 6;

  const opaqueVertices = new Uint32Array(opaque.quadCount * 8);
  const cutoutVertices = new Uint32Array((cutout.quadCount + models.quadCount) * 8);
  const translucentVertices = new Uint32Array(translucent.quadCount * 8);
  writeCanonicalQuadVertices(opaque, opaqueVertices);
  writeCanonicalQuadVertices(cutout, cutoutVertices);
  writeCanonicalQuadVertices(models, cutoutVertices, cutout.quadCount * 8);
  writeCanonicalQuadVertices(translucent, translucentVertices);

  const normalizePackedBucket = (
    bucket: typeof opaque,
    vertices: Uint32Array,
    start: number,
  ): void => {
    bucket.vertices = vertices.subarray(start, start + bucket.quadCount * 8);
    bucket.vertexCount = bucket.quadCount * 4;
    bucket.indices = quadIndices(bucket.quadCount);
    bucket.canonicalQuads = true;
  };
  normalizePackedBucket(opaque, opaqueVertices, 0);
  normalizePackedBucket(cutout, cutoutVertices, 0);
  normalizePackedBucket(models, cutoutVertices, cutout.quadCount * 8);
  normalizePackedBucket(translucent, translucentVertices, 0);

  let hasWallTorch = false;
  for (let i = 0; i < models.vertices.length; i += 2) {
    if (
      ((models.vertices[i]! >>> 15) & 7) >= 6 ||
      isShapeVertex(models.vertices[i]!, models.vertices[i + 1]!)
    ) {
      hasWallTorch = true;
      break;
    }
  }
  meshData.hasWallTorch = hasWallTorch;
  meshData.arenaBuffers = {
    opaque: opaqueVertices,
    cutout: cutoutVertices,
    translucent: translucentVertices,
  };
  meshData.hasBlockLight = false;
  for (const vertices of [opaqueVertices, cutoutVertices, translucentVertices]) {
    for (let i = 0; i < vertices.length; i += 2) {
      if (vertexHasBlockLight(vertices[i]!, vertices[i + 1]!)) {
        meshData.hasBlockLight = true;
        break;
      }
    }
    if (meshData.hasBlockLight) break;
  }
  const duration = performance.now() - start;

  const transferables = new Set<Transferable>([
    opaqueVertices.buffer,
    opaque.indices.buffer,
    cutoutVertices.buffer,
    cutout.indices.buffer,
    translucentVertices.buffer,
    translucent.indices.buffer,
    models.indices.buffer,
  ]);
  if (trivialMasks) transferables.add(trivialMasks.buffer);

  ctx.postMessage(
    {
      id,
      meshData,
      duration,
      greedyMs,
      visibilityMs,
      trivialMasks,
      finishedAt: performance.timeOrigin + performance.now(),
    },
    [...transferables],
  );
}

ctx.onmessage = processMeshMessage;
