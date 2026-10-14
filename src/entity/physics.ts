import { BOTTOM_SLAB_BOX, TOP_SLAB_BOX } from '../world/block-shapes';
import { BlockRegistry } from '../world/blocks/registry';
import type { World } from '../world/world';

export const EPSILON = 1e-7;
export const HALF_WIDTH = 0.3;
export type Position = [number, number, number];

/** Cached state shapes: no block objects or arrays are created during a collision query. */
export class BlockCollision {
  private readonly heights: Float64Array;
  private readonly bottoms: Float64Array;
  private readonly water: Uint8Array;
  private readonly hay: Uint8Array;
  private readonly mire: Uint8Array;
  private readonly climbers: Uint8Array;
  constructor(public readonly world: World) {
    const registry = BlockRegistry.getInstance();
    const n = registry.getMaxStateId() + 1;
    this.heights = new Float64Array(n);
    this.bottoms = new Float64Array(n);
    this.water = new Uint8Array(n);
    this.hay = new Uint8Array(n);
    this.mire = new Uint8Array(n);
    this.climbers = new Uint8Array(n);
    for (const id of registry.getAllStateIds()) {
      const state = registry.getResolvedState(id)!;
      const def = state.definition;
      this.water[id] = state.blockId === 'water' ? 1 : 0;
      this.hay[id] = state.blockId === 'hay_bale' ? 1 : 0;
      this.mire[id] = state.blockId === 'mire' ? 1 : 0;
      if (state.blockId === 'ladder' || state.blockId === 'vine')
        this.climbers[id] =
          ['north', 'south', 'east', 'west'].indexOf(String(state.properties.facing)) + 1;
      if (def.model === 'slab') {
        const box = state.properties.half === 'top' ? TOP_SLAB_BOX : BOTTOM_SLAB_BOX;
        this.heights[id] = box[4] - box[1];
        this.bottoms[id] = box[1];
      } else if (
        state.blockId !== 'air' &&
        state.blockId !== 'water' &&
        state.blockId !== 'lava' &&
        def.model !== 'cross' &&
        def.model !== 'wall' &&
        def.model !== 'wall_torch'
      ) {
        this.heights[id] = 1;
      }
    }
  }

  private state(x: number, y: number, z: number): number {
    return this.world.getBlockStateId(x, y, z);
  }

  free(x: number, y: number, z: number, height: number): boolean {
    for (let by = Math.floor(y + EPSILON); by <= Math.floor(y + height - EPSILON); by++)
      for (
        let bz = Math.floor(z - HALF_WIDTH + EPSILON);
        bz <= Math.floor(z + HALF_WIDTH - EPSILON);
        bz++
      )
        for (
          let bx = Math.floor(x - HALF_WIDTH + EPSILON);
          bx <= Math.floor(x + HALF_WIDTH - EPSILON);
          bx++
        ) {
          const id = this.state(bx, by, bz);
          const bottom = by + this.bottoms[id]!;
          if (
            this.heights[id]! > 0 &&
            y < bottom + this.heights[id]! - EPSILON &&
            y + height > bottom + EPSILON
          )
            return false;
        }
    return true;
  }

  /** Sweeps the full distance, including every crossed voxel, along one axis. */
  sweep(
    pos: Position,
    height: number,
    axis: number,
    distance: number,
    halfWidth = HALF_WIDTH,
  ): number {
    if (distance === 0) return 0;
    const minX = pos[0] - halfWidth,
      maxX = pos[0] + halfWidth;
    const minY = pos[1],
      maxY = pos[1] + height;
    const minZ = pos[2] - halfWidth,
      maxZ = pos[2] + halfWidth;
    let result = distance;
    for (
      let y = Math.floor(minY + Math.min(axis === 1 ? distance : 0, 0) + EPSILON);
      y <= Math.floor(maxY + Math.max(axis === 1 ? distance : 0, 0) - EPSILON);
      y++
    )
      for (
        let z = Math.floor(minZ + Math.min(axis === 2 ? distance : 0, 0) + EPSILON);
        z <= Math.floor(maxZ + Math.max(axis === 2 ? distance : 0, 0) - EPSILON);
        z++
      )
        for (
          let x = Math.floor(minX + Math.min(axis === 0 ? distance : 0, 0) + EPSILON);
          x <= Math.floor(maxX + Math.max(axis === 0 ? distance : 0, 0) - EPSILON);
          x++
        ) {
          const id = this.state(x, y, z);
          const h = this.heights[id]!;
          if (h === 0) continue;
          const bottom = y + this.bottoms[id]!;
          if (axis !== 0 && (maxX <= x + EPSILON || minX >= x + 1 - EPSILON)) continue;
          if (axis !== 1 && (maxY <= bottom + EPSILON || minY >= bottom + h - EPSILON)) continue;
          if (axis !== 2 && (maxZ <= z + EPSILON || minZ >= z + 1 - EPSILON)) continue;
          const near = axis === 0 ? x : axis === 1 ? bottom : z;
          const far = near + (axis === 1 ? h : 1);
          const low = axis === 0 ? minX : axis === 1 ? minY : minZ;
          const high = axis === 0 ? maxX : axis === 1 ? maxY : maxZ;
          if (distance > 0 && high <= near + EPSILON)
            result = Math.min(result, Math.max(0, near - high));
          if (distance < 0 && low >= far - EPSILON)
            result = Math.max(result, Math.min(0, far - low));
        }
    return result;
  }

