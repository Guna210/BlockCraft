// Slowing of a player by a local effect (a Sporeburst's spore cloud). Kept in a map beside the
// player, not on it, and empty unless something is slowing a player right now.

interface Slow {
  factor: number;
  ticks: number;
}

const slowed = new Map<object, Slow>();

/** Slows the player's walking to `factor` for the next `ticks` ticks (the strongest slow wins). */
export function slowPlayer(player: object, factor: number, ticks: number): void {
  const slow = slowed.get(player);
  if (!slow) slowed.set(player, { factor, ticks });
  else {
    slow.factor = Math.min(slow.factor, factor);
    slow.ticks = Math.max(slow.ticks, ticks);
  }
}

/** The walking speed factor for this tick (1 when not slowed); called once per player tick. */
export function takePlayerSlow(player: object): number {
  if (slowed.size === 0) return 1;
  const slow = slowed.get(player);
  if (!slow) return 1;
  if (--slow.ticks <= 0) slowed.delete(player);
  return slow.factor;
}

/** Ticks of slowing left (0 when not slowed). */
export function playerSlowTicks(player: object): number {
  return slowed.get(player)?.ticks ?? 0;
}
