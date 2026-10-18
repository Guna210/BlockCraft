import type { World } from './world';
import { BlockShapes, type Box } from './block-shapes';
import type { BlockFaceDirection } from './blocks/types';
export const FACES = ['west', 'bottom', 'north', 'east', 'top', 'south'] as const;
export interface RayHit {
  hit: boolean;
  x: number;
  y: number;
  z: number;
  stateId: number;
  face: BlockFaceDirection;
  distance: number;
}
export function createRayHit(): RayHit {
  return { hit: false, x: 0, y: 0, z: 0, stateId: 0, face: 'west', distance: 0 };
}
/** Exact slab intersection. A ray starting inside exits through the first outgoing face. */
export function intersectBox(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  x: number,
  y: number,
  z: number,
  box: Box,
  out: RayHit,
): boolean {
  let near = -Infinity,
    far = Infinity,
    enter = 0,
    leave = 3;
  for (let axis = 0; axis < 3; axis++) {
    const o = axis === 0 ? ox : axis === 1 ? oy : oz;
    const d = axis === 0 ? dx : axis === 1 ? dy : dz;
    const base = axis === 0 ? x : axis === 1 ? y : z;
    const lo = base + box[axis]!,
      hi = base + box[axis + 3]!;
    if (d === 0) {
      if (o < lo || o > hi) return false;
      continue;
    }
    const a = (lo - o) / d,
      b = (hi - o) / d;
    const n = Math.min(a, b),
      f = Math.max(a, b);
    if (n > near) {
      near = n;
      enter = axis + (d > 0 ? 0 : 3);
    }
    if (f < far) {
      far = f;
      leave = axis + (d > 0 ? 3 : 0);
    }
    if (near > far) return false;
  }
  if (far < 0) return false;
  out.distance = near >= 0 ? near : far;
  out.face = FACES[near >= 0 ? enter : leave]!;
  return true;
}
/** Voxel DDA with reusable result/scratch storage; distances are in world blocks. */
export class VoxelRaycaster {
  readonly shapes = new BlockShapes();
  private readonly boxHit = createRayHit();
  private bestFace: BlockFaceDirection = 'west';
  constructor(private readonly world: Pick<World, 'getBlockStateId'>) {}
  cast(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    reach: number,
    out: RayHit,
  ): RayHit {
    out.hit = false;
    const length = Math.hypot(dx, dy, dz);
    if (!Number.isFinite(length) || length === 0 || !Number.isFinite(reach) || reach < 0)
      return out;
    dx /= length;
    dy /= length;
    dz /= length;
    let x = Math.floor(ox),
      y = Math.floor(oy),
      z = Math.floor(oz);
    const sx = Math.sign(dx),
      sy = Math.sign(dy),
      sz = Math.sign(dz);
    const tx = dx === 0 ? Infinity : Math.abs(1 / dx),
      ty = dy === 0 ? Infinity : Math.abs(1 / dy),
      tz = dz === 0 ? Infinity : Math.abs(1 / dz);
    let nx = dx === 0 ? Infinity : ((dx > 0 ? x + 1 : x) - ox) / dx;
    let ny = dy === 0 ? Infinity : ((dy > 0 ? y + 1 : y) - oy) / dy;
    let nz = dz === 0 ? Infinity : ((dz > 0 ? z + 1 : z) - oz) / dz;
    let entered = 0;
    while (entered <= reach) {
      const id = this.world.getBlockStateId(x, y, z),
        parts = this.shapes.parts[id];
      if (parts) {
        // Nearest hit across the state's boxes: the empty part of a stair lets the ray pass.
        let best = Infinity;
        for (let i = 0; i < parts.length; i++)
          if (
            intersectBox(ox, oy, oz, dx, dy, dz, x, y, z, parts[i]!, this.boxHit) &&
            this.boxHit.distance < best
          ) {
            best = this.boxHit.distance;
            this.bestFace = this.boxHit.face;
          }
        if (best <= reach && best <= Math.min(nx, ny, nz) + 1e-10) {
          out.hit = true;
          out.x = x;
          out.y = y;
          out.z = z;
          out.stateId = id;
          out.face = this.bestFace;
          out.distance = best;
          return out;
        }
      }
      if (nx <= ny && nx <= nz) {
        entered = nx;
        nx += tx;
        x += sx;
      } else if (ny <= nz) {
        entered = ny;
        ny += ty;
        y += sy;
      } else {
        entered = nz;
        nz += tz;
        z += sz;
      }
    }
    return out;
  }
}
