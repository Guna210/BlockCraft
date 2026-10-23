import { deriveSeed } from '../../engine/rng';
import { sampleTerrainTopY } from '../../gen/terrain-height';
import { terrainVariant } from '../../gen/world-options';
import {
  locateNearest,
  STRUCTURE_PLACEMENT_CONFIGS,
  createPlacementGrid,
} from '../../gen/structures/placement';
import { getWorldInstance } from '../../world/world-instance';
import { WorldManager } from '../../world/world-manager';
import { registerLocator } from './locate';

function locateStructure(
  id: string,
  near: [number, number, number],
): [number, number, number] | null {
  const manager = WorldManager.getInstance();
  if (!manager.worldOptions.structures) return null;
  if (!STRUCTURE_PLACEMENT_CONFIGS.some((config) => config.id === id)) return null;
  const worldSeed = getWorldInstance().worldSeed ?? manager.worldSeed;
  const variant = terrainVariant();
  const start =
    variant.type === 'flat'
      ? createPlacementGrid(worldSeed, STRUCTURE_PLACEMENT_CONFIGS, () => 'plains').locateNearest(
          id,
          near,
          2000,
        )
      : locateNearest(worldSeed, id, near, 2000);
  if (!start) return null;
  const y =
    variant.type === 'flat'
      ? 65
      : sampleTerrainTopY(deriveSeed(worldSeed, 'terrain_shape'), start.x, start.z) + 1;
  return [start.x, y, start.z];
}

registerLocator('structure', locateStructure);
