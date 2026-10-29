import { DropRenderer } from '../render/drops';
import { MovingBlockRenderer } from '../render/moving-blocks';
import { BlockSelectionRenderer } from '../render/block-selection';
import { PlayerModelRenderer } from '../render/player-model';
import { EntityRenderer } from '../render/entities';
import type { PlayerController } from '../engine/player-controller';
import { LightStorage, SKY_15_SECTION } from './lighting';
import { collectLightPadding } from './light-padding';
import type { ColumnLight, LightRect } from './batch-light';
import { columnKey } from './streaming-plan';
import { vec3, mat4 } from 'gl-matrix';
import { World } from './world';
import { setWorldInstance } from './world-instance';
import { ChunkSection } from './chunk';
import { WorkerPool } from '../mesh/worker-pool';
import { GenWorkerPool } from '../workers/gen-worker-pool';
import { LightWorkerPool } from '../workers/light-worker-pool';
import { createDefaultPipeline, TerrainPipeline } from '../gen/pipeline';
import { deriveSeed, hash2, hashString } from '../engine/rng';
import { OVERWORLD_BIOME_IDS, type OverworldBiomeId } from '../gen/biomes';
import {
  DEFAULT_WORLD_OPTIONS,
  normalizeWorldOptions,
  setTerrainVariant,
  withTerrainVariant,
  type TerrainVariant,
  type WorldOptions,
  type WorldType,
} from '../gen/world-options';
import { placeStartingChest } from '../gameplay/starting-chest';
import { applyStructureMarkers } from '../gameplay/structure-markers';
import { spawnerMiniatures } from '../gameplay/spawners';
import { STRUCTURE_REGISTRATIONS } from '../gen/structures/registrations';
import { UnderwaterView, UnderwaterTint } from '../render/underwater';
import { ChunkRenderer } from '../render/chunk-renderer';
import { SkyRenderer } from '../render/sky';
import { CloudRenderer } from '../render/clouds';
import { WeatherRenderer } from '../render/weather';
import { weatherManager, getWeather, resetWeather } from './weather';
import {
  getWorldTime,
  resetWorldTime,
  setWorldTime,
  skyAtmosphereFactors,
  skyLightMultiplier,
  sunDirection,
} from './time';
import { TextureAtlas, ATLAS_MAX_MIP } from '../render/atlas';
import { textureGenerators } from '../render/textures/index';
import { TextureData } from '../render/textures/noise';
import { createSentinelTile, SENTINEL_KEY } from '../render/texture-resolve';
import { BlockRegistry } from './blocks/registry';
import { buildMeshLookupTables, MeshLookupTables } from '../mesh/greedy';
import { collectBlockPadding, snapshotBlocks, type BlockColumnsSnapshot } from './block-snapshot';
import { findSpawnPoint } from './spawn';
import { readPlayerData } from '../persist/restore';
import {
  applyPlayerData,
  deserializeInventory,
  deserializePlayerData,
  serializeInventory,
  serializePlayerData,
} from '../persist/serializers';
import {
  DIMENSIONS,
  isDimensionId,
  otherDimension,
  scaleCoordinate,
  type DimensionId,
} from './dimension';
import {
  PortalGuard,
  PortalIndex,
  PortalTravel,
  findLinkedPortal,
  lightPortal,
  placeArrivalPortal,
  portalArrivalPoint,
  type PortalAxis,
  type PortalRecord,
} from './portals';
import { PortalRenderer, WarpOverlay } from '../render/portal';
import type { RayHit } from './raycast';
import { getToolDurability } from '../gameplay/tools';
import { SaveManager, type LoadedWorld, type RestoredColumn } from '../persist/save-manager';
import {
  applyEntityRecord,
  applyPlayerRecord,
  applyRestoredColumn,
  applyWorldRecord,
} from '../persist/restore';
import { Camera } from '../render/camera';
import { GLWrapper } from '../render/gl';
import { renderStats, setRenderStatsRefresh } from '../debug/api/core';
import { extractFrustumPlanes } from '../render/frustum';
import { frameStats } from '../engine/frame-stats';
import { settings, type LeavesSetting } from '../engine/settings';
import { Streamer, StreamerHost, StreamerView, StreamingStats } from './streamer';
import { MeshAttempts } from './mesh-attempts';
import { fadeStartFor } from '../render/column-fade';
import { clampRenderDistance } from './streaming-plan';
import type { GenResult } from '../workers/gen-worker-pool';
import type { MeshResult } from '../mesh/worker-pool';

/**
 * Columns generated (and, in createWorld, lit) beyond the radius that is meshed. A meshed section
 * needs all eight neighbour columns of its own column, so the ring is one column wide.
 */
const PERIMETER_RING = 1;

