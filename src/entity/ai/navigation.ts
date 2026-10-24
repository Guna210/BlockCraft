import type { EntityWorld } from '../ecs/world';
import { BodyC, TransformC } from '../ecs/components';
import type { Vec3 } from '../ecs/model';
import { MobBodyC } from './components';
import type { BlockPos, NodeClassification, PathSearch, Pathfinder } from './pathfinding';

/** Nodes all mobs together may expand in one tick. */
export const PATH_NODE_BUDGET = 2000;
/** Searches stepped at once; each holds a large pooled context, so the rest wait in a queue. */
export const MAX_ACTIVE_SEARCHES = 3;
/** A search that expands this many nodes gives up as 'limit'. */
export const MAX_SEARCH_NODES = 4000;
/** Re-path when the goal moved more than this far from the one the path was made for. */
export const REPATH_DISTANCE = 2;
/** At most one re-path per this many ticks while a mob is already moving. */
export const REPATH_INTERVAL = 20;
/** A waypoint not reached in this many ticks fails the path. */
const STUCK_TICKS = 60;

export type PathRequestStatus = 'queued' | 'pending' | 'success' | 'unreachable' | 'limit';

export class PathRequest {
  search: PathSearch | null = null;
  status: PathRequestStatus = 'queued';
  path: BlockPos[] | null = null;
  constructor(
    readonly owner: number,
    readonly start: BlockPos,
    readonly goal: BlockPos,
    readonly height: 1 | 2,
  ) {}
  get finished(): boolean {
    return this.status !== 'queued' && this.status !== 'pending';
  }
}

/**
 * Shares one per-tick node budget between every mob's incremental A* search, round-robin. A few
 * searches run at once; the others queue. Abandoned searches are disposed.
 */
export class PathScheduler {
  private readonly queue: PathRequest[] = [];
  private readonly active: PathRequest[] = [];
  private cursor = 0;
  /** Nodes expanded by the last tick(). */
  lastExpanded = 0;
  constructor(
    readonly pathfinder: Pathfinder,
    readonly budget = PATH_NODE_BUDGET,
  ) {}

  request(owner: number, start: BlockPos, goal: BlockPos, height: 1 | 2): PathRequest {
    const request = new PathRequest(owner, start, goal, height);
    this.queue.push(request);
    return request;
  }

  /** Drops a request; a running search is disposed. */
  cancel(request: PathRequest): void {
    const queued = this.queue.indexOf(request);
    if (queued >= 0) this.queue.splice(queued, 1);
    const active = this.active.indexOf(request);
    if (active >= 0) {
      this.active.splice(active, 1);
      request.search?.dispose?.();
    }
    if (!request.finished) request.status = 'unreachable';
  }

  /** Cancels every request whose owner is gone. */
  prune(alive: (owner: number) => boolean): void {
    for (const request of [...this.queue, ...this.active])
      if (!alive(request.owner)) this.cancel(request);
  }

  /** Requests not finished yet. */
  get outstanding(): number {
    return this.queue.length + this.active.length;
  }

  /** Cancels everything (world unload). */
  clear(): void {
    for (const request of [...this.queue, ...this.active]) this.cancel(request);
  }

  tick(): void {
    let remaining = this.budget;
    let expanded = 0;
    for (;;) {
      this.fill();
      if (this.active.length === 0 || remaining <= 0) break;
      let progress = false;
      const count = this.active.length;
      const start = this.cursor % count;
      for (let i = 0; i < count && remaining > 0; i++) {
        const request = this.active[(start + i) % count]!;
        const search = request.search!;
        const share = Math.max(1, Math.floor(remaining / (count - i)));
        const before = search.nodesExpanded;
        const status = search.step(Math.min(share, remaining, MAX_SEARCH_NODES - before));
        const used = search.nodesExpanded - before;
        remaining -= used;
        expanded += used;
        if (used > 0) progress = true;
        if (status === 'pending' && search.nodesExpanded >= MAX_SEARCH_NODES) {
          search.dispose?.();
          request.status = 'limit';
        } else if (status !== 'pending') this.finish(request);
        if (request.finished) progress = true;
      }
      this.cursor++;
      for (let i = this.active.length - 1; i >= 0; i--)
        if (this.active[i]!.finished) this.active.splice(i, 1);
      if (!progress) break;
    }
    this.lastExpanded = expanded;
  }

