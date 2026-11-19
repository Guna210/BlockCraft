import type { mat4 } from 'gl-matrix';
import { renderPhaseStats } from '../engine/render-phase-stats';
import { settings } from '../engine/settings';
import type { TerrainVariant } from '../gen/world-options';
import { aabbIntersectsFrustum } from '../world/frustum';
import {
  chebyshev,
  columnKey,
  FULL_DETAIL_RADIUS,
  MAX_RENDER_DISTANCE,
} from '../world/streaming-plan';
import type { TextureAtlas } from './atlas';
import { BufferArenaAllocator, type ArenaRange } from './buffer-arena-allocator';
import type { GLWrapper } from './gl';
import { LodColumnMask, lodStep, lodTileDistance, type LodStep } from './lod-plan';
import { LOD_TILE_COLUMNS, LOD_TILE_SIZE, LOD_QUAD_WORDS, type LodMesh } from './lod-mesh';
import { LOD_DATA_WIDTH, VS_LOD } from './lod-vertex';
import { FS_CHUNK } from './terrain-fragment';
import type { UnderwaterView } from './underwater';

const TILE_LIMIT = (Math.ceil((2 * MAX_RENDER_DISTANCE) / LOD_TILE_COLUMNS) + 1) ** 2;
const DATA_ROWS = 1024;
const UPLOAD_BUFFER_BYTES = 256 * 1024;
const UPLOAD_WORD_BYTES = Int32Array.BYTES_PER_ELEMENT;
const UPLOAD_QUAD_BYTES = LOD_QUAD_WORDS * UPLOAD_WORD_BYTES;
const UPLOAD_BUFFER_COUNT = 8;
// WebGL resource creation calls are indivisible. Give each step most of the
// shared budget, and wait until the next frame before issuing another step.
const INIT_HEADROOM_MS = 2;

interface UploadBuffer {
  buffer: WebGLBuffer;
  fence: WebGLSync | null;
}
interface GpuInit {
  vertex?: WebGLShader;
  fragment?: WebGLShader;
  program?: WebGLProgram;
  linked: boolean;
  texture?: WebGLTexture;
  uploadBuffers: UploadBuffer[];
  linkFence: WebGLSync | null;
}

const DATA_UNIT = 6;
const FS_LOD = FS_CHUNK.replace(
  'precision highp float;',
  '#define LOD_TERRAIN\nprecision highp float;',
);

export interface LodAtmosphere {
  cameraPos: ArrayLike<number>;
  sunDir: readonly number[];
  dayFactor: number;
  twilightFactor: number;
  nightFactor: number;
  rainFactor?: number;
  lightningFlash?: number;
  fogStart: number;
  fogEnd: number;
  underwater?: UnderwaterView | null;
}

interface Tile {
  tx: number;
  tz: number;
  key: number;
  step: LodStep;
  range?: ArenaRange;
  staged?: ArenaRange;
  sent: number;
  opaqueCount: number;
  waterCount: number;
  state: 'queued' | 'running' | 'ready' | 'uploaded';
  mesh?: LodMesh;
  maxY: number;
}

interface Lane {
  worker: Worker;
  tile: Tile | null;
  step: LodStep;
}

type MultiDraw = {
  multiDrawArraysWEBGL(
    mode: number,
    firsts: Int32Array,
    firstOffset: number,
    counts: Int32Array,
    countOffset: number,
    drawCount: number,
  ): void;
};

/** Owns worker scheduling, the shared quad store, and the column handoff mask. */
export class LodRenderer {
  readonly mask = new LodColumnMask();
  visibleTiles = 0;
  drawSubmissions = 0;
  private seed = 0;
  private variant: TerrainVariant = { type: 'default' };
  private cx = 0;
  private cz = 0;
  private rd = 0;
  private planTimer: number | undefined;
  private readonly tileLookup = new Map<number, Tile>();
  private tiles: Tile[] = [];
  private readonly lanes: Lane[] = [];
  private readonly queue: Tile[] = [];
  private readonly ready: Tile[] = [];
  private uploaded = 0;
  private uploadBufferIndex = 0;
  private readonly firsts = new Int32Array(TILE_LIMIT);
  private readonly counts = new Int32Array(TILE_LIMIT);
  private readonly waterFirsts = new Int32Array(TILE_LIMIT);
  private readonly waterCounts = new Int32Array(TILE_LIMIT);
  private readonly waterDistances = new Float64Array(TILE_LIMIT);
  private waterTiles = 0;
  submittedTriangles = 0;
  private samplingTotals = new Float64Array(3);
  private samplingCounts = new Uint32Array(3);
  private planStart = 0;
  private planMs = 0;
  private gpu: ReturnType<LodRenderer['finishGpu']> | undefined;
  private gpuInit: GpuInit | undefined;
  private parallelCompile?: KHR_parallel_shader_compile | null;
  private readonly multiDraw: MultiDraw | null;

