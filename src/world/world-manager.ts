import { vec3, mat4 } from 'gl-matrix';
import { World } from './world';
import { setWorldInstance } from './world-instance';
import { generateFlatWorld, genStats } from '../gen/flat';
import { WorkerPool } from '../mesh/worker-pool';
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
  public tables: MeshLookupTables | null = null;

  private pendingTerrainPromises: Map<string, Promise<void>> = new Map();

  public static getInstance(): WorldManager {
    if (!WorldManager.instance) {
      WorldManager.instance = new WorldManager();
    }
    return WorldManager.instance;
  }

  private constructor() {
    this.workerPool = new WorkerPool();
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

  public async createWorld(_opts?: {
    name?: string;
    seed?: string;
    mode?: 'survival' | 'creative';
  }): Promise<void> {
    const radiusChunks = 4;

    // Clear cached terrain promises and dispose old GPU section meshes
    this.pendingTerrainPromises.clear();
    if (this.chunkRenderer) {
      this.chunkRenderer.clearAllMeshes();
    }

    // Create flat world
    this.world = generateFlatWorld(radiusChunks);
    setWorldInstance(this.world);

    // Set camera spawn at y=80 looking at horizon
    if (this.camera) {
      this.camera.position = vec3.fromValues(0.5, 80.0, 0.5);
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
      genMsP95: genStats.genMsP95,
      meshMsP95: this.workerPool.meshMsP95,
      queueLength: this.workerPool.queueLength,
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