  supported(x: number, y: number, z: number, depth = 0.6): boolean {
    // A sweep catches even a thin top slab without treating its empty half as support.
    this.supportPosition[0] = x;
    this.supportPosition[1] = y;
    this.supportPosition[2] = z;
    return this.sweep(this.supportPosition, 0.01, 1, -depth) > -depth + EPSILON;
  }
  private readonly supportPosition: Position = [0, 0, 0];

  inWater(pos: Position, height: number): boolean {
    for (let y = Math.floor(pos[1]); y <= Math.floor(pos[1] + height - EPSILON); y++)
      for (
        let z = Math.floor(pos[2] - HALF_WIDTH + EPSILON);
        z <= Math.floor(pos[2] + HALF_WIDTH - EPSILON);
        z++
      )
        for (
          let x = Math.floor(pos[0] - HALF_WIDTH + EPSILON);
          x <= Math.floor(pos[0] + HALF_WIDTH - EPSILON);
          x++
        )
          if (this.water[this.state(x, y, z)]) return true;
    return false;
  }

  /** Highest water surface touched by the body; NaN if there is no overlap. */
  waterSurface(pos: Position, height: number): number {
    let surface = NaN;
    for (let y = Math.floor(pos[1]); y <= Math.floor(pos[1] + height - EPSILON); y++)
      for (
        let z = Math.floor(pos[2] - HALF_WIDTH + EPSILON);
        z <= Math.floor(pos[2] + HALF_WIDTH - EPSILON);
        z++
      )
        for (
          let x = Math.floor(pos[0] - HALF_WIDTH + EPSILON);
          x <= Math.floor(pos[0] + HALF_WIDTH - EPSILON);
          x++
        )
          if (this.water[this.state(x, y, z)] && !this.water[this.state(x, y + 1, z)])
            surface = Number.isNaN(surface) ? y + 1 : Math.max(surface, y + 1);
    return surface;
  }

  /** Overlap uses the whole block volume; facing points away from its supporting wall. */
  climbing(pos: Position, height: number, dx = 0, dz = 0, intoOnly = false): boolean {
    for (let y = Math.floor(pos[1]); y <= Math.floor(pos[1] + height - EPSILON); y++)
      for (
        let z = Math.floor(pos[2] - HALF_WIDTH + EPSILON);
        z <= Math.floor(pos[2] + HALF_WIDTH - EPSILON);
        z++
      )
        for (
          let x = Math.floor(pos[0] - HALF_WIDTH + EPSILON);
          x <= Math.floor(pos[0] + HALF_WIDTH - EPSILON);
          x++
        ) {
          const facing = this.climbers[this.state(x, y, z)];
          if (
            facing &&
            (!intoOnly ||
              (facing === 1
                ? dz > EPSILON
                : facing === 2
                  ? dz < -EPSILON
                  : facing === 3
                    ? dx < -EPSILON
                    : dx > EPSILON))
          )
            return true;
        }
    return false;
  }

  onMire(pos: Position): boolean {
    for (
      let z = Math.floor(pos[2] - HALF_WIDTH + EPSILON);
      z <= Math.floor(pos[2] + HALF_WIDTH - EPSILON);
      z++
    )
      for (
        let x = Math.floor(pos[0] - HALF_WIDTH + EPSILON);
        x <= Math.floor(pos[0] + HALF_WIDTH - EPSILON);
        x++
      )
        if (this.mire[this.state(x, Math.floor(pos[1] - EPSILON), z)]) return true;
    return false;
  }