  constructor(
    private readonly wrapper: GLWrapper,
    private readonly materials: Int32Array,
    readonly hasFullMesh: (cx: number, cz: number) => boolean,
  ) {
    this.multiDraw = wrapper.perDrawChecks ? null : wrapper.gl.getExtension('WEBGL_multi_draw');
  }

  reset(): void {
    clearTimeout(this.planTimer);
    this.planTimer = undefined;
    for (const lane of this.lanes) lane.worker.terminate();
    this.lanes.length = 0;
    this.queue.length = 0;
    this.ready.length = 0;
    this.tiles.length = 0;
    this.tileLookup.clear();
    this.samplingTotals.fill(0);
    this.samplingCounts.fill(0);
    this.planStart = 0;
    this.planMs = 0;
    this.uploaded = 0;
    this.mask.rows.fill(0);
    this.visibleTiles = 0;
    this.drawSubmissions = 0;
    this.rd = 0;
    const gpu = this.gpu ?? this.gpuInit;
    if (gpu) {
      for (const staging of gpu.uploadBuffers) {
        if (staging.fence) this.wrapper.gl.deleteSync(staging.fence);
        this.wrapper.deleteBuffer(staging.buffer);
      }
      if (gpu.texture) this.wrapper.deleteTexture(gpu.texture);
      if (gpu.program) this.wrapper.deleteProgram(gpu.program);
    }
    if (this.gpu) this.wrapper.deleteVertexArray(this.gpu.vao);
    if (this.gpuInit?.linkFence) this.wrapper.gl.deleteSync(this.gpuInit.linkFence);
    if (this.gpuInit?.vertex) this.wrapper.deleteShader(this.gpuInit.vertex);
    if (this.gpuInit?.fragment) this.wrapper.deleteShader(this.gpuInit.fragment);
    this.uploadBufferIndex = 0;
    this.gpu = undefined;
    this.gpuInit = undefined;
  }

  update(cx: number, cz: number, rd: number, seed: number, variant: TerrainVariant): void {
    if (this.rd === rd && this.cx === cx && this.cz === cz) return;
    this.planStart = performance.now();
    this.planMs = 0;
    this.rd = rd;
    this.cx = cx;
    this.cz = cz;
    this.seed = seed;
    this.variant = variant;
    this.planTimer ??= window.setTimeout(this.plan, 0);
  }