  private fill(): void {
    while (this.active.length < MAX_ACTIVE_SEARCHES && this.queue.length > 0) {
      const request = this.queue.shift()!;
      request.search = this.pathfinder.createSearch(request.start, request.goal, {
        height: request.height,
      });
      request.status = 'pending';
      if (request.search.status === 'pending') this.active.push(request);
      else this.finish(request);
    }
  }

  private finish(request: PathRequest): void {
    const search = request.search!;
    request.status = search.status === 'pending' ? 'limit' : search.status;
    request.path = search.status === 'success' ? search.path : null;
  }
}

/** What a navigator needs from the mob runtime. */
export interface NavigationHost {
  readonly ecs: EntityWorld;
  readonly scheduler: PathScheduler;
  classify(x: number, y: number, z: number): NodeClassification;
}

export interface MoveOptions {
  /** Multiplier on the body's walking speed. */
  speed?: number;
  /** Steer straight at the goal when no path exists (chasing), instead of giving up. */
  direct?: boolean;
  /** Arrival distance in blocks, horizontally. */
  within?: number;
}

type NavState = 'idle' | 'waiting' | 'following' | 'direct';

/** Follows A* paths for one mob and writes its movement intent; flyers always steer directly. */
export class Navigator {
  private state: NavState = 'idle';
  private path: BlockPos[] | null = null;
  private index = 0;
  private request: PathRequest | null = null;
  private goal: Vec3 | null = null;
  private pathGoal: Vec3 | null = null;
  private lastRequest = -Infinity;
  private waypointTicks = 0;
  private options: Required<MoveOptions> = { speed: 1, direct: false, within: 0.5 };
  /** Set when the last move ended at its goal rather than failing. */
  arrived = false;

  constructor(
    private readonly host: NavigationHost,
    readonly id: number,
  ) {}

  /** Direct fallback after A* could not supply a path (or following became stuck). */
  get failed(): boolean {
    return this.state === 'direct' && this.path === null;
  }

  get idle(): boolean {
    return this.state === 'idle';
  }

  /** Waypoints left on the current path (0 when steering directly or idle). */
  get pathLength(): number {
    return this.path ? Math.max(0, this.path.length - this.index) : 0;
  }

  get target(): Readonly<Vec3> | null {
    return this.goal;
  }

  /** Starts or updates a move. A moving mob re-paths only as REPATH_DISTANCE/INTERVAL allow. */
  moveTo(x: number, y: number, z: number, options: MoveOptions = {}): void {
    this.options = {
      speed: options.speed ?? 1,
      direct: options.direct ?? false,
      within: options.within ?? 0.5,
    };
    const goal: Vec3 = [x, y, z];
    this.goal = goal;
    this.arrived = false;
    const body = this.host.ecs.get(this.id, MobBodyC);
    if (body?.flying) {
      this.state = 'direct';
      return;
    }
    if (this.state === 'idle') {
      this.repath();
      return;
    }
    const moved = this.pathGoal ? distance(goal, this.pathGoal) : Infinity;
    if (moved > REPATH_DISTANCE && this.host.ecs.time - this.lastRequest >= REPATH_INTERVAL)
      this.repath();
  }

  stop(): void {
    if (this.request) this.host.scheduler.cancel(this.request);
    this.request = null;
    this.path = null;
    this.goal = null;
    this.pathGoal = null;
    this.state = 'idle';
  }

