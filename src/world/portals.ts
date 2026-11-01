import { PRNG } from '../engine/rng';
import { BlockRegistry } from './blocks/registry';
import type { DimensionDefinition } from './dimension';
import type { RemovedBlock, World, WorldListener } from './world';

/**
 * Portals (SPEC M20): a 4×5 Lumite frame (corners optional) around a 2×3 opening, lit with Ember
 * Flint. A portal is recorded by the lowest interior cell on its axis (x: the opening spans x and
 * x+1 at one z; z: it spans z and z+1 at one x) and its axis.
 */
export type PortalAxis = 'x' | 'z';

export interface PortalRecord {
  x: number;
  y: number;
  z: number;
  axis: PortalAxis;
}

export const PORTAL_WIDTH = 2;
export const PORTAL_HEIGHT = 3;
/** Ticks a player stands in a portal before it carries them (4 s at 20 TPS). */
export const PORTAL_TRAVEL_TICKS = 80;
/** Ticks after arriving before a portal counts again (the player must also step out first). */
export const PORTAL_ARRIVAL_COOLDOWN = 40;
/** An existing portal this close (horizontally) to the scaled point is reused. */
export const PORTAL_LINK_RADIUS = 32;
/** How far from the scaled point a new portal may be placed on found ground. */
export const PORTAL_SEARCH_RADIUS = 16;
/** Seeded ground candidates tried before the fallback platform is built. */
export const PORTAL_SEARCH_ATTEMPTS = 48;
/** How far above and below the scaled height each candidate column is searched. */
export const PORTAL_SEARCH_HEIGHT = 24;

const FRAME_BLOCK = 'lumite_block';
const PORTAL_BLOCK = 'portal';

function columnKey(cx: number, cz: number): number {
  return (cx + 32768) * 65536 + (cz + 32768);
}

/** World x and z of the cell `u` along the portal's axis and `w` across it from its min cell. */
function cellX(p: PortalRecord, u: number, w: number): number {
  return p.axis === 'x' ? p.x + u : p.x + w;
}
function cellZ(p: PortalRecord, u: number, w: number): number {
  return p.axis === 'x' ? p.z + w : p.z + u;
}

/** Whether (x, y, z) is in the portal's frame box (corners included). */
export function portalBoxContains(p: PortalRecord, x: number, y: number, z: number): boolean {
  if (y < p.y - 1 || y > p.y + PORTAL_HEIGHT) return false;
  if (p.axis === 'x') return z === p.z && x >= p.x - 1 && x <= p.x + PORTAL_WIDTH;
  return x === p.x && z >= p.z - 1 && z <= p.z + PORTAL_WIDTH;
}

/** Whether (x, y, z) is one of the six interior cells. */
export function portalInteriorContains(p: PortalRecord, x: number, y: number, z: number): boolean {
  if (y < p.y || y >= p.y + PORTAL_HEIGHT) return false;
  if (p.axis === 'x') return z === p.z && x >= p.x && x < p.x + PORTAL_WIDTH;
  return x === p.x && z >= p.z && z < p.z + PORTAL_WIDTH;
}

let portalStates: Record<PortalAxis, number> | null = null;

/** The portal block state of an axis. */
export function portalState(axis: PortalAxis): number {
  if (!portalStates) {
    const registry = BlockRegistry.getInstance();
    portalStates = {
      x: registry.getStateId(PORTAL_BLOCK, { axis: 'x' })!,
      z: registry.getStateId(PORTAL_BLOCK, { axis: 'z' })!,
    };
  }
  return portalStates[axis];
}

/** The ten non-corner frame cells are Lumite Blocks. */
export function frameComplete(world: World, p: PortalRecord): boolean {
  const lumite = BlockRegistry.getInstance().getDefaultStateId(FRAME_BLOCK)!;
  for (let u = 0; u < PORTAL_WIDTH; u++) {
    if (world.getBlockStateId(cellX(p, u, 0), p.y - 1, cellZ(p, u, 0)) !== lumite) return false;
    if (world.getBlockStateId(cellX(p, u, 0), p.y + PORTAL_HEIGHT, cellZ(p, u, 0)) !== lumite)
      return false;
  }
  for (let v = 0; v < PORTAL_HEIGHT; v++) {
    if (world.getBlockStateId(cellX(p, -1, 0), p.y + v, cellZ(p, -1, 0)) !== lumite) return false;
    if (
      world.getBlockStateId(cellX(p, PORTAL_WIDTH, 0), p.y + v, cellZ(p, PORTAL_WIDTH, 0)) !==
      lumite
    )
      return false;
  }
  return true;
}

