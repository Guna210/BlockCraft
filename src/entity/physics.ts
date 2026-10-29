import { collisionBoxes } from '../world/block-shapes';
import { BlockRegistry } from '../world/blocks/registry';
import type { World } from '../world/world';

export const EPSILON = 1e-7;
export const HALF_WIDTH = 0.3;
export type Position = [number, number, number];

/** Highest a collision box reaches above its own cell (fences are 1.5 blocks tall). */
const MAX_OVERHANG = 1;

/**
 * Cached state shapes: no block objects or arrays are created during a collision query. Every
 * state owns a run of boxes in `boxData` (six numbers each, relative to its cell).
 */
export class BlockCollision {
  private readonly boxStart: Int32Array;
  private readonly boxCount: Uint8Array;
  private readonly boxData: Float64Array;
  private readonly water: Uint8Array;
  private readonly hay: Uint8Array;
  private readonly mire: Uint8Array;
  private readonly silkmesh: Uint8Array;
  private readonly climbers: Uint8Array;
  constructor(public readonly world: World) {
    const registry = BlockRegistry.getInstance();
    const n = registry.getMaxStateId() + 1;
    this.boxStart = new Int32Array(n);
    this.boxCount = new Uint8Array(n);
    this.water = new Uint8Array(n);
    this.hay = new Uint8Array(n);
    this.mire = new Uint8Array(n);
    this.silkmesh = new Uint8Array(n);
    this.climbers = new Uint8Array(n);
    const data: number[] = [];
    for (const id of registry.getAllStateIds()) {
      const state = registry.getResolvedState(id)!;
      this.water[id] = state.blockId === 'water' ? 1 : 0;
      this.hay[id] = state.blockId === 'hay_bale' ? 1 : 0;
      this.mire[id] = state.blockId === 'mire' ? 1 : 0;
      this.silkmesh[id] = state.blockId === 'silkmesh' ? 1 : 0;
      if (state.blockId === 'ladder' || state.blockId === 'vine')
        this.climbers[id] =
          ['north', 'south', 'east', 'west'].indexOf(String(state.properties.facing)) + 1;
      const boxes = collisionBoxes(state.blockId, state.definition.model, state.properties);
      this.boxStart[id] = data.length / 6;
      this.boxCount[id] = boxes.length;
      for (const box of boxes) data.push(...box);
    }
    this.boxData = Float64Array.from(data);
  }

  private state(x: number, y: number, z: number): number {
    return this.world.getBlockStateId(x, y, z);
  }

  free(x: number, y: number, z: number, height: number): boolean {
    const minX = x - HALF_WIDTH,
      maxX = x + HALF_WIDTH,
      minZ = z - HALF_WIDTH,
      maxZ = z + HALF_WIDTH;
    for (
      let by = Math.floor(y + EPSILON) - MAX_OVERHANG;
      by <= Math.floor(y + height - EPSILON);
      by++
    )
      for (let bz = Math.floor(minZ + EPSILON); bz <= Math.floor(maxZ - EPSILON); bz++)
        for (let bx = Math.floor(minX + EPSILON); bx <= Math.floor(maxX - EPSILON); bx++) {
          const id = this.state(bx, by, bz);
          for (let i = 0, o = this.boxStart[id]! * 6; i < this.boxCount[id]!; i++, o += 6) {
            const d = this.boxData;
            if (
              y < by + d[o + 4]! - EPSILON &&
              y + height > by + d[o + 1]! + EPSILON &&
              bx + d[o]! <= maxX - EPSILON &&
              bx + d[o + 3]! > minX + EPSILON &&
              bz + d[o + 2]! <= maxZ - EPSILON &&
              bz + d[o + 5]! > minZ + EPSILON
            )
              return false;
          }
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
    const d = this.boxData;
    let result = distance;
    for (
      let y = Math.floor(minY + Math.min(axis === 1 ? distance : 0, 0) + EPSILON) - MAX_OVERHANG;
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
          for (let i = 0, o = this.boxStart[id]! * 6; i < this.boxCount[id]!; i++, o += 6) {
            const x0 = x + d[o]!,
              y0 = y + d[o + 1]!,
              z0 = z + d[o + 2]!;
            const x1 = x + d[o + 3]!,
              y1 = y + d[o + 4]!,
              z1 = z + d[o + 5]!;
            if (axis !== 0 && (maxX <= x0 + EPSILON || minX >= x1 - EPSILON)) continue;
            if (axis !== 1 && (maxY <= y0 + EPSILON || minY >= y1 - EPSILON)) continue;
            if (axis !== 2 && (maxZ <= z0 + EPSILON || minZ >= z1 - EPSILON)) continue;
            const near = axis === 0 ? x0 : axis === 1 ? y0 : z0;
            const far = axis === 0 ? x1 : axis === 1 ? y1 : z1;
            const low = axis === 0 ? minX : axis === 1 ? minY : minZ;
            const high = axis === 0 ? maxX : axis === 1 ? maxY : maxZ;
            if (distance > 0 && high <= near + EPSILON)
              result = Math.min(result, Math.max(0, near - high));
            if (distance < 0 && low >= far - EPSILON)
              result = Math.max(result, Math.min(0, far - low));
          }
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

  /** Whether the body overlaps a Silkmesh cell (it has no collision box, only drag). */
  inSilkmesh(pos: Position, height: number): boolean {
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
          if (this.silkmesh[this.state(x, y, z)]) return true;
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

  /** Exact ray/solid-shape intersection, including slabs and stairs. No per-query allocations. */
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
    const d = this.boxData;
    for (
      let bz = Math.floor(Math.min(z, z + dz * distance));
      bz <= Math.floor(Math.max(z, z + dz * distance));
      bz++
    )
      for (
        let by = Math.floor(Math.min(y, y + dy * distance)) - MAX_OVERHANG;
        by <= Math.floor(Math.max(y, y + dy * distance));
        by++
      )
        for (
          let bx = Math.floor(Math.min(x, x + dx * distance));
          bx <= Math.floor(Math.max(x, x + dx * distance));
          bx++
        ) {
          const id = this.state(bx, by, bz);
          for (let i = 0, o = this.boxStart[id]! * 6; i < this.boxCount[id]!; i++, o += 6) {
            let enter = 0,
              leave = hit;
            for (let axis = 0; axis < 3; axis++) {
              const origin = axis === 0 ? x : axis === 1 ? y : z;
              const dir = axis === 0 ? dx : axis === 1 ? dy : dz;
              const base = axis === 0 ? bx : axis === 1 ? by : bz;
              const low = base + d[o + axis]!;
              const high = base + d[o + axis + 3]!;
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
