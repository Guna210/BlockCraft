// Runs the real placement, toggle and break rules of stairs, fences, doors and trapdoors, so
// tests and screenshots build with the same code as BlockInteraction.
import { api } from './core';
import { getWorldInstance } from '../../world/world-instance';
import { BlockRegistry } from '../../world/blocks/registry';
import { BlockShapes } from '../../world/block-shapes';
import {
  removeShapeBlock,
  shapePlacement,
  toggleOpenable,
  updateFenceNeighbours,
} from '../../gameplay/shape-blocks';

api.placeShape = (id, x, y, z, opts = {}) => {
  const world = getWorldInstance();
  const registry = BlockRegistry.getInstance();
  const shapes = new BlockShapes(registry);
  const hit = opts.hit ?? [0.5, 0.25, 0.5];
  const look = opts.look ?? [0, -1];
  const cells = shapePlacement(
    registry,
    world,
    id,
    {
      x,
      y,
      z,
      face: opts.face ?? 'top',
      hitX: hit[0],
      hitY: hit[1],
      hitZ: hit[2],
      lookX: look[0],
      lookZ: look[1],
    },
    (fx, fy, fz) => shapes.replaceable[world.getBlockStateId(fx, fy, fz)] === 1,
  );
  if (!cells) return null;
  for (const cell of cells) world.setBlockStateId(cell.x, cell.y, cell.z, cell.state);
  for (const cell of cells) updateFenceNeighbours(registry, world, cell.x, cell.y, cell.z);
  return cells.map((c) => ({
    x: c.x,
    y: c.y,
    z: c.z,
    block: registry.getResolvedState(c.state)!.blockId,
  }));
};
api.toggleShape = (x, y, z) =>
  toggleOpenable(BlockRegistry.getInstance(), getWorldInstance(), x, y, z).length;
api.breakShape = (x, y, z) =>
  removeShapeBlock(BlockRegistry.getInstance(), getWorldInstance(), x, y, z).length;
