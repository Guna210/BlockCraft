import type { mat4 } from 'gl-matrix';
import { renderPhaseStats } from '../engine/render-phase-stats';
import type { TerrainVariant } from '../gen/world-options';
import { aabbIntersectsFrustum } from '../world/frustum';
import {
  chebyshev,
  columnKey,
  FULL_DETAIL_RADIUS,
  MAX_RENDER_DISTANCE,
} from '../world/streaming-plan';
import { LIGHT_MIN_BRIGHTNESS } from '../world/light-curve';
import type { GLWrapper } from './gl';
import { GLSL_SKY_ATMOSPHERE } from './sky';
import type { LodColors } from './lod-colors';
import { LOD_MASK_WIDTH, LodColumnMask } from './lod-plan';
import {
  LOD_TILE_COLUMNS,
  LOD_TILE_SIZE,
  LOD_TILE_VERTICES,
  LOD_VERTEX_WORDS,
  type LodMesh,
} from './lod-mesh';
import type { UnderwaterView } from './underwater';

const SLOT_COUNT = (Math.ceil((2 * MAX_RENDER_DISTANCE) / LOD_TILE_COLUMNS) + 1) ** 2;
const STRIDE = LOD_VERTEX_WORDS * 4;
const VS = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in ivec3 a_packed;
layout(location=1) in vec4 a_color;
layout(location=2) in uint a_owner;
uniform mat4 u_viewProj;
uniform ivec2 u_center;
uniform int u_distance;
uniform uint u_detail[${LOD_MASK_WIDTH}];
out vec3 v_world;
flat out vec3 v_color;

