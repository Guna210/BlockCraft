import {
  blockEntityRegistry,
  type BlockEntityState,
  type JsonValue,
} from '../world/block-entities';
import type { World } from '../world/world';
import { BlockRegistry } from '../world/blocks/registry';
import type { ItemEntityManager } from '../entity/item-entity';

export interface ChestSlot extends Record<string, JsonValue> {
  id: string;
  count: number;
}

export interface ChestEntityState extends BlockEntityState {
  slots: Array<ChestSlot | null>;
}

export type ChestFacing = 'north' | 'south' | 'east' | 'west';
export type ChestPair = 'single' | 'left' | 'right';

export interface ChestStorage {
  halves: ChestEntityState[];
  double: boolean;
}

const SIDES: Record<ChestFacing, { left: [number, number]; right: [number, number] }> = {
  north: { left: [-1, 0], right: [1, 0] },
  south: { left: [1, 0], right: [-1, 0] },
  east: { left: [0, -1], right: [0, 1] },
  west: { left: [0, 1], right: [0, -1] },
};

function blockAt(world: World, x: number, y: number, z: number) {
  return world.getBlock(x, y, z);
}

function chestState(world: World, x: number, y: number, z: number) {
  const block = blockAt(world, x, y, z);
  if (block.id !== 'chest') return null;
  return {
    facing: String(block.state.facing ?? 'north') as ChestFacing,
    pair: String(block.state.pair ?? 'single') as ChestPair,
  };
}

function setPair(world: World, x: number, y: number, z: number, pair: ChestPair): void {
  const current = chestState(world, x, y, z);
  if (!current || current.pair === pair) return;
  const stateId = BlockRegistry.getInstance().getStateId('chest', {
    facing: current.facing,
    pair,
  });
  if (stateId !== undefined) world.setBlockStateId(x, y, z, stateId);
}

function matchingChest(
  world: World,
  x: number,
  y: number,
  z: number,
  facing: ChestFacing,
): ChestPair | null {
  const state = chestState(world, x, y, z);
  return state?.facing === facing ? state.pair : null;
}

function reconcileChestAt(world: World, x: number, y: number, z: number): void {
  const key = `${x},${y},${z}`;
  if (reconciling.has(key)) return;
  const state = chestState(world, x, y, z);
  if (!state) return;

  reconciling.add(key);
  try {
    const sides = SIDES[state.facing];
    if (!sides) return;

    if (state.pair !== 'single') {
      const side = state.pair === 'left' ? sides.right : sides.left;
      const otherPair = state.pair === 'left' ? 'right' : 'left';
      if (matchingChest(world, x + side[0], y, z + side[1], state.facing) === otherPair) return;
      setPair(world, x, y, z, 'single');
    }

    const current = chestState(world, x, y, z);
    if (!current) return;
    const candidates: Array<{ side: 'left' | 'right'; dx: number; dz: number }> = [];
    for (const sideName of ['left', 'right'] as const) {
      const [dx, dz] = sides[sideName];
      if (
        matchingChest(world, x + dx, y, z + dz, current.facing) !== 'single' ||
        hasThirdChest(world, x, y, z, x + dx, z + dz, current.facing)
      )
        continue;
      candidates.push({ side: sideName, dx, dz });
    }
    if (candidates.length !== 1) return;

    const candidate = candidates[0]!;
    setPair(world, x, y, z, candidate.side === 'left' ? 'right' : 'left');
    setPair(world, x + candidate.dx, y, z + candidate.dz, candidate.side);
  } finally {
    reconciling.delete(key);
  }
}

const reconciling = new Set<string>();

function hasThirdChest(
  world: World,
  currentX: number,
  y: number,
  currentZ: number,
  candidateX: number,
  candidateZ: number,
  facing: ChestFacing,
): boolean {
  const sides = SIDES[facing];
  const dx = candidateX - currentX;
  const dz = candidateZ - currentZ;
  const candidateSide = dx === sides.left[0] && dz === sides.left[1] ? 'left' : 'right';
  const farSide = candidateSide === 'left' ? sides.left : sides.right;
  return matchingChest(world, candidateX + farSide[0], y, candidateZ + farSide[1], facing) !== null;
}

function reconcileAround(world: World, x: number, y: number, z: number): void {
  reconcileChestAt(world, x, y, z);
  reconcileChestAt(world, x - 1, y, z);
  reconcileChestAt(world, x + 1, y, z);
  reconcileChestAt(world, x, y, z - 1);
  reconcileChestAt(world, x, y, z + 1);
}

export function registerChestBlockEntity(): void {
  blockEntityRegistry.register<ChestEntityState>({
    blockId: 'chest',
    create: () => ({ slots: Array.from({ length: 27 }, () => null) }),
    afterPlaced: (entity, world) => reconcileAround(world, entity.x, entity.y, entity.z),
    afterStateChanged: (entity, world) => reconcileAround(world, entity.x, entity.y, entity.z),
    afterRemoved: (entity, world) => reconcileAround(world, entity.x, entity.y, entity.z),
  });
}

registerChestBlockEntity();

export function chestStorageAt(world: World, x: number, y: number, z: number): ChestStorage | null {
  const state = chestState(world, x, y, z);
  if (!state) return null;
  const positions: Array<[number, number, number]> = [[x, y, z]];
  if (state.pair !== 'single') {
    const side = state.pair === 'left' ? SIDES[state.facing].right : SIDES[state.facing].left;
    const mateX = x + side[0];
    const mateZ = z + side[1];
    const mate = chestState(world, mateX, y, mateZ);
    const expected = state.pair === 'left' ? 'right' : 'left';
    if (mate?.facing === state.facing && mate.pair === expected) {
      if (state.pair === 'left') positions.push([mateX, y, mateZ]);
      else positions.unshift([mateX, y, mateZ]);
    }
  }

  const halves: ChestEntityState[] = [];
  for (const [cx, cy, cz] of positions) {
    const entity = world.getBlockEntity<ChestEntityState>(cx, cy, cz);
    if (!entity || entity.slots.length !== 27) return null;
    halves.push(entity);
  }
  return { halves, double: halves.length === 2 };
}

export function chestFacingFromYaw(yaw: number): ChestFacing {
  const x = Math.cos(yaw);
  const z = Math.sin(yaw);
  if (Math.abs(x) > Math.abs(z)) return x >= 0 ? 'east' : 'west';
  return z >= 0 ? 'south' : 'north';
}

/** Drops each occupied slot from the broken half at the block's position. */
export function spillChestContents(
  world: World,
  entities: ItemEntityManager,
  x: number,
  y: number,
  z: number,
): boolean {
  const state = world.getBlockEntity<ChestEntityState>(x, y, z);
  if (!state || state.slots.length !== 27) return false;
  const contents = state.slots.filter((stack): stack is ChestSlot => stack !== null);
  const freeEntities = entities.pool.reduce((count, entity) => count + Number(!entity.active), 0);
  if (contents.length > freeEntities) return false;
  for (const stack of contents)
    if (!entities.spawn(stack.id, stack.count, x + 0.5, y + 0.5, z + 0.5)) return false;
  return true;
}