  /** Exact ray/solid-shape intersection, including slabs. No per-query allocations. */
  cameraDistance(
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    distance = 4,
  ): number {
    let hit = distance;
    for (
      let bz = Math.floor(Math.min(z, z + dz * distance));
      bz <= Math.floor(Math.max(z, z + dz * distance));
      bz++
    )
      for (
        let by = Math.floor(Math.min(y, y + dy * distance));
        by <= Math.floor(Math.max(y, y + dy * distance));
        by++
      )
        for (
          let bx = Math.floor(Math.min(x, x + dx * distance));
          bx <= Math.floor(Math.max(x, x + dx * distance));
          bx++
        ) {
          const id = this.state(bx, by, bz),
            h = this.heights[id]!;
          if (!h) continue;
          let enter = 0,
            leave = hit;
          for (let axis = 0; axis < 3; axis++) {
            const origin = axis === 0 ? x : axis === 1 ? y : z;
            const dir = axis === 0 ? dx : axis === 1 ? dy : dz;
            const low = axis === 0 ? bx : axis === 1 ? by + this.bottoms[id]! : bz;
            const high = low + (axis === 1 ? h : 1);
            if (Math.abs(dir) < EPSILON) {
              if (origin < low || origin > high) {
                leave = -1;
                break;
              }
            } else {
              const a = (low - origin) / dir,
                b = (high - origin) / dir;
              enter = Math.max(enter, Math.min(a, b));
              leave = Math.min(leave, Math.max(a, b));
            }
          }
          if (enter <= leave) hit = Math.min(hit, enter);
        }
    return hit < distance ? Math.max(0, hit - 0.2) : distance;
  }

  /** Detect even water crossed entirely between two ticks at terminal speed. */
  waterResetHeight(pos: Position, height: number, distance: number): number {
    let bottom = Infinity;
    for (let y = Math.floor(pos[1] + distance); y <= Math.floor(pos[1] + height - EPSILON); y++)
      for (
        let z = Math.floor(pos[2] - HALF_WIDTH + EPSILON);
        z <= Math.floor(pos[2] + HALF_WIDTH - EPSILON);
        z++
      )
        for (
          let x = Math.floor(pos[0] - HALF_WIDTH + EPSILON);
          x <= Math.floor(pos[0] + HALF_WIDTH - EPSILON);
          x++
        )
          if (this.water[this.state(x, y, z)]) bottom = Math.min(bottom, y);
    return Number.isFinite(bottom) ? Math.max(pos[1] + distance, bottom - height) : NaN;
  }

  onHay(pos: Position): boolean {
    for (
      let z = Math.floor(pos[2] - HALF_WIDTH + EPSILON);
      z <= Math.floor(pos[2] + HALF_WIDTH - EPSILON);
      z++
    )
      for (
        let x = Math.floor(pos[0] - HALF_WIDTH + EPSILON);
        x <= Math.floor(pos[0] + HALF_WIDTH - EPSILON);
        x++
      )
        if (this.hay[this.state(x, Math.floor(pos[1] - EPSILON), z)]) return true;
    return false;
  }

  eject(pos: Position, height: number, ready?: (x: number, z: number) => boolean): void {
    if (this.free(pos[0], pos[1], pos[2], height)) return;
    // Above world height is always free, so it also bounds every shortest-axis search.
    let best = Math.max(0, 320 - pos[1]),
      bestAxis = 1,
      bestDelta = best;
    for (let order = 0; order < 6; order++) {
      const axis = order < 2 ? 1 : order < 4 ? 0 : 2;
      const sign = order % 2 === 0 ? 1 : -1;
      const p = pos[axis]!;
      const extent = axis === 1 ? (sign > 0 ? 0 : height) : HALF_WIDTH;
      const edge = p + (sign > 0 ? -extent : extent);
      let face = (sign > 0 ? Math.ceil(edge * 2) : Math.floor(edge * 2)) / 2;
      for (; ; face += sign * 0.5) {
        const target = face + (sign > 0 ? extent : -extent);
        const delta = target - p;
        if (Math.abs(delta) >= best - EPSILON) break;
        if (delta * sign <= 0) continue;
        const x = axis === 0 ? target : pos[0],
          y = axis === 1 ? target : pos[1],
          z = axis === 2 ? target : pos[2];
        if ((!ready || ready(x, z)) && this.free(x, y, z, height)) {
          best = Math.abs(delta);
          bestAxis = axis;
          bestDelta = delta;
          break;
        }
      }
    }
    if (Number.isFinite(best)) pos[bestAxis]! += bestDelta;
  }
}
