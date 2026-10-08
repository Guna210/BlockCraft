/**
 * Pure planning rules of terrain streaming: which columns are wanted in which ring, in which order
 * they are processed, and when their data may be freed. No state, no GL, no workers, so every rule
 * is unit-testable (decisions/M04a-streaming.md).
 *
 * "Chunk" here is a 16x16 column. Distance is the Chebyshev distance in columns from the camera's
 * column.
 */
import { columnInFrustum } from '../render/frustum';

export const MIN_RENDER_DISTANCE = 2;
export const MAX_RENDER_DISTANCE = 32;
export const DEFAULT_RENDER_DISTANCE = 8;

/** Clamps a requested render distance to a whole number in [2, 32]; NaN gives the default. */
export function clampRenderDistance(n: number): number {
  if (Number.isNaN(n)) return DEFAULT_RENDER_DISTANCE;
  return Math.min(MAX_RENDER_DISTANCE, Math.max(MIN_RENDER_DISTANCE, Math.round(n)));
}

/**
 * The rings around the camera column for render distance `rd`:
 * - columns up to `mesh` are meshed,
 * - columns up to `gen` (one more, the perimeter every meshed section needs) are generated,
 * - meshes are freed beyond `keepMesh`, block and light data beyond `keepData`.
 * `keepMesh > mesh` and `keepData > gen` are the hysteresis: a column right at the edge does not
 * flip between loaded and freed while the camera hovers over a column border.
 */
export interface StreamRings {
  mesh: number;
  gen: number;
  keepMesh: number;
  keepData: number;
}

export function streamRings(rd: number): StreamRings {
  return { mesh: rd, gen: rd + 1, keepMesh: rd + 1, keepData: rd + 2 };
}

export function chebyshev(ax: number, az: number, bx: number, bz: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(az - bz));
}

/** Numeric column key, collision free for |cx|, |cz| <= 32767. */
export function columnKey(cx: number, cz: number): number {
  return (cx + 32768) * 65536 + (cz + 32768);
}

/** The columns of Chebyshev ring `ring` around (0, 0) as [dx, dz] pairs. Ring 0 is the centre. */
export function ringOffsets(ring: number): Array<[number, number]> {
  if (ring === 0) return [[0, 0]];
  const out: Array<[number, number]> = [];
  for (let dx = -ring; dx <= ring; dx++) {
    out.push([dx, -ring], [dx, ring]);
  }
  for (let dz = -ring + 1; dz <= ring - 1; dz++) {
    out.push([-ring, dz], [ring, dz]);
  }
  return out;
}

/** Offsets of the eight neighbour columns. */
export const NEIGHBOUR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/**
 * Smoothed travel direction of the camera on the ground plane: an exponential moving average of the
 * displacement per second. Zero while the camera stands still or moves slower than `MIN_SPEED`.
 */
export class TravelTracker {
  /** Time constant of the smoothing, in seconds. */
  static readonly TAU = 0.3;
  /** Blocks per second below which the camera counts as standing still. */
  static readonly MIN_SPEED = 0.5;

  private vx = 0;
  private vz = 0;
  private lastX = 0;
  private lastZ = 0;
  private hasLast = false;
  /** Unit direction of travel, or (0, 0) when still. */
  public dirX = 0;
  public dirZ = 0;

  reset(): void {
    this.vx = 0;
    this.vz = 0;
    this.dirX = 0;
    this.dirZ = 0;
    this.hasLast = false;
  }

  update(x: number, z: number, dtSeconds: number): void {
    if (!this.hasLast || !(dtSeconds > 0)) {
      this.lastX = x;
      this.lastZ = z;
      this.hasLast = true;
      return;
    }
    const alpha = 1 - Math.exp(-dtSeconds / TravelTracker.TAU);
    this.vx += ((x - this.lastX) / dtSeconds - this.vx) * alpha;
    this.vz += ((z - this.lastZ) / dtSeconds - this.vz) * alpha;
    this.lastX = x;
    this.lastZ = z;
    const speed = Math.hypot(this.vx, this.vz);
    if (speed < TravelTracker.MIN_SPEED) {
      this.dirX = 0;
      this.dirZ = 0;
    } else {
      this.dirX = this.vx / speed;
      this.dirZ = this.vz / speed;
    }
  }
}

