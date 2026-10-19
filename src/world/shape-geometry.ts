// Pure box geometry of block states: shared by targeting, collision and the mesher (workers
// import this file, so it must not touch the block registry).
import type { BlockModel, ResolvedBlockState } from './blocks/types';
export type Box = readonly [number, number, number, number, number, number];
export const CUBE_BOX: Box = [0, 0, 0, 1, 1, 1];
export const BOTTOM_SLAB_BOX: Box = [0, 0, 0, 1, 0.5, 1];
export const TOP_SLAB_BOX: Box = [0, 0.5, 0, 1, 1, 1];
const PLANT_BOX: Box = [0.15, 0, 0.15, 0.85, 1, 0.85];
const TORCH_BOX: Box = [0.35, 0, 0.35, 0.7, 0.875, 0.7];
const TRACE_BOX: Box = [0, 0, 0, 1, 0.125, 1];
const TRIPWIRE_BOX: Box = [0, 0.4, 0, 1, 0.6, 1];
export const WALL_FACINGS = ['north', 'south', 'east', 'west'] as const;
export type Facing = (typeof WALL_FACINGS)[number];
const WALL_BOXES: readonly Box[] = [
  [0, 0, 15 / 16, 1, 1, 1],
  [0, 0, 0, 1, 1, 1 / 16],
  [0, 0, 0, 1 / 16, 1, 1],
  [15 / 16, 0, 0, 1, 1, 1],
];
const WALL_TORCH_BOXES: readonly Box[] = [
  [0.35, 0.15, 0.45, 0.7, 1, 1],
  [0.35, 0.15, 0, 0.7, 1, 0.55],
  [0, 0.15, 0.35, 0.55, 1, 0.7],
  [0.45, 0.15, 0.35, 1, 1, 0.7],
];

/** Horizontal unit vectors in (x, z) per facing: north is -z, east is +x. */
export const FACING_VECTOR: Record<Facing, readonly [number, number]> = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
};
export function facingFromVector(x: number, z: number): Facing {
  return Math.abs(x) > Math.abs(z) ? (x > 0 ? 'east' : 'west') : z > 0 ? 'south' : 'north';
}
export function oppositeFacing(facing: Facing): Facing {
  return facingFromVector(-FACING_VECTOR[facing][0], -FACING_VECTOR[facing][1]);
}

/** Door and trapdoor leaves are 3/16 of a block thick. */
export const LEAF = 3 / 16;
/** A fence is a 1.5-block obstacle, so a player cannot jump over it. */
export const FENCE_COLLISION_HEIGHT = 1.5;

/** Stairs rise towards `facing`: the riser stands on that side of the block. */
function stairBoxes(facing: Facing, top: boolean): readonly Box[] {
  const [fx, fz] = FACING_VECTOR[facing];
  const slab = top ? TOP_SLAB_BOX : BOTTOM_SLAB_BOX;
  const y0 = top ? 0 : 0.5;
  const step: Box = [
    fx > 0 ? 0.5 : 0,
    y0,
    fz > 0 ? 0.5 : 0,
    fx < 0 ? 0.5 : 1,
    y0 + 0.5,
    fz < 0 ? 0.5 : 1,
  ];
  return [slab, step];
}

function bedBoxes(props: Record<string, string | number>): readonly Box[] {
  const boxes: Box[] = [
    [0, 3 / 16, 0, 1, 9 / 16, 1],
    [1 / 16, 0, 1 / 16, 3 / 16, 3 / 16, 3 / 16],
    [13 / 16, 0, 1 / 16, 15 / 16, 3 / 16, 3 / 16],
    [1 / 16, 0, 13 / 16, 3 / 16, 3 / 16, 15 / 16],
    [13 / 16, 0, 13 / 16, 15 / 16, 3 / 16, 15 / 16],
  ];
  if (props.part !== 'head') return boxes;
  const facing = props.facing as Facing;
  const pillow: Record<Facing, Box> = {
    north: [1 / 8, 9 / 16, 1 / 16, 7 / 8, 10 / 16, 5 / 16],
    south: [1 / 8, 9 / 16, 11 / 16, 7 / 8, 10 / 16, 15 / 16],
    east: [11 / 16, 9 / 16, 1 / 8, 15 / 16, 10 / 16, 7 / 8],
    west: [1 / 16, 9 / 16, 1 / 8, 5 / 16, 10 / 16, 7 / 8],
  };
  boxes.push(pillow[facing] ?? pillow.north);
  return boxes;
}

