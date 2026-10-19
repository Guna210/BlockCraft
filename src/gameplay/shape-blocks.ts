// Placement, connection and toggling rules of stairs, fences, doors and trapdoors. Everything works
// on a small world interface and the block registry, so the unit tests, the debug API and
// BlockInteraction all run the same code.
import { BlockRegistry } from '../world/blocks/registry';
import type { BlockFaceDirection } from '../world/blocks/types';
import {
  FACING_VECTOR,
  WALL_FACINGS,
  facingFromVector,
  oppositeFacing,
  type Facing,
} from '../world/shape-geometry';

export interface ShapeWorld {
  getBlockStateId(x: number, y: number, z: number): number;
  setBlockStateId(x: number, y: number, z: number, state: number): void;
}

export interface PlacementContext {
  /** Placement cell. */
  x: number;
  y: number;
  z: number;
  /** Face of the targeted block that was clicked. */
  face: BlockFaceDirection;
  /** Hit point inside the targeted block, each 0..1. */
  hitX: number;
  hitY: number;
  hitZ: number;
  /** Player's horizontal look direction. */
  lookX: number;
  lookZ: number;
}

export interface PlacedCell {
  x: number;
  y: number;
  z: number;
  state: number;
}

const FACE_NORMAL: Record<BlockFaceDirection, readonly [number, number, number]> = {
  top: [0, 1, 0],
  bottom: [0, -1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
};

export function shapeModel(registry: BlockRegistry, state: number): string | undefined {
  const model = registry.getResolvedState(state)?.definition.model;
  return model === 'stairs' || model === 'fence' || model === 'door' || model === 'trapdoor'
    ? model
    : undefined;
}

function isFence(registry: BlockRegistry, state: number): boolean {
  return registry.getResolvedState(state)?.definition.model === 'fence';
}

/** A fence joins another fence and any full opaque cube. */
function fenceConnects(registry: BlockRegistry, state: number): boolean {
  const def = registry.getResolvedState(state)?.definition;
  return !!def && (def.model === 'fence' || (def.fullOpaqueCube && def.id !== 'air'));
}

function fenceStateAt(
  registry: BlockRegistry,
  world: ShapeWorld,
  blockId: string,
  x: number,
  y: number,
  z: number,
): number {
  const props: Record<string, string> = {};
  for (const side of WALL_FACINGS) {
    const [dx, dz] = FACING_VECTOR[side];
    props[side] = String(fenceConnects(registry, world.getBlockStateId(x + dx, y, z + dz)));
  }
  return registry.getStateId(blockId, props)!;
}

/** The state a new fence block takes at this position. */
export function fenceStateFor(
  registry: BlockRegistry,
  world: ShapeWorld,
  blockId: string,
  x: number,
  y: number,
  z: number,
): number {
  return fenceStateAt(registry, world, blockId, x, y, z);
}

/**
 * Recomputes the fences next to a changed cell; returns the cells whose state changed. Call it
 * after every block change at (x, y, z).
 */
export function updateFenceNeighbours(
  registry: BlockRegistry,
  world: ShapeWorld,
  x: number,
  y: number,
  z: number,
): PlacedCell[] {
  const changed: PlacedCell[] = [];
  for (const side of WALL_FACINGS) {
    const [dx, dz] = FACING_VECTOR[side];
    const nx = x + dx,
      nz = z + dz;
    const current = world.getBlockStateId(nx, y, nz);
    if (!isFence(registry, current)) continue;
    const next = fenceStateAt(
      registry,
      world,
      registry.getResolvedState(current)!.blockId,
      nx,
      y,
      nz,
    );
    if (next === current) continue;
    world.setBlockStateId(nx, y, nz, next);
    changed.push({ x: nx, y, z: nz, state: next });
  }
  return changed;
}

/**
 * The cells a placed shape block fills (a door fills two), or null when it cannot go here.
 * `isFree` says whether a cell can take a block.
 */
export function shapePlacement(
  registry: BlockRegistry,
  world: ShapeWorld,
  blockId: string,
  c: PlacementContext,
  isFree: (x: number, y: number, z: number) => boolean,
): PlacedCell[] | null {
  const model =
    registry.getDefaultStateId(blockId) !== undefined
      ? registry.getResolvedState(registry.getDefaultStateId(blockId)!)!.definition.model
      : undefined;
  const look = facingFromVector(c.lookX, c.lookZ);
  const upperHalf = c.face === 'bottom' || (c.face !== 'top' && c.hitY >= 0.5);
  if (model === 'fence') {
    return [
      { x: c.x, y: c.y, z: c.z, state: fenceStateAt(registry, world, blockId, c.x, c.y, c.z) },
    ];
  }
  if (model === 'stairs') {
    const state = registry.getStateId(blockId, {
      facing: look,
      half: upperHalf ? 'top' : 'bottom',
    });
    return state === undefined ? null : [{ x: c.x, y: c.y, z: c.z, state }];
  }
  if (model === 'trapdoor') {
    const facing: Facing =
      c.face === 'top' || c.face === 'bottom'
        ? oppositeFacing(look)
        : oppositeFacing(facingFromVector(FACE_NORMAL[c.face][0], FACE_NORMAL[c.face][2]));
    const state = registry.getStateId(blockId, {
      facing,
      half: upperHalf ? 'top' : 'bottom',
      open: 'false',
    });
    return state === undefined ? null : [{ x: c.x, y: c.y, z: c.z, state }];
  }
  if (model === 'door') {
    if (!isFree(c.x, c.y + 1, c.z)) return null;
    // Right-hand side of a viewer looking along (lookX, lookZ), with north = -z.
    const [lx, lz] = FACING_VECTOR[look];
    const rx = -lz,
      rz = lx;
    const n = FACE_NORMAL[c.face];
    const along =
      (rx !== 0 && n[0] === 0 ? (c.hitX - 0.5) * rx : 0) +
      (rz !== 0 && n[2] === 0 ? (c.hitZ - 0.5) * rz : 0);
    const props = {
      facing: oppositeFacing(look),
      hinge: along > 0 ? 'right' : 'left',
      open: 'false',
    };
    const lower = registry.getStateId(blockId, { ...props, half: 'lower' });
    const upper = registry.getStateId(blockId, { ...props, half: 'upper' });
    if (lower === undefined || upper === undefined) return null;
    return [
      { x: c.x, y: c.y, z: c.z, state: lower },
      { x: c.x, y: c.y + 1, z: c.z, state: upper },
    ];
  }
  return null;
}

/** Cells of the door a door state belongs to (both halves), or null when it is not a door. */
export function doorCells(
  registry: BlockRegistry,
  world: ShapeWorld,
  x: number,
  y: number,
  z: number,
): PlacedCell[] | null {
  const state = world.getBlockStateId(x, y, z);
  const s = registry.getResolvedState(state);
  if (!s || s.definition.model !== 'door') return null;
  const lower = s.properties.half !== 'upper';
  const otherY = lower ? y + 1 : y - 1;
  const other = world.getBlockStateId(x, otherY, z);
  const o = registry.getResolvedState(other);
  const cells: PlacedCell[] = [{ x, y, z, state }];
  if (o && o.blockId === s.blockId && o.properties.half !== s.properties.half)
    cells.push({ x, y: otherY, z, state: other });
  return cells;
}

/**
 * Opens or closes the door or trapdoor at this cell; returns the changed cells, empty when the
 * block is neither.
 */
export function toggleOpenable(
  registry: BlockRegistry,
  world: ShapeWorld,
  x: number,
  y: number,
  z: number,
): PlacedCell[] {
  const s = registry.getResolvedState(world.getBlockStateId(x, y, z));
  if (!s) return [];
  const cells =
    s.definition.model === 'door'
      ? doorCells(registry, world, x, y, z)!
      : s.definition.model === 'trapdoor'
        ? [{ x, y, z, state: world.getBlockStateId(x, y, z) }]
        : [];
  const changed: PlacedCell[] = [];
  for (const cell of cells) {
    const r = registry.getResolvedState(cell.state)!;
    const state = registry.getStateId(r.blockId, {
      ...r.properties,
      open: r.properties.open === 'true' ? 'false' : 'true',
    })!;
    world.setBlockStateId(cell.x, cell.y, cell.z, state);
    changed.push({ x: cell.x, y: cell.y, z: cell.z, state });
  }
  return changed;
}

/**
 * Drives the `open` state of the door or trapdoor at this cell (both halves of a door) to `open`.
 * Returns the changed cells; empty when the block is neither or already in that state.
 */
export function setOpenable(
  registry: BlockRegistry,
  world: ShapeWorld,
  x: number,
  y: number,
  z: number,
  open: boolean,
): PlacedCell[] {
  const s = registry.getResolvedState(world.getBlockStateId(x, y, z));
  if (!s) return [];
  const cells =
    s.definition.model === 'door'
      ? doorCells(registry, world, x, y, z)!
      : s.definition.model === 'trapdoor'
        ? [{ x, y, z, state: world.getBlockStateId(x, y, z) }]
        : [];
  const changed: PlacedCell[] = [];
  for (const cell of cells) {
    const r = registry.getResolvedState(cell.state)!;
    if ((r.properties.open === 'true') === open) continue;
    const state = registry.getStateId(r.blockId, { ...r.properties, open: String(open) })!;
    world.setBlockStateId(cell.x, cell.y, cell.z, state);
    changed.push({ x: cell.x, y: cell.y, z: cell.z, state });
  }
  return changed;
}

/**
 * Removes the block at this cell, and the other half of a door, then refreshes neighbouring
 * fences. Returns every changed cell.
 */
export function removeShapeBlock(
  registry: BlockRegistry,
  world: ShapeWorld,
  x: number,
  y: number,
  z: number,
): PlacedCell[] {
  const cells = doorCells(registry, world, x, y, z) ?? [{ x, y, z, state: 0 }];
  const changed: PlacedCell[] = [];
  for (const cell of cells) {
    world.setBlockStateId(cell.x, cell.y, cell.z, 0);
    changed.push({ x: cell.x, y: cell.y, z: cell.z, state: 0 });
  }
  for (const cell of cells)
    changed.push(...updateFenceNeighbours(registry, world, cell.x, cell.y, cell.z));
  return changed;
}
