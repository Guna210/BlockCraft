import { vec3, mat4 } from 'gl-matrix';
import { World } from './world';
import { setWorldInstance } from './world-instance';
import { ChunkSection } from './chunk';
import { WorkerPool } from '../mesh/worker-pool';
import { GenWorkerPool } from '../workers/gen-worker-pool';
import { LightWorkerPool } from '../workers/light-worker-pool';
import { createDefaultPipeline, TerrainPipeline } from '../gen/pipeline';
import { OVERWORLD_BIOME_IDS } from '../gen/biomes';
import { hashString } from '../engine/rng';
import { ChunkRenderer } from '../render/chunk-renderer';
import { TextureAtlas, ATLAS_MAX_MIP } from '../render/atlas';
import { textureGenerators } from '../render/textures/index';
import { TextureData } from '../render/textures/noise';
import { createSentinelTile, SENTINEL_KEY } from '../render/texture-resolve';
import { BlockRegistry } from './blocks/registry';
import { buildMeshLookupTables, MeshLookupTables } from '../mesh/greedy';
import { buildPaddedSection } from './padded';
import { findSpawnPoint } from './spawn';
import { Camera } from '../render/camera';
import { GLWrapper } from '../render/gl';
import { renderStats, setRenderStatsRefresh } from '../debug/api/core';
import { extractFrustumPlanes } from '../render/frustum';
import { frameStats } from '../engine/frame-stats';
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

/** Main-thread time per frame that may be spent uploading meshes. */
const UPLOAD_BUDGET_MS = 3;

/**
 * The steps that store a generation result in a world column: the column with its biome data, then
 * one step per section. The streamer runs them a few milliseconds at a time.
 */