/** Every interior cell holds `state`. */
function interiorIs(world: World, p: PortalRecord, state: number): boolean {
  for (let v = 0; v < PORTAL_HEIGHT; v++)
    for (let u = 0; u < PORTAL_WIDTH; u++)
      if (world.getBlockStateId(cellX(p, u, 0), p.y + v, cellZ(p, u, 0)) !== state) return false;
  return true;
}

/** A complete frame around an opening full of portal blocks of its axis. */
export function portalIntact(world: World, p: PortalRecord): boolean {
  return interiorIs(world, p, portalState(p.axis)) && frameComplete(world, p);
}

/** The empty frame whose opening contains (x, y, z), x axis first, or null. */
export function findPortalFrame(
  world: World,
  x: number,
  y: number,
  z: number,
): PortalRecord | null {
  if (world.getBlockStateId(x, y, z) !== 0) return null;
  for (const axis of ['x', 'z'] as const)
    for (let v = 0; v < PORTAL_HEIGHT; v++)
      for (let u = 0; u < PORTAL_WIDTH; u++) {
        const candidate: PortalRecord =
          axis === 'x' ? { x: x - u, y: y - v, z, axis } : { x, y: y - v, z: z - u, axis };
        if (interiorIs(world, candidate, 0) && frameComplete(world, candidate)) return candidate;
      }
  return null;
}

/**
 * The portals of one dimension, indexed by every column their frame touches. It is part of the
 * dimension's save data, so linking never scans the world.
 */
export class PortalIndex {
  private readonly list: PortalRecord[] = [];
  private readonly byColumn = new Map<number, PortalRecord[]>();

  get size(): number {
    return this.list.length;
  }

  all(): readonly PortalRecord[] {
    return this.list;
  }

  /** The portals whose frame touches column (cx, cz), or undefined. */
  inColumn(cx: number, cz: number): readonly PortalRecord[] | undefined {
    return this.byColumn.get(columnKey(cx, cz));
  }

  private columnsOf(p: PortalRecord, visit: (key: number) => void): void {
    const min = p.axis === 'x' ? p.x - 1 : p.z - 1;
    const max = min + PORTAL_WIDTH + 1;
    const fixed = Math.floor((p.axis === 'x' ? p.z : p.x) / 16);
    for (let c = Math.floor(min / 16); c <= Math.floor(max / 16); c++)
      visit(p.axis === 'x' ? columnKey(c, fixed) : columnKey(fixed, c));
  }

  add(p: PortalRecord): void {
    if (this.find(p.x, p.y, p.z, p.axis)) return;
    this.list.push(p);
    this.columnsOf(p, (key) => {
      const entries = this.byColumn.get(key);
      if (entries) entries.push(p);
      else this.byColumn.set(key, [p]);
    });
  }

  remove(p: PortalRecord): void {
    const at = this.list.indexOf(p);
    if (at < 0) return;
    this.list.splice(at, 1);
    this.columnsOf(p, (key) => {
      const entries = this.byColumn.get(key);
      if (!entries) return;
      entries.splice(entries.indexOf(p), 1);
      if (entries.length === 0) this.byColumn.delete(key);
    });
  }

  find(x: number, y: number, z: number, axis: PortalAxis): PortalRecord | null {
    for (const p of this.inColumn(Math.floor(x / 16), Math.floor(z / 16)) ?? [])
      if (p.x === x && p.y === y && p.z === z && p.axis === axis) return p;
    return null;
  }

  /** The portal whose opening holds (x, y, z), or null. */
  portalAt(x: number, y: number, z: number): PortalRecord | null {
    const entries = this.byColumn.get(columnKey(Math.floor(x / 16), Math.floor(z / 16)));
    if (!entries) return null;
    for (let i = 0; i < entries.length; i++)
      if (portalInteriorContains(entries[i]!, x, y, z)) return entries[i]!;
    return null;
  }

  /** Portals within `radius` blocks horizontally of (x, z), nearest first (ties by height). */
  near(x: number, y: number, z: number, radius: number): PortalRecord[] {
    const distance = (p: PortalRecord) => {
      const dx = cellX(p, 1, 0) - x;
      const dz = cellZ(p, 1, 0) - z;
      return dx * dx + dz * dz;
    };
    return this.list
      .filter((p) => distance(p) <= radius * radius)
      .sort((a, b) => distance(a) - distance(b) || Math.abs(a.y - y) - Math.abs(b.y - y));
  }

  clear(): void {
    this.list.length = 0;
    this.byColumn.clear();
  }

