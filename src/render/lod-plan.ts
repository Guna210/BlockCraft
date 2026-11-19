import { chebyshev, FULL_DETAIL_RADIUS } from '../world/streaming-plan';

export const LOD_MASK_WIDTH = 2 * FULL_DETAIL_RADIUS + 1;
const ROW_MASK = (1 << LOD_MASK_WIDTH) - 1;

/** Coordinates relative to the camera column. One bit per x coordinate in each z row. */
export class LodColumnMask {
  readonly rows = new Uint32Array(LOD_MASK_WIDTH);

  constructor(
    public cx = 0,
    public cz = 0,
  ) {}

  moveTo(cx: number, cz: number): void {
    const dx = cx - this.cx;
    const dz = cz - this.cz;
    if (dx === 0 && dz === 0) return;
    this.cx = cx;
    this.cz = cz;
    if (Math.abs(dx) >= LOD_MASK_WIDTH || Math.abs(dz) >= LOD_MASK_WIDTH) {
      this.rows.fill(0);
      return;
    }
    // In-place translation. Iterate away from the source rows to retain the overlap.
    const step = dz >= 0 ? 1 : -1;
    for (
      let row = dz >= 0 ? 0 : LOD_MASK_WIDTH - 1;
      row >= 0 && row < LOD_MASK_WIDTH;
      row += step
    ) {
      const bits = this.rows[row + dz] ?? 0;
      this.rows[row] = dx >= 0 ? bits >>> dx : (bits << -dx) & ROW_MASK;
    }
  }

  forget(cx: number, cz: number): void {
    if (chebyshev(cx, cz, this.cx, this.cz) > FULL_DETAIL_RADIUS) return;
    const z = cz - this.cz + FULL_DETAIL_RADIUS;
    this.rows[z] = this.rows[z]! & ~(1 << (cx - this.cx + FULL_DETAIL_RADIUS));
  }

  markDrawn(cx: number, cz: number): void {
    if (chebyshev(cx, cz, this.cx, this.cz) > FULL_DETAIL_RADIUS) return;
    const z = cz - this.cz + FULL_DETAIL_RADIUS;
    this.rows[z] = this.rows[z]! | (1 << (cx - this.cx + FULL_DETAIL_RADIUS));
  }

  hides(cx: number, cz: number): boolean {
    if (chebyshev(cx, cz, this.cx, this.cz) > FULL_DETAIL_RADIUS) return false;
    return (
      (this.rows[cz - this.cz + FULL_DETAIL_RADIUS]! &
        (1 << (cx - this.cx + FULL_DETAIL_RADIUS))) !==
      0
    );
  }
}

export type LodStep = 1 | 2 | 4;

/** Chebyshev distance to the closest column belonging to the tile. */
export function lodTileDistance(cx: number, cz: number, tx: number, tz: number): number {
  const x = tx * 4;
  const z = tz * 4;
  return Math.max(0, x - cx, cx - x - 3, z - cz, cz - z - 3);
}

export function lodStep(distance: number, previous?: LodStep): LodStep {
  if (distance <= (previous === 1 ? 17 : previous ? 15 : 16)) return 1;
  if (distance <= (previous === 2 ? 25 : previous === 4 ? 23 : 24)) return 2;
  return 4;
}