/** Everything the priority of a column depends on. */
export interface PriorityView {
  /** Camera position in blocks. */
  x: number;
  z: number;
  /** Camera column. */
  cx: number;
  cz: number;
  /** Unit travel direction, (0, 0) when the camera is still. */
  travelX: number;
  travelZ: number;
  /** Frustum planes (see src/render/frustum.ts), or null when the view is unknown. */
  planes: ArrayLike<number> | null;
}

/**
 * Sort key of a column. Lower sorts first. Fields in order of importance:
 * `pinned` (0: a waitForTerrain / createWorld request needs it), `ring` (Chebyshev distance),
 * `outside` (0: in the camera frustum, 1: not), `negDot` (negated dot product of the travel
 * direction with the unit direction from the camera to the column, so columns ahead of the camera
 * come first), `dist2` (exact squared distance from the camera to the column centre).
 */
export interface PriorityKey {
  pinned: number;
  ring: number;
  outside: number;
  negDot: number;
  dist2: number;
}

export function makePriorityKey(): PriorityKey {
  return { pinned: 1, ring: 0, outside: 0, negDot: 0, dist2: 0 };
}

export function computePriority(
  out: PriorityKey,
  view: PriorityView,
  cx: number,
  cz: number,
  pinned: boolean,
): PriorityKey {
  out.pinned = pinned ? 0 : 1;
  out.ring = chebyshev(cx, cz, view.cx, view.cz);
  out.outside = view.planes && !columnInFrustum(view.planes, cx, cz) ? 1 : 0;
  const dx = cx * 16 + 8 - view.x;
  const dz = cz * 16 + 8 - view.z;
  const dist2 = dx * dx + dz * dz;
  out.dist2 = dist2;
  const dist = Math.sqrt(dist2);
  out.negDot = dist > 1e-9 ? -((view.travelX * dx + view.travelZ * dz) / dist) : 0;
  return out;
}

/** Negative when `a` is processed before `b`. */
export function comparePriority(a: PriorityKey, b: PriorityKey): number {
  return (
    a.pinned - b.pinned ||
    a.ring - b.ring ||
    a.outside - b.outside ||
    a.negDot - b.negDot ||
    a.dist2 - b.dist2
  );
}

/** Phases of a column that is generated, i.e. whose block data is in the world. */
export type ColumnPhase =
  'queuedGen' | 'generating' | 'generated' | 'queuedMesh' | 'meshing' | 'meshed';

/** Does the column hold its block data? */
export function hasData(phase: ColumnPhase | undefined): boolean {
  return (
    phase === 'generated' || phase === 'queuedMesh' || phase === 'meshing' || phase === 'meshed'
  );
}

/**
 * A section may be meshed only when all eight neighbour columns hold block data: the padded copy
 * fills a missing column with air and the mesher would emit faces toward it
 * (decisions/M03g-mesh-perimeter.md).
 */
export function neighboursReady(
  cx: number,
  cz: number,
  phaseOf: (cx: number, cz: number) => ColumnPhase | undefined,
): boolean {
  for (const [dx, dz] of NEIGHBOUR_OFFSETS) {
    if (!hasData(phaseOf(cx + dx, cz + dz))) return false;
  }
  return true;
}

/**
 * A column's data may be freed only when neither it nor a neighbour holds a mesh (or a running mesh
 * job) that depends on it. The meshes beyond the keep-mesh ring are freed first, so by the time data
 * beyond the keep-data ring is freed this normally holds; the check makes it an invariant instead of
 * a consequence of ring arithmetic (a pinned request can keep a mesh beyond its ring).
 */
export function canFreeData(
  cx: number,
  cz: number,
  holdsMeshAt: (cx: number, cz: number) => boolean,
): boolean {
  if (holdsMeshAt(cx, cz)) return false;
  for (const [dx, dz] of NEIGHBOUR_OFFSETS) {
    if (holdsMeshAt(cx + dx, cz + dz)) return false;
  }
  return true;
}
