export interface BlockCraftDebugAPI {
  ready(): Promise<void>;
  giveItem?: (id: string, count: number) => void;
  getInventory?: () => Array<import('../../gameplay/inventory').ItemStack | null>;
  getInventoryCursor?: () => import('../../gameplay/inventory').CursorStack | null;
  selectHotbarSlot?: (slot: number) => void;
  getEntities?: (filter?: {
    type?: string;
    radius?: number;
  }) => import('../../entity/item-entity').EntitySnapshot[];
  getDropStats?: () => {
    items: number;
    particles: number;
    itemDraws: number;
    particleDraws: number;
    triangles: number;
  };
  raycast?: () => {
    hit: boolean;
    block?: [number, number, number];
    face?: string;
    distance?: number;
  };
  setHeldBlock?: (id: string, state?: Record<string, string | number>) => void;
  getInteraction?: () => {
    editFrame: number;
    meshFrame: number;
    meshRevision: number;
    progress: number;
    stage: number;
    heldBlock: string | null;
  };
  getPlayer?: () => import('../../entity/player').PlayerSnapshot;
  teleport?: (x: number, y: number, z: number, yaw?: number, pitch?: number) => void;
  input?: (action: string, down: boolean) => void;
  pause?: () => void;
  resume?: () => void;
  tick?: (n: number) => Promise<void>;
  setGameMode?: (mode: 'survival' | 'creative') => void;
  setTimeOfDay?: (ticks: number) => void;
  setClouds?: (mode: 'fancy' | 'fast' | 'off') => void;
  setWeather?: (state: 'clear' | 'rain' | 'thunder') => void;
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
  getBlockLightRGB?: (x: number, y: number, z: number) => { r: number; g: number; b: number };
  setDebugLight?: (on: boolean) => void;
  locate?: (
    kind: 'ore' | 'structure' | 'biome',
    id: string,
    near: [number, number, number],
  ) => [number, number, number] | null;
  worldHash?: (x1: number, z1: number, x2: number, z2: number) => string;
  setWorkerPoolSize?: (size: number) => void;
  getMainThreadGenCount?: () => number;
  resetMainThreadGenCount?: () => void;
  setRenderDistance?: (n: number) => number;
  getStreamingStats?: () => import('../../world/world-manager').WorldStreamingStats;
  resetFrameStats?: () => void;
  getFrameStats?: () => import('../../engine/frame-stats').FrameStatsSnapshot;
  getGlResourceCounts?: () => import('../../render/gl').ResourceCounts;
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
    cameraPosition: [number, number, number];
    cameraFov: number;
    cameraRoll: number;
    perspective: number;
    underwater: boolean;
    underwaterFog: [number, number];
    underwaterBrightnessFloor: number;
    playerModelParts: number;
    cloudWindOffset: number;
    weather: {
      state: 'clear' | 'rain' | 'thunder';
      activeParticles: {
        rain: number;
        snow: number;
      };
    };
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
  cameraPosition: [0, 0, 0] as [number, number, number],
  cameraFov: 70,
  cameraRoll: 0,
  perspective: 0,
  underwater: false,
  underwaterFog: [0, 0] as [number, number],
  underwaterBrightnessFloor: 0,
  playerModelParts: 0,
  cloudWindOffset: 0,
  weather: {
    state: 'clear' as 'clear' | 'rain' | 'thunder',
    activeParticles: {
      rain: 0,
      snow: 0,
    },
  },
};

// Set by main.ts in debug mode: reads pending WebGL errors into renderStats.glErrors.
let drainGlErrors: (() => void) | null = null;

export function setGlErrorDrain(fn: (() => void) | null): void {
  drainGlErrors = fn;
}

// Set by WorldManager: refreshes the stats that depend on streaming state (chunksLoaded, chunksMeshed).
let refreshRenderStats: (() => void) | null = null;

export function setRenderStatsRefresh(fn: (() => void) | null): void {
  refreshRenderStats = fn;
}

export const api: BlockCraftDebugAPI = {
  ready: () => readyPromise,
  getRenderStats: () => {
    if (refreshRenderStats) refreshRenderStats();
    // Count errors that no frame has drained yet, so a test that holds requestAnimationFrame
    // still sees them.
    if (drainGlErrors) drainGlErrors();
    return {
      ...renderStats,
      cameraPosition: [...renderStats.cameraPosition],
      underwaterFog: [...renderStats.underwaterFog],
      weather: {
        state: renderStats.weather.state,
        activeParticles: { ...renderStats.weather.activeParticles },
      },
    };
  },
};

export function markReady() {
  if (!isReady) {
    isReady = true;
    readyResolve();
  }
}
