import { api } from './core';
import { WorldManager } from '../../world/world-manager';
import { isDimensionId, scaleCoordinate } from '../../world/dimension';

const manager = () => WorldManager.getInstance();

api.getDimension = () => manager().dimension;

api.travelTo = (dimension, x, y, z) => {
  if (!isDimensionId(dimension))
    return Promise.reject(new Error(`Unknown dimension: ${dimension}`));
  const player = manager().playerController?.player;
  if (!player) return Promise.reject(new Error('Create a world before changing dimension'));
  const from = manager().dimension;
  return manager().changeDimension(
    dimension,
    x ?? scaleCoordinate(player.pos[0], from, dimension),
    y ?? player.pos[1],
    z ?? scaleCoordinate(player.pos[2], from, dimension),
  );
};

api.waitForTravel = async () => {
  // A travel can only start from a tick, so one settled change means none is pending.
  while (manager().dimensionChange) await manager().dimensionChange!.catch(() => undefined);
};

api.getPortals = () =>
  manager()
    .portalIndices[manager().dimension].all()
    .map((p) => ({ ...p }));

api.getPortalTravel = () => {
  const travel = manager().portalTravel;
  return {
    ticksInside: travel.ticksInside,
    warp: travel.warp,
    travelling: travel.travelling,
    needsExit: travel.needsExit,
    cooldown: travel.cooldown,
    changes: manager().dimensionChanges,
  };
};
