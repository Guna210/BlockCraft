import { buildLodMesh, type LodJob } from '../render/lod-mesh';

self.onmessage = ({ data }: MessageEvent<LodJob>) => {
  const mesh = buildLodMesh(data);
  self.postMessage(mesh, { transfer: [mesh.vertices.buffer] });
};
