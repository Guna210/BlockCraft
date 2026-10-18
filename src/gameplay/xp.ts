/**
 * BlockCraft original XP progression curve and experience points management.
 *
 * Curve breakdown:
 * - Early tiers (Levels 0–14): linear ramp starting at 10 XP per level, increasing by 2 per level:
 *     pointsForLevel(L) = 10 + L * 2 (10, 12, 14, ..., 38)
 * - Mid tiers (Levels 15–29): accelerated ramp starting at 40 XP, increasing by 5 per level:
 *     pointsForLevel(L) = 40 + (L - 15) * 5 (40, 45, ..., 110)
 * - Late tiers (Levels 30+): mastery ramp starting at 115 XP, increasing by 10 per level:
 *     pointsForLevel(L) = 115 + (L - 30) * 10
 */
export function pointsForLevel(level: number): number {
  if (level < 15) return 10 + level * 2;
  if (level < 30) return 40 + (level - 15) * 5;
  return 115 + (level - 30) * 10;
}

export interface PlayerXpTarget {
  xpLevel: number;
  xpProgress: number;
}

/**
 * Adds experience points to a player, advancing levels and setting progress towards the next level.
 * Fractions of points (e.g. from smelting 0.7 XP) accumulate toward xpProgress.
 */
export function addXp(player: PlayerXpTarget, points: number): void {
  if (!Number.isFinite(points) || points <= 0) return;

  let currentPoints = player.xpProgress * pointsForLevel(player.xpLevel) + points;

  while (true) {
    const required = pointsForLevel(player.xpLevel);
    if (currentPoints >= required) {
      currentPoints -= required;
      player.xpLevel++;
    } else {
      break;
    }
  }

  const req = pointsForLevel(player.xpLevel);
  player.xpProgress = Math.max(0, Math.min(1, currentPoints / req));
}
