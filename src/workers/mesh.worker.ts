import { greedyMesh } from '../mesh/greedy';
import type { MeshLookupTables } from '../mesh/greedy';

const ctx: Worker = self as unknown as Worker;

ctx.onmessage = (event: MessageEvent) => {
  const { id, paddedSection, tables } = event.data as {
    id: number;
    paddedSection: Uint16Array;
    tables: MeshLookupTables;
  };

  const start = performance.now();
  const meshData = greedyMesh(paddedSection, tables);
  const duration = performance.now() - start;

  const transferables: Transferable[] = [
    meshData.opaque.vertices.buffer,
    meshData.opaque.indices.buffer,
    meshData.cutout.vertices.buffer,
    meshData.cutout.indices.buffer,
    meshData.translucent.vertices.buffer,
    meshData.translucent.indices.buffer,
  ];

  ctx.postMessage({ id, meshData, duration }, transferables);
};
