import { WorldManager } from '../../world/world-manager';

/** Kills the player (entity id 0); `kill` in ./entities routes id 0 here. */
export function killPlayer(): void {
  const player = WorldManager.getInstance().playerController?.player;
  if (!player) throw new Error('Create a world before killing the player');
  player.survival.damage(player.health, 'killed');
}
