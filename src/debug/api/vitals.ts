import { WorldManager } from '../../world/world-manager';

export interface PlayerVitals {
  health?: number;
  hunger?: number;
  air?: number;
}

/** Set already modeled player vitals for diagnostics; this does not simulate survival effects. */
export function setVitals(vitals: PlayerVitals): void {
  const values = Object.entries(vitals);
  if (!values.length) throw new Error('At least one player vital is required');
  for (const [name, value] of values) {
    const max = name === 'air' ? 300 : 20;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max)
      throw new Error(`Invalid ${name} value`);
  }
  const player = WorldManager.getInstance().playerController?.player;
  if (!player) throw new Error('Create a world before setting player vitals');
  if (vitals.health !== undefined) player.health = vitals.health;
  if (vitals.hunger !== undefined) player.hunger = vitals.hunger;
  if (vitals.air !== undefined) player.air = vitals.air;
}
