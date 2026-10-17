import { WorldManager } from '../../world/world-manager';

/** Set the player's XP display state for diagnostics and deterministic visual checks. */
export function setXp(level: number, progress: number): void {
  if (!Number.isInteger(level) || level < 0)
    throw new Error('XP level must be a non-negative integer');
  if (!Number.isFinite(progress) || progress < 0 || progress > 1)
    throw new Error('XP progress must be between 0 and 1');
  const player = WorldManager.getInstance().playerController?.player;
  if (!player) throw new Error('Create a world before setting XP');
  player.xpLevel = level;
  player.xpProgress = progress;
}
