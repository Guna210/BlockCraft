/**
 * Terrain streaming: the single owner of column state (queued / generating / generated / queued for
 * meshing / meshing / meshed). It decides which columns around the camera are generated, meshed,
 * uploaded and freed, in what order, and never infers a column's state from the world's contents.
 * See decisions/M04a-streaming.md for the rules; the pure parts live in streaming-plan.ts.
 *
 * The streamer is generic over the generation result `G` and the section mesh result `M` and talks to
 * the world, the worker pools and the GPU only through `StreamerHost`, so its logic is unit-tested
 * with a fake host.
 */
import {
  ColumnPhase,
  DEFAULT_RENDER_DISTANCE,
  PriorityKey,
  PriorityView,
  TravelTracker,
  canFreeData,
  chebyshev,
  clampRenderDistance,
  columnKey,
  comparePriority,
  computePriority,
  hasData,
  makePriorityKey,
  neighboursReady,
  streamRings,
  type StreamRings,
} from './streaming-plan';

export interface StreamerHost<G, M> {
  /** Starts generating a column on a worker. */
  requestGen(cx: number, cz: number): Promise<G>;
  /** Stores a generation result in the world. */
  applyGen(cx: number, cz: number, data: G): void;
  /**
   * Builds and starts the mesh jobs of a column: one promise per section that needs a mesh. An
   * empty array means the column needs no mesh.
   */
  requestMesh(cx: number, cz: number): Array<Promise<M>>;
  /** Uploads one section mesh to the GPU. */
  uploadSection(cx: number, cz: number, mesh: M): void;
  /** Deletes every GPU resource of a column's meshes. */
  freeMesh(cx: number, cz: number): void;
  /** Deletes a column's block and light data from the world. */
  freeData(cx: number, cz: number): void;
  /** Milliseconds, monotonic. */
  now(): number;
  /** Reports the main-thread time of one streaming task that ran outside the frame callback. */
  recordSlice?(ms: number): void;
}

/** What the streamer needs to know about the camera, once per frame. */
export interface StreamerView {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  /** Frustum planes (src/render/frustum.ts) for the in-frustum priority, or null. */
  planes: ArrayLike<number> | null;
}

export interface StreamingStats {
  renderDistance: number;
  genQueued: number;
  genRunning: number;
  meshQueued: number;
  meshRunning: number;
  uploadsDeferred: number;
  cancelledJobs: number;
}

export interface RegionRequest {
  cx: number;
  cz: number;
  /** Columns up to this Chebyshev radius around (cx, cz) must hold block data. */
  genRadius: number;
  /** Columns up to this radius must be meshed and uploaded; -1 for none. */
  meshRadius: number;
}

interface Column {
  cx: number;
  cz: number;
  key: number;
  phase: ColumnPhase;
  /** Bumped whenever results of earlier jobs for this column must be ignored. */
  serial: number;
  /** GPU meshes (or a part of them) exist for this column. */
  hasMesh: boolean;
  /** Section results of the current attempt that were dropped or are still to come. */
  jobsLeft: number;
  uploadsPending: number;
  stale: boolean;
  failed: boolean;
  prio: PriorityKey;
}

interface Pending<M> {
  col: Column;
  serial: number;
  mesh: M;
}

interface PendingRequest {
  req: RegionRequest;
  resolve: () => void;
}

interface Token {
  abandoned: boolean;
  remaining: number;
}

/** Longest a frame-less pump slice may run (the upload budget of one frame). */
const SLICE_MS = 3;
/** Camera rotation (radians) that triggers a re-prioritisation. */
const VIEW_CHANGE_RAD = 0.05;

export class Streamer<G, M> {
  public renderDistance = DEFAULT_RENDER_DISTANCE;
  /** How much work may be in flight at once; the owner sets it from the worker pool sizes. */
  public limits = { maxGenInFlight: 4, maxMeshColumnsInFlight: 2, maxDeferred: 256 };
  /** Off: only columns pinned by region requests are loaded (createWorld's barrier). */
  public backgroundEnabled = true;
  /** Off after resetWorldToEmpty: tests then drive the world by hand. */
  public active = true;

