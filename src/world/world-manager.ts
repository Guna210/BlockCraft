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
  public lightWorkerPool: LightWorkerPool;
  public pipeline: TerrainPipeline;
  public tables: MeshLookupTables | null = null;

  public worldSeedStr: string = 'blockcraft-test-seed-42';
  public worldSeed: number = hashString('blockcraft-test-seed-42');
  public worldType: 'default' | 'flat' = 'default';
  public mainThreadGenCount: number = 0;

  private pendingTerrainPromises: Map<string, Promise<void>> = new Map();

  // Bumped every time `this.world` is replaced. Asynchronous results (generation, light, mesh)
  // carry the epoch they were requested in and are dropped when it no longer matches.
  private worldEpoch = 0;

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
  }

  public setWorkerPoolSize(size: number): void {
    this.genWorkerPool.setPoolSize(size);
    this.lightWorkerPool.setPoolSize(size);
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
    this.world = new World();
    this.world.worldSeed = this.worldSeed;
    this.world.worldType = this.worldType;
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
    const worldType = this.worldType;
    const worldSeed = this.worldSeed;

    // Clear cached terrain promises and dispose old GPU section meshes
    this.pendingTerrainPromises.clear();
    if (this.chunkRenderer) {
      this.chunkRenderer.clearAllMeshes();
    }

    const epoch = ++this.worldEpoch;
    const world = new World();
    this.world = world;
    this.world.worldSeed = this.worldSeed;
    this.world.worldType = this.worldType;
    setWorldInstance(this.world);

    // Generate terrain via GenWorkerPool
    const genPromises: Promise<void>[] = [];
    for (let cx = -radiusChunks; cx <= radiusChunks; cx++) {
      for (let cz = -radiusChunks; cz <= radiusChunks; cz++) {
        const job = this.genWorkerPool.enqueueGenJob(worldSeed, cx, cz, worldType).then((res) => {
          if (epoch !== this.worldEpoch) return;
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
    // A newer createWorld (or resetWorldToEmpty) replaced this world while it was generating.
    if (epoch !== this.worldEpoch) return;

    // Light terrain within radius using a single region LightWorkerPool job
    const regionColumns: Record<string, (Uint16Array | number)[]> = {};
    for (let cx = -radiusChunks; cx <= radiusChunks; cx++) {
      for (let cz = -radiusChunks; cz <= radiusChunks; cz++) {
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

    const lightResult = await this.lightWorkerPool.enqueueLightRegionJob(
      radiusChunks,
      regionColumns,
    );

    if (epoch !== this.worldEpoch) return;

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
    await this.meshRadius(radiusChunks);
  }

  public async waitForTerrain(radiusChunks: number): Promise<void> {
    await this.meshRadius(radiusChunks);
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

  private async meshRadius(radiusChunks: number): Promise<void> {
    if (!this.world || !this.chunkRenderer || !this.tables) return;
    const world = this.world;
    const epoch = this.worldEpoch;
    const worldSeed = this.worldSeed;
    const worldType = this.worldType;

    const centerCX = this.camera ? Math.floor(this.camera.position[0] / 16) : 0;
    const centerCZ = this.camera ? Math.floor(this.camera.position[2] / 16) : 0;

    // 1. Ensure all columns within radiusChunks around camera are generated
    const genPromises: Promise<void>[] = [];
    for (let cx = centerCX - radiusChunks; cx <= centerCX + radiusChunks; cx++) {
      for (let cz = centerCZ - radiusChunks; cz <= centerCZ + radiusChunks; cz++) {
        if (!this.world.hasColumn(cx, cz)) {
          const job = this.genWorkerPool.enqueueGenJob(worldSeed, cx, cz, worldType).then((res) => {
            if (epoch !== this.worldEpoch) return;
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
    }
    await Promise.all(genPromises);
    if (epoch !== this.worldEpoch) return;

    // 2. Mesh all columns within radiusChunks
    const promises: Promise<void>[] = [];

    for (let cx = centerCX - radiusChunks; cx <= centerCX + radiusChunks; cx++) {
      for (let cz = centerCZ - radiusChunks; cz <= centerCZ + radiusChunks; cz++) {
        const colKey = `${cx},${cz}`;
        if (this.pendingTerrainPromises.has(colKey)) {
          promises.push(this.pendingTerrainPromises.get(colKey)!);
          continue;
        }

        const colPromise = (async () => {
          const sectionPromises: Promise<void>[] = [];
          const col = world.getColumn(cx, cz, false);

          for (let sy = 0; sy < 20; sy++) {
            if (!col) continue;
            const sec = col.getSection(sy);

            // 1. Skip all-air / empty sections
            if (!sec || (sec.getBitsPerEntry() === 0 && sec.uniformStateId === 0)) {
              continue;
            }

            // 2. Skip section if it contains only opaque blocks and all 6 neighbor sections are loaded and contain only opaque blocks
            if (this.isSectionAllOpaque(sec) && this.canSkipOpaqueSection(cx, sy, cz)) {
              continue;
            }

            const paddedSection = buildPaddedSection(world, cx, sy, cz);

            const jobPromise = this.workerPool
              .enqueueMeshJob(cx, sy, cz, paddedSection, this.tables!)
              .then((res) => {
                if (epoch !== this.worldEpoch) return;
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
      this.chunkRenderer.render(viewProj, this.atlasTexture, this.atlas, this.world);
    }
  }
}