  private readonly plan = (): void => {
    this.planTimer = undefined;
    const minX = Math.floor((this.cx - this.rd) / LOD_TILE_COLUMNS);
    const maxX = Math.floor((this.cx + this.rd) / LOD_TILE_COLUMNS);
    const minZ = Math.floor((this.cz - this.rd) / LOD_TILE_COLUMNS);
    const maxZ = Math.floor((this.cz + this.rd) / LOD_TILE_COLUMNS);
    this.tiles = this.tiles.filter((tile) => {
      if (tile.tx >= minX && tile.tx <= maxX && tile.tz >= minZ && tile.tz <= maxZ) return true;
      this.tileLookup.delete(tile.key);
      if (tile.range) {
        this.uploaded--;
        this.gpu?.arena.free(tile.range);
      }
      if (tile.staged) this.gpu?.arena.free(tile.staged);
      return false;
    });
    let retained = 0;
    for (const tile of this.ready) {
      if (this.tileLookup.get(tile.key) === tile) this.ready[retained++] = tile;
    }
    this.ready.length = retained;
    this.queue.length = 0;
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const key = columnKey(x, z);
        let tile = this.tileLookup.get(key);
        const step = lodStep(lodTileDistance(this.cx, this.cz, x, z), tile?.step);
        if (tile && tile.step !== step) {
          if (tile.staged) this.gpu?.arena.free(tile.staged);
          tile.mesh = undefined;
          tile.staged = undefined;
          tile.sent = 0;
          tile.step = step;
          tile.state = 'queued';
        }
        if (!tile) {
          tile = {
            tx: x,
            tz: z,
            key,
            step,
            state: 'queued',
            sent: 0,
            maxY: 0,
            opaqueCount: 0,
            waterCount: 0,
          };
          this.tileLookup.set(key, tile);
          this.tiles.push(tile);
        }
        if (tile.state === 'queued') this.queue.push(tile);
      }
    }
    const priority = (tile: Tile) => {
      const half = LOD_TILE_COLUMNS / 2;
      const ring = chebyshev(
        tile.tx * LOD_TILE_COLUMNS + half,
        tile.tz * LOD_TILE_COLUMNS + half,
        this.cx,
        this.cz,
      );
      return Math.abs(ring - FULL_DETAIL_RADIUS);
    };
    this.queue.sort((a, b) => priority(b) - priority(a));
    if (this.lanes.length === 0) {
      this.addLane();
      this.addLane();
    }
    for (const lane of this.lanes) this.dispatch(lane);
  };

  private addLane(): void {
    const worker = new Worker(new URL('../workers/lod.worker.ts', import.meta.url), {
      type: 'module',
    });
    const lane: Lane = { worker, tile: null, step: 1 };
    worker.onmessage = (event: MessageEvent<LodMesh>) => {
      const tile = lane.tile!;
      lane.tile = null;
      if (
        this.tileLookup.get(tile.key) === tile &&
        lane.step === tile.step &&
        tile.state === 'running'
      ) {
        const index = Math.log2(tile.step);
        this.samplingTotals[index] = this.samplingTotals[index]! + event.data.samplingMs;
        this.samplingCounts[index] = this.samplingCounts[index]! + 1;
        tile.mesh = event.data;
        tile.state = 'ready';
        this.ready.push(tile);
      }
      this.dispatch(lane);
    };
    this.lanes.push(lane);
  }

  private dispatch(lane: Lane): void {
    if (lane.tile || this.planTimer !== undefined) return;
    const tile = this.queue.pop();
    if (!tile) return;
    lane.tile = tile;
    lane.step = tile.step;
    tile.state = 'running';
    lane.worker.postMessage({
      tx: tile.tx,
      tz: tile.tz,
      seed: this.seed,
      variant: this.variant,
      step: tile.step,
    });
  }

  private advanceGpuInit(init: GpuInit, deadline: number): void {
    const { gl } = this.wrapper;
    if (this.parallelCompile === undefined) {
      this.parallelCompile = gl.getExtension('KHR_parallel_shader_compile');
      return;
    }
    if (!init.program) {
      if (!init.vertex) {
        init.vertex = this.wrapper.createShader(gl.VERTEX_SHADER, VS_LOD, false);
      } else if (!init.fragment) {
        init.fragment = this.wrapper.createShader(gl.FRAGMENT_SHADER, FS_LOD, false);
      } else {
        init.program = this.wrapper.linkProgram(init.vertex, init.fragment);
        init.linkFence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      }
      return;
    }

    if (!init.texture) {
      init.texture = this.wrapper.createTexture();
      gl.activeTexture(gl.TEXTURE0 + DATA_UNIT);
      gl.bindTexture(gl.TEXTURE_2D, init.texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32I, LOD_DATA_WIDTH, DATA_ROWS);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.activeTexture(gl.TEXTURE0);
      return;
    }

    if (init.uploadBuffers.length < UPLOAD_BUFFER_COUNT) {
      const buffer = this.wrapper.createBuffer();
      gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, buffer);
      gl.bufferData(gl.PIXEL_UNPACK_BUFFER, UPLOAD_BUFFER_BYTES, gl.STREAM_DRAW);
      gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
      init.uploadBuffers.push({ buffer, fence: null });
      return;
    }

    if (!init.linked) {
      // Buffer allocation can advance while the link is in flight. Avoid a
      // blocking status query until the driver's queued link has run.
      if (init.linkFence) {
        const status = gl.clientWaitSync(init.linkFence, gl.SYNC_FLUSH_COMMANDS_BIT, 0);
        if (status !== gl.ALREADY_SIGNALED && status !== gl.CONDITION_SATISFIED) return;
        gl.deleteSync(init.linkFence);
        init.linkFence = null;
      }
      if (performance.now() + INIT_HEADROOM_MS >= deadline) return;
      if (
        this.parallelCompile &&
        !gl.getProgramParameter(init.program, this.parallelCompile.COMPLETION_STATUS_KHR)
      )
        return;
      this.wrapper.checkProgramLink(init.program);
      gl.detachShader(init.program, init.vertex!);
      gl.detachShader(init.program, init.fragment!);
      this.wrapper.deleteShader(init.vertex!);
      this.wrapper.deleteShader(init.fragment!);
      init.vertex = undefined;
      init.fragment = undefined;
      init.linked = true;
      return;
    }

    this.gpu = this.finishGpu(init.program, init.texture, init.uploadBuffers);
    this.gpuInit = undefined;
  }

  private finishGpu(program: WebGLProgram, texture: WebGLTexture, uploadBuffers: UploadBuffer[]) {
    const { gl } = this.wrapper;
    const vao = this.wrapper.createVertexArray();
    const uniform = (name: string) => gl.getUniformLocation(program, name);
    return {
      texture,
      uploadBuffers,
      vao,
      program,
      arena: new BufferArenaAllocator(LOD_DATA_WIDTH * DATA_ROWS),
      quads: uniform('u_quads'),
      materials: uniform('u_materials[0]'),
      atlas: uniform('u_atlasSampler'),
      atlasSize: uniform('u_atlasSize'),
      viewProj: uniform('u_viewProj'),
      center: uniform('u_center'),
      distance: uniform('u_distance'),
      detail: uniform('u_detail[0]'),
      camera: uniform('u_cameraPos'),
      sun: uniform('u_sunDir'),
      factors: uniform('u_factors'),
      weatherLight: uniform('u_weatherLight'),
      fogStart: uniform('u_fogStart'),
      fogEnd: uniform('u_fogEnd'),
      waterFog: uniform('u_waterFogColor'),
      underwater: uniform('u_underwater'),
      depth: uniform('u_sceneDepth'),
      inverse: uniform('u_inverseViewProj'),
      viewport: uniform('u_viewport'),
      brightness: uniform('u_brightness'),
      fluidTime: uniform('u_fluidTime'),
      fade: uniform('u_fade'),
    };
  }

  upload(deadline: number): void {
    if (!this.rd || this.planTimer !== undefined) return;
    if (!this.gpu) {
      const init = (this.gpuInit ??= { linked: false, uploadBuffers: [], linkFence: null });
      if (performance.now() + INIT_HEADROOM_MS < deadline) this.advanceGpuInit(init, deadline);
      return;
    }
    if (!this.ready.length || performance.now() + 0.5 >= deadline) return;
    const { gl } = this.wrapper;
    const gpu = this.gpu;
    const staging = gpu.uploadBuffers[this.uploadBufferIndex]!;
    if (staging.fence) {
      const status = gl.clientWaitSync(staging.fence, 0, 0);
      if (status !== gl.ALREADY_SIGNALED && status !== gl.CONDITION_SATISFIED) return;
      gl.deleteSync(staging.fence);
      staging.fence = null;
    }
    let bytes = 0;
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, staging.buffer);
    gl.activeTexture(gl.TEXTURE0 + DATA_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, gpu.texture);
    while (this.ready.length && bytes < UPLOAD_BUFFER_BYTES && performance.now() + 0.5 < deadline) {
      const tile = this.ready[0]!;
      const mesh = tile.mesh;
      if (this.tileLookup.get(tile.key) !== tile || tile.state !== 'ready' || !mesh) {
        this.ready.shift();
        continue;
      }
      const count = mesh.quads.length / LOD_QUAD_WORDS;
      tile.staged ??= gpu.arena.allocate(count, 1) ?? undefined;
      if (!tile.staged) break;
      const offset = tile.staged.offset + tile.sent;
      const col = offset % LOD_DATA_WIDTH;
      const available = Math.min(
        count - tile.sent,
        (UPLOAD_BUFFER_BYTES - bytes) / UPLOAD_QUAD_BYTES,
      );
      const rows = col === 0 ? Math.max(1, Math.floor(available / LOD_DATA_WIDTH)) : 1;
      const width = rows > 1 ? LOD_DATA_WIDTH : Math.min(available, LOD_DATA_WIDTH - col);
      const slice = rows * width;
      gl.bufferSubData(
        gl.PIXEL_UNPACK_BUFFER,
        bytes,
        mesh.quads,
        tile.sent * LOD_QUAD_WORDS,
        slice * LOD_QUAD_WORDS,
      );
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        col,
        Math.floor(offset / LOD_DATA_WIDTH),
        width,
        rows,
        gl.RGBA_INTEGER,
        gl.INT,
        bytes,
      );
      bytes += slice * UPLOAD_QUAD_BYTES;
      tile.sent += slice;
      if (tile.sent !== count) continue;
      if (tile.range) gpu.arena.free(tile.range);
      else this.uploaded++;
      tile.range = tile.staged;
      tile.staged = undefined;
      tile.sent = 0;
      tile.opaqueCount = mesh.opaqueCount;
      tile.waterCount = count - mesh.opaqueCount;
      tile.maxY = mesh.maxY;
      tile.mesh = undefined;
      tile.state = 'uploaded';
      this.ready.shift();
    }
    if (bytes) {
      staging.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      this.uploadBufferIndex = (this.uploadBufferIndex + 1) % UPLOAD_BUFFER_COUNT;
    }
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
    if (this.pendingJobs() === 0) this.planMs = performance.now() - this.planStart;
    gl.activeTexture(gl.TEXTURE0);
  }

  prepare(planes: ArrayLike<number>, cameraPos: ArrayLike<number>): void {
    this.visibleTiles = 0;
    this.waterTiles = 0;
    this.drawSubmissions = 0;
    this.submittedTriangles = 0;
    if (!this.gpu) return;
    for (let i = 0; i < this.tiles.length; i++) {
      const tile = this.tiles[i]!;
      if (!tile.range) continue;
      const x = tile.tx * LOD_TILE_SIZE;
      const z = tile.tz * LOD_TILE_SIZE;
      if (!aabbIntersectsFrustum(planes, x, 0, z, x + LOD_TILE_SIZE, tile.maxY, z + LOD_TILE_SIZE))
        continue;
      if (!this.hasVisibleColumn(tile.tx * LOD_TILE_COLUMNS, tile.tz * LOD_TILE_COLUMNS)) continue;
      this.firsts[this.visibleTiles] = tile.range.offset * 6;
      this.counts[this.visibleTiles++] = tile.opaqueCount * 6;
      if (!tile.waterCount) continue;
      const distance =
        (x + LOD_TILE_SIZE / 2 - cameraPos[0]!) ** 2 + (z + LOD_TILE_SIZE / 2 - cameraPos[2]!) ** 2;
      let index = this.waterTiles++;
      while (index > 0 && this.waterDistances[index - 1]! < distance) {
        this.waterDistances[index] = this.waterDistances[index - 1]!;
        this.waterFirsts[index] = this.waterFirsts[index - 1]!;
        this.waterCounts[index] = this.waterCounts[index - 1]!;
        index--;
      }
      this.waterDistances[index] = distance;
      this.waterFirsts[index] = (tile.range.offset + tile.opaqueCount) * 6;
      this.waterCounts[index] = tile.waterCount * 6;
    }
  }

  get hasWater(): boolean {
    return this.waterTiles > 0;
  }

  draw(
    water: boolean,
    viewProj: mat4,
    inverse: mat4,
    sky: number,
    atmosphere: LodAtmosphere,
    atlas: TextureAtlas,
    fluidTime: number,
    activeUnit: number,
    debugLight: boolean,
  ): number {
    const gpu = this.gpu;
    const size = water ? this.waterTiles : this.visibleTiles;
    if (!gpu || !size) return 0;
    const { gl } = this.wrapper;
    gl.useProgram(gpu.program);
    gl.bindVertexArray(gpu.vao);
    gl.activeTexture(gl.TEXTURE0 + DATA_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, gpu.texture);
    gl.activeTexture(gl.TEXTURE0 + activeUnit);
    gl.uniform1i(gpu.quads, DATA_UNIT);
    gl.uniform3iv(gpu.materials, this.materials);
    gl.uniform1i(gpu.atlas, 0);
    gl.uniform2f(gpu.atlasSize, atlas.width, atlas.height);
    gl.uniform1i(gpu.depth, 4);
    gl.uniformMatrix4fv(gpu.inverse, false, inverse);
    gl.uniform2f(gpu.viewport, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniformMatrix4fv(gpu.viewProj, false, viewProj);
    gl.uniform2i(gpu.center, this.mask.cx, this.mask.cz);
    gl.uniform1i(gpu.distance, this.rd);
    gl.uniform1uiv(gpu.detail, this.mask.rows);
    const { cameraPos, sunDir, underwater } = atmosphere;
    gl.uniform3f(gpu.camera, cameraPos[0]!, cameraPos[1]!, cameraPos[2]!);
    gl.uniform3f(gpu.sun, sunDir[0]!, sunDir[1]!, sunDir[2]!);
    gl.uniform3f(
      gpu.factors,
      atmosphere.dayFactor,
      atmosphere.twilightFactor,
      atmosphere.nightFactor,
    );
    gl.uniform3f(
      gpu.weatherLight,
      atmosphere.rainFactor ?? 0,
      atmosphere.lightningFlash ?? 0,
      debugLight ? 1 : Math.max(sky, underwater?.brightnessFloor ?? 0),
    );
    gl.uniform1f(gpu.brightness, settings.brightness);
    gl.uniform1f(gpu.fade, 1);
    gl.uniform1f(gpu.fluidTime, fluidTime);
    gl.uniform1f(gpu.fogStart, atmosphere.fogStart);
    gl.uniform1f(gpu.fogEnd, atmosphere.fogEnd);
    gl.uniform1i(gpu.underwater, underwater?.submerged ? 1 : 0);
    if (underwater) gl.uniform3fv(gpu.waterFog, underwater.fogColor);
    const firsts = water ? this.waterFirsts : this.firsts;
    const counts = water ? this.waterCounts : this.counts;
    for (let i = 0; i < size; i++) this.submittedTriangles += counts[i]! / 3;
    if (this.multiDraw) {
      const start = renderPhaseStats.start();
      this.multiDraw.multiDrawArraysWEBGL(gl.TRIANGLES, firsts, 0, counts, 0, size);
      this.wrapper.recordDrawSubmission();
      renderPhaseStats.end('drawSubmissionMs', start);
      this.drawSubmissions++;
    } else {
      for (let i = 0; i < size; i++) this.wrapper.drawArrays(gl.TRIANGLES, firsts[i]!, counts[i]!);
      this.drawSubmissions += size;
    }
    return size;
  }

  covers(cx: number, cz: number): boolean {
    return !!this.tileLookup.get(
      columnKey(Math.floor(cx / LOD_TILE_COLUMNS), Math.floor(cz / LOD_TILE_COLUMNS)),
    )?.range;
  }

  private pendingJobs(): number {
    let pending = 0;
    for (let i = 0; i < this.tiles.length; i++) if (this.tiles[i]!.state !== 'uploaded') pending++;
    return pending;
  }

  private hasVisibleColumn(cx: number, cz: number): boolean {
    for (let z = cz; z < cz + LOD_TILE_COLUMNS; z++) {
      for (let x = cx; x < cx + LOD_TILE_COLUMNS; x++) {
        if (chebyshev(x, z, this.cx, this.cz) <= this.rd && !this.mask.hides(x, z)) return true;
      }
    }
    return false;
  }

  stats(fullDetailRadius: number) {
    const pendingJobs = this.pendingJobs();
    return {
      tiles: this.uploaded,
      visibleTiles: this.visibleTiles,
      drawSubmissions: this.drawSubmissions,
      pendingJobs,
      coverageRadius:
        this.planTimer === undefined && this.tiles.length > 0 && pendingJobs === 0 ? this.rd : 0,
      fullDetailRadius,
      samplingMsPerTile: Array.from(
        this.samplingTotals,
        (total, i) => total / Math.max(1, this.samplingCounts[i]!),
      ),
      planMs: this.planMs,
    };
  }
}
