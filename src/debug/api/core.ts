export interface BlockCraftDebugAPI {
  ready(): Promise<void>;
  look?: (yaw: number, pitch: number) => void;
  showTestScene?: () => Promise<void>;
  audio?: typeof import('./audio').audioApi;
  createWorld?: (opts?: {
    name?: string;
    seed?: string;
    mode?: 'survival' | 'creative';
    type?: 'default' | 'flat';
  }) => Promise<void>;
  waitForTerrain?: (radiusChunks: number) => Promise<void>;
  getWorkerStats?: () => { genMsP95: number; meshMsP95: number; queueLength: number };
  wireframe?: (enabled?: boolean) => boolean;
  setWireframe?: (enabled: boolean) => void;
  getBlock?: (
    x: number,
    y: number,
    z: number,
  ) => { id: string; state: Record<string, string | number> };
  setBlock?: (
    x: number,
    y: number,
    z: number,
    id: string,
    state?: Record<string, string | number>,
  ) => void;
  fill?: (
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
    id: string,
  ) => void;
  getBiome?: (x: number, z: number) => string;
  getHeight?: (x: number, z: number) => number;
  getLight?: (x: number, y: number, z: number) => { sky: number; block: number };
  locate?: (
    kind: 'ore' | 'structure' | 'biome',
    id: string,
    near: [number, number, number],
  ) => [number, number, number] | null;
  worldHash?: (x1: number, z1: number, x2: number, z2: number) => string;
  setWorkerPoolSize?: (size: number) => void;
  getMainThreadGenCount?: () => number;
  resetMainThreadGenCount?: () => void;
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

// Set by main.ts in debug mode: reads pending WebGL errors into renderStats.glErrors.
let drainGlErrors: (() => void) | null = null;

export function setGlErrorDrain(fn: (() => void) | null): void {
  drainGlErrors = fn;
}

export const api: BlockCraftDebugAPI = {
  ready: () => readyPromise,
  getRenderStats: () => {
    // Count errors that no frame has drained yet, so a test that holds requestAnimationFrame
    // still sees them.
    if (drainGlErrors) drainGlErrors();
    return { ...renderStats };
  },
};

export function markReady() {
  if (!isReady) {
    isReady = true;
    readyResolve();
  }
}
