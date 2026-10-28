import { api } from './core';
import { WorldManager } from '../../world/world-manager';
import { explode } from '../../gameplay/explosions';
import { hurtPlayer } from '../../gameplay/combat';
function controller() {
  const c = WorldManager.getInstance().playerController;
  if (!c?.charges || !c.player || !c.ecs) throw new Error('Create a world before explosions');
  return c;
}
api.primeBlastCharge = (x, y, z) => {
  if (![x, y, z].every(Number.isSafeInteger))
    throw new Error('Charge coordinates must be integers');
  return controller().charges!.prime(x, y, z);
};
api.explode = (x, y, z, power) => {
  const c = controller(),
    player = c.player!;
  return explode(
    {
      world: c.charges!.world,
      ecs: c.ecs!,
      player: () => ({
        pos: player.pos,
        height: player.height,
        hurt: (amount, source, from) => hurtPlayer(player, amount, source, from),
        impulse: (v) => {
          for (let a = 0; a < 3; a++) player.vel[a]! += v[a]! * 20;
        },
      }),
    },
    [x, y, z],
    power,
  );
};
api.getExplosionStats = () => {
  const charges = controller().charges!;
  return {
    detonations: charges.detonations,
    pending: charges.pendingWork,
    maxExplosionMs: charges.maxExplosionMs,
    tick: charges.ecs.time,
    lastDetonationTick: charges.lastDetonationTick,
  };
};
