import {
  DefaultBlockClassifier,
  Pathfinder,
  type BlockPos,
  type PathOptions,
  type PathResult,
  type WorldQuery,
} from '../../entity/ai/pathfinding';
import { BlockRegistry } from '../../world/blocks/registry';
import { getWorldInstance } from '../../world/world-instance';

/** Debug-only A* access for generation acceptance checks; it does not subscribe to World edits. */
export function findDebugPath(start: BlockPos, goal: BlockPos, options?: PathOptions): PathResult {
  const world = getWorldInstance();
  const registry = BlockRegistry.getInstance();
  const query: WorldQuery = {
    getBlockStateId: (x, y, z) => world.getBlockStateId(x, y, z),
  };
  const classifier = new DefaultBlockClassifier(
    (_x, _y, _z, stateId) =>
      String(registry.getResolvedState(stateId)?.properties['open'] ?? 'false') === 'true',
    (stateId) => (registry.getResolvedState(stateId)?.blockId ?? '').endsWith('_door'),
  );
  return new Pathfinder(query, classifier).findPath(start, goal, options);
}
