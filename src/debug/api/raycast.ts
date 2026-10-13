import { api } from './core';
import { WorldManager } from '../../world/world-manager';
import { BlockRegistry } from '../../world/blocks/registry';
api.raycast = () => {
  const i = WorldManager.getInstance().playerController?.interaction;
  if (!i) throw new Error('Create a world before raycasting');
  i.updateTarget();
  const t = i.target;
  return t.hit
    ? { hit: true, block: [t.x, t.y, t.z], face: t.face, distance: t.distance }
    : { hit: false };
};
api.setHeldBlock = (id, state) => {
  const p = WorldManager.getInstance().playerController?.player;
  if (!p) throw new Error('Create a world before setting held block');
  const value = BlockRegistry.getInstance().getStateId(id, state);
  if (value === undefined) throw new Error(`Unknown block state: ${id}`);
  p.heldBlock = value;
};
api.getInteraction = () => {
  const i = WorldManager.getInstance().playerController?.interaction;
  if (!i) throw new Error('Create a world before querying interaction');
  const held = i.player.heldBlock;
  const wm = WorldManager.getInstance();
  return {
    editFrame: wm.interactionEditFrame,
    meshFrame: wm.interactionMeshFrame,
    meshRevision: wm.interactionMeshRevision,
    progress: i.progress,
    stage: i.progress > 0 ? Math.min(9, Math.floor(i.progress * 10)) : -1,
    heldBlock: held === null ? null : BlockRegistry.getInstance().getResolvedState(held)!.blockId,
  };
};