  private epoch = 0;
  private cols = new Map<number, Column>();
  private genQueue: Column[] = [];
  private meshQueue: Column[] = [];
  private genTokens = new Set<Token>();
  private meshTokens = new Set<Token>();
  private deferred: Array<Pending<M>> = [];
  private requests: PendingRequest[] = [];
  private cancelled = 0;

  private camX = 0;
  private camZ = 0;
  private camCX = 0;
  private camCZ = 0;
  private yaw = 0;
  private pitch = 0;
  private planes: ArrayLike<number> | null = null;
  private lastPlanYaw = 0;
  private lastPlanPitch = 0;
  private lastPlanCX = Number.NaN;
  private lastPlanCZ = Number.NaN;
  private lastUpdateAt = -Infinity;
  private planDirty = true;
  private freesPending = false;
  private travel = new TravelTracker();
  private view: PriorityView = {
    x: 0,
    z: 0,
    cx: 0,
    cz: 0,
    travelX: 0,
    travelZ: 0,
    planes: null,
  };

  private pumpScheduled = false;
  private pumpTimer: ReturnType<typeof setTimeout> | null = null;
  private pumpDueAt = 0;

  constructor(private readonly host: StreamerHost<G, M>) {}

  // ---------------------------------------------------------------------------------------------
  // Queries

  /** Phase of a column, or undefined when the streamer knows nothing about it. */
  public phaseOf(cx: number, cz: number): ColumnPhase | undefined {
    return this.cols.get(columnKey(cx, cz))?.phase;
  }

  /** Columns that hold block data. */
  public get loadedColumns(): number {
    let n = 0;
    for (const col of this.cols.values()) if (hasData(col.phase)) n++;
    return n;
  }

  /** Columns whose meshes are all uploaded. */
  public get meshedColumns(): number {
    let n = 0;
    for (const col of this.cols.values()) if (col.phase === 'meshed') n++;
    return n;
  }

  public get cameraColumn(): { cx: number; cz: number } {
    return { cx: this.camCX, cz: this.camCZ };
  }

  public getStats(): StreamingStats {
    return {
      renderDistance: this.renderDistance,
      genQueued: this.genQueue.length,
      genRunning: this.genTokens.size,
      meshQueued: this.meshQueue.length,
      meshRunning: this.meshTokens.size,
      uploadsDeferred: this.deferred.length,
      cancelledJobs: this.cancelled,
    };
  }

