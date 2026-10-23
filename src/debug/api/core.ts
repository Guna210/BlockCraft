export interface BlockCraftDebugAPI {
  ready(): Promise<void>;
  getSettings?: () => import('../../engine/settings').Settings;
  setSetting?: (
    key: keyof import('../../engine/settings').Settings,
    value: unknown,
  ) => import('../../engine/settings').Settings;
  resetSettings?: () => import('../../engine/settings').Settings;
  setFluidAnimationPaused?: (paused: boolean) => void;
  getFluidAnimation?: () => { paused: boolean; seconds: number; frame: number };
  giveItem?: (id: string, count: number) => void;
  getInventory?: () => Array<import('../../gameplay/inventory').ItemStack | null>;
  getInventoryCursor?: () => import('../../gameplay/inventory').CursorStack | null;
  selectHotbarSlot?: (slot: number) => void;
  setItemDamage?: (slot: number, damage: number) => void;
  openScreen?: (name: import('../../ui/ui-manager').ScreenName | 'none') => void;
  getScreen?: () => import('../../ui/ui-manager').ScreenSnapshot;
  /**
   * Main menu and panorama state: whether each is up, how often the panorama has started, what its
   * last teardown left behind, and GPU columns with meshes that are not in the loaded world.
   */
  getMenuState?: () => {
    menuVisible: boolean;
    panorama: boolean;
    panoramaStarts: number;
    lastTeardown: import('../../world/world-manager').PanoramaTeardown | null;
    sectionMeshes: number;
    meshedColumns: number;
    meshedColumnsOutsideWorld: number;
  };
  kill?: (id: number) => void;
  uiClickSlot?: (slot: number, button: 'left' | 'right', shift?: boolean) => void;
  /** Spawns a registered entity type ('item:<itemId>' drops one item) and returns its id. */
  spawn?: (type: string, x: number, y: number, z: number) => number;
  /** Item entities and ECS entities together, sorted by id. */
  getEntities?: {
    (filter: {
      type: 'item';
      radius?: number;
    }): import('../../entity/item-entity').EntitySnapshot[];
    (filter?: {
      type?: string;
      radius?: number;
    }): Array<
      | import('../../entity/item-entity').EntitySnapshot
      | import('../../entity/ecs/systems').EcsEntitySnapshot
    >;
  };
  /** AI state of an ECS mob: running goal, target (0 = player), path length, love and i-frames. */
  getEntityAI?: (id: number) => import('../../entity/ai/runtime').EntityAISnapshot;
  getProjectile?: (id: number) => {
    pos: [number, number, number];
    vel: [number, number, number];
    stuck: boolean;
    owner: number;
    kind: string;
  };
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
  placeShape?: (
    id: string,
    x: number,
    y: number,
    z: number,
    opts?: {
      face?: 'top' | 'bottom' | 'north' | 'south' | 'east' | 'west';
      hit?: [number, number, number];
      look?: [number, number];
    },
  ) => Array<{ x: number; y: number; z: number; block: string }> | null;
  toggleShape?: (x: number, y: number, z: number) => number;
  /** Uses the block as a player would: pulls a lever, presses a button, steps a note block. */
  useBlock?: (x: number, y: number, z: number) => boolean;
  /** Blocks currently sliding between cells (piston moves). */
  getMovingBlocks?: () => Array<{ x: number; y: number; z: number; blocks: string[] }>;
  /** Puts items into a dispenser; false when it has no room. */
  loadDispenser?: (x: number, y: number, z: number, id: string, count?: number) => boolean;
  /** Note block tones emitted since the world was created. */
  getTones?: () => Array<{ x: number; y: number; z: number; note: number; pitch: number }>;
  breakShape?: (x: number, y: number, z: number) => number;
  getInteraction?: () => {
    editFrame: number;
    meshFrame: number;
    meshRevision: number;
    progress: number;
    stage: number;
    heldBlock: string | null;
  };
  getPlayer?: () => import('../../entity/player').PlayerSnapshot;
  setXp?: (level: number, progress: number) => void;
  setVitals?: (vitals: {
    health?: number;
    hunger?: number;
    air?: number;
    saturation?: number;
  }) => void;
  teleport?: (x: number, y: number, z: number, yaw?: number, pitch?: number) => void;
  input?: (action: string, down: boolean) => void;
  pause?: () => void;
  resume?: () => void;
  tick?: (n: number) => Promise<void>;
  setGameMode?: (mode: 'survival' | 'creative') => void;
  setTimeOfDay?: (ticks: number) => void;
  getTimeOfDay?: () => number;
  getWorldTime?: () => number;
  setClouds?: (mode: 'fancy' | 'fast' | 'off') => void;
  setLeaves?: (mode: 'fancy' | 'fast') => void;
  setWeather?: (state: 'clear' | 'rain' | 'thunder') => void;
  look?: (yaw: number, pitch: number) => void;
  showTestScene?: () => Promise<void>;
  audio?: typeof import('./audio').audioApi;
  createWorld?: (opts?: {
    name?: string;
    seed?: string;
    mode?: 'survival' | 'creative';
    type?: 'default' | 'flat' | 'amplified' | 'single_biome';
    /** Single Biome only (an Appendix C overworld biome id); defaults to plains. */
    biome?: import('../../gen/biomes').OverworldBiomeId;
    /** Stored with the world; default true. */
    structures?: boolean;
    /** Places a chest of starting items next to the spawn; default false. */
    startingChest?: boolean;
  }) => Promise<void>;
  openWorldList?: () => Promise<void>;
  listWorlds?: () => Promise<Array<{ name: string; lastPlayed: number; hasThumbnail: boolean }>>;
  waitForTerrain?: (radiusChunks: number) => Promise<void>;
  loadWorld?: (name: string) => Promise<void>;
  save?: () => Promise<void>;
  /** Starts the incremental autosave now (it normally runs every 60 s); resolves when written. */
  autosaveNow?: () => Promise<void>;
  getSaveStats?: () => Promise<{
    stats: import('../../persist/save-manager').SaveStats;
    usage: {
      regions: Array<{ rx: number; rz: number; columns: number; bytes: number }>;
      blockEntities: number;
      totalBytes: number;
    } | null;
  }>;
  getBlockEntity?: (
    x: number,
    y: number,
    z: number,
  ) => { blockId: string; state: Record<string, unknown> } | null;
  /** The player's respawn point (null = world spawn); `set` replaces it. */
  spawnPoint?: (set?: [number, number, number] | null) => [number, number, number] | null;
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
  findPath?: (
    start: [number, number, number],
    goal: [number, number, number],
    options?: { height?: 1 | 2; maxNodes?: number },
  ) => import('../../entity/ai/pathfinding').PathResult;
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
