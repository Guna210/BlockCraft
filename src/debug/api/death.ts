import { api } from './core';
import { WorldManager } from '../../world/world-manager';

api.kill = (id: number) => {
  if (!Number.isSafeInteger(id) || id < 0)
    throw new Error('Entity id must be a non-negative integer');
  const player = WorldManager.getInstance().playerController?.player;
  if (id === 0) {
    if (!player) throw new Error('Create a world before killing the player');
    player.survival.damage(player.health, 'killed');
    return;
  }
  throw new Error(`No entity with id ${id} exists`);
};