  /** Work that is queued, running or waiting for an upload. */
  public get busy(): boolean {
    return (
      this.genQueue.length > 0 ||
      this.meshQueue.length > 0 ||
      this.genTokens.size > 0 ||
      this.meshTokens.size > 0 ||
      this.deferred.length > 0 ||
      this.freesPending
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Control

  /**
   * Forgets every column and request. Called whenever the world is replaced. Pending requests are
   * resolved (their world is gone, as before); running jobs finish and their results are ignored.
   */
  public reset(cx = 0, cz = 0): void {
    this.epoch++;
    for (const t of this.genTokens) t.abandoned = true;
    for (const t of this.meshTokens) t.abandoned = true;
    this.genTokens.clear();
    this.meshTokens.clear();
    this.cols.clear();
    this.genQueue.length = 0;
    this.meshQueue.length = 0;
    this.deferred.length = 0;
    this.cancelled = 0;
    const requests = this.requests.splice(0);
    this.camCX = cx;
    this.camCZ = cz;
    this.camX = cx * 16 + 8;
    this.camZ = cz * 16 + 8;
    this.view.cx = cx;
    this.view.cz = cz;
    this.view.x = this.camX;
    this.view.z = this.camZ;
    this.view.travelX = 0;
    this.view.travelZ = 0;
    this.lastPlanCX = Number.NaN;
    this.travel.reset();
    this.planDirty = true;
    this.freesPending = false;
    for (const r of requests) r.resolve();
  }

  /** Sets the render distance (rounded, clamped to 2..32) and re-plans at once. */
  public setRenderDistance(n: number): number {
    this.renderDistance = clampRenderDistance(n);
    this.plan();
    this.dispatch();
    this.schedulePump();
    return this.renderDistance;
  }

  /**
   * Loads a region at top priority and resolves when every column within `meshRadius` is meshed and
   * uploaded (or, with meshRadius -1, when every column within `genRadius` holds data). The
   * region's columns stay pinned (never cancelled or freed) until the promise resolves.
   */
  public requestRegion(req: RegionRequest): Promise<void> {
    return new Promise<void>((resolve) => {
      this.requests.push({ req: { ...req }, resolve });
      this.plan();
      this.dispatch();
      this.checkRequests();
      this.schedulePump();
    });
  }

  /**
   * Registers a column whose block data was put into the world by other means (main-thread
   * generation). A queued or running generation of it is cancelled and its result ignored.
   */
  public adoptColumn(cx: number, cz: number): void {
    const key = columnKey(cx, cz);
    let col = this.cols.get(key);
    if (!col) {
      col = this.newColumn(cx, cz, 'generated');
      this.cols.set(key, col);
    } else if (col.phase === 'queuedGen') {
      this.removeFrom(this.genQueue, col);
      col.phase = 'generated';
      col.failed = false;
      this.cancelled++;
    } else if (col.phase === 'generating') {
      col.serial++;
      col.phase = 'generated';
      this.cancelled++;
    } else {
      // Data replaced under an existing mesh: the mesh may be stale.
      this.invalidate(cx, cz);
      return;
    }
    this.freesPending = true;
    this.tryQueueMeshAround(col);
    this.schedulePump();
  }

  /** Marks a meshed column stale: it is meshed again as soon as it is wanted and its turn comes. */
  public invalidate(cx: number, cz: number): void {
    const col = this.cols.get(columnKey(cx, cz));
    if (!col) return;
    if (col.phase === 'meshed' || col.phase === 'meshing') {
      if (col.phase === 'meshing') this.discardAttempt(col);
      col.phase = 'generated';
      this.tryQueueMesh(col);
      this.schedulePump();
    }
  }

  public invalidateAll(): void {
    for (const col of this.cols.values()) {
      if (col.phase === 'meshed' || col.phase === 'meshing') {
        if (col.phase === 'meshing') this.discardAttempt(col);
        col.phase = 'generated';
      }
    }
    for (const col of this.cols.values()) this.tryQueueMesh(col);
    this.schedulePump();
  }

  /**
   * A worker pool was replaced and its queued and running jobs are gone for good: put the affected
   * columns back to the state before their jobs were dispatched.
   */
  public abandonInFlight(which: { gen: boolean; mesh: boolean }): void {
    if (which.gen) {
      for (const t of this.genTokens) t.abandoned = true;
      this.genTokens.clear();
    }
    if (which.mesh) {
      for (const t of this.meshTokens) t.abandoned = true;
      this.meshTokens.clear();
    }
    for (const col of this.cols.values()) {
      if (which.gen && col.phase === 'generating') {
        col.serial++;
        col.phase = 'queuedGen';
        this.genQueue.push(col);
      } else if (which.mesh && col.phase === 'meshing') {
        this.discardAttempt(col);
        col.phase = 'generated';
      }
    }
    this.planDirty = true;
    this.plan();
    this.dispatch();
    this.schedulePump();
  }

  // ---------------------------------------------------------------------------------------------
  // Frame hooks

  /**
   * Called once per frame from the frame loop: tracks the travel direction, re-plans when the camera
   * changed column or turned (at most once per call) and dispatches work.
   */
  public update(view: StreamerView, nowMs: number): void {
    if (!this.active) return;
    const dt = this.lastUpdateAt > 0 ? (nowMs - this.lastUpdateAt) / 1000 : 0;
    this.lastUpdateAt = nowMs;
    this.camX = view.x;
    this.camZ = view.z;
    this.yaw = view.yaw;
    this.pitch = view.pitch;
    this.planes = view.planes;
    this.travel.update(view.x, view.z, dt);
    this.camCX = Math.floor(view.x / 16);
    this.camCZ = Math.floor(view.z / 16);

    const turned =
      angleDiff(this.yaw, this.lastPlanYaw) > VIEW_CHANGE_RAD ||
      Math.abs(this.pitch - this.lastPlanPitch) > VIEW_CHANGE_RAD;
    if (
      this.planDirty ||
      this.camCX !== this.lastPlanCX ||
      this.camCZ !== this.lastPlanCZ ||
      turned
    ) {
      this.plan();
    }
    // Deleting a column's GPU meshes (a few ms for one column) and starting a mesh job (it copies the
    // column's padded sections on the main thread, up to ~10 ms under load) are not frame work: the
    // pump task that follows the frame does them in slices of SLICE_MS (decisions/M04a-streaming.md).
    this.dispatch(false);
    if (this.meshQueue.length > 0 || this.freesPending) this.schedulePump();
  }

  /**
   * Uploads deferred section meshes while the time spent stays under `budgetMs`. At least one is
   * uploaded when any is waiting. Returns the milliseconds spent.
   */
  public drainUploads(budgetMs: number): number {
    const start = this.host.now();
    let spent = 0;
    while (this.deferred.length > 0 && spent < budgetMs) {
      const item = this.deferred.shift()!;
      const col = item.col;
      if (col.serial !== item.serial || this.cols.get(col.key) !== col) {
        this.cancelled++;
        spent = this.host.now() - start;
        continue;
      }
      this.host.uploadSection(col.cx, col.cz, item.mesh);
      col.hasMesh = true;
      col.uploadsPending--;
      this.finishIfDone(col);
      spent = this.host.now() - start;
    }
    return spent;
  }

  /** Runs a streaming task that is not part of a frame and reports its duration. */
  private task(fn: () => void): void {
    const start = this.host.now();
    try {
      fn();
    } finally {
      this.host.recordSlice?.(this.host.now() - start);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Planning

  private newColumn(cx: number, cz: number, phase: ColumnPhase): Column {
    return {
      cx,
      cz,
      key: columnKey(cx, cz),
      phase,
      serial: 0,
      hasMesh: false,
      jobsLeft: 0,
      uploadsPending: 0,
      stale: false,
      failed: false,
      prio: makePriorityKey(),
    };
  }

  private ringsRd = -1;
  private ringsCache = streamRings(DEFAULT_RENDER_DISTANCE);

  /** The rings of the current render distance, computed once per change (they are read per column). */
  private currentRings(): StreamRings {
    if (this.ringsRd !== this.renderDistance) {
      this.ringsCache = streamRings(this.renderDistance);
      this.ringsRd = this.renderDistance;
    }
    return this.ringsCache;
  }

  private pinnedGen(cx: number, cz: number): boolean {
    for (const r of this.requests) {
      if (chebyshev(cx, cz, r.req.cx, r.req.cz) <= r.req.genRadius) return true;
    }
    return false;
  }

  private pinnedMesh(cx: number, cz: number): boolean {
    for (const r of this.requests) {
      if (chebyshev(cx, cz, r.req.cx, r.req.cz) <= r.req.meshRadius) return true;
    }
    return false;
  }

  private wantGen(cx: number, cz: number): boolean {
    if (this.backgroundEnabled && this.active) {
      if (chebyshev(cx, cz, this.camCX, this.camCZ) <= this.currentRings().gen) {
        return true;
      }
    }
    return this.pinnedGen(cx, cz);
  }

  private wantMesh(cx: number, cz: number): boolean {
    if (this.backgroundEnabled && this.active) {
      if (chebyshev(cx, cz, this.camCX, this.camCZ) <= this.currentRings().mesh) {
        return true;
      }
    }
    return this.pinnedMesh(cx, cz);
  }

  private keepMesh(cx: number, cz: number): boolean {
    const d = chebyshev(cx, cz, this.camCX, this.camCZ);
    return d <= this.currentRings().keepMesh || this.pinnedMesh(cx, cz);
  }

  private keepData(cx: number, cz: number): boolean {
    const d = chebyshev(cx, cz, this.camCX, this.camCZ);
    return d <= this.currentRings().keepData || this.pinnedGen(cx, cz);
  }

  private phaseAt = (cx: number, cz: number): ColumnPhase | undefined => this.phaseOf(cx, cz);

  private holdsMeshAt = (cx: number, cz: number): boolean => {
    const col = this.cols.get(columnKey(cx, cz));
    return col !== undefined && (col.hasMesh || col.phase === 'meshing');
  };

  private removeFrom(queue: Column[], col: Column): void {
    const i = queue.indexOf(col);
    if (i >= 0) queue.splice(i, 1);
  }

  /** Moves a generated column into the mesh queue if it is wanted and its perimeter is loaded. */
  private tryQueueMesh(col: Column): void {
    if (col.phase !== 'generated') return;
    if (!this.wantMesh(col.cx, col.cz)) return;
    if (!neighboursReady(col.cx, col.cz, this.phaseAt)) return;
    col.phase = 'queuedMesh';
    this.refreshView();
    computePriority(col.prio, this.view, col.cx, col.cz, this.pinnedMesh(col.cx, col.cz));
    this.meshQueue.push(col);
    this.meshSorted = false;
  }

  private tryQueueMeshAround(col: Column): void {
    this.tryQueueMesh(col);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const n = this.cols.get(columnKey(col.cx + dx, col.cz + dz));
        if (n) this.tryQueueMesh(n);
      }
    }
  }

  private genSorted = true;
  private meshSorted = true;

  private refreshView(): void {
    this.view.x = this.camX;
    this.view.z = this.camZ;
    this.view.cx = this.camCX;
    this.view.cz = this.camCZ;
    this.view.travelX = this.travel.dirX;
    this.view.travelZ = this.travel.dirZ;
    this.view.planes = this.planes;
  }

  /**
   * Re-plans: cancels queued work for columns that left their ring, queues newly wanted columns and
   * recomputes the priority of everything queued. Frees are done by freePass.
   */
  public plan(): void {
    if (!this.active && this.requests.length === 0) {
      this.planDirty = false;
      return;
    }
    this.refreshView();
    this.lastPlanCX = this.camCX;
    this.lastPlanCZ = this.camCZ;
    this.lastPlanYaw = this.yaw;
    this.lastPlanPitch = this.pitch;
    this.planDirty = false;

    // 1. Cancel queued work that is no longer wanted.
    for (const col of this.cols.values()) {
      if (col.phase === 'queuedGen' && !this.wantGen(col.cx, col.cz)) {
        this.removeFrom(this.genQueue, col);
        this.cols.delete(col.key);
        this.cancelled++;
      } else if (col.phase === 'queuedMesh' && !this.wantMesh(col.cx, col.cz)) {
        this.removeFrom(this.meshQueue, col);
        col.phase = 'generated';
        this.cancelled++;
      }
    }

    // 2. Queue what is wanted and not yet known.
    const rings = this.currentRings();
    if (this.backgroundEnabled && this.active) {
      this.enqueueSquare(this.camCX, this.camCZ, rings.gen, rings.mesh);
    }
    for (const r of this.requests) {
      this.enqueueSquare(r.req.cx, r.req.cz, r.req.genRadius, r.req.meshRadius);
    }

    // 3. Re-prioritise everything queued.
    for (const col of this.genQueue) {
      computePriority(col.prio, this.view, col.cx, col.cz, this.pinnedGen(col.cx, col.cz));
    }
    for (const col of this.meshQueue) {
      computePriority(col.prio, this.view, col.cx, col.cz, this.pinnedMesh(col.cx, col.cz));
    }
    this.genSorted = false;
    this.meshSorted = false;

    this.freesPending = this.hasFreeWork();
  }

  private enqueueSquare(cx: number, cz: number, genRadius: number, meshRadius: number): void {
    for (let z = cz - genRadius; z <= cz + genRadius; z++) {
      for (let x = cx - genRadius; x <= cx + genRadius; x++) {
        const key = columnKey(x, z);
        let col = this.cols.get(key);
        if (!col) {
          if (!this.wantGen(x, z)) continue;
          col = this.newColumn(x, z, 'queuedGen');
          this.cols.set(key, col);
          computePriority(col.prio, this.view, x, z, this.pinnedGen(x, z));
          this.genQueue.push(col);
        }
        if (
          col.phase === 'generated' &&
          Math.abs(x - cx) <= meshRadius &&
          Math.abs(z - cz) <= meshRadius
        ) {
          this.tryQueueMesh(col);
        }
      }
    }
  }

  private hasFreeWork(): boolean {
    for (const col of this.cols.values()) {
      if (col.hasMesh && !this.keepMesh(col.cx, col.cz)) return true;
      if (hasData(col.phase) && !this.keepData(col.cx, col.cz)) return true;
    }
    return false;
  }

  /**
   * Frees GPU meshes of columns beyond the keep-mesh ring, then block and light data beyond the
   * keep-data ring, while the time spent stays under `budgetMs` (at least one column is freed when
   * any is due). Meshes go first, and data is freed only when no neighbour holds a mesh, so a
   * meshed section never loses a neighbour column.
   */
  public freePass(budgetMs: number): void {
    if (!this.freesPending) return;
    const start = this.host.now();
    let freed = 0;
    const over = () => freed > 0 && this.host.now() - start >= budgetMs;

    for (const col of this.cols.values()) {
      if ((col.hasMesh || col.phase === 'meshing') && !this.keepMesh(col.cx, col.cz)) {
        if (over()) break;
        this.freeMeshOf(col);
        freed++;
      }
    }
    for (const col of this.cols.values()) {
      if (!hasData(col.phase) || this.keepData(col.cx, col.cz)) continue;
      if (!canFreeData(col.cx, col.cz, this.holdsMeshAt)) continue;
      if (over()) break;
      if (col.phase === 'queuedMesh') this.removeFrom(this.meshQueue, col);
      this.host.freeData(col.cx, col.cz);
      this.cols.delete(col.key);
      freed++;
    }
    this.freesPending = this.hasFreeWork();
    if (this.freesPending) this.schedulePump();
  }

  /** Deletes a column's GPU meshes and invalidates all of its mesh jobs. */
  private freeMeshOf(col: Column): void {
    if (col.hasMesh) this.host.freeMesh(col.cx, col.cz);
    col.hasMesh = false;
    if (col.phase === 'queuedMesh') this.removeFrom(this.meshQueue, col);
    this.discardAttempt(col);
    if (hasData(col.phase)) col.phase = 'generated';
  }

  /** Invalidates the mesh jobs and deferred uploads of the current attempt. */
  private discardAttempt(col: Column): void {
    col.serial++;
    col.jobsLeft = 0;
    col.uploadsPending = 0;
    col.stale = false;
  }

  // ---------------------------------------------------------------------------------------------
  // Dispatch and results

  private dispatch(startMeshJobs = true): void {
    if (!this.active && this.requests.length === 0) return;
    if (!this.genSorted) {
      this.genQueue.sort((a, b) => comparePriority(a.prio, b.prio));
      this.genSorted = true;
    }
    while (this.genQueue.length > 0 && this.genTokens.size < this.limits.maxGenInFlight) {
      this.startGen(this.genQueue.shift()!);
    }

    if (!this.meshSorted) {
      this.meshQueue.sort((a, b) => comparePriority(a.prio, b.prio));
      this.meshSorted = true;
    }
    if (!startMeshJobs) return;
    const sliceStart = this.host.now();
    let started = 0;
    while (
      this.meshQueue.length > 0 &&
      this.meshTokens.size < this.limits.maxMeshColumnsInFlight &&
      this.deferred.length < this.limits.maxDeferred
    ) {
      // One slice of preparation work per task; the rest follows in the next one.
      if (started > 0 && this.host.now() - sliceStart >= SLICE_MS) {
        this.schedulePump();
        break;
      }
      this.startMesh(this.meshQueue.shift()!);
      started++;
    }
  }

  private startGen(col: Column): void {
    col.phase = 'generating';
    const token: Token = { abandoned: false, remaining: 1 };
    const serial = col.serial;
    const epoch = this.epoch;
    this.genTokens.add(token);
    this.host.requestGen(col.cx, col.cz).then(
      (data) => {
        if (token.abandoned || epoch !== this.epoch) return;
        this.genTokens.delete(token);
        this.task(() => this.onGen(col, serial, data));
      },
      () => {
        if (token.abandoned || epoch !== this.epoch) return;
        this.genTokens.delete(token);
        if (col.serial === serial && this.cols.get(col.key) === col) {
          col.failed = true;
          col.phase = 'queuedGen';
        }
        this.dispatch();
      },
    );
  }

  private onGen(col: Column, serial: number, data: G): void {
    if (col.serial !== serial || this.cols.get(col.key) !== col || col.phase !== 'generating') {
      // Adopted (generated on the main thread) or freed meanwhile.
      this.cancelled++;
      this.dispatch();
      return;
    }
    if (!this.wantGen(col.cx, col.cz)) {
      this.cols.delete(col.key);
      this.cancelled++;
      this.dispatch();
      return;
    }
    this.host.applyGen(col.cx, col.cz, data);
    col.phase = 'generated';
    this.tryQueueMeshAround(col);
    this.dispatch();
    this.schedulePump();
  }

  private startMesh(col: Column): void {
    if (col.phase !== 'queuedMesh') return;
    if (!this.wantMesh(col.cx, col.cz) || !neighboursReady(col.cx, col.cz, this.phaseAt)) {
      col.phase = 'generated';
      this.cancelled++;
      return;
    }
    const promises = this.host.requestMesh(col.cx, col.cz);
    if (promises.length === 0) {
      col.phase = 'meshed';
      this.schedulePump();
      return;
    }
    col.phase = 'meshing';
    col.jobsLeft = promises.length;
    col.uploadsPending = 0;
    col.stale = false;
    const token: Token = { abandoned: false, remaining: promises.length };
    const serial = col.serial;
    const epoch = this.epoch;
    this.meshTokens.add(token);
    const finishJob = () => {
      token.remaining--;
      if (token.remaining === 0) this.meshTokens.delete(token);
    };
    for (const p of promises) {
      p.then(
        (mesh) => {
          if (token.abandoned || epoch !== this.epoch) return;
          finishJob();
          this.task(() => this.onMeshSection(col, serial, mesh));
        },
        () => {
          if (token.abandoned || epoch !== this.epoch) return;
          finishJob();
          if (col.serial === serial) {
            col.stale = true;
            col.failed = true;
            col.jobsLeft--;
            this.finishIfDone(col);
          }
          this.dispatch();
        },
      );
    }
  }

  private onMeshSection(col: Column, serial: number, mesh: M): void {
    if (col.serial !== serial || this.cols.get(col.key) !== col) {
      this.cancelled++; // the column was freed or restarted since the job was dispatched
      this.dispatch();
      return;
    }
    col.jobsLeft--;
    if (this.wantMesh(col.cx, col.cz) && neighboursReady(col.cx, col.cz, this.phaseAt)) {
      this.deferred.push({ col, serial, mesh });
      col.uploadsPending++;
    } else {
      col.stale = true;
      this.cancelled++;
    }
    this.finishIfDone(col);
    this.dispatch();
    this.schedulePump();
  }

  /** Completes the column's attempt when all its jobs returned and all its uploads are done. */
  private finishIfDone(col: Column): void {
    if (col.phase !== 'meshing' || col.jobsLeft > 0) return;
    if (col.stale) {
      // Part of the result was dropped: the column is not complete, so it is not meshed.
      if (col.hasMesh) this.host.freeMesh(col.cx, col.cz);
      col.hasMesh = false;
      this.discardAttempt(col);
      col.phase = 'generated';
      if (!col.failed) this.tryQueueMesh(col);
      return;
    }
    if (col.uploadsPending === 0) col.phase = 'meshed';
  }

  // ---------------------------------------------------------------------------------------------
  // Pump: work that happens between frames

  private schedulePump(delayMs = 0): void {
    const dueAt = this.host.now() + delayMs;
    if (this.pumpScheduled) {
      // A later timer must not make an earlier need wait (a request arriving during a delayed pump).
      if (dueAt >= this.pumpDueAt) return;
      if (this.pumpTimer !== null) clearTimeout(this.pumpTimer);
    }
    this.pumpScheduled = true;
    this.pumpDueAt = dueAt;
    this.pumpTimer = setTimeout(() => {
      this.pumpScheduled = false;
      this.pumpTimer = null;
      this.pump();
    }, delayMs);
  }

  public pump(): void {
    this.task(() => this.pumpSlice());
  }

  private pumpSlice(): void {
    this.freePass(SLICE_MS);
    // Uploads happen in the frame, inside its upload budget. Only a pending region request
    // (createWorld, waitForTerrain) may have them done between frames, because it must finish
    // although the frame loop may be suspended (decisions/M04a-streaming.md).
    if (this.requests.length > 0) this.drainUploads(SLICE_MS);
    this.dispatch();
    this.checkRequests();
    // The next slice runs in a separate task, so worker messages and input are handled in between.
    if (this.requests.length > 0 && this.deferred.length > 0 && !this.freesPending) {
      this.schedulePump();
    }
  }

  private checkRequests(): void {
    if (this.requests.length === 0) return;
    const done: PendingRequest[] = [];
    for (const r of this.requests) if (this.requestDone(r.req)) done.push(r);
    if (done.length === 0) return;
    this.requests = this.requests.filter((r) => !done.includes(r));
    for (const r of done) r.resolve();
    // The pins are released: the next plan applies the ring rules to the region again.
    this.planDirty = true;
    this.freesPending = true;
  }

  private requestDone(req: RegionRequest): boolean {
    const mesh = req.meshRadius;
    if (mesh >= 0) {
      for (let z = req.cz - mesh; z <= req.cz + mesh; z++) {
        for (let x = req.cx - mesh; x <= req.cx + mesh; x++) {
          const col = this.cols.get(columnKey(x, z));
          if (col && col.failed) continue;
          if (!col || col.phase !== 'meshed') return false;
        }
      }
    }
    const gen = req.genRadius;
    for (let z = req.cz - gen; z <= req.cz + gen; z++) {
      for (let x = req.cx - gen; x <= req.cx + gen; x++) {
        const col = this.cols.get(columnKey(x, z));
        if (col && col.failed) continue;
        if (!col || !hasData(col.phase)) return false;
      }
    }
    return true;
  }

  /** Cancels the pump timer (tests). */
  public dispose(): void {
    if (this.pumpTimer !== null) clearTimeout(this.pumpTimer);
    this.pumpTimer = null;
    this.pumpScheduled = false;
  }
}

function angleDiff(a: number, b: number): number {
  const d = a - b;
  return Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
}