/** Direction (as a facing) from the cell centre to the hinge edge of an open door. */
export function doorHingeSide(facing: Facing, hinge: string): Facing {
  const [fx, fz] = FACING_VECTOR[facing];
  // A viewer outside the door looks along -facing; their right-hand side is (fz, -fx).
  return hinge === 'right' ? facingFromVector(fz, -fx) : facingFromVector(-fz, fx);
}

function leafBox(side: Facing): Box {
  const [sx, sz] = FACING_VECTOR[side];
  return [sx > 0 ? 1 - LEAF : 0, 0, sz > 0 ? 1 - LEAF : 0, sx < 0 ? LEAF : 1, 1, sz < 0 ? LEAF : 1];
}

/** Closed doors stand on the `facing` side; open ones swing to the hinge edge. */
export function doorBox(facing: Facing, hinge: string, open: boolean): Box {
  return leafBox(open ? doorHingeSide(facing, hinge) : facing);
}

/** The face (as a facing, i.e. outward normal) of a door leaf that was its front when closed. */
export function doorFrontNormal(facing: Facing, hinge: string, open: boolean): Facing {
  if (!open) return facing;
  return oppositeFacing(doorHingeSide(facing, hinge));
}

export function trapdoorBox(facing: Facing, half: string, open: boolean): Box {
  if (open) return leafBox(facing);
  return half === 'top' ? [0, 1 - LEAF, 0, 1, 1, 1] : [0, 0, 0, 1, LEAF, 1];
}

const POST_MIN = 6 / 16;
const POST_MAX = 10 / 16;
const ARM_MIN = 7 / 16;
const ARM_MAX = 9 / 16;
const ARM_BARS: ReadonlyArray<readonly [number, number]> = [
  [6 / 16, 9 / 16],
  [12 / 16, 15 / 16],
];
function armBoxes(side: Facing, bars: ReadonlyArray<readonly [number, number]>): Box[] {
  const [sx, sz] = FACING_VECTOR[side];
  return bars.map(([y0, y1]): Box => [
    sx > 0 ? POST_MAX : sx < 0 ? 0 : ARM_MIN,
    y0,
    sz > 0 ? POST_MAX : sz < 0 ? 0 : ARM_MIN,
    sx > 0 ? 1 : sx < 0 ? POST_MIN : ARM_MAX,
    y1,
    sz > 0 ? 1 : sz < 0 ? POST_MIN : ARM_MAX,
  ]);
}
function fenceBoxes(props: Record<string, string | number>, collision: boolean): readonly Box[] {
  const top = collision ? FENCE_COLLISION_HEIGHT : 1;
  const boxes: Box[] = [[POST_MIN, 0, POST_MIN, POST_MAX, top, POST_MAX]];
  for (const side of WALL_FACINGS) {
    if (String(props[side]) !== 'true') continue;
    boxes.push(...armBoxes(side, collision ? [[0, FENCE_COLLISION_HEIGHT]] : ARM_BARS));
  }
  return boxes;
}