const FACE_OFFSETS: Readonly<Record<RayHit['face'], readonly [number, number, number]>> = {
  top: [0, 1, 0],
  bottom: [0, -1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
};

/** The world behind the main menu (decisions/M18a-menus.md). */
export const PANORAMA_SEED = 'blockcraft-panorama';
/** A valley of the panorama seed ringed by hills: land in nearly every direction. */
export const PANORAMA_CENTER = { x: -64, z: -224 } as const;
const PANORAMA_RENDER_DISTANCE = 4;
const PANORAMA_TIME = 6000;
const NO_ACTIVE_PARTICLES = { rain: 0, snow: 0 };

/** What a new world is created with: the debug `createWorld` options and the Create World screen. */
/** What the panorama left behind when it was torn down (read through the debug API). */
export interface PanoramaTeardown {
  /** GPU section meshes the panorama had just before teardown. */
  meshesBefore: number;
  /** Jobs still queued or running in each worker pool right after teardown. */
  genQueue: number;
  lightQueue: number;
  meshQueue: number;
  /** GPU section meshes and live GL buffers right after teardown. */
  sectionMeshes: number;
  glBuffers: number;
  /** Live GL buffers just before the panorama started streaming. */
  glBuffersAtStart: number;
}

export interface WorldStartOptions {
  name?: string;
  seed?: string;
  mode?: 'survival' | 'creative';
  type?: WorldType;
  /** Single Biome only: the biome everywhere. Defaults to plains. */
  biome?: OverworldBiomeId;
  /** Stored with the world for the structure stage; default on. */
  structures?: boolean;
  /** A chest of starting items next to the spawn; default off. */
  startingChest?: boolean;
  /** Natural creature spawning; default on. */
  spawning?: boolean;
}

/** Main-thread time per frame that may be spent uploading meshes. */
const UPLOAD_BUDGET_MS = 3;

/** A generation result, or a saved column standing in for one (`restored`). */
type StreamedGenResult = GenResult & { restored?: RestoredColumn };

/**
 * The steps that store a generation result in a world column: the column with its biome data, then
 * one step per section. The streamer runs them a few milliseconds at a time.
 */
function applyGenSteps(world: World, res: GenResult, queueForSpawning: boolean): Array<() => void> {
  const restored = (res as StreamedGenResult).restored;
  if (restored) {
    // A saved column replaces generation: it is adopted whole, with its block entities and ticks.
    return [
      () => applyRestoredColumn(world, restored),
      () => weatherManager.heightmap.updateColumn(world, res.cx, res.cz),
      () => world.current.settleRestored(),
      () => world.notifyColumnLoaded(res.cx, res.cz, false, queueForSpawning),
    ];
  }
  const steps: Array<() => void> = [
    () => {
      const col = world.getColumn(res.cx, res.cz, true)!;
      if (res.biomes) {
        col.setBiomeIndices(res.biomes, OVERWORLD_BIOME_IDS);
      }
      if (res.grassTints) {
        col.grassTints.set(res.grassTints);
      }
      if (res.foliageTints) {
        col.foliageTints.set(res.foliageTints);
      }
    },
  ];
  for (const secData of res.sections) {
    steps.push(() => {
      const col = world.getColumn(res.cx, res.cz, true)!;
      const sec = col.getOrCreateSection(secData.sy);
      if (sec) {
        if (secData.packed) {
          sec.adoptPackedStorage(secData.packed);
        } else if (secData.states) {
          sec.loadBlockStatesFrom(secData.states);
        } else if (secData.uniformStateId !== null) {
          sec.fill(secData.uniformStateId);
        }
      }
    });
  }
  // Generated chests get their structure's loot and spawners their creature (M19c markers).
  const markers = res.markers;
  if (markers && markers.length > 0) steps.push(() => applyStructureMarkers(world, markers));
  steps.push(() => {
    weatherManager.heightmap.updateColumn(world, res.cx, res.cz);
  });
  // A generated column can complete the neighbourhood a restored column was waiting for.
  steps.push(() => world.current.settleRestored());
  steps.push(() => world.notifyColumnLoaded(res.cx, res.cz, true, queueForSpawning));
  return steps;
}

/**
 * The handle tests use to force a re-mesh (`pendingTerrainPromises.delete('cx,cz')` or `.clear()`).
 * The streamer owns column state now, so deleting a key marks that column's mesh stale and clearing
 * marks every meshed column stale; the streamer meshes them again as soon as they are wanted.
 */
class StaleMeshHandle extends Map<string, Promise<void>> {
  constructor(
    private readonly markStale: (cx: number, cz: number) => void,
    private readonly markAllStale: () => void,
  ) {
    super();
  }

  override delete(key: string): boolean {
    const parts = key.split(',');
    const cx = Number(parts[0]);
    const cz = Number(parts[1]);
    if (parts.length === 2 && Number.isInteger(cx) && Number.isInteger(cz)) this.markStale(cx, cz);
    return super.delete(key);
  }

  override clear(): void {
    this.markAllStale();
    super.clear();
  }
}

/** The streamer's counts plus the columns still fading in (the renderer owns the fades). */
export type WorldStreamingStats = StreamingStats & { columnsFading: number };

export class WorldManager {
  private static instance: WorldManager | null = null;

  public glWrapper: GLWrapper | null = null;
  public camera: Camera | null = null;
  public playerController: PlayerController | null = null;
  public world: World | null = null;
  public atlas: TextureAtlas | null = null;
  public atlasTexture: WebGLTexture | null = null;
  public chunkRenderer: ChunkRenderer | null = null;
  public readonly underwaterView = new UnderwaterView();
  private blockSelection: BlockSelectionRenderer | null = null;
  private underwaterTint: UnderwaterTint | null = null;
  public playerModelRenderer: PlayerModelRenderer | null = null;
  public skyRenderer: SkyRenderer | null = null;
  public cloudRenderer: CloudRenderer | null = null;
  public dropRenderer: DropRenderer | null = null;
  public entityRenderer: EntityRenderer | null = null;
  public movingBlockRenderer: MovingBlockRenderer | null = null;
  public weatherRenderer: WeatherRenderer | null = null;
  public workerPool: WorkerPool;
  public genWorkerPool: GenWorkerPool;
  public lightWorkerPool: LightWorkerPool;
  public pipeline: TerrainPipeline;
  public tables: MeshLookupTables | null = null;
  private tileResolver: ((texName: string) => number) | null = null;
  private tablesFastLeaves = false;

  public readonly saves = new SaveManager();

  /** The dimension the player is in; only its world exists, streams and ticks. */
  public dimension: DimensionId = 'overworld';
  /** Each dimension's portals; saved with that dimension's entities record. */
  public readonly portalIndices: Readonly<Record<DimensionId, PortalIndex>> = {
    overworld: new PortalIndex(),
    hollowdeep: new PortalIndex(),
  };
  public readonly portalTravel = new PortalTravel();
  /** Completed dimension changes since the page loaded. */
  public dimensionChanges = 0;
  /** The dimension change in progress, if any. */
  public dimensionChange: Promise<PortalRecord> | null = null;
  private portalGuard: PortalGuard | null = null;
  private portalRenderer: PortalRenderer | null = null;
  private warpOverlay: WarpOverlay | null = null;

  public worldSeedStr: string = 'blockcraft-test-seed-42';
  public worldSeed: number = hashString('blockcraft-test-seed-42');
  public worldType: WorldType = 'default';
  public worldOptions: WorldOptions = { ...DEFAULT_WORLD_OPTIONS };
  private spawning = true;
  public mainThreadGenCount: number = 0;

  /** True while `world` is the main-menu panorama rather than a played world. */
  public panorama = false;
  /** How many times the panorama has started streaming since the page loaded. */
  public panoramaStarts = 0;
  public lastPanoramaTeardown: PanoramaTeardown | null = null;
  private panoramaGlBuffersAtStart = 0;
  // The render distance chosen for played worlds while the panorama streams at its own.
  private panoramaSavedRenderDistance: number | null = null;
  /** Called whenever a world starts (or a test takes over the renderer); main.ts hides the menu. */
  public onLeaveMenu: (() => void) | null = null;

  // Re-mesh handle for tests, see StaleMeshHandle.
  public readonly pendingTerrainPromises: Map<string, Promise<void>> = new StaleMeshHandle(
    (cx, cz) => this.streamer.invalidate(cx, cz),
    () => this.streamer.invalidateAll(),
  );

  // Owns the state of every column and decides what is generated, meshed, uploaded and freed.
  public readonly streamer: Streamer<GenResult, MeshResult>;

  // Per column ("cx,cz"): the section meshes ("sx,sy,sz") uploaded by its open mesh attempt.
  private readonly meshAttempts = new MeshAttempts();

  // Main-thread time the latest render() spent uploading meshes, read by the frame loop.
  public lastUploadMs = 0;

  private readonly viewProj = mat4.create();
  private readonly frustumPlanes = new Float64Array(24);

  // Bumped every time `this.world` is replaced. Asynchronous results (generation, light, mesh)
  // carry the epoch they were requested in and are dropped when it no longer matches.
  private worldEpoch = 0;
  public lightBatchTimes: Array<{
    columns: number;
    workerMs: number;
    mainMs: number;
    maxSliceMs: number;
    copySliceMaxMs: number;
    commitSliceMaxMs: number;
  }> = [];

  // Number of createWorld calls that have not finished. While it is non-zero the frame loop draws
  // sky-clear frames only: every frame that draws freshly uploaded terrain takes tens to hundreds of
  // milliseconds of main-thread time under software rendering, and the rendering task outranks the
  // worker message tasks that carry the generation, light and mesh results (decisions/M02c-fix-load-path.md).
  private initialLoadCount = 0;
  public terrainFrames = 0;
  private editSerial = 0;
  private readonly editMeshes: Array<{ result: MeshResult; serial: number; primary: boolean }> = [];
  private readonly editVersions = new Map<string, number>();
  private readonly editMeshStarters: Array<() => void> = [];
  public interactionEditFrame = -1;
  public interactionMeshFrame = -1;
  public interactionMeshRevision = 0;
  public requestInteractionMesh(x: number, y: number, z: number): void {
    const world = this.world,
      tables = this.tables;
    if (!world || !tables) return;
    this.interactionEditFrame = this.terrainFrames;
    this.interactionMeshFrame = -1;
    const serial = ++this.editSerial,
      epoch = this.worldEpoch;
    const cx = Math.floor(x / 16),
      sy = Math.floor(y / 16),
      cz = Math.floor(z / 16);
    const sections = [[cx, sy, cz]];
    if ((x & 15) === 0) sections.push([cx - 1, sy, cz]);
    if ((x & 15) === 15) sections.push([cx + 1, sy, cz]);
    if ((z & 15) === 0) sections.push([cx, sy, cz - 1]);
    if ((z & 15) === 15) sections.push([cx, sy, cz + 1]);
    if ((y & 15) === 0 && sy > 0) sections.push([cx, sy - 1, cz]);
    if ((y & 15) === 15 && sy < 19) sections.push([cx, sy + 1, cz]);
    for (const [sx, sectionY, sz] of sections) {
      if (!world.hasColumn(sx!, sz!)) continue;
      const key = `${sx},${sectionY},${sz}`;
      this.editVersions.set(key, serial);
      void this.workerPool
        .enqueueMeshJob(
          sx!,
          sectionY!,
          sz!,
          collectBlockPadding(world, sx!, sectionY!, sz!),
          tables,
          false,
          collectLightPadding(world, sx!, sectionY!, sz!),
        )
        .then((result) => {
          if (epoch === this.worldEpoch && this.editVersions.get(key) === serial)
            this.editMeshes.push({
              result,
              serial,
              primary: sx === cx && sectionY === sy && sz === cz,
            });
        });
    }
  }

  /** One coalesced worker mesh per affected section, with snapshots spread over frame slices. */
  private requestBatchMeshes(sections: readonly [number, number, number][]): void {
    const world = this.world,
      tables = this.tables;
    if (!world || !tables) return;
    const serial = ++this.editSerial,
      epoch = this.worldEpoch;
    for (const [cx, sy, cz] of sections) {
      const key = `${cx},${sy},${cz}`;
      this.editVersions.set(key, serial);
      this.editMeshStarters.push(() => {
        if (epoch !== this.worldEpoch || this.editVersions.get(key) !== serial) return;
        if (!world.hasColumn(cx, cz)) {
          this.editVersions.delete(key);
          return;
        }
        void this.workerPool
          .enqueueMeshJob(
            cx,
            sy,
            cz,
            collectBlockPadding(world, cx, sy, cz),
            tables,
            false,
            collectLightPadding(world, cx, sy, cz),
          )
          .then((result) => {
            if (epoch !== this.worldEpoch || this.editVersions.get(key) !== serial) return;
            if (!world.hasColumn(cx, cz)) {
              this.editVersions.delete(key);
              return;
            }
            this.editMeshes.push({ result, serial, primary: false });
          });
      });
    }
  }

  // Set by main.ts in debug mode: reads pending WebGL errors after the synchronous terrain frame.
  public drainGlErrors: (() => void) | null = null;

  public static getInstance(): WorldManager {
    if (!WorldManager.instance) {
      WorldManager.instance = new WorldManager();
    }
    return WorldManager.instance;
  }

  private constructor() {
    // Each stage owns real workers at its SPEC/master default capacity.
    this.workerPool = new WorkerPool();
    this.genWorkerPool = new GenWorkerPool();
    this.lightWorkerPool = new LightWorkerPool();
    this.pipeline = createDefaultPipeline(STRUCTURE_REGISTRATIONS);
    this.streamer = new Streamer<GenResult, MeshResult>(this.makeStreamerHost());
    this.portalTravel.onTravel = (portal) => {
      void this.travelThroughPortal(portal);
    };
    // Not streaming until a world exists (createWorld) and while tests drive an empty world by hand.
    this.streamer.active = false;
    this.updateStreamerLimits();
    setRenderStatsRefresh(() => {
      if (this.camera) {
        renderStats.cameraPosition[0] = this.camera.position[0];
        renderStats.cameraPosition[1] = this.camera.position[1];
        renderStats.cameraPosition[2] = this.camera.position[2];
        renderStats.cameraFov = (this.camera.fov * 180) / Math.PI;
        renderStats.cameraRoll = this.camera.roll;
      }
      renderStats.perspective = this.playerController?.perspective ?? 0;
      renderStats.underwater = this.underwaterView.submerged;
      renderStats.underwaterFog[0] = this.underwaterView.submerged
        ? this.underwaterView.fogStart
        : 0;
      renderStats.underwaterFog[1] = this.underwaterView.submerged ? this.underwaterView.fogEnd : 0;
      renderStats.underwaterBrightnessFloor = this.underwaterView.brightnessFloor;
      renderStats.playerModelParts = this.playerModelRenderer?.lastPartDraws ?? 0;
      renderStats.chunksLoaded = this.streamer.loadedColumns;
      renderStats.chunksMeshed = this.streamer.meshedColumns;
      renderStats.weather.state = getWeather();
      if (this.weatherRenderer && this.camera && this.world) {
        renderStats.weather.activeParticles = this.weatherRenderer.getActiveParticleCounts(
          this.camera.position,
          this.world,
          getWorldTime() / 20.0,
        );
      } else {
        renderStats.weather.activeParticles = { rain: 0, snow: 0 };
      }
    });
  }

  /** A saved column if the world has one at (cx, cz), otherwise generation from the seed. */
  private requestColumn(cx: number, cz: number): Promise<GenResult> {
    const saved = this.saves.has(cx, cz) ? this.saves.restoreColumn(cx, cz) : null;
    if (saved) {
      return saved.then(
        (restored): StreamedGenResult => ({
          cx,
          cz,
          sections: [],
          biomes: restored.column.biomeIndices,
          grassTints: restored.column.grassTints,
          foliageTints: restored.column.foliageTints,
          columnMs: 0,
          sectionCount: 0,
          perSectionMs: 0,
          restored,
        }),
        (error) => {
          // A column that cannot be read is regenerated rather than leaving a hole in the world.
          console.warn(`[saves] column ${cx},${cz} unreadable, regenerating:`, error);
          return this.genWorkerPool.enqueueGenJob(
            this.worldSeed,
            cx,
            cz,
            this.terrainVariant,
            this.worldOptions.structures,
            this.dimension,
          );
        },
      );
    }
    return this.genWorkerPool.enqueueGenJob(
      this.worldSeed,
      cx,
      cz,
      this.terrainVariant,
      this.worldOptions.structures,
      this.dimension,
    );
  }

  /** The generator variant of the open world: its type and, for Single Biome, its biome. */
  public get terrainVariant(): TerrainVariant {
    return this.worldType === 'single_biome'
      ? { type: 'single_biome', biome: this.worldOptions.biome ?? 'plains' }
      : { type: this.worldType };
  }

  /** Sets the open world's type and options and the main thread's generator variant to match. */
  private setWorldKind(type: WorldType, options: WorldOptions): void {
    this.worldType = type;
    this.worldOptions =
      type === 'single_biome' ? { ...options, biome: options.biome ?? 'plains' } : { ...options };
    if (type !== 'single_biome') delete this.worldOptions.biome;
    setTerrainVariant(this.terrainVariant);
    this.pipeline = createDefaultPipeline(
      this.worldOptions.structures ? STRUCTURE_REGISTRATIONS : [],
    );
  }

  /** What the streamer needs from the world, the worker pools and the GPU. */
  private makeStreamerHost(): StreamerHost<GenResult, MeshResult> {
    return {
      requestGen: (cx, cz) => this.requestColumn(cx, cz),
      applyGen: (_cx, _cz, res) => {
        const world = this.world;
        if (!world) return [];
        return applyGenSteps(world, res, this.spawning);
      },
      requestLight: (columns) => this.requestColumnLight(columns),
      requestMesh: (cx, cz) => this.requestColumnMesh(cx, cz),
      uploadSection: (cx, cz, res) => {
        if (!this.chunkRenderer) return;
        // Nothing is shown until a createWorld or waitForTerrain request is done, so the sections it
        // uploads appear at full opacity; any other column fades in (decisions/M04b-fade-and-memory.md).
        const fadeFromMs = fadeStartFor(this.loadPending, performance.now());
        this.chunkRenderer.uploadSectionMesh(res.sx, res.sy, res.sz, res.meshData, fadeFromMs);
        this.meshAttempts.uploaded(`${cx},${cz}`, `${res.sx},${res.sy},${res.sz}`);
        // The column's tint textures are created with its upload, not in the first frame that draws it.
        this.chunkRenderer.prepareColumnTints(cx, cz, this.world);
      },
      beginMeshAttempt: (cx, cz) => {
        this.meshAttempts.begin(`${cx},${cz}`);
      },
      endMeshAttempt: (cx, cz) => {
        const uploaded = this.meshAttempts.end(`${cx},${cz}`);
        return this.chunkRenderer?.removeColumnMeshesExcept(cx, cz, uploaded) ?? false;
      },
      abandonMeshAttempt: (cx, cz) => {
        this.meshAttempts.abandon(`${cx},${cz}`);
      },
      freeMesh: (cx, cz) => {
        this.meshAttempts.abandon(`${cx},${cz}`);
        this.chunkRenderer?.removeColumnMeshes(cx, cz);
      },
      freeMeshStep: (cx, cz) => {
        this.meshAttempts.abandon(`${cx},${cz}`);
        return this.chunkRenderer?.removeColumnMeshStep(cx, cz) ?? true;
      },
      freeData: (cx, cz) => {
        this.meshAttempts.abandon(`${cx},${cz}`);
        // A column that changed is stored before it goes, so walking away never loses an edit.
        if (this.world) this.saves.onColumnUnload(this.world, cx, cz);
        this.world?.removeColumn(cx, cz);
        weatherManager.heightmap.removeColumn(cx, cz);
      },
      now: () => performance.now(),
      recordSlice: (ms) => frameStats.recordPump(ms),
      setWorkPriorities: (priorities) => {
        this.workerPool.setWorkPriorities(priorities);
        this.genWorkerPool.setWorkPriorities(priorities);
        this.lightWorkerPool.setWorkPriorities(priorities);
      },
      uploadPriority: (mesh) => Math.abs(mesh.sy * 16 + 8 - (this.camera?.position[1] ?? 0)),
    };
  }

  private configureLighting(world: World): void {
    world.lightEngine.onlyLitColumns = true;
    world.listeners.add({
      blocksRemoved: (blocks, touchedSections) => {
        weatherManager.heightmap.blocksRemoved(world, blocks);
        const sections = new Map<number, [number, number, number]>();
        const add = (cx: number, sy: number, cz: number) => {
          if (sy < 0 || sy > 19 || !world.hasColumn(cx, cz)) return;
          sections.set(LightStorage.getSectionKey(cx, sy, cz), [cx, sy, cz]);
        };
        const borderColumns = new Set<number>();
        for (const b of blocks) {
          const cx = Math.floor(b.x / 16),
            sy = b.y >> 4,
            cz = Math.floor(b.z / 16);
          const xs = [cx],
            ys = [sy],
            zs = [cz];
          if ((b.x & 15) === 0) xs.push(cx - 1);
          if ((b.x & 15) === 15) xs.push(cx + 1);
          if ((b.y & 15) === 0) ys.push(sy - 1);
          if ((b.y & 15) === 15) ys.push(sy + 1);
          if ((b.z & 15) === 0) zs.push(cz - 1);
          if ((b.z & 15) === 15) zs.push(cz + 1);
          for (const x of xs) for (const y of ys) for (const z of zs) add(x, y, z);
          for (let dz = -1; dz <= 1; dz++)
            for (let dx = -1; dx <= 1; dx++)
              if (!world.lightEngine.isLit(cx + dx, cz + dz)) borderColumns.add(columnKey(cx, cz));
        }
        for (const key of touchedSections) {
          const column = Math.floor(key / 32),
            sy = key % 32;
          const cx = Math.floor(column / 65536) - 32768,
            cz = (column % 65536) - 32768;
          for (let dy = -1; dy <= 1; dy++)
            for (let dz = -1; dz <= 1; dz++)
              for (let dx = -1; dx <= 1; dx++) {
                const x = cx + dx,
                  y = sy + dy,
                  z = cz + dz;
                const section = world.getColumn(x, z, false)?.getSection(y);
                if (section && !(section.getBitsPerEntry() === 0 && section.uniformStateId === 0))
                  add(x, y, z);
              }
        }
        for (const [cx, , cz] of sections.values()) {
          const phase = this.streamer.phaseOf(cx, cz);
          if (phase === 'lighting' || phase === 'queuedLight') borderColumns.add(columnKey(cx, cz));
        }
        for (const key of borderColumns)
          this.streamer.invalidateLight(Math.floor(key / 65536) - 32768, (key % 65536) - 32768);
        this.requestBatchMeshes(
          [...sections.values()].filter(
            ([cx, , cz]) =>
              !borderColumns.has(columnKey(cx, cz)) && world.lightEngine.isLit(cx, cz),
          ),
        );
      },
    });
    world.onBlockEdited = (x, y, z, _state, batched) => {
      if (batched) return; // The batch listener handles weather and mesh/light invalidation once.
      weatherManager.heightmap.updateBlock(world, x, y, z);
      const cx = Math.floor(x / 16);
      const cz = Math.floor(z / 16);
      // A worker snapshot also depends on the unlit block border, where incremental BFS does not
      // write. Refresh the nearby columns whose snapshot or skirt can depend on this edit.
      const affected = new Set<number>();
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) affected.add(columnKey(cx + dx, cz + dz));
      for (const key of world.lightEngine.storage.touchedSections) {
        affected.add(Math.floor(key / 32));
      }
      for (const column of affected)
        this.streamer.invalidateLight(Math.floor(column / 65536) - 32768, (column % 65536) - 32768);
      if ((x & 15) === 0) this.streamer.invalidate(cx - 1, cz);
      if ((x & 15) === 15) this.streamer.invalidate(cx + 1, cz);
      if ((z & 15) === 0) this.streamer.invalidate(cx, cz - 1);
      if ((z & 15) === 15) this.streamer.invalidate(cx, cz + 1);
    };
  }

  private async copyLightColumns(bounds: LightRect) {
    const captureStart = performance.now();
    const blocks: BlockColumnsSnapshot = {};
    let sliceStart = captureStart;
    let workMs = 0;
    let maxSliceMs = 0;
    for (let cz = bounds.minCZ; cz <= bounds.maxCZ; cz++)
      for (let cx = bounds.minCX; cx <= bounds.maxCX; cx++) {
        const column = this.world?.getColumn(cx, cz, false);
        if (!column) throw new Error(`Light block data missing for ${cx},${cz}`);
        const sections: BlockColumnsSnapshot[string] = [];
        blocks[`${cx},${cz}`] = sections;
        for (let sy = 0; sy < 20; sy++) {
          sections.push(snapshotBlocks(column.getSection(sy)));
          const elapsed = performance.now() - sliceStart;
          if (elapsed >= 1) {
            workMs += elapsed;
            maxSliceMs = Math.max(maxSliceMs, elapsed);
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            sliceStart = performance.now();
          }
        }
      }
    const elapsed = performance.now() - sliceStart;
    return { blocks, workMs: workMs + elapsed, maxSliceMs: Math.max(maxSliceMs, elapsed) };
  }

  private commitColumnLight(world: World, column: ColumnLight): void {
    const engine = world.lightEngine;
    engine.storage.removeColumn(column.cx, column.cz);
    for (const channel of engine.rgbChannels) channel.storage.removeColumn(column.cx, column.cz);
    for (const section of column.sections) {
      if (section.lightData === 0xf0) engine.storage.setRawDataByKey(section.key, SKY_15_SECTION);
      else if (section.lightData instanceof Uint8Array)
        engine.storage.setRawDataByKey(section.key, section.lightData);
      for (let c = 0; c < 3; c++) {
        const raw = section.rgb?.[c];
        if (raw) engine.rgbChannels[c]!.storage.setRawDataByKey(section.key, raw);
      }
    }
    engine.skirts.set(columnKey(column.cx, column.cz), {
      height: column.height,
      data: column.skirt,
    });
    engine.markLit(column.cx, column.cz);
  }

  private async requestColumnLight(columns: Array<{ cx: number; cz: number }>) {
    const world = this.world!;
    const interior = {
      minCX: Math.min(...columns.map((c) => c.cx)),
      maxCX: Math.max(...columns.map((c) => c.cx)),
      minCZ: Math.min(...columns.map((c) => c.cz)),
      maxCZ: Math.max(...columns.map((c) => c.cz)),
    };
    const bounds = {
      minCX: interior.minCX - 1,
      maxCX: interior.maxCX + 1,
      minCZ: interior.minCZ - 1,
      maxCZ: interior.maxCZ + 1,
    };
    const { blocks, workMs: copiedMs, maxSliceMs } = await this.copyLightColumns(bounds);
    const result = await this.lightWorkerPool.enqueueBatch(bounds, interior, blocks);
    const timing = {
      columns: columns.length,
      workerMs: result.duration ?? 0,
      mainMs: copiedMs,
      maxSliceMs,
      copySliceMaxMs: maxSliceMs,
      commitSliceMaxMs: 0,
    };
    this.lightBatchTimes.push(timing);
    if (this.lightBatchTimes.length > 100) this.lightBatchTimes.shift();
    return (result.columns ?? []).map((column) => ({
      cx: column.cx,
      cz: column.cz,
      apply: () => {
        const commitStart = performance.now();
        this.commitColumnLight(world, column);
        const elapsed = performance.now() - commitStart;
        timing.mainMs += elapsed;
        timing.maxSliceMs = Math.max(timing.maxSliceMs, elapsed);
        timing.commitSliceMaxMs = Math.max(timing.commitSliceMaxMs, elapsed);
      },
    }));
  }

  /** In-flight work is bounded by the pool sizes, so queued work stays in the streamer, in priority order. */
  private updateStreamerLimits(): void {
    this.streamer.limits.maxGenInFlight = Math.max(4, this.genWorkerPool.workerCount * 8);
    this.streamer.limits.maxMeshColumnsInFlight = Math.max(4, this.workerPool.workerCount * 2);
  }

  public setWorkerPoolSize(size: number): void {
    this.genWorkerPool.setPoolSize(size);
    this.lightWorkerPool.setPoolSize(size);
    // The old pool dropped its queued and running generation jobs without answering them.
    this.streamer.abandonGenerations();
    this.streamer.abandonLights();
    this.updateStreamerLimits();
  }

  public get renderDistance(): number {
    return this.streamer.renderDistance;
  }

  /** Sets the render distance (rounded, clamped to 2..32), re-plans at once and returns the value used. */
  public setRenderDistance(n: number): number {
    if (this.panorama) {
      // The panorama keeps its own distance; the chosen one applies to the next played world.
      this.panoramaSavedRenderDistance = clampRenderDistance(n);
      return this.panoramaSavedRenderDistance;
    }
    return this.streamer.setRenderDistance(clampRenderDistance(n));
  }

  /**
   * Starts streaming the main-menu panorama: an unsaved world of the panorama seed at render
   * distance 4, noon, with nothing simulated. The menu turns the camera (main.ts).
   */
  public startPanorama(): void {
    if (this.panorama || this.world || !this.camera) return;
    this.panorama = true;
    this.panoramaStarts++;
    this.saves.detach();
    resetWorldTime();
    setWorldTime(PANORAMA_TIME);
    resetWeather();
    this.worldSeedStr = PANORAMA_SEED;
    this.worldSeed = hashString(PANORAMA_SEED);
    this.setWorldKind('default', { ...DEFAULT_WORLD_OPTIONS });
    this.worldEpoch++;
    this.chunkRenderer?.clearAllMeshes();
    this.meshAttempts.clear();
    this.panoramaGlBuffersAtStart = this.glWrapper?.getCounts().buffers ?? 0;
    this.resetDimensions('overworld');
    const world = new World();
    this.world = world;
    this.configureLighting(world);
    world.worldSeed = this.worldSeed;
    world.worldType = this.worldType;
    // Not the debug API's world: debug calls made in the menu keep addressing their own world.
    this.panoramaSavedRenderDistance = this.streamer.renderDistance;
    this.streamer.setRenderDistance(PANORAMA_RENDER_DISTANCE);
    this.streamer.reset(Math.floor(PANORAMA_CENTER.x / 16), Math.floor(PANORAMA_CENTER.z / 16));
    this.streamer.active = true;
    this.streamer.backgroundEnabled = true;
    this.updateStreamerLimits();
  }

  /**
   * Tears the panorama down completely: queued and running generation, light and mesh jobs are
   * cancelled, its columns and GPU buffers freed, and the render distance restored.
   */
  public stopPanorama(): void {
    if (!this.panorama) return;
    this.panorama = false;
    const meshesBefore = this.chunkRenderer?.sectionMeshCount ?? 0;
    this.worldEpoch++;
    this.streamer.reset();
    this.streamer.active = false;
    this.genWorkerPool.cancelAll();
    this.lightWorkerPool.cancelAll();
    this.workerPool.cancelAll();
    this.updateStreamerLimits();
    this.chunkRenderer?.clearAllMeshes();
    this.meshAttempts.clear();
    this.lastPanoramaTeardown = {
      meshesBefore,
      genQueue: this.genWorkerPool.queueLength,
      lightQueue: this.lightWorkerPool.queueLength,
      meshQueue: this.workerPool.queueLength,
      sectionMeshes: this.chunkRenderer?.sectionMeshCount ?? 0,
      glBuffers: this.glWrapper?.getCounts().buffers ?? 0,
      glBuffersAtStart: this.panoramaGlBuffersAtStart,
    };
    resetWeather();
    this.world = null;
    this.setWorldKind('default', { ...DEFAULT_WORLD_OPTIONS });
    if (this.panoramaSavedRenderDistance !== null)
      this.streamer.setRenderDistance(this.panoramaSavedRenderDistance);
    this.panoramaSavedRenderDistance = null;
    resetWorldTime();
  }

  /** A world is starting: the panorama goes and the menu hides. */
  public leaveMenu(): void {
    this.stopPanorama();
    this.onLeaveMenu?.();
  }

  /**
   * Pause menu "Save & Quit": saves the open world, then lets go of it entirely (player, columns,
   * meshes), leaving the renderer empty for the main menu.
   */
  public async quitToMenu(): Promise<void> {
    if (this.panorama) return;
    await this.exitWorld();
    this.worldEpoch++;
    this.streamer.reset();
    this.streamer.active = false;
    this.genWorkerPool.cancelAll();
    this.lightWorkerPool.cancelAll();
    this.workerPool.cancelAll();
    this.updateStreamerLimits();
    this.editMeshStarters.length = 0;
    this.editMeshes.length = 0;
    this.editVersions.clear();
    this.playerController?.reset();
    this.chunkRenderer?.clearAllMeshes();
    this.meshAttempts.clear();
    this.world = null;
    this.resetDimensions('overworld');
    this.setWorldKind('default', { ...DEFAULT_WORLD_OPTIONS });
    resetWorldTime();
    resetWeather();
  }

  /** A createWorld or a region request (waitForTerrain) is waiting: its columns are not shown yet. */
  private get loadPending(): boolean {
    return this.initialLoadCount > 0 || this.streamer.requestPending;
  }

  public getStreamingStats(): WorldStreamingStats {
    return {
      ...this.streamer.getStats(),
      columnsFading: this.chunkRenderer?.fadingColumns(performance.now()) ?? 0,
    };
  }

  /** Debug controls also present a frame when the normal frame loop is suspended. */
  public setDebugLight(on: boolean): void {
    this.chunkRenderer?.setDebugLight(on);
    this.drawTerrainFrame();
  }

  /** Sets world time in ticks and presents a frame immediately if terrain is loaded. */
  public setTimeOfDay(ticks: number): void {
    setWorldTime(ticks);
    this.chunkRenderer?.setSkyBrightness(skyLightMultiplier(getWorldTime()));
    if (this.world && this.initialLoadCount === 0) {
      this.drawTerrainFrame();
    }
  }

  public resetMainThreadGenCount(): void {
    this.mainThreadGenCount = 0;
  }

  public resetWorldToEmpty(seed = 'blockcraft-test-seed-42', type: WorldType = 'default'): void {
    this.leaveMenu();
    // A hand-built test world is thrown away, not saved.
    this.saves.detach();
    resetWorldTime();
    resetWeather();
    this.editMeshStarters.length = 0;
    this.editMeshes.length = 0;
    this.editVersions.clear();
    this.playerController?.reset();
    this.worldSeedStr = seed;
    this.worldSeed = hashString(seed);
    this.setWorldKind(type, { ...DEFAULT_WORLD_OPTIONS });
    this.worldEpoch++;
    this.lightBatchTimes = [];
    this.chunkRenderer?.clearAllMeshes();
    this.meshAttempts.clear();
    this.world = new World();
    this.configureLighting(this.world);
    this.resetDimensions('overworld');
    this.attachPortals(this.world);
    this.world.worldSeed = this.worldSeed;
    this.world.worldType = this.worldType;
    setWorldInstance(this.world);
    this.mainThreadGenCount = 0;
    // Tests build this world by hand (generateColumnMainThread): nothing streams into it.
    this.streamer.reset();
    this.streamer.active = false;
  }

  public generateColumnMainThread(cx: number, cz: number): void {
    if (!this.world) return;
    this.mainThreadGenCount++;
    const col = this.world.getColumn(cx, cz, true)!;
    col.worldSeed = this.worldSeed;
    if (this.worldType === 'flat') {
      const registry = BlockRegistry.getInstance();
      const stoneState = registry.getDefaultStateId('stone') ?? 1;
      const dirtState = registry.getDefaultStateId('dirt') ?? 1;
      const grassState = registry.getDefaultStateId('grass_block') ?? 1;
      for (let sy = 0; sy < 3; sy++) {
        const sec = col.getOrCreateSection(sy);
        if (sec) sec.fill(stoneState);
      }
      const sec3 = col.getOrCreateSection(3);
      if (sec3) {
        for (let yLocal = 0; yLocal <= 12; yLocal++) {
          for (let z = 0; z < 16; z++) {
            for (let x = 0; x < 16; x++) sec3.setBlockStateId(x, yLocal, z, stoneState);
          }
        }
        for (let yLocal = 13; yLocal <= 15; yLocal++) {
          for (let z = 0; z < 16; z++) {
            for (let x = 0; x < 16; x++) sec3.setBlockStateId(x, yLocal, z, dirtState);
          }
        }
      }
      const sec4 = col.getOrCreateSection(4);
      if (sec4) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) sec4.setBlockStateId(x, 0, z, grassState);
        }
      }
      const structureStage = this.pipeline.getStages().find((stage) => stage.name === 'structures');
      withTerrainVariant(this.terrainVariant, () =>
        structureStage?.generate(deriveSeed(this.worldSeed, 'structures'), cx, cz, col),
      );
    } else {
      this.pipeline.generateColumn(this.worldSeed, cx, cz, col, this.terrainVariant);
    }
    applyStructureMarkers(this.world, this.pipeline.takeStructureMarkers(cx, cz));

    weatherManager.heightmap.updateColumn(this.world, cx, cz);
    this.streamer.adoptColumn(cx, cz);
  }

  public initGL(glWrapper: GLWrapper, camera: Camera): void {
    this.glWrapper = glWrapper;
    this.camera = camera;

    // 1. Build Atlas & Sentinel
    const tiles = new Map<string, TextureData>();
    for (const [name, generator] of Object.entries(textureGenerators)) {
      const res = generator(42);
      if (Array.isArray(res)) {
        res.forEach((frame, idx) => {
          tiles.set(`${name}_${idx}`, frame);
        });
      } else {
        tiles.set(name, res);
      }
    }
    tiles.set(SENTINEL_KEY, createSentinelTile());

    if (tiles.size >= 4096) throw new Error('Texture atlas reached the packed vertex tile limit');
    this.atlas = new TextureAtlas(tiles);
    renderStats.textureAtlasSize = [this.atlas.width, this.atlas.height];

    // 2. Upload Atlas Texture to WebGL
    const gl = this.glWrapper.gl;
    this.atlasTexture = this.glWrapper.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);

    for (let k = 0; k <= ATLAS_MAX_MIP; k++) {
      const w = this.atlas.width >> k;
      const h = this.atlas.height >> k;
      gl.texImage2D(
        gl.TEXTURE_2D,
        k,
        gl.RGBA,
        w,
        h,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.atlas.mips[k]!,
      );
    }

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, ATLAS_MAX_MIP);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // 3. Build Lookup Tables for Mesher
    const registry = BlockRegistry.getInstance();

    // Map texture name to tileIndex
    const tileNameToIndex = new Map<string, number>();
    let cellIdx = 0;
    for (const tileName of tiles.keys()) {
      tileNameToIndex.set(tileName, cellIdx++);
    }

    const tileResolver = (texName: string): number => {
      let idx = tileNameToIndex.get(texName);
      if (idx === undefined && tileNameToIndex.has(`${texName}_0`)) {
        idx = tileNameToIndex.get(`${texName}_0`);
      }
      if (idx !== undefined) {
        return idx;
      }
      if (!renderStats.missingTextures.includes(texName)) {
        renderStats.missingTextures.push(texName);
      }
      return tileNameToIndex.get(SENTINEL_KEY) ?? 0;
    };

    this.tileResolver = tileResolver;
    this.tablesFastLeaves = settings.leaves === 'fast';
    this.tables = buildMeshLookupTables(registry, tileResolver, {
      fastLeaves: this.tablesFastLeaves,
    });

    // 4. Sky & Chunk Renderers
    this.skyRenderer = new SkyRenderer(this.glWrapper);
    this.cloudRenderer = new CloudRenderer(this.glWrapper);
    this.underwaterTint = new UnderwaterTint(this.glWrapper);
    this.playerModelRenderer = new PlayerModelRenderer(this.glWrapper);
    this.blockSelection = new BlockSelectionRenderer(this.glWrapper);
    this.entityRenderer?.dispose();
    this.entityRenderer = new EntityRenderer(this.glWrapper);
    this.dropRenderer?.dispose();
    this.dropRenderer = new DropRenderer(this.glWrapper, this.atlas);
    this.movingBlockRenderer?.dispose();
    this.movingBlockRenderer = new MovingBlockRenderer(this.glWrapper, this.atlas);
    this.chunkRenderer = new ChunkRenderer(this.glWrapper);
    this.weatherRenderer = new WeatherRenderer(this.glWrapper);
  }

  /** Sets the leaves mode; when it differs from the one the meshes were built for, remeshes every loaded section. */
  public setLeaves(mode: LeavesSetting): void {
    settings.leaves = mode;
    if (!this.tileResolver || this.tablesFastLeaves === (mode === 'fast')) return;
    this.tablesFastLeaves = mode === 'fast';
    this.tables = buildMeshLookupTables(BlockRegistry.getInstance(), this.tileResolver, {
      fastLeaves: this.tablesFastLeaves,
    });
    this.streamer.invalidateAll();
  }

  public async createWorld(opts?: WorldStartOptions): Promise<void> {
    this.leaveMenu();
    // Leaving a world saves it first (the old world is gone once the new one starts loading).
    await this.exitWorld();
    await this.startWorld(opts);
  }

  /** Enables or disables natural spawning in the active world. */
  public setSpawning(enabled: boolean): void {
    this.spawning = enabled;
    if (!enabled) this.world?.unpopulatedColumns.clear();
    this.playerController?.setSpawning(enabled);
  }

  /**
   * Loads a saved world by name: its seed and type, every edited column, block entities, the
   * player, inventory, ground items, clocks and weather. Columns nobody edited regenerate from
   * the seed.
   */
  public async loadWorld(name: string): Promise<void> {
    this.leaveMenu();
    await this.exitWorld();
    const loaded = await this.saves.load(name, (record) => {
      if (!record) return 'overworld';
      try {
        const dimension = readPlayerData(record).dimension;
        return isDimensionId(dimension) ? dimension : 'overworld';
      } catch {
        // The damaged player record is reported below; its world opens in the Overworld.
        return 'overworld';
      }
    });
    let player: ReturnType<typeof readPlayerData> | undefined;
    try {
      player = loaded.player ? readPlayerData(loaded.player) : undefined;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`The saved player of world '${name}' is damaged: ${reason}`, {
        cause: error,
      });
    }
    const options = normalizeWorldOptions(loaded.record.options);
    await this.startWorld(
      {
        name,
        seed: loaded.record.seedString,
        type: loaded.record.worldType,
        mode: player?.mode ?? 'survival',
        structures: options.structures,
        startingChest: options.startingChest,
        ...(options.biome ? { biome: options.biome } : {}),
      },
      loaded,
    );
  }

  /** Saves the open world, if it is a named one, and lets go of it. A failed save is logged, not fatal. */
  private async exitWorld(): Promise<void> {
    try {
      await this.saves.exit();
    } catch (error) {
      console.warn('[saves] could not save the world being left:', error);
      this.saves.detach();
    }
  }

  /** Saves the open world now (SPEC §4 `save()`). */
  public async save(): Promise<void> {
    if (!this.saves.session) throw new Error('Only a named world can be saved; create one first');
    await this.saves.save('manual');
  }

  private async startWorld(opts?: WorldStartOptions, restore?: LoadedWorld): Promise<void> {
    this.initialLoadCount++;
    // The streamer loads only what the barrier below pins until the barrier is done.
    this.streamer.backgroundEnabled = false;
    try {
      const completed = await this.loadInitialWorld(opts, restore);
      // The frame loop skipped terrain while loading. Draw the first frame with terrain now, in
      // this task, so it is presented before anything that awaits createWorld can look at the canvas.
      // A superseded call draws nothing: the newer call draws for its own world.
      if (completed) this.drawTerrainFrame();
    } finally {
      this.initialLoadCount--;
      if (this.initialLoadCount === 0) this.streamer.backgroundEnabled = true;
    }
  }

  private async loadInitialWorld(
    opts?: WorldStartOptions,
    restore?: LoadedWorld,
  ): Promise<boolean> {
    this.spawning = opts?.spawning ?? true;
    const radiusChunks = 4;
    // One more ring of columns is generated and lit than is meshed, so that every meshed section
    // has real neighbour columns (decisions/M03g-mesh-perimeter.md).
    const loadRadius = radiusChunks + PERIMETER_RING;

    this.worldSeedStr = opts?.seed ?? 'blockcraft-test-seed-42';
    this.worldSeed = hashString(this.worldSeedStr);
    this.setWorldKind(opts?.type ?? 'default', {
      structures: opts?.structures ?? DEFAULT_WORLD_OPTIONS.structures,
      startingChest: opts?.startingChest ?? DEFAULT_WORLD_OPTIONS.startingChest,
      ...(opts?.biome ? { biome: opts.biome } : {}),
    });
    const worldType = this.worldType;
    // A named world is saved. Its store is opened (or emptied, for a new world) before anything streams.
    let store = restore?.store ?? null;
    if (opts?.name && !store) {
      try {
        store = await this.saves.create(opts.name);
      } catch (error) {
        console.warn('[saves] saving is unavailable for this world:', error);
      }
    }
    const savedPlayer = restore?.player ? readPlayerData(restore.player) : undefined;
    const centerCX = savedPlayer ? Math.floor(savedPlayer.position[0] / 16) : 0;
    const centerCZ = savedPlayer ? Math.floor(savedPlayer.position[2] / 16) : 0;

    // Dispose old GPU section meshes
    if (this.chunkRenderer) {
      this.chunkRenderer.clearAllMeshes();
    }
    this.meshAttempts.clear();

    resetWorldTime();
    resetWeather();
    this.editMeshStarters.length = 0;
    this.editMeshes.length = 0;
    this.editVersions.clear();
    this.playerController?.reset();
    const epoch = ++this.worldEpoch;
    // A saved world reopens in the dimension its player was in, with that dimension's portals.
    const dimension = restore && isDimensionId(restore.store.dim) ? restore.store.dim : 'overworld';
    this.resetDimensions(dimension);
    this.portalIndices[dimension].load(restore?.entities?.portals);
    const world = new World();
    this.world = world;
    this.lightBatchTimes = [];
    this.configureLighting(world);
    this.attachPortals(world);
    this.world.worldSeed = this.worldSeed;
    this.world.worldType = this.worldType;
    setWorldInstance(this.world);
    this.saves.detach();
    if (restore) applyWorldRecord(world, restore.record);
    if (opts?.name && store) {
      this.saves.attach(
        {
          name: opts.name,
          seedString: this.worldSeedStr,
          worldType: this.worldType,
          options: { ...this.worldOptions },
          world,
          player: () => this.playerController?.player ?? null,
          items: () => this.playerController?.itemEntities ?? null,
          portals: () => this.portalIndices[this.dimension].serialize(),
        },
        store,
        restore?.record.createdAt,
        restore?.record.thumbnail,
      );
      this.saves.installPageHooks();
      if (this.playerController)
        this.playerController.loop.onPause = () => this.saves.saveSoon('pause');
    }
    this.streamer.reset(centerCX, centerCZ);
    this.streamer.active = true;
    this.updateStreamerLimits();

    // Generate the columns within the load radius through the streamer, at top priority.
    await this.streamer.requestRegion({
      cx: centerCX,
      cz: centerCZ,
      genRadius: loadRadius,
      meshRadius: -1,
    });
    // A newer createWorld (or resetWorldToEmpty) replaced this world while it was generating.
    if (epoch !== this.worldEpoch) return false;

    if (savedPlayer && restore?.player) {
      // The saved player stands where it was saved; the streamer lights and meshes the terrain
      // around it, exactly as for streamed columns.
      if (this.camera) {
        this.camera.position = vec3.fromValues(
          savedPlayer.position[0],
          savedPlayer.position[1] + 1.62,
          savedPlayer.position[2],
        );
        this.camera.yaw = savedPlayer.rotation[0];
        this.camera.pitch = savedPlayer.rotation[1];
        this.camera.updateView();
      }
      if (this.playerController) {
        this.playerController.spawn(
          world,
          savedPlayer.position[0],
          savedPlayer.position[1],
          savedPlayer.position[2],
          savedPlayer.mode,
          false,
          this.spawning,
        );
        const player = this.playerController.player!;
        applyPlayerRecord(player, restore.player);
        player.dimension = dimension;
        // A player saved standing in a portal steps out of it before it counts.
        this.portalTravel.needsExit = true;
        if (restore.entities && this.playerController.itemEntities)
          applyEntityRecord(this.playerController.itemEntities, restore.entities);
        this.playerController.render(1);
        this.playerController.onInteractionEdit = (x, y, z) => this.requestInteractionMesh(x, y, z);
      }
      this.setTimeOfDay(getWorldTime());
      await this.waitForTerrain(radiusChunks);
      return epoch === this.worldEpoch;
    }

    // Light terrain within the load radius using a single region LightWorkerPool job
    const { blocks: regionColumns } = await this.copyLightColumns({
      minCX: -loadRadius,
      maxCX: loadRadius,
      minCZ: -loadRadius,
      maxCZ: loadRadius,
    });

    const lightResult = await this.lightWorkerPool.enqueueLightRegionJob(loadRadius, regionColumns);

    if (epoch !== this.worldEpoch) return false;

    let commitSliceStart = performance.now();
    for (const column of lightResult.columns ?? []) {
      if (performance.now() - commitSliceStart >= 2) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (epoch !== this.worldEpoch) return false;
        commitSliceStart = performance.now();
      }
      this.commitColumnLight(world, column);
      this.streamer.markLit(column.cx, column.cz);
    }

    const playerSpawn = findSpawnPoint(world, radiusChunks);

    // Set camera spawn position
    if (this.camera) {
      if (worldType === 'flat') {
        this.camera.position = vec3.fromValues(0.5, 80.0, 0.5);
      } else {
        // Nearest generated land column to (0, 0): top block above sea level and not a fluid
        const spawn = playerSpawn;
        if (spawn) {
          this.camera.position = vec3.fromValues(
            spawn.position[0],
            spawn.position[1],
            spawn.position[2],
          );
        } else {
          this.camera.position = vec3.fromValues(0.5, world.getHeight(0, 0) + 1.82, 0.5);
        }
      }
      this.camera.yaw = -Math.PI / 2;
      this.camera.pitch = -0.05;
      this.camera.updateView();
    }

    // A new world (never a loaded one: it already holds whatever became of its chest).
    if (playerSpawn && this.worldOptions.startingChest) placeStartingChest(world, playerSpawn);

    if (playerSpawn)
      this.playerController?.spawn(
        world,
        playerSpawn.x + 0.5,
        playerSpawn.topY + 1,
        playerSpawn.z + 0.5,
        opts?.mode ?? 'survival',
        true,
        this.spawning,
      );

    if (this.playerController)
      this.playerController.onInteractionEdit = (x, y, z) => this.requestInteractionMesh(x, y, z);
    // Mesh terrain within radius 4
    await this.waitForTerrain(radiusChunks);
    return epoch === this.worldEpoch;
  }

  // -------------------------------------------------------------------------------------------
  // Dimensions and portals (M20a)
  // -------------------------------------------------------------------------------------------

  /** A world starts over in `dimension`: no portals are known and no travel is pending. */
  private resetDimensions(dimension: DimensionId): void {
    this.dimension = dimension;
    this.portalIndices.overworld.clear();
    this.portalIndices.hollowdeep.clear();
    this.portalTravel.reset();
    this.portalGuard = null;
  }

  /** Keeps the active dimension's portals whole as `world` is edited. */
  private attachPortals(world: World): void {
    this.portalGuard = new PortalGuard(world, this.portalIndices[this.dimension]);
    world.listeners.add(this.portalGuard);
  }

  /** Called after every tick: counts the player's time in a portal. Free while none is near. */
  public tickPortals(): void {
    const travel = this.portalTravel;
    const index = this.portalIndices[this.dimension];
    if (index.size === 0 && travel.warp === 0 && travel.cooldown === 0) return;
    const player = this.playerController?.player;
    if (!player || !this.world || player.dead) return;
    travel.tick(this.world, index, player.pos[0], player.pos[1], player.pos[2]);
  }

  /**
   * Ember Flint used on `target`: lights the empty Lumite frame around the cell in front of the
   * face it hit. Returns whether a portal was lit.
   */
  public useEmberFlint(target: RayHit): boolean {
    const world = this.world;
    if (!world) return false;
    const [dx, dy, dz] = FACE_OFFSETS[target.face];
    const portal = lightPortal(
      world,
      this.portalIndices[this.dimension],
      target.x + dx,
      target.y + dy,
      target.z + dz,
    );
    if (!portal) return false;
    const player = this.playerController?.player;
    const held = player?.inventory.held;
    const durability = getToolDurability(held);
    if (player && held && player.mode === 'survival' && durability !== null) {
      held.damage = (held.damage ?? 0) + 1;
      if (held.damage >= durability) player.inventory.slots[player.inventory.selectedSlot] = null;
    }
    return true;
  }

  /** A player stood in `portal` long enough: they go to the other dimension at the 1:4 point. */
  private async travelThroughPortal(portal: PortalRecord): Promise<void> {
    const from = this.dimension;
    const to = otherDimension(from);
    const [x, y, z] = portalArrivalPoint(portal);
    try {
      await this.changeDimension(
        to,
        scaleCoordinate(x, from, to),
        y,
        scaleCoordinate(z, from, to),
        portal.axis,
      );
    } catch (error) {
      console.warn('[portals] travel did not complete:', error);
    }
  }

  /**
   * Moves the player into dimension `to` near (x, y, z) there. The dimension being left is saved and
   * unloaded; the destination's columns stream in around the point, then the player arrives in the
   * existing portal within PORTAL_LINK_RADIUS or in a new one built on a safe spot. Resolves with
   * the arrival portal once the terrain around the player is meshed.
   */
  public changeDimension(
    to: DimensionId,
    x: number,
    y: number,
    z: number,
    axis: PortalAxis = 'x',
  ): Promise<PortalRecord> {
    if (this.dimensionChange) return Promise.reject(new Error('A dimension change is running'));
    const change = this.runDimensionChange(to, x, y, z, axis).finally(() => {
      if (this.dimensionChange === change) this.dimensionChange = null;
    });
    this.dimensionChange = change;
    return change;
  }

  private async runDimensionChange(
    to: DimensionId,
    x: number,
    y: number,
    z: number,
    axis: PortalAxis,
  ): Promise<PortalRecord> {
    const controller = this.playerController;
    const player = controller?.player;
    const departing = this.world;
    if (!controller || !player || !departing || this.panorama)
      throw new Error('Create a world before changing dimension');
    if (to === this.dimension) throw new Error(`The player is already in the ${to}`);
    if (![x, y, z].every(Number.isFinite)) throw new Error('Dimension coordinates must be finite');
    const wasPaused = controller.loop.paused;
    controller.suspended = true;
    this.portalTravel.travelling = true;
    this.initialLoadCount++;
    this.streamer.backgroundEnabled = false;
    try {
      let epoch = this.worldEpoch;
      const left = (): Error => new Error('The world was left during a dimension change');
      // The dimension being left is saved whole: its columns are dropped below without the unload hook.
      if (this.saves.session) await this.saves.save('exit');
      const destination = this.saves.session ? await this.saves.loadDimension(to) : null;
      if (epoch !== this.worldEpoch) throw left();
      const playerData = serializePlayerData(player);
      const inventory = serializeInventory(player.inventory);
      const mode = player.mode;
      const yaw = player.yaw;
      const pitch = player.pitch;

      epoch = ++this.worldEpoch;
      this.streamer.reset();
      this.genWorkerPool.cancelAll();
      this.lightWorkerPool.cancelAll();
      this.workerPool.cancelAll();
      this.editMeshStarters.length = 0;
      this.editMeshes.length = 0;
      this.editVersions.clear();
      this.chunkRenderer?.clearAllMeshes();
      this.meshAttempts.clear();
      weatherManager.heightmap.clear();
      if (this.portalGuard) departing.listeners.delete(this.portalGuard);

      this.dimension = to;
      const index = this.portalIndices[to];
      if (destination) index.load(destination.entities?.portals);
      const world = new World();
      this.world = world;
      this.lightBatchTimes = [];
      this.configureLighting(world);
      this.attachPortals(world);
      world.worldSeed = this.worldSeed;
      world.worldType = this.worldType;
      world.ticks.time = departing.ticks.time;
      world.breakCount = departing.breakCount;
      setWorldInstance(world);
      if (destination) this.saves.switchDimension(world, destination.store);

      const cx = Math.floor(x / 16);
      const cz = Math.floor(z / 16);
      this.streamer.reset(cx, cz);
      this.streamer.active = true;
      this.updateStreamerLimits();
      // Every column a linked portal (within 32 blocks) or a new one could stand in.
      await this.streamer.requestRegion({ cx, cz, genRadius: 3, meshRadius: -1 });
      if (epoch !== this.worldEpoch) throw left();

      const portal =
        findLinkedPortal(world, index, x, y, z) ??
        (await placeArrivalPortal(
          world,
          index,
          DIMENSIONS[to],
          axis,
          x,
          y,
          z,
          hash2(this.worldSeed, Math.floor(x), Math.floor(z)),
          () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
        ));
      if (epoch !== this.worldEpoch) throw left();

      const [px, py, pz] = portalArrivalPoint(portal);
      if (this.camera) {
        this.camera.position = vec3.fromValues(px, py + 1.62, pz);
        this.camera.yaw = yaw;
        this.camera.pitch = pitch;
        this.camera.updateView();
      }
      controller.spawn(world, px, py, pz, mode, false, this.spawning);
      if (wasPaused) controller.loop.paused = true;
      const arrived = controller.player!;
      applyPlayerData(arrived, deserializePlayerData(playerData));
      deserializeInventory(inventory, arrived.inventory);
      arrived.dimension = to;
      arrived.teleport(px, py, pz, yaw, pitch);
      arrived.onGround = arrived.collision.supported(px, py, pz, 1e-5);
      if (destination?.entities && controller.itemEntities)
        applyEntityRecord(controller.itemEntities, destination.entities);
      controller.onInteractionEdit = (ix, iy, iz) => this.requestInteractionMesh(ix, iy, iz);
      controller.render(1);
      this.portalTravel.arrived();
      this.dimensionChanges++;
      this.setTimeOfDay(getWorldTime());
      await this.waitForTerrain(4);
      if (epoch === this.worldEpoch) this.drawTerrainFrame();
      return portal;
    } finally {
      controller.suspended = false;
      if (this.portalTravel.travelling) this.portalTravel.cancel();
      this.initialLoadCount--;
      if (this.initialLoadCount === 0) this.streamer.backgroundEnabled = true;
    }
  }

  /** The active dimension's portal surfaces; draws nothing while it has none. */
  private drawPortals(): void {
    const index = this.portalIndices[this.dimension];
    if (index.size === 0 || !this.world || !this.glWrapper) return;
    this.portalRenderer ??= new PortalRenderer(this.glWrapper);
    const draws = this.portalRenderer.render(
      index.all(),
      this.world,
      this.viewProj,
      performance.now() / 1000,
    );
    renderStats.drawCalls += draws;
    renderStats.triangles += draws * 2;
  }

  /** The screen warp while waiting in a portal, during travel and fading after it. */
  private drawWarp(): void {
    const strength = this.portalTravel.travelling ? 1 : this.portalTravel.warp;
    if (strength <= 0 || !this.glWrapper) return;
    this.warpOverlay ??= new WarpOverlay(this.glWrapper);
    const draws = this.warpOverlay.render(strength, performance.now() / 1000);
    renderStats.drawCalls += draws;
    renderStats.triangles += draws;
  }

  /**
   * Resolves when every column within `radiusChunks` of the camera is meshed and uploaded. Goes
   * through the streamer: its columns are pinned at top priority until this resolves, and columns the
   * streamer already holds are not generated again.
   */
  public async waitForTerrain(radiusChunks: number): Promise<void> {
    if (!this.world || !this.chunkRenderer || !this.tables) return;
    // The camera may have been placed without frames running (spawn, a test holding the frame loop):
    // tell the streamer where it is before the region is pinned, or its frees would work from the
    // old column once the request resolves.
    if (this.camera) this.streamer.moveTo(this.streamerView(this.camera));
    const cx = this.camera ? Math.floor(this.camera.position[0] / 16) : 0;
    const cz = this.camera ? Math.floor(this.camera.position[2] / 16) : 0;
    await this.streamer.requestRegion({
      cx,
      cz,
      genRadius: radiusChunks + PERIMETER_RING,
      meshRadius: radiusChunks,
    });
    const epoch = this.worldEpoch;
    while (
      epoch === this.worldEpoch &&
      (this.editMeshStarters.length || this.editVersions.size || this.editMeshes.length)
    )
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  /** The streamer's view of `camera`: position, orientation and frustum planes of its current pose. */
  private streamerView(camera: Camera): StreamerView {
    mat4.multiply(this.viewProj, camera.projectionMatrix, camera.viewMatrix);
    extractFrustumPlanes(this.viewProj, this.frustumPlanes);
    return {
      x: camera.position[0],
      z: camera.position[2],
      yaw: camera.yaw,
      pitch: camera.pitch,
      planes: this.frustumPlanes,
    };
  }

  private isSectionAllOpaque(sec: ChunkSection | null): boolean {
    if (!sec || !this.tables) return false;
    if (sec.getBitsPerEntry() === 0) {
      const st = sec.uniformStateId;
      return this.tables.isOpaqueCube[st] === 1;
    }
    const palette = sec.palette;
    if (!palette) return false;
    for (let i = 0; i < palette.length; i++) {
      const st = palette[i];
      if (st === undefined || this.tables.isOpaqueCube[st] !== 1) {
        return false;
      }
    }
    return true;
  }

  private canSkipOpaqueSection(cx: number, sy: number, cz: number): boolean {
    if (!this.world) return false;
    // Check all 6 neighbors
    const neighbors = [
      { cx: cx + 1, sy, cz },
      { cx: cx - 1, sy, cz },
      { cx, sy, cz: cz + 1 },
      { cx, sy, cz: cz - 1 },
      { cx, sy: sy + 1, cz },
      { cx, sy: sy - 1, cz },
    ];

    for (const n of neighbors) {
      if (n.sy < 0) {
        // Below y=0 (foundation stone floor), treated as opaque
        continue;
      }
      if (n.sy > 19) {
        // Above world height y=319 (air), not opaque!
        return false;
      }
      if (!this.world.hasColumn(n.cx, n.cz)) {
        // Missing neighbor column at edge of loaded radius
        return false;
      }
      const ncol = this.world.getColumn(n.cx, n.cz, false);
      if (!ncol) return false;
      const nsec = ncol.getSection(n.sy);
      if (!nsec || !this.isSectionAllOpaque(nsec)) {
        return false;
      }
    }
    return true;
  }

  /**
   * The mesh jobs of one column: one starter per section that needs a mesh. Running a starter takes
   * the padded copy from the block data at that moment and enqueues the worker job.
   */
  private requestColumnMesh(cx: number, cz: number): Array<() => Promise<MeshResult>> {
    const world = this.world;
    if (!world || !this.chunkRenderer || !this.tables) return [];
    const col = world.getColumn(cx, cz, false);
    if (!col) return [];
    const starters: Array<() => Promise<MeshResult>> = [];
    const sectionOrder = Array.from({ length: 20 }, (_, sy) => sy);
    const cameraY = this.camera?.position[1] ?? 0;
    sectionOrder.sort((a, b) => Math.abs(a * 16 + 8 - cameraY) - Math.abs(b * 16 + 8 - cameraY));

    for (const sy of sectionOrder) {
      const sec = col.getSection(sy);

      // 1. Skip all-air / empty sections
      if (!sec || (sec.getBitsPerEntry() === 0 && sec.uniformStateId === 0)) {
        continue;
      }

      // 2. Skip section if it contains only opaque blocks and all 6 neighbor sections are loaded and contain only opaque blocks
      if (this.isSectionAllOpaque(sec) && this.canSkipOpaqueSection(cx, sy, cz)) {
        continue;
      }

      // 3. Transfer compact neighbour snapshots; padded voxel extraction runs in the worker.
      starters.push(() => {
        const tables = this.tables;
        if (!tables) return Promise.reject(new Error('mesh tables are gone'));
        const paddedSection = collectBlockPadding(world, cx, sy, cz);
        return this.workerPool.enqueueMeshJob(
          cx,
          sy,
          cz,
          paddedSection,
          tables,
          true,
          collectLightPadding(world, cx, sy, cz),
        );
      });
    }
    return starters;
  }

  public getWorkerStats(): { genMsP95: number; meshMsP95: number; queueLength: number } {
    return {
      genMsP95: this.genWorkerPool.genMsP95,
      meshMsP95: this.workerPool.meshMsP95,
      queueLength:
        this.workerPool.queueLength +
        this.genWorkerPool.queueLength +
        this.lightWorkerPool.queueLength,
    };
  }

  /**
   * Streaming runs first, then deferred mesh uploads while this frame's upload time is under the
   * budget, then the draw; `lastUploadMs` is the upload time.
   */
  public render(): boolean {
    this.lastUploadMs = 0;
    this.saves.frame();
    if (this.initialLoadCount > 0) {
      // A dimension change shows only the warp while the other world loads.
      this.drawWarp();
      return false;
    }
    if (this.world && this.camera) {
      this.streamer.update(this.streamerView(this.camera), performance.now());
      const uploadStart = performance.now();
      while (this.editMeshStarters.length && performance.now() - uploadStart < UPLOAD_BUDGET_MS / 2)
        this.editMeshStarters.shift()!();
      while (this.editMeshes.length && performance.now() - uploadStart < UPLOAD_BUDGET_MS) {
        const { result: mesh, serial, primary } = this.editMeshes.shift()!;
        if (this.editVersions.get(mesh.key) !== serial) continue;
        this.editVersions.delete(mesh.key);
        if (!this.world.hasColumn(mesh.sx, mesh.sz)) continue;
        this.chunkRenderer?.uploadSectionMesh(mesh.sx, mesh.sy, mesh.sz, mesh.meshData, -Infinity);
        if (primary && serial === this.editSerial) {
          this.interactionMeshFrame = this.terrainFrames + 1;
          this.interactionMeshRevision++;
        }
      }
      this.lastUploadMs = performance.now() - uploadStart;
      this.lastUploadMs += this.streamer.drainUploads(
        Math.max(0, UPLOAD_BUDGET_MS - this.lastUploadMs),
      );
    }
    return this.drawTerrain();
  }

  private drawTerrainFrame(): void {
    if (!this.glWrapper) return;
    const gl = this.glWrapper.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.drawTerrain();
    if (this.drainGlErrors) this.drainGlErrors();
  }

  private drawTerrain(): boolean {
    if (this.chunkRenderer && this.camera && this.atlasTexture && this.atlas) {
      const ticks = getWorldTime();
      if (this.world) {
        weatherManager.tick(this.world, ticks, this.camera.position);
      }
      const weatherState = getWeather();
      const rainFactor = weatherState === 'clear' ? 0.0 : weatherState === 'rain' ? 1.0 : 1.25;
      const lightningFlash = weatherManager.flashIntensity;

      const skyStats = this.skyRenderer
        ? this.skyRenderer.render(
            this.camera,
            this.atlasTexture,
            this.atlas,
            ticks,
            rainFactor,
            lightningFlash,
          )
        : { drawCalls: 0, triangles: 0 };

      const maxFogDist = (this.renderDistance - 1) * 16;
      const skyBrightness = skyLightMultiplier(ticks);
      if (this.world) this.underwaterView.update(this.world, this.camera.position, skyBrightness);
      const underwater = this.underwaterView;
      const { dayFactor, twilightFactor, nightFactor } = skyAtmosphereFactors(ticks);
      this.chunkRenderer.setSkyBrightness?.(skyLightMultiplier(ticks));
      this.chunkRenderer.setWorldPaused?.(this.playerController?.loop.paused ?? false);
      this.chunkRenderer.setAtmosphere?.({
        cameraPos: this.camera.position,
        fogStart: underwater.submerged ? underwater.fogStart : maxFogDist * 0.7,
        fogEnd: underwater.submerged ? underwater.fogEnd : maxFogDist,
        underwater,
        sunDir: sunDirection(ticks),
        dayFactor,
        twilightFactor,
        nightFactor,
        rainFactor,
        lightningFlash,
      });

      mat4.multiply(this.viewProj, this.camera.projectionMatrix, this.camera.viewMatrix);
      this.chunkRenderer.render(this.viewProj, this.atlasTexture, this.atlas, this.world, () => {
        const playerDraws =
          this.playerModelRenderer?.render(
            this.playerController,
            this.viewProj,
            this.atlasTexture!,
            this.atlas!,
            underwater,
            skyBrightness,
            sunDirection(ticks),
            dayFactor,
            twilightFactor,
            nightFactor,
            underwater.submerged ? underwater.fogStart : maxFogDist * 0.7,
            underwater.submerged ? underwater.fogEnd : maxFogDist,
          ) ?? 0;
        const entityDraws =
          this.entityRenderer?.render(
            this.playerController?.ecs ?? null,
            this.world,
            {
              viewProj: this.viewProj,
              atlasTexture: this.atlasTexture,
              eye: this.camera!.position,
              alpha: this.playerController?.renderAlpha ?? 1,
              skyBrightness,
              underwater,
              sunDir: sunDirection(ticks),
              day: dayFactor,
              twilight: twilightFactor,
              night: nightFactor,
              fogStart: underwater.submerged ? underwater.fogStart : maxFogDist * 0.7,
              fogEnd: underwater.submerged ? underwater.fogEnd : maxFogDist,
            },
            spawnerMiniatures(this.world),
          ) ?? 0;
        return (
          playerDraws +
          entityDraws +
          (this.dropRenderer?.render(
            this.playerController,
            this.viewProj,
            this.atlasTexture!,
            skyBrightness,
          ) ?? 0) +
          (this.movingBlockRenderer?.render(
            this.world,
            this.viewProj,
            this.atlasTexture!,
            skyBrightness,
            this.playerController?.renderAlpha ?? 1,
          ) ?? 0)
        );
      });
      this.drawPortals();
      if (this.movingBlockRenderer) renderStats.triangles += this.movingBlockRenderer.triangles;
      // The terrain renderer counts 12 triangles per callback draw; replace them with the real count.
      if (this.entityRenderer)
        renderStats.triangles += this.entityRenderer.triangles - 12 * this.entityRenderer.draws;
      if (this.dropRenderer)
        renderStats.triangles +=
          this.dropRenderer.triangles -
          12 * (this.dropRenderer.itemDraws + this.dropRenderer.particleDraws);
      const selectionDraws =
        this.blockSelection?.render(this.playerController?.interaction ?? null, this.viewProj) ?? 0;
      renderStats.drawCalls += selectionDraws;
      if (selectionDraws === 2) renderStats.triangles += 12;
      const cloudStats = this.cloudRenderer
        ? this.cloudRenderer.render(
            this.camera,
            ticks,
            this.renderDistance,
            rainFactor,
            lightningFlash,
          )
        : { drawCalls: 0, triangles: 0 };
      renderStats.cloudWindOffset = this.cloudRenderer?.windOffset ?? 0;
      this.underwaterTint?.render(underwater);

      const weatherStats =
        this.weatherRenderer && this.world
          ? this.weatherRenderer.render(this.camera, this.world, ticks)
          : { drawCalls: 0, triangles: 0 };

      renderStats.weather.state = weatherState;
      if (settings.particles && this.weatherRenderer && this.world) {
        renderStats.weather.activeParticles = this.weatherRenderer.getActiveParticleCounts(
          this.camera.position,
          this.world,
          ticks / 20.0,
        );
      } else {
        renderStats.weather.activeParticles = NO_ACTIVE_PARTICLES;
      }

      this.drawWarp();

      renderStats.drawCalls +=
        skyStats.drawCalls +
        cloudStats.drawCalls +
        weatherStats.drawCalls +
        Number(underwater.submerged);
      renderStats.triangles +=
        skyStats.triangles +
        cloudStats.triangles +
        weatherStats.triangles +
        Number(underwater.submerged);
      this.terrainFrames++;
      return true;
    }
    return false;
  }
}
