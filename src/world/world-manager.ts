import { vec3, mat4 } from 'gl-matrix';
import { World } from './world';
import { setWorldInstance } from './world-instance';
import { WorkerPool } from '../mesh/worker-pool';
import { GenWorkerPool } from '../workers/gen-worker-pool';
import { createDefaultPipeline, TerrainPipeline } from '../gen/pipeline';
import { hashString } from '../engine/rng';
import { ChunkRenderer } from '../render/chunk-renderer';
import { TextureAtlas, ATLAS_MAX_MIP } from '../render/atlas';
import { textureGenerators } from '../render/textures/index';
import { TextureData } from '../render/textures/noise';
import { createSentinelTile, SENTINEL_KEY } from '../render/texture-resolve';
import { BlockRegistry } from './blocks/registry';
import { buildMeshLookupTables, MeshLookupTables } from '../mesh/greedy';
import { buildPaddedSection } from './padded';
import { Camera } from '../render/camera';
import { GLWrapper } from '../render/gl';
import { renderStats } from '../debug/api/core';

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
  public pipeline: TerrainPipeline;
  public tables: MeshLookupTables | null = null;

  public worldSeedStr: string = 'blockcraft-test-seed-42';
  public worldSeed: number = hashString('blockcraft-test-seed-42');
  public worldType: 'default' | 'flat' = 'default';
  public mainThreadGenCount: number = 0;

  private pendingTerrainPromises: Map<string, Promise<void>> = new Map();

  public static getInstance(): WorldManager {
    if (!WorldManager.instance) {
      WorldManager.instance = new WorldManager();
    }
    return WorldManager.instance;
  }

  private constructor() {
    this.workerPool = new WorkerPool();
    this.genWorkerPool = new GenWorkerPool();
    this.pipeline = createDefaultPipeline();
  }

  public setWorkerPoolSize(size: number): void {
    this.genWorkerPool.setPoolSize(size);
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
    this.world = new World();
    setWorldInstance(this.world);
    this.mainThreadGenCount = 0;
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
    const radiusChunks = 4;

    this.worldSeedStr = opts?.seed ?? 'blockcraft-test-seed-42';
    this.worldSeed = hashString(this.worldSeedStr);
    this.worldType = opts?.type ?? 'default';

    // Clear cached terrain promises and dispose old GPU section meshes
    this.pendingTerrainPromises.clear();
    if (this.chunkRenderer) {
      this.chunkRenderer.clearAllMeshes();
    }

    this.world = new World();
    setWorldInstance(this.world);

    // Generate terrain via GenWorkerPool
    const genPromises: Promise<void>[] = [];
    for (let cx = -radiusChunks; cx <= radiusChunks; cx++) {
      for (let cz = -radiusChunks; cz <= radiusChunks; cz++) {
        const job = this.genWorkerPool
          .enqueueGenJob(this.worldSeed, cx, cz, this.worldType)
          .then((res) => {
            const col = this.world!.getColumn(res.cx, res.cz, true)!;
            for (const secData of res.sections) {
              const sec = col.getOrCreateSection(secData.sy);
              if (sec) {
                if (secData.states) {
                  sec.loadBlockStatesFrom(secData.states);
                } else if (secData.uniformStateId !== null) {
                  sec.fill(secData.uniformStateId);
                }
              }
            }
          });
        genPromises.push(job);
      }
    }

    await Promise.all(genPromises);

    // Light terrain within radius
    for (let cx = -radiusChunks; cx <= radiusChunks; cx++) {
      for (let cz = -radiusChunks; cz <= radiusChunks; cz++) {
        this.world.lightEngine.initializeColumnLight(this.world, cx, cz);
      }
    }

    // Set camera spawn position
    if (this.camera) {
      if (this.worldType === 'flat') {
        this.camera.position = vec3.fromValues(0.5, 80.0, 0.5);
      } else {
        const ySurface = this.world.getHeight(0, 0);
        // Spawn camera just above the terrain surface at documented land position (0.5, ySurface + 1.82, 0.5)
        this.camera.position = vec3.fromValues(0.5, ySurface + 1.82, 0.5);
      }
      this.camera.yaw = -Math.PI / 2;
      this.camera.pitch = -0.05;
      this.camera.updateView();
    }

    // Mesh terrain within radius 4
    await this.meshRadius(radiusChunks);
  }

  public async waitForTerrain(radiusChunks: number): Promise<void> {
    await this.meshRadius(radiusChunks);
  }

  private async meshRadius(radiusChunks: number): Promise<void> {
    if (!this.world || !this.chunkRenderer || !this.tables) return;

    const promises: Promise<void>[] = [];

    for (let cx = -radiusChunks; cx <= radiusChunks; cx++) {
      for (let cz = -radiusChunks; cz <= radiusChunks; cz++) {
        const colKey = `${cx},${cz}`;
        if (this.pendingTerrainPromises.has(colKey)) {
          promises.push(this.pendingTerrainPromises.get(colKey)!);
          continue;
        }

        const colPromise = (async () => {
          const sectionPromises: Promise<void>[] = [];
          for (let sy = 0; sy < 5; sy++) {
            const paddedSection = buildPaddedSection(this.world!, cx, sy, cz);
            const jobPromise = this.workerPool
              .enqueueMeshJob(cx, sy, cz, paddedSection, this.tables!)
              .then((res) => {
                if (this.chunkRenderer) {
                  this.chunkRenderer.uploadSectionMesh(res.sx, res.sy, res.sz, res.meshData);
                }
              });
            sectionPromises.push(jobPromise);
          }
          await Promise.all(sectionPromises);
        })();

        this.pendingTerrainPromises.set(colKey, colPromise);
        promises.push(colPromise);
      }
    }

    await Promise.all(promises);
  }

  public getWorkerStats(): { genMsP95: number; meshMsP95: number; queueLength: number } {
    return {
      genMsP95: this.genWorkerPool.genMsP95,
      meshMsP95: this.workerPool.meshMsP95,
      queueLength: this.workerPool.queueLength + this.genWorkerPool.queueLength,
    };
  }

  public render(): void {
    if (this.chunkRenderer && this.camera && this.atlasTexture && this.atlas) {
      const viewProj = mat4.create();
      mat4.multiply(viewProj, this.camera.projectionMatrix, this.camera.viewMatrix);
      this.chunkRenderer.render(viewProj, this.atlasTexture, this.atlas);
    }
  }
}