/** Targeting/rendering boxes: what the player sees and aims at. */
export function selectionBoxes(
  blockId: string,
  model: BlockModel | undefined,
  props: Record<string, string | number>,
): readonly Box[] | null {
  if (blockId === 'air' || blockId === 'water' || blockId === 'lava') return null;
  const facing = WALL_FACINGS.indexOf(props.facing as Facing);
  if (blockId === 'wall_torch') return [WALL_TORCH_BOXES[facing]!];
  if (blockId === 'torch') return [TORCH_BOX];
  switch (model) {
    case 'trace':
      return [TRACE_BOX];
    case 'tripwire':
      return [TRIPWIRE_BOX];
    case 'pressure_plate':
      return [[0, 0, 0, 1, String(props.powered) === 'true' ? 1 / 32 : 1 / 16, 1]];
    case 'cross':
      return [PLANT_BOX];
    case 'wall':
      return [WALL_BOXES[facing]!];
    case 'slab':
      return [props.half === 'top' ? TOP_SLAB_BOX : BOTTOM_SLAB_BOX];
    case 'stairs':
      return stairBoxes(props.facing as Facing, props.half === 'top');
    case 'fence':
      return fenceBoxes(props, false);
    case 'door':
      return [doorBox(props.facing as Facing, String(props.hinge), props.open === 'true')];
    case 'trapdoor':
      return [trapdoorBox(props.facing as Facing, String(props.half), props.open === 'true')];
    case 'piston_head':
      return pistonHeadBoxes(String(props.facing));
    case 'bed':
      return bedBoxes(props);
    default:
      return [CUBE_BOX];
  }
}

/** Unit vectors of the six piston and dispenser facings. */
const PISTON_FACING_VECTOR: Record<string, readonly [number, number, number]> = {
  north: [0, 0, -1],
  east: [1, 0, 0],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
};

/** A 4/16 plate on the front of the cell and a 4/16 square shaft running back to the piston. */
function pistonHeadBoxes(facing: string): readonly Box[] {
  const vector = PISTON_FACING_VECTOR[facing] ?? PISTON_FACING_VECTOR.north!;
  const axis = vector[0] !== 0 ? 0 : vector[1] !== 0 ? 1 : 2;
  const positive = vector[axis]! > 0;
  const plate = [0, 0, 0, 1, 1, 1];
  const shaft = [6 / 16, 6 / 16, 6 / 16, 10 / 16, 10 / 16, 10 / 16];
  if (positive) {
    plate[axis] = 12 / 16;
    shaft[axis] = 0;
    shaft[axis + 3] = 12 / 16;
  } else {
    plate[axis + 3] = 4 / 16;
    shaft[axis] = 4 / 16;
    shaft[axis + 3] = 1;
  }
  return [plate as unknown as Box, shaft as unknown as Box];
}

/** Solid boxes entities collide with; they may extend above the cell (fences). */
export function collisionBoxes(
  blockId: string,
  model: BlockModel | undefined,
  props: Record<string, string | number>,
): readonly Box[] {
  if (blockId === 'air' || blockId === 'water' || blockId === 'lava') return [];
  switch (model) {
    case 'cross':
    case 'wall':
    case 'wall_torch':
    case 'trace':
    case 'tripwire':
    case 'pressure_plate':
      return [];
    case 'fence':
      return fenceBoxes(props, true);
    case 'none':
      return [];
    case 'slab':
    case 'stairs':
    case 'door':
    case 'trapdoor':
    case 'piston_head':
    case 'bed':
      return selectionBoxes(blockId, model, props)!;
    default:
      return [CUBE_BOX];
  }
}

export function stateBoxes(state: ResolvedBlockState): readonly Box[] | null {
  return selectionBoxes(state.blockId, state.definition.model, state.properties);
}

export function boundingBox(boxes: readonly Box[]): Box {
  const out = [...boxes[0]!] as [number, number, number, number, number, number];
  for (const box of boxes)
    for (let i = 0; i < 3; i++) {
      out[i] = Math.min(out[i]!, box[i]!);
      out[i + 3] = Math.max(out[i + 3]!, box[i + 3]!);
    }
  return out;
}
