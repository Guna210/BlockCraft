import { it, expect } from 'vitest';
import { World } from '../../src/world/world';
import { PortalIndex, buildPortal, portalState } from '../../src/world/portals';
import { RemotePortals } from '../../src/game/net/portals';
it('indexes replicated portal cells for rendering without running local portal mechanics', () => {
  const world = new World(false),
    index = new PortalIndex();
  buildPortal(world, new PortalIndex(), { x: 15, y: 70, z: 4, axis: 'x' });
  const remote = new RemotePortals(world, index);
  remote.column(0, 0);
  expect(index.all()).toEqual([{ x: 15, y: 70, z: 4, axis: 'x' }]);
  world.setBlockStateId(15, 70, 4, 0);
  remote.edit(15, 70, 4);
  expect(index.size).toBe(0);
  expect(world.getBlockStateId(16, 70, 4)).toBe(portalState('x'));
  world.setBlockStateId(15, 70, 4, portalState('x'));
  remote.edit(15, 70, 4);
  expect(index.size).toBe(1);
  remote.unload(1, 0);
  expect(index.size).toBe(0);
});