bool drawsDetail(ivec2 p) {
  ivec2 cell = p + ${FULL_DETAIL_RADIUS};
  if (any(lessThan(cell, ivec2(0))) || any(greaterThanEqual(cell, ivec2(${LOD_MASK_WIDTH})))) return false;
  return (u_detail[cell.y] & (1u << uint(cell.x))) != 0u;
}
bool withinRange(ivec2 p) {
  return max(abs(p.x), abs(p.y)) <= u_distance;
}
void main() {
  ivec2 owner = ivec2(int(a_owner >> 16u), int(a_owner & 65535u)) - 32768 - u_center;
  int side = (a_packed.y >> 9) & 7;
  ivec2 neighbor = side == 1 ? ivec2(-1,0) : side == 2 ? ivec2(1,0) :
                   side == 3 ? ivec2(0,-1) : ivec2(0,1);
  if (!withinRange(owner) || drawsDetail(owner) ||
      (side != 0 && (a_packed.y & 8192) == 0 &&
       withinRange(owner + neighbor) && !drawsDetail(owner + neighbor))) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  v_world = vec3(a_packed.x, a_packed.y & 511, a_packed.z);
  // Taper the skirt inward so its wall and a voxel face never occupy the same plane.
  if ((a_packed.y & 4096) != 0) v_world.xz -= vec2(neighbor) * 0.03125;
  v_color = a_color.rgb * a_color.a;
  gl_Position = u_viewProj * vec4(v_world, 1.0);
}
`;

const FS = `#version 300 es
precision highp float;
in vec3 v_world;
flat in vec3 v_color;
uniform vec3 u_camera;
uniform vec3 u_sun;
uniform vec3 u_factors;
uniform vec3 u_weatherLight;
uniform vec2 u_fog;
uniform vec3 u_waterFog;
uniform bool u_underwater;
out vec4 fragColor;
${GLSL_SKY_ATMOSPHERE}
void main() {
  vec3 delta = v_world - u_camera;
  vec3 fogColor = skyAtmosphereColor(normalize(delta + vec3(0.0, 1e-5, 0.0)), u_sun,
    u_factors.x, u_factors.y, u_factors.z);
  float rain = u_weatherLight.x;
  if (rain > 0.001) {
    float lum = dot(fogColor, vec3(0.2126, 0.7152, 0.0722));
    fogColor = mix(fogColor, vec3(lum), min(0.8, 0.55 * rain)) * vec3(0.9, 0.97, 1.08) * max(0.12, 1.0 - 0.8 * rain);
  }
  fogColor += u_weatherLight.y * 0.35;
  if (u_underwater) fogColor = u_waterFog;
  float distance = u_underwater ? length(delta) : length(delta.xz);
  float fog = u_fog.y > u_fog.x ? smoothstep(u_fog.x, u_fog.y, distance) : 0.0;
  fragColor = vec4(mix(v_color * u_weatherLight.z, fogColor, fog), 1.0);
}
`;

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
  slot: number;
  state: 'queued' | 'running' | 'ready' | 'uploaded';
  mesh?: LodMesh;
  maxY: number;
}

interface Lane {
  worker: Worker;
  tile: Tile | null;
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

/** Owns worker scheduling, one shared vertex buffer, and a per-frame handoff mask. */
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
  private readonly slots = Array.from({ length: SLOT_COUNT }, (_, i) => SLOT_COUNT - i - 1);
  private uploaded = 0;
  private readonly firsts = new Int32Array(SLOT_COUNT);
  private readonly counts = new Int32Array(SLOT_COUNT).fill(LOD_TILE_VERTICES);
  private gpu: ReturnType<LodRenderer['createGpu']> | undefined;
  private readonly multiDraw: MultiDraw | null;

  constructor(
    private readonly wrapper: GLWrapper,
    private readonly colors: LodColors,
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
    for (let i = 0; i < SLOT_COUNT; i++) this.slots[i] = SLOT_COUNT - i - 1;
    this.slots.length = SLOT_COUNT;
    this.uploaded = 0;
    this.mask.rows.fill(0);
    this.visibleTiles = 0;
    this.drawSubmissions = 0;
    this.rd = 0;
    if (this.gpu) {
      this.wrapper.deleteBuffer(this.gpu.buffer);
      this.wrapper.deleteVertexArray(this.gpu.vao);
      this.wrapper.gl.deleteProgram(this.gpu.program);
      this.gpu = undefined;
    }
  }

  update(cx: number, cz: number, rd: number, seed: number, variant: TerrainVariant): void {
    if (this.rd === rd && this.cx === cx && this.cz === cz) return;
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
      if (tile.state === 'uploaded') this.uploaded--;
      if (tile.slot >= 0) this.slots.push(tile.slot);
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
        if (!tile) {
          tile = { tx: x, tz: z, key, state: 'queued', slot: -1, maxY: 0 };
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
    const lane: Lane = { worker, tile: null };
    worker.onmessage = (event: MessageEvent<LodMesh>) => {
      const tile = lane.tile!;
      lane.tile = null;
      if (this.tileLookup.get(tile.key) === tile) {
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
    tile.state = 'running';
    lane.worker.postMessage({
      tx: tile.tx,
      tz: tile.tz,
      seed: this.seed,
      variant: this.variant,
      colors: this.colors,
    });
  }

  private createGpu() {
    const { gl } = this.wrapper;
    const buffer = this.wrapper.createBuffer();
    const vao = this.wrapper.createVertexArray();
    const program = this.wrapper.createProgram(VS, FS);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, SLOT_COUNT * LOD_TILE_VERTICES * STRIDE, gl.DYNAMIC_DRAW);
    gl.vertexAttribIPointer(0, 3, gl.INT, STRIDE, 0);
    gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, true, STRIDE, 12);
    gl.vertexAttribIPointer(2, 1, gl.UNSIGNED_INT, STRIDE, 16);
    for (let i = 0; i < 3; i++) gl.enableVertexAttribArray(i);
    gl.bindVertexArray(null);
    return {
      buffer,
      vao,
      program,
      viewProj: gl.getUniformLocation(program, 'u_viewProj'),
      center: gl.getUniformLocation(program, 'u_center'),
      distance: gl.getUniformLocation(program, 'u_distance'),
      detail: gl.getUniformLocation(program, 'u_detail[0]'),
      camera: gl.getUniformLocation(program, 'u_camera'),
      sun: gl.getUniformLocation(program, 'u_sun'),
      factors: gl.getUniformLocation(program, 'u_factors'),
      weatherLight: gl.getUniformLocation(program, 'u_weatherLight'),
      fog: gl.getUniformLocation(program, 'u_fog'),
      waterFog: gl.getUniformLocation(program, 'u_waterFog'),
      underwater: gl.getUniformLocation(program, 'u_underwater'),
    };
  }

  upload(deadline: number, limit = Infinity): void {
    if (this.planTimer !== undefined || this.ready.length === 0 || performance.now() >= deadline)
      return;
    const { gl } = this.wrapper;
    if (!this.gpu) {
      this.gpu = this.createGpu();
      // Recheck the shared deadline before sending vertex data.
      return;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu.buffer);
    while (limit > 0 && this.ready.length && performance.now() < deadline) {
      const tile = this.ready.shift()!;
      if (this.tileLookup.get(tile.key) !== tile) continue;
      const mesh = tile.mesh!;
      tile.slot = this.slots.pop()!;
      gl.bufferSubData(gl.ARRAY_BUFFER, tile.slot * LOD_TILE_VERTICES * STRIDE, mesh.vertices);
      tile.maxY = mesh.maxY;
      tile.mesh = undefined;
      tile.state = 'uploaded';
      this.uploaded++;
      limit--;
    }
  }

  draw(viewProj: mat4, planes: ArrayLike<number>, sky: number, atmosphere: LodAtmosphere): number {
    this.visibleTiles = 0;
    this.drawSubmissions = 0;
    const gpu = this.gpu;
    if (!gpu) return 0;
    const mask = this.mask;
    for (let i = 0; i < this.tiles.length; i++) {
      const tile = this.tiles[i]!;
      if (tile.state !== 'uploaded') continue;
      const x = tile.tx * LOD_TILE_SIZE;
      const z = tile.tz * LOD_TILE_SIZE;
      if (!aabbIntersectsFrustum(planes, x, 0, z, x + LOD_TILE_SIZE, tile.maxY, z + LOD_TILE_SIZE))
        continue;
      const cx = tile.tx * LOD_TILE_COLUMNS;
      const cz = tile.tz * LOD_TILE_COLUMNS;
      if (!this.hasVisibleColumn(cx, cz)) continue;
      this.firsts[this.visibleTiles++] = tile.slot * LOD_TILE_VERTICES;
    }
    if (!this.visibleTiles) return 0;

    const { gl } = this.wrapper;
    gl.useProgram(gpu.program);
    gl.bindVertexArray(gpu.vao);
    gl.uniformMatrix4fv(gpu.viewProj, false, viewProj);
    gl.uniform2i(gpu.center, mask.cx, mask.cz);
    gl.uniform1i(gpu.distance, this.rd);
    gl.uniform1uiv(gpu.detail, mask.rows);
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
      Math.max(sky, LIGHT_MIN_BRIGHTNESS, underwater?.brightnessFloor ?? 0),
    );
    gl.uniform2f(gpu.fog, atmosphere.fogStart, atmosphere.fogEnd);
    gl.uniform1i(gpu.underwater, underwater?.submerged ? 1 : 0);
    if (underwater) gl.uniform3fv(gpu.waterFog, underwater.fogColor);
    if (this.multiDraw) {
      const start = renderPhaseStats.start();
      this.multiDraw.multiDrawArraysWEBGL(
        gl.TRIANGLES,
        this.firsts,
        0,
        this.counts,
        0,
        this.visibleTiles,
      );
      this.wrapper.recordDrawSubmission();
      renderPhaseStats.end('drawSubmissionMs', start);
      this.drawSubmissions = 1;
    } else {
      for (let i = 0; i < this.visibleTiles; i++)
        this.wrapper.drawArrays(gl.TRIANGLES, this.firsts[i]!, LOD_TILE_VERTICES);
      this.drawSubmissions = this.visibleTiles;
    }
    return this.visibleTiles;
  }

  get submittedTriangles(): number {
    return (this.visibleTiles * LOD_TILE_VERTICES) / 3;
  }

  covers(cx: number, cz: number): boolean {
    return (
      this.tileLookup.get(
        columnKey(Math.floor(cx / LOD_TILE_COLUMNS), Math.floor(cz / LOD_TILE_COLUMNS)),
      )?.state === 'uploaded'
    );
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
    return {
      tiles: this.uploaded,
      visibleTiles: this.visibleTiles,
      drawSubmissions: this.drawSubmissions,
      pendingJobs: this.tiles.length - this.uploaded,
      coverageRadius:
        this.planTimer === undefined && this.tiles.length > 0 && this.uploaded === this.tiles.length
          ? this.rd
          : 0,
      fullDetailRadius,
    };
  }
}