  /** Four integers per portal: x, y, z and axis (0 = x, 1 = z). */
  serialize(): Int32Array {
    const out = new Int32Array(this.list.length * 4);
    this.list.forEach((p, i) => {
      out[i * 4] = p.x;
      out[i * 4 + 1] = p.y;
      out[i * 4 + 2] = p.z;
      out[i * 4 + 3] = p.axis === 'x' ? 0 : 1;
    });
    return out;
  }

  /** Replaces the index with serialized portals. Throws on malformed data. */
  load(data: ArrayLike<number> | undefined): void {
    this.clear();
    if (!data) return;
    if (data.length % 4 !== 0) throw new Error('Saved portal list is malformed');
    for (let i = 0; i < data.length; i += 4) {
      const [x, y, z, axis] = [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
      if (![x, y, z].every(Number.isInteger) || (axis !== 0 && axis !== 1))
        throw new Error('Saved portal list is malformed');
      this.add({ x, y, z, axis: axis === 0 ? 'x' : 'z' });
    }
  }
}

/**
 * Keeps one world's portals whole: an edit to a frame or opening cell of an indexed portal that
 * leaves it broken removes the portal and its remaining portal blocks.
 */
export class PortalGuard implements WorldListener {
  private collapsing = false;

  constructor(
    private readonly world: World,
    readonly index: PortalIndex,
  ) {}

  blockEdited(x: number, y: number, z: number): void {
    if (this.index.size === 0 || this.collapsing) return;
    this.check(x, y, z);
  }

  blocksRemoved(blocks: readonly RemovedBlock[]): void {
    if (this.index.size === 0 || this.collapsing) return;
    for (const b of blocks) this.check(b.x, b.y, b.z);
  }

  private check(x: number, y: number, z: number): void {
    const entries = this.index.inColumn(Math.floor(x / 16), Math.floor(z / 16));
    if (!entries) return;
    for (let i = entries.length - 1; i >= 0; i--) {
      const p = entries[i];
      if (!p || !portalBoxContains(p, x, y, z) || portalIntact(this.world, p)) continue;
      this.collapse(p);
    }
  }