function applyGenSteps(world: World, res: GenResult): Array<() => void> {
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
        if (secData.states) {
          sec.loadBlockStatesFrom(secData.states);
        } else if (secData.uniformStateId !== null) {
          sec.fill(secData.uniformStateId);
        }
      }
    });
  }
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
  public world: World | null = null;
  public atlas: TextureAtlas | null = null;
  public atlasTexture: WebGLTexture | null = null;
  public chunkRenderer: ChunkRenderer | null = null;
  public workerPool: WorkerPool;
  public genWorkerPool: GenWorkerPool;
  public lightWorkerPool: LightWorkerPool;
  public pipeline: TerrainPipeline;
  public tables: MeshLookupTables | null = null;

  public worldSeedStr: string = 'blockcraft-test-seed-42';
  public worldSeed: number = hashString('blockcraft-test-seed-42');
  public worldType: 'default' | 'flat' = 'default';
  public mainThreadGenCount: number = 0;

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

  // Number of createWorld calls that have not finished. While it is non-zero the frame loop draws
  // sky-clear frames only: every frame that draws freshly uploaded terrain takes tens to hundreds of
  // milliseconds of main-thread time under software rendering, and the rendering task outranks the
  // worker message tasks that carry the generation, light and mesh results (decisions/M02c-fix-load-path.md).
  private initialLoadCount = 0;

  // Set by main.ts in debug mode: reads pending WebGL errors after the synchronous terrain frame.
  public drainGlErrors: (() => void) | null = null;

  public static getInstance(): WorldManager {
    if (!WorldManager.instance) {
      WorldManager.instance = new WorldManager();
    }
    return WorldManager.instance;
  }

  private constructor() {
    this.workerPool = new WorkerPool();
    this.genWorkerPool = new GenWorkerPool();
    this.lightWorkerPool = new LightWorkerPool();
    this.pipeline = createDefaultPipeline();
    this.streamer = new Streamer<GenResult, MeshResult>(this.makeStreamerHost());
    // Not streaming until a world exists (createWorld) and while tests drive an empty world by hand.
    this.streamer.active = false;
    this.updateStreamerLimits();
    setRenderStatsRefresh(() => {
      renderStats.chunksLoaded = this.streamer.loadedColumns;
      renderStats.chunksMeshed = this.streamer.meshedColumns;
    });
  }

  /** What the streamer needs from the world, the worker pools and the GPU. */
  private makeStreamerHost(): StreamerHost<GenResult, MeshResult> {
    return {
      requestGen: (cx, cz) =>
        this.genWorkerPool.enqueueGenJob(this.worldSeed, cx, cz, this.worldType),
      applyGen: (_cx, _cz, res) => {
        const world = this.world;
        return world ? applyGenSteps(world, res) : [];
      },
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
      freeData: (cx, cz) => {
        this.meshAttempts.abandon(`${cx},${cz}`);
        this.world?.removeColumn(cx, cz);
      },
      now: () => performance.now(),
      recordSlice: (ms) => frameStats.recordPump(ms),
    };
  }

  /** In-flight work is bounded by the pool sizes, so queued work stays in the streamer, in priority order. */
  private updateStreamerLimits(): void {
    this.streamer.limits.maxGenInFlight = Math.max(4, this.genWorkerPool.workerCount * 2);
    this.streamer.limits.maxMeshColumnsInFlight = Math.max(2, this.workerPool.workerCount);
  }

  public setWorkerPoolSize(size: number): void {
    this.genWorkerPool.setPoolSize(size);
    this.lightWorkerPool.setPoolSize(size);
    // The old pool dropped its queued and running generation jobs without answering them.
    this.streamer.abandonGenerations();
    this.updateStreamerLimits();
  }

  public get renderDistance(): number {
    return this.streamer.renderDistance;
  }

  /** Sets the render distance (rounded, clamped to 2..32), re-plans at once and returns the value used. */
  public setRenderDistance(n: number): number {
    return this.streamer.setRenderDistance(clampRenderDistance(n));
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

  public resetMainThreadGenCount(): void {
    this.mainThreadGenCount = 0;
  }

  public resetWorldToEmpty(
    seed = 'blockcraft-test-seed-42',
    type: 'default' | 'flat' = 'default',
  ): void {
    this.worldSeedStr = seed;
    this.worldSeed = hashString(seed);
    this.worldType = type;
    this.worldEpoch++;
    this.chunkRenderer?.clearAllMeshes();
    this.meshAttempts.clear();
    this.world = new World();
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
    } else {
      this.pipeline.generateColumn(this.worldSeed, cx, cz, col);
    }
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

    this.tables = buildMeshLookupTables(registry, tileResolver);

    // 4. Chunk Renderer
    this.chunkRenderer = new ChunkRenderer(this.glWrapper);
  }

  public async createWorld(opts?: {
    name?: string;
    seed?: string;
    mode?: 'survival' | 'creative';
    type?: 'default' | 'flat';
  }): Promise<void> {
    this.initialLoadCount++;
    // The streamer loads only what the barrier below pins until the barrier is done.
    this.streamer.backgroundEnabled = false;
    try {
      const completed = await this.loadInitialWorld(opts);
      // The frame loop skipped terrain while loading. Draw the first frame with terrain now, in
      // this task, so it is presented before anything that awaits createWorld can look at the canvas.
      // A superseded call draws nothing: the newer call draws for its own world.
      if (completed) this.drawTerrainFrame();
    } finally {
      this.initialLoadCount--;
      if (this.initialLoadCount === 0) this.streamer.backgroundEnabled = true;
    }
  }

  private async loadInitialWorld(opts?: {
    name?: string;
    seed?: string;
    mode?: 'survival' | 'creative';
    type?: 'default' | 'flat';
  }): Promise<boolean> {
    const radiusChunks = 4;
    // One more ring of columns is generated and lit than is meshed, so that every meshed section
    // has real neighbour columns (decisions/M03g-mesh-perimeter.md).
    const loadRadius = radiusChunks + PERIMETER_RING;

    this.worldSeedStr = opts?.seed ?? 'blockcraft-test-seed-42';
    this.worldSeed = hashString(this.worldSeedStr);
    this.worldType = opts?.type ?? 'default';
    const worldType = this.worldType;

    // Dispose old GPU section meshes
    if (this.chunkRenderer) {
      this.chunkRenderer.clearAllMeshes();
    }
    this.meshAttempts.clear();

    const epoch = ++this.worldEpoch;
    const world = new World();
    this.world = world;
    this.world.worldSeed = this.worldSeed;
    this.world.worldType = this.worldType;
    setWorldInstance(this.world);
    this.streamer.reset(0, 0);
    this.streamer.active = true;
    this.updateStreamerLimits();

    // Generate the columns within the load radius through the streamer, at top priority.
    await this.streamer.requestRegion({ cx: 0, cz: 0, genRadius: loadRadius, meshRadius: -1 });
    // A newer createWorld (or resetWorldToEmpty) replaced this world while it was generating.
    if (epoch !== this.worldEpoch) return false;

    // Light terrain within the load radius using a single region LightWorkerPool job
    const regionColumns: Record<string, (Uint16Array | number)[]> = {};
    for (let cx = -loadRadius; cx <= loadRadius; cx++) {
      for (let cz = -loadRadius; cz <= loadRadius; cz++) {
        const col = world.getColumn(cx, cz, false);
        if (col) {
          const secArray: (Uint16Array | number)[] = [];
          for (let sy = 0; sy < 20; sy++) {
            const sec = col.getSection(sy);
            if (!sec) {
              secArray.push(0);
            } else if (sec.getBitsPerEntry() === 0) {
              secArray.push(sec.uniformStateId);
            } else {
              const arr = new Uint16Array(4096);
              sec.copyBlockStatesTo(arr);
              secArray.push(arr);
            }
          }
          regionColumns[`${cx},${cz}`] = secArray;
        }
      }
    }

    const lightResult = await this.lightWorkerPool.enqueueLightRegionJob(loadRadius, regionColumns);

    if (epoch !== this.worldEpoch) return false;

    for (const secLight of lightResult.sections) {
      world.lightEngine.storage.setRawDataByKey(secLight.key, secLight.lightData);
    }

    // Set camera spawn position
    if (this.camera) {
      if (worldType === 'flat') {
        this.camera.position = vec3.fromValues(0.5, 80.0, 0.5);
      } else {
        // Nearest generated land column to (0, 0): top block above sea level and not a fluid
        const spawn = findSpawnPoint(world, radiusChunks);
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

    // Mesh terrain within radius 4
    await this.waitForTerrain(radiusChunks);
    return epoch === this.worldEpoch;
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

    for (let sy = 0; sy < 20; sy++) {
      const sec = col.getSection(sy);

      // 1. Skip all-air / empty sections
      if (!sec || (sec.getBitsPerEntry() === 0 && sec.uniformStateId === 0)) {
        continue;
      }

      // 2. Skip section if it contains only opaque blocks and all 6 neighbor sections are loaded and contain only opaque blocks
      if (this.isSectionAllOpaque(sec) && this.canSkipOpaqueSection(cx, sy, cz)) {
        continue;
      }

      // 3. Copying the padded section is main-thread work: the streamer starts one job at a time.
      starters.push(() => {
        const tables = this.tables;
        if (!tables) return Promise.reject(new Error('mesh tables are gone'));
        const paddedSection = buildPaddedSection(world, cx, sy, cz);
        return this.workerPool.enqueueMeshJob(cx, sy, cz, paddedSection, tables, true);
      });
    }
    return starters;
  }

  public getWorkerStats(): { genMsP95: number; meshMsP95: number; queueLength: number } {
    return {
      genMsP95: this.genWorkerPool.genMsP95,
      meshMsP95: this.workerPool.meshMsP95,
      queueLength: this.workerPool.queueLength + this.genWorkerPool.queueLength,
    };
  }

  /**
   * Per-frame terrain update and draw. Skipped (sky-clear frame only) while createWorld is loading.
   * Streaming runs first, then deferred mesh uploads while this frame's upload time is under the
   * budget, then the draw; `lastUploadMs` is the upload time.
   */
  public render(): void {
    this.lastUploadMs = 0;
    if (this.initialLoadCount > 0) return;
    if (this.world && this.camera) {
      this.streamer.update(this.streamerView(this.camera), performance.now());
      this.lastUploadMs = this.streamer.drainUploads(UPLOAD_BUDGET_MS);
    }
    this.drawTerrain();
  }

  private drawTerrainFrame(): void {
    if (!this.glWrapper) return;
    const gl = this.glWrapper.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.drawTerrain();
    if (this.drainGlErrors) this.drainGlErrors();
  }

  private drawTerrain(): void {
    if (this.chunkRenderer && this.camera && this.atlasTexture && this.atlas) {
      mat4.multiply(this.viewProj, this.camera.projectionMatrix, this.camera.viewMatrix);
      this.chunkRenderer.render(this.viewProj, this.atlasTexture, this.atlas, this.world);
    }
  }
}
