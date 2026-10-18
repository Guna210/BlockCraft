export type CurrentFacing = 'north' | 'east' | 'south' | 'west';
export type CurrentAttachment =
  'floor' | 'ceiling' | 'wall_north' | 'wall_south' | 'wall_east' | 'wall_west';
export type CurrentMode = 'compare' | 'subtract';

export interface BlockPosition {
  x: number;
  y: number;
  z: number;
}

export const CURRENT_BLOCK_IDS = new Set([
  'copper_trace',
  'gauge',
  'inverter_torch',
  'lamp',
  'lever',
  'pressure_plate',
  'relay',
  'stone_button',
  'tripwire',
  'tripwire_hook',
  'wooden_button',
]);

/** Neighbour propagation order is +X, -X, +Y, -Y, +Z, -Z in every pass. */
export const NEIGHBOR_OFFSETS: readonly BlockPosition[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

export const HORIZONTAL_OFFSETS = NEIGHBOR_OFFSETS.filter((offset) => offset.y === 0);

export const FACING_OFFSET: Record<CurrentFacing, readonly [number, number, number]> = {
  north: [0, 0, -1],
  east: [1, 0, 0],
  south: [0, 0, 1],
  west: [-1, 0, 0],
};

export function oppositeFacing(facing: CurrentFacing): CurrentFacing {
  return facing === 'north'
    ? 'south'
    : facing === 'south'
      ? 'north'
      : facing === 'east'
        ? 'west'
        : 'east';
}

export function offsetPosition(position: BlockPosition, offset: BlockPosition): BlockPosition {
  return { x: position.x + offset.x, y: position.y + offset.y, z: position.z + offset.z };
}

export function positionKey(position: BlockPosition): string {
  return `${position.x},${position.y},${position.z}`;
}

export function comparePositions(a: BlockPosition, b: BlockPosition): number {
  return a.y - b.y || a.z - b.z || a.x - b.x;
}
