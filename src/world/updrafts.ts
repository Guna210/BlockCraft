import { deriveSeed, hash3 } from '../engine/rng';
import { hollowdeepHeights, MAGMA_LEVEL } from '../gen/hollowdeep/shape';
import type { World } from './world';

/** Gravity inside an Updraft, as a share of normal gravity (SPEC M20). */
export const UPDRAFT_GRAVITY = 0.4;
/** Updraft zones live one per cell of this many blocks at most, wholly inside their cell. */
export const UPDRAFT_CELL = 48;
/** Vertical extent: from just above the magma sea to under the cavern ceiling. */
export const UPDRAFT_MIN_Y = MAGMA_LEVEL + 1;
export const UPDRAFT_MAX_Y = 176;
/** Share of cells that may hold an Updraft before the biome check. */
const UPDRAFT_CHANCE = 0.75;
/** Deep chasm floors are the Driftstone Expanse (M20b's shape stage labels floors below 32). */
const EXPANSE_FLOOR = 32;
const CACHE_SIZE = 1024;

/** A vertical cylinder of low gravity. */
export interface UpdraftZone {
  x: number;
  z: number;
  radius: number;
}

/**
 * The Hollowdeep's Updraft zones: a pure function of the world seed. Each 48-block cell may hold one
 * cylinder (radius 5–9) whose centre lies over a Driftstone Expanse chasm, evaluated from M20b's own
 * height field, so loaded columns are never read. Lookups are O(1): one cell, served from a small
 * direct-mapped cache after its first evaluation, with no allocation.
 */
export class UpdraftField {
  private readonly cellSeed: number;
  private readonly heights: ReturnType<typeof hollowdeepHeights>;
  private readonly keysX = new Int32Array(CACHE_SIZE);
  private readonly keysZ = new Int32Array(CACHE_SIZE);
  private readonly filled = new Uint8Array(CACHE_SIZE);
  /** Per slot: centre x, centre z, radius (0 when the cell has no Updraft). */
  private readonly data = new Float64Array(CACHE_SIZE * 3);

  constructor(readonly worldSeed: number) {
    this.cellSeed = deriveSeed(worldSeed, 'hollowdeep:updrafts');
    this.heights = hollowdeepHeights(deriveSeed(worldSeed, 'hollowdeep:shape'));
  }

  /** The cache slot holding cell (gx, gz), evaluated if needed. */
  private slot(gx: number, gz: number): number {
    const slot = ((gx * 73856093) ^ (gz * 19349663)) & (CACHE_SIZE - 1);
    if (this.filled[slot] === 1 && this.keysX[slot] === gx && this.keysZ[slot] === gz) return slot;
    this.filled[slot] = 1;
    this.keysX[slot] = gx;
    this.keysZ[slot] = gz;
    const o = slot * 3;
    const seed = this.cellSeed;
    let radius = 0;
    const cx = gx * UPDRAFT_CELL + 12 + Math.floor(hash3(seed, gx, 1, gz) * 24) + 0.5;
    const cz = gz * UPDRAFT_CELL + 12 + Math.floor(hash3(seed, gx, 2, gz) * 24) + 0.5;
    if (
      hash3(seed, gx, 0, gz) < UPDRAFT_CHANCE &&
      this.heights(Math.floor(cx), Math.floor(cz)).floor < EXPANSE_FLOOR
    )
      radius = 5 + Math.floor(hash3(seed, gx, 3, gz) * 5);
    this.data[o] = cx;
    this.data[o + 1] = cz;
    this.data[o + 2] = radius;
    return slot;
  }

  /** Whether (x, y, z) lies inside an Updraft. */
  contains(x: number, y: number, z: number): boolean {
    if (y < UPDRAFT_MIN_Y || y > UPDRAFT_MAX_Y) return false;
    const o = this.slot(Math.floor(x / UPDRAFT_CELL), Math.floor(z / UPDRAFT_CELL)) * 3;
    const r = this.data[o + 2]!;
    if (r === 0) return false;
    const dx = x - this.data[o]!,
      dz = z - this.data[o + 1]!;
    return dx * dx + dz * dz <= r * r;
  }

  /** Gravity multiplier at a point. */
  factorAt(x: number, y: number, z: number): number {
    return this.contains(x, y, z) ? UPDRAFT_GRAVITY : 1;
  }

  /** The zone of cell (gx, gz), written into `out`; false when the cell has none. */
  zoneOfCell(gx: number, gz: number, out: UpdraftZone): boolean {
    const o = this.slot(gx, gz) * 3;
    out.x = this.data[o]!;
    out.z = this.data[o + 1]!;
    out.radius = this.data[o + 2]!;
    return out.radius > 0;
  }

  /**
   * The nearest zone whose centre is within `maxDistance` blocks of (x, z), searching cells outward
   * (debug and tests only).
   */
  nearest(x: number, z: number, maxDistance: number): UpdraftZone | null {
    const zone: UpdraftZone = { x: 0, z: 0, radius: 0 };
    let best: UpdraftZone | null = null;
    let bestD = maxDistance;
    const gx0 = Math.floor(x / UPDRAFT_CELL),
      gz0 = Math.floor(z / UPDRAFT_CELL);
    const cells = Math.ceil(maxDistance / UPDRAFT_CELL) + 1;
    for (let gz = gz0 - cells; gz <= gz0 + cells; gz++)
      for (let gx = gx0 - cells; gx <= gx0 + cells; gx++) {
        if (!this.zoneOfCell(gx, gz, zone)) continue;
        const d = Math.hypot(zone.x - x, zone.z - z);
        if (d <= bestD) {
          bestD = d;
          best = { ...zone };
        }
      }
    return best;
  }
}

// The one World whose physics reads an Updraft field (the active Hollowdeep). Every other world,
// including the Overworld, answers 1 after two comparisons.
let fieldWorld: World | null = null;
let field: UpdraftField | null = null;

/** Gives `world` an Updraft field, or removes it with null. Only one world holds one at a time. */
export function setUpdraftField(world: World, next: UpdraftField | null): void {
  if (next) {
    fieldWorld = world;
    field = next;
  } else if (fieldWorld === world) {
    fieldWorld = null;
    field = null;
  }
}

/** Drops the field whichever world holds it, so a world left behind is not kept alive. */
export function clearUpdraftField(): void {
  fieldWorld = null;
  field = null;
}

/** The Updraft field of `world`, if it has one. */
export function updraftField(world: World): UpdraftField | null {
  return fieldWorld === world ? field : null;
}

/**
 * The shared gravity factor every physics path multiplies its gravity by: the player, mobs, item
 * entities and falling blocks (Blast Charges).
 */
export function gravityFactor(world: World, x: number, y: number, z: number): number {
  if (field === null || world !== fieldWorld) return 1;
  return field.factorAt(x, y, z);
}