  /** Forgets the portal and turns what is left of its surface to air. */
  collapse(p: PortalRecord): void {
    this.index.remove(p);
    const state = portalState(p.axis);
    this.collapsing = true;
    try {
      for (let v = 0; v < PORTAL_HEIGHT; v++)
        for (let u = 0; u < PORTAL_WIDTH; u++) {
          const x = cellX(p, u, 0);
          const z = cellZ(p, u, 0);
          if (this.world.getBlockStateId(x, p.y + v, z) === state)
            this.world.setBlockStateId(x, p.y + v, z, 0);
        }
    } finally {
      this.collapsing = false;
    }
  }
}

/** Fills the empty frame around (x, y, z) with portal blocks and indexes it; null if there is none. */
export function lightPortal(
  world: World,
  index: PortalIndex,
  x: number,
  y: number,
  z: number,
): PortalRecord | null {
  const portal = findPortalFrame(world, x, y, z);
  if (!portal) return null;
  const state = portalState(portal.axis);
  for (let v = 0; v < PORTAL_HEIGHT; v++)
    for (let u = 0; u < PORTAL_WIDTH; u++)
      world.setBlockStateId(cellX(portal, u, 0), portal.y + v, cellZ(portal, u, 0), state);
  index.add(portal);
  return portal;
}

/** Writes a full frame (corners included) and its portal blocks, then indexes the portal. */
export function buildPortal(world: World, index: PortalIndex, p: PortalRecord): void {
  const registry = BlockRegistry.getInstance();
  const lumite = registry.getDefaultStateId(FRAME_BLOCK)!;
  const state = portalState(p.axis);
  for (let v = -1; v <= PORTAL_HEIGHT; v++)
    for (let u = -1; u <= PORTAL_WIDTH; u++) {
      const inside = u >= 0 && u < PORTAL_WIDTH && v >= 0 && v < PORTAL_HEIGHT;
      world.setBlockStateId(cellX(p, u, 0), p.y + v, cellZ(p, u, 0), inside ? state : lumite);
    }
  index.add(p);
}

/**
 * The nearest indexed portal within PORTAL_LINK_RADIUS of (x, z) that is still standing; indexed
 * portals whose columns are loaded but no longer hold the portal (an unsaved dimension that
 * regenerated) are dropped on the way.
 */
export function findLinkedPortal(
  world: World,
  index: PortalIndex,
  x: number,
  y: number,
  z: number,
): PortalRecord | null {
  for (const p of index.near(x, y, z, PORTAL_LINK_RADIUS)) {
    if (portalIntact(world, p)) return p;
    if (world.hasColumn(Math.floor(p.x / 16), Math.floor(p.z / 16))) index.remove(p);
  }
  return null;
}

/** Solid full cubes, free of fluid, that a player can stand on. */
function solidTable(): Uint8Array {
  const registry = BlockRegistry.getInstance();
  const table = new Uint8Array(registry.getMaxStateId() + 1);
  for (const id of registry.getAllStateIds())
    table[id] = registry.getResolvedState(id)?.definition.fullOpaqueCube ? 1 : 0;
  return table;
}

/**
 * A safe spot for a new portal with its opening's min cell at (u along the axis, y, w): solid ground
 * under the frame and both sides of it, and air (no fluid) in the four rows above, so the player
 * arrives standing and can step out to either side.
 */
export function isSafePortalSpot(
  world: World,
  solid: Uint8Array,
  axis: PortalAxis,
  x: number,
  y: number,
  z: number,
): boolean {
  const p: PortalRecord = { x, y, z, axis };
  // The ground under the opening first: most candidates fail here.
  if (!solid[world.getBlockStateId(cellX(p, 0, 0), y - 1, cellZ(p, 0, 0))]) return false;
  for (let w = -1; w <= 1; w++)
    for (let u = -1; u <= PORTAL_WIDTH; u++) {
      const cx = cellX(p, u, w);
      const cz = cellZ(p, u, w);
      if (!solid[world.getBlockStateId(cx, y - 1, cz)]) return false;
      for (let v = 0; v <= PORTAL_HEIGHT; v++)
        if (world.getBlockStateId(cx, y + v, cz) !== 0) return false;
    }
  return true;
}

/** Seeded candidate offsets within PORTAL_SEARCH_RADIUS, the exact point first, nearest first. */
export function portalSearchOffsets(seed: number): Array<[number, number]> {
  const rng = new PRNG(seed);
  const span = PORTAL_SEARCH_RADIUS * 2 + 1;
  const offsets: Array<[number, number]> = [[0, 0]];
  while (offsets.length < PORTAL_SEARCH_ATTEMPTS) {
    const dx = Math.floor(rng.next() * span) - PORTAL_SEARCH_RADIUS;
    const dz = Math.floor(rng.next() * span) - PORTAL_SEARCH_RADIUS;
    if (dx * dx + dz * dz <= PORTAL_SEARCH_RADIUS * PORTAL_SEARCH_RADIUS) offsets.push([dx, dz]);
  }
  return offsets.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
}

/**
 * Makes the arrival portal near (x, y, z): on the nearest safe spot of a bounded, seeded search, or,
 * when there is none, on a small platform with an air pocket. The search yields through
 * `pause` whenever it has run for `budgetMs`, so it never holds a frame over budget.
 */
export async function placeArrivalPortal(
  world: World,
  index: PortalIndex,
  dimension: DimensionDefinition,
  axis: PortalAxis,
  x: number,
  y: number,
  z: number,
  seed: number,
  pause: () => Promise<void>,
  budgetMs = 2,
): Promise<PortalRecord> {
  const solid = solidTable();
  const baseX = Math.floor(x);
  const baseZ = Math.floor(z);
  const baseY = Math.max(dimension.portalMinY, Math.min(dimension.portalMaxY, Math.floor(y)));
  let sliceStart = performance.now();
  for (const [dx, dz] of portalSearchOffsets(seed)) {
    for (let step = 0; step <= PORTAL_SEARCH_HEIGHT * 2; step++) {
      const dy = step % 2 === 0 ? step / 2 : -(step + 1) / 2;
      const cy = baseY + dy;
      if (cy < dimension.portalMinY || cy > dimension.portalMaxY) continue;
      if (isSafePortalSpot(world, solid, axis, baseX + dx, cy, baseZ + dz)) {
        const portal: PortalRecord = { x: baseX + dx, y: cy, z: baseZ + dz, axis };
        buildPortal(world, index, portal);
        return portal;
      }
    }
    if (performance.now() - sliceStart >= budgetMs) {
      await pause();
      sliceStart = performance.now();
    }
  }
  // Nowhere safe: the platform goes at the first open cell at or above the point, out of rock and fluid.
  let platformY = baseY;
  while (platformY < dimension.portalMaxY && world.getBlockStateId(baseX, platformY, baseZ) !== 0)
    platformY++;
  if (world.getBlockStateId(baseX, platformY, baseZ) !== 0) platformY = baseY;
  return buildPlatformPortal(world, index, dimension, axis, baseX, platformY, baseZ);
}

/**
 * A 6×5 platform under the portal and an air pocket four blocks high above it. Any water or lava
 * touching the pocket is sealed off with the platform block, so nothing flows in.
 */
export function buildPlatformPortal(
  world: World,
  index: PortalIndex,
  dimension: DimensionDefinition,
  axis: PortalAxis,
  x: number,
  y: number,
  z: number,
): PortalRecord {
  const registry = BlockRegistry.getInstance();
  const floor = registry.getDefaultStateId(dimension.platformBlock)!;
  const portal: PortalRecord = { x, y, z, axis };
  for (let w = -2; w <= 2; w++)
    for (let u = -2; u <= PORTAL_WIDTH + 1; u++) {
      const cx = cellX(portal, u, w);
      const cz = cellZ(portal, u, w);
      world.setBlockStateId(cx, y - 1, cz, floor);
      for (let v = 0; v <= PORTAL_HEIGHT; v++) world.setBlockStateId(cx, y + v, cz, 0);
    }
  for (let w = -3; w <= 3; w++)
    for (let u = -3; u <= PORTAL_WIDTH + 2; u++)
      for (let v = -1; v <= PORTAL_HEIGHT + 1; v++) {
        const inside = w >= -2 && w <= 2 && u >= -2 && u <= PORTAL_WIDTH + 1 && v <= PORTAL_HEIGHT;
        if (inside) continue;
        const cx = cellX(portal, u, w);
        const cz = cellZ(portal, u, w);
        const id = registry.getResolvedState(world.getBlockStateId(cx, y + v, cz))?.blockId;
        if (id === 'water' || id === 'lava') world.setBlockStateId(cx, y + v, cz, floor);
      }
  buildPortal(world, index, portal);
  return portal;
}

/** Where a player arriving through `p` stands: the middle of the opening's floor. */
export function portalArrivalPoint(p: PortalRecord): [number, number, number] {
  return p.axis === 'x' ? [p.x + 1, p.y, p.z + 0.5] : [p.x + 0.5, p.y, p.z + 1];
}

/**
 * Counts the ticks a player stands in a portal and drives the screen warp. Costs one empty check per
 * tick while the dimension has no portal, and one column lookup while it has some.
 */
export class PortalTravel {
  /** Consecutive ticks inside a portal. */
  public ticksInside = 0;
  /** 0..1 strength of the screen warp: ramps up while waiting, fades after arriving. */
  public warp = 0;
  public cooldown = 0;
  /** Set on arrival: the player has to step out of the portal before it counts again. */
  public needsExit = false;
  public travelling = false;
  /** The portal the player stands in, if any. */
  public current: PortalRecord | null = null;
  public onTravel: ((portal: PortalRecord) => void) | null = null;

