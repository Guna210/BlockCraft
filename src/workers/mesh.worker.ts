import { normalizeSharedQuads } from '../render/shared-quads';
import { buildSnapshotPadding, type BlockPaddingInput } from '../world/block-snapshot';
import { buildPaddedLight, type LightPaddingInput } from '../world/light-padding';
import { greedyMesh } from '../mesh/greedy';
import type { MeshLookupTables } from '../mesh/greedy';
import { vertexHasBlockLight } from '../mesh/vertex';

const ctx: Worker = self as unknown as Worker;

export function processMeshMessage(event: MessageEvent): void {
  const { id, paddedSection, tables, light } = event.data as {
    id: number;
    paddedSection: Uint16Array | BlockPaddingInput;
    tables: MeshLookupTables;
    light?: LightPaddingInput;
  };

  const start = performance.now();
  const blocks =
    paddedSection instanceof Uint16Array ? paddedSection : buildSnapshotPadding(paddedSection);
  const meshData = greedyMesh(blocks, tables, light ? buildPaddedLight(light) : undefined);
  for (const bucket of [meshData.opaque, meshData.cutout, meshData.translucent, meshData.models])
    normalizeSharedQuads(bucket);
  meshData.hasBlockLight = false;
  for (const bucket of [meshData.opaque, meshData.cutout, meshData.translucent, meshData.models]) {
    for (let i = 0; i < bucket.vertices.length; i += 2) {
      if (vertexHasBlockLight(bucket.vertices[i]!, bucket.vertices[i + 1]!)) {
        meshData.hasBlockLight = true;
        break;
      }
    }
    if (meshData.hasBlockLight) break;
  }
  const duration = performance.now() - start;

  const transferables: Transferable[] = [
    meshData.opaque.vertices.buffer,
    meshData.opaque.indices.buffer,
    meshData.cutout.vertices.buffer,
    meshData.cutout.indices.buffer,
    meshData.translucent.vertices.buffer,
    meshData.translucent.indices.buffer,
    meshData.models.vertices.buffer,
    meshData.models.indices.buffer,
  ];

  ctx.postMessage(
    { id, meshData, duration, finishedAt: performance.timeOrigin + performance.now() },
    transferables,
  );
}

ctx.onmessage = processMeshMessage;