  /** Writes this tick's wish velocity and jump flag. */
  tick(): void {
    const ecs = this.host.ecs;
    const body = ecs.get(this.id, MobBodyC),
      transform = ecs.get(this.id, TransformC);
    if (!body || !transform || !this.goal) return;
    const pos = transform.pos;
    if (this.request?.finished) {
      const request = this.request;
      this.request = null;
      if (request.status === 'success' && request.path) {
        this.path = request.path;
        this.index = request.path.length > 1 ? 1 : 0;
        this.waypointTicks = 0;
        this.state = 'following';
      } else if (this.options.direct) {
        this.path = null;
        this.state = 'direct';
      } else if (this.state === 'waiting' || !this.path) {
        this.fail();
        return;
      }
    }
    const speed = body.speed * this.options.speed;
    if (this.state === 'following' && this.path) {
      let waypoint = this.path[this.index];
      while (waypoint && reached(pos, waypoint, body)) {
        this.index++;
        this.waypointTicks = 0;
        waypoint = this.path[this.index];
      }
      if (!waypoint) {
        this.path = null;
        if (horizontal(pos, this.goal) <= Math.max(1, this.options.within + 0.5)) this.finish();
        else if (this.options.direct) this.state = 'direct';
        else this.finish();
        return;
      }
      if (++this.waypointTicks > STUCK_TICKS) {
        this.path = null;
        if (this.options.direct) this.state = 'direct';
        else this.fail();
        return;
      }
      steer(body, pos, waypoint[0] + 0.5, waypoint[2] + 0.5, speed);
      if (waypoint[1] > pos[1] + 0.5 || (body.horizontalCollision && body.onGround))
        body.jump = true;
      if (body.inFluid && waypoint[1] >= Math.floor(pos[1])) body.jump = true;
    } else if (this.state === 'direct') {
      if (
        horizontal(pos, this.goal) <= this.options.within &&
        (body.flying || Math.abs(pos[1] - this.goal[1]) < 1.5)
      ) {
        this.finish();
        return;
      }
      steer(body, pos, this.goal[0], this.goal[2], speed);
      if (body.flying) {
        const dy = this.goal[1] - pos[1];
        body.wish[1] = Math.max(-speed, Math.min(speed, dy * 0.5));
      } else if (body.horizontalCollision || body.inFluid) body.jump = true;
      if (!body.flying && !this.request && ecs.time - this.lastRequest >= REPATH_INTERVAL)
        this.repath();
    }
  }

  private finish(): void {
    const goal = this.goal;
    this.stop();
    this.arrived = goal !== null;
  }

  private fail(): void {
    this.stop();
    this.arrived = false;
  }

  private repath(): void {
    const ecs = this.host.ecs;
    const transform = ecs.get(this.id, TransformC),
      bodySize = ecs.get(this.id, BodyC);
    if (!transform || !this.goal) return;
    if (this.request) this.host.scheduler.cancel(this.request);
    const height = (bodySize?.height ?? 2) <= 1 ? 1 : 2;
    const start = this.standCell(transform.pos);
    const goal = this.standCell(this.goal);
    this.request = this.host.scheduler.request(this.id, start, goal, height);
    this.pathGoal = [...this.goal];
    this.lastRequest = ecs.time;
    if (this.state === 'idle') this.state = 'waiting';
  }

  /** The block cell a position stands in, lowered by up to 3 blocks onto something solid. */
  private standCell(pos: Readonly<Vec3>): BlockPos {
    const x = Math.floor(pos[0]),
      z = Math.floor(pos[2]);
    let y = Math.floor(pos[1] + 0.01);
    for (let i = 0; i < 3; i++) {
      const here = this.host.classify(x, y, z);
      if (here === 'water' || this.host.classify(x, y - 1, z) === 'solid') break;
      y--;
    }
    return [x, y, z];
  }
}

function distance(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function horizontal(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

function reached(
  pos: Readonly<Vec3>,
  cell: BlockPos,
  body: { onGround: boolean; inFluid: boolean },
): boolean {
  const dx = pos[0] - (cell[0] + 0.5),
    dz = pos[2] - (cell[2] + 0.5);
  return (
    dx * dx + dz * dz < 0.35 * 0.35 &&
    pos[1] >= cell[1] - 0.5 &&
    pos[1] < cell[1] + 1 &&
    (body.onGround || body.inFluid || pos[1] - cell[1] < 0.6)
  );
}

/** Sets the horizontal wish toward (x, z) at `speed`, slowing on the final approach. */
export function steer(
  body: { wish: Vec3 },
  pos: Readonly<Vec3>,
  x: number,
  z: number,
  speed: number,
): void {
  const dx = x - pos[0],
    dz = z - pos[2];
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) {
    body.wish[0] = 0;
    body.wish[2] = 0;
    return;
  }
  const s = Math.min(speed, length);
  body.wish[0] = (dx / length) * s;
  body.wish[2] = (dz / length) * s;
}