  tick(world: World, index: PortalIndex, x: number, y: number, z: number): void {
    if (this.travelling) return;
    if (this.cooldown > 0) this.cooldown--;
    const portal = index.size === 0 ? null : this.portalAround(world, index, x, y, z);
    this.current = portal;
    if (!portal) {
      this.needsExit = false;
      this.ticksInside = 0;
      if (this.warp > 0) this.warp = Math.max(0, this.warp - 0.05);
      return;
    }
    if (this.needsExit || this.cooldown > 0) {
      if (this.warp > 0) this.warp = Math.max(0, this.warp - 0.05);
      return;
    }
    this.ticksInside++;
    this.warp = Math.min(1, this.ticksInside / PORTAL_TRAVEL_TICKS);
    if (this.ticksInside >= PORTAL_TRAVEL_TICKS) {
      this.ticksInside = 0;
      this.travelling = true;
      this.onTravel?.(portal);
    }
  }

  /** The portal holding the player's feet or head cell, if its block is really there. */
  private portalAround(
    world: World,
    index: PortalIndex,
    x: number,
    y: number,
    z: number,
  ): PortalRecord | null {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    for (let dy = 0; dy <= 1; dy++) {
      const by = Math.floor(y) + dy;
      const p = index.portalAt(bx, by, bz);
      if (p && world.getBlockStateId(bx, by, bz) === portalState(p.axis)) return p;
    }
    return null;
  }

  /** The player has arrived: the warp fades and the portal waits for them to step out. */
  arrived(): void {
    this.travelling = false;
    this.ticksInside = 0;
    this.needsExit = true;
    this.cooldown = PORTAL_ARRIVAL_COOLDOWN;
    this.warp = 1;
  }

  /** Travel did not happen (the world was left meanwhile). */
  cancel(): void {
    this.travelling = false;
    this.ticksInside = 0;
    this.warp = 0;
  }

  reset(): void {
    this.cancel();
    this.cooldown = 0;
    this.needsExit = false;
    this.current = null;
  }
}
