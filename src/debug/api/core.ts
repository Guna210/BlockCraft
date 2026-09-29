export interface BlockCraftDebugAPI {
  ready(): Promise<void>;
  look?: (yaw: number, pitch: number) => void;
  audio?: typeof import('./audio').audioApi;
  getRenderStats(): {
    fps: number;
    frameCpuMsP95: number;
    uploadMsP95: number;
    drawCalls: number;
    triangles: number;
    chunksLoaded: number;
    chunksMeshed: number;
    chunksVisible: number;
    glErrors: number;
    textureAtlasSize: [number, number];
    missingTextures: string[];
  };
}

let isReady = false;
let readyResolve: () => void;
const readyPromise = new Promise<void>((resolve) => {
  readyResolve = resolve;
});

// Render stats
export const renderStats = {
  fps: 0,
  frameCpuMsP95: 0,
  uploadMsP95: 0,
  drawCalls: 0,
  triangles: 0,
  chunksLoaded: 0,
  chunksMeshed: 0,
  chunksVisible: 0,
  glErrors: 0,
  textureAtlasSize: [0, 0] as [number, number],
  missingTextures: [] as string[],
};

export const api: BlockCraftDebugAPI = {
  ready: () => readyPromise,
  getRenderStats: () => ({ ...renderStats }),
};

export function markReady() {
  if (!isReady) {
    isReady = true;
    readyResolve();
  }
}
