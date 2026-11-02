import { api } from './core';
import { WorldManager } from '../../world/world-manager';
import { gravityFactor, updraftField } from '../../world/updrafts';
import { sound } from '../../audio/service';
import { EntityKindC } from '../../entity/ecs/components';
import { GlowwingC, flightPathfinder } from '../../entity/mobs/glowwing';
import { MagmawC } from '../../entity/mobs/magmaw';

const manager = () => WorldManager.getInstance();

api.getUpdraft = (x, y, z) => {
  const world = manager().world;
  const gravity = world ? gravityFactor(world, x, y, z) : 1;
  return { inside: gravity < 1, gravity };
};

api.findUpdraft = (x, z, maxDistance = 256) => {
  const world = manager().world;
  const field = world ? updraftField(world) : null;
  return field ? field.nearest(x, z, maxDistance) : null;
};

api.getNightVision = () => manager().playerController?.player?.survival.nightVisionTicks ?? 0;

api.getHollowdeepCreature = (id) => {
  const ecs = manager().playerController?.ecs;
  if (!ecs || !ecs.exists(id)) throw new Error(`No entity with id ${id} exists`);
  const type = ecs.get(id, EntityKindC)?.type ?? 'unknown';
  const glowwing = ecs.get(id, GlowwingC);
  if (glowwing)
    return {
      type,
      phase: glowwing.phase,
      hits: glowwing.hits,
      plans: glowwing.path.plans,
      pathStatus: glowwing.path.status,
    };
  const magmaw = ecs.get(id, MagmawC);
  if (magmaw) return { type, phase: magmaw.mode, hits: magmaw.hits, lunges: magmaw.lunges };
  return null;
};

api.getFlightStats = () => {
  const mobs = manager().playerController?.mobs;
  if (!mobs) return { lastExpansions: 0, searches: 0, pending: 0 };
  const pathfinder = flightPathfinder(mobs);
  return {
    lastExpansions: pathfinder.lastExpansions,
    searches: pathfinder.searches,
    pending: pathfinder.pending,
  };
};

api.getMusicContext = () => sound.lastMusicContext;

api.getUpdraftGlowZones = () => manager().updraftGlow?.lastZones ?? 0;
