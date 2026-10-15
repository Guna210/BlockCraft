import { api } from './core';
import { WorldManager } from '../../world/world-manager';
function controller() {
  const c = WorldManager.getInstance().playerController;
  if (!c?.player || !c.itemEntities) throw new Error('Create a world before querying entities');
  return c;
}
api.getEntities = (filter) => {
  if (filter?.radius !== undefined && (!Number.isFinite(filter.radius) || filter.radius < 0))
    throw new Error('Entity radius must be finite and nonnegative');
  const c = controller();
  return c.itemEntities!.snapshot(c.player!, filter);
};
api.getDropStats = () => {
  const c = controller(),
    renderer = WorldManager.getInstance().dropRenderer;
  return {
    items: c.itemEntities!.pool.filter((e) => e.active).length,
    particles: c.particles!.pool.filter((p) => p.active).length,
    itemDraws: renderer?.itemDraws ?? 0,
    particleDraws: renderer?.particleDraws ?? 0,
    triangles: renderer?.triangles ?? 0,
  };
};
