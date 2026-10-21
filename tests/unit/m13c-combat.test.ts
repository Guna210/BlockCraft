import { describe, expect, it } from 'vitest';
import {
  CRIT_MULTIPLIER,
  CREATIVE_REACH,
  INVULNERABLE_TICKS,
  KNOCKBACK_HORIZONTAL,
  KNOCKBACK_UP,
  PlayerCombat,
  SHIELD_SLOT,
  SURVIVAL_REACH,
  armorReduced,
  attackPeriod,
  cooldownProgress,
  hurtMob,
  hurtPlayer,
  isBlocking,
  isCritical,
  knockBack,
  scaledDamage,
  shieldFaces,
} from '../../src/gameplay/combat';
import { blast, blastDamage, blastRadius } from '../../src/gameplay/blast';
import { getAttackDamage, getTotalArmorDefense } from '../../src/gameplay/tools';
import { BlockCollision } from '../../src/entity/physics';
import { Player } from '../../src/entity/player';
import { BlockInteraction } from '../../src/gameplay/block-interaction';
import { HealthC } from '../../src/entity/ecs/components';
import { CombatC, LoveC, MobBodyC, PLAYER_TARGET, TargetC } from '../../src/entity/ai/components';
import { LOVE_TICKS } from '../../src/entity/ai/goals/breed';
import { hudSnapshot } from '../../src/ui/hud';
import type { World } from '../../src/world/world';
import { GROUND, flatWorld, makeMob, pos, run, scene } from './helpers/m13c-mobs';

function give(player: Player, slot: number, id: string, count = 1): void {
  player.inventory.slots[slot] = { slot, id, count };
}

/** A player standing on the floor at the origin, facing +x. */
function fighter(world: World, mode: 'survival' | 'creative' = 'survival'): Player {
  const player = new Player(new BlockCollision(world), () => true);
  player.setGameMode(mode);
  player.teleport(0.5, GROUND, 0.5, 0, 0);
  player.tick();
  return player;
}

function health(ecs: Parameters<typeof makeMob>[0], id: number): number {
  return ecs.get(id, HealthC)!.current;
}

describe('M13c combat math', () => {
  it('uses 12, 20 and 5 tick attack periods and the base × (0.2 + 0.8c²) curve', () => {
    expect(attackPeriod('iron_sword')).toBe(12);
    expect(attackPeriod('wooden_sword')).toBe(12);
    expect(attackPeriod('stone_axe')).toBe(20);
    expect(attackPeriod('iron_pickaxe')).toBe(5);
    expect(attackPeriod('stone')).toBe(5);
    expect(attackPeriod(null)).toBe(5);
    expect(cooldownProgress(0, 12)).toBe(0);
    expect(cooldownProgress(6, 12)).toBe(0.5);
    expect(cooldownProgress(40, 12)).toBe(1);
    expect(scaledDamage(6, 0)).toBeCloseTo(1.2);
    expect(scaledDamage(6, 0.5)).toBeCloseTo(2.4);
    expect(scaledDamage(6, 1)).toBeCloseTo(6);
    // Monotonic between the ends.
    for (let c = 0; c < 1; c += 0.1)
      expect(scaledDamage(5, c + 0.1)).toBeGreaterThan(scaledDamage(5, c));
  });

  it('crits only when falling, airborne, out of fluid and with the meter above 0.9', () => {
    const falling = { velY: -0.3, onGround: false, inFluid: false };
    expect(isCritical(falling, 1)).toBe(true);
    expect(isCritical(falling, 0.91)).toBe(true);
    expect(isCritical(falling, 0.9)).toBe(false);
    expect(isCritical({ ...falling, velY: 0 }, 1)).toBe(false);
    expect(isCritical({ ...falling, velY: 0.2 }, 1)).toBe(false);
    expect(isCritical({ ...falling, onGround: true }, 1)).toBe(false);
    expect(isCritical({ ...falling, inFluid: true }, 1)).toBe(false);
  });

  it('reduces damage by min(20, armor)/25 and derives armor points from the item data', () => {
    expect(armorReduced(10, 0)).toBe(10);
    expect(armorReduced(10, 15)).toBeCloseTo(4);
    expect(armorReduced(10, 20)).toBeCloseTo(2);
    expect(armorReduced(10, 30)).toBeCloseTo(2);
    const iron = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'];
    expect(getTotalArmorDefense(iron)).toBe(15);
    expect(getTotalArmorDefense(['copper_chestplate', null, undefined])).toBe(4);
  });

  it('accepts a shield only for sources in the front half-space', () => {
    const at: [number, number, number] = [0, 64, 0];
    expect(shieldFaces(0, at, [3, 64, 0])).toBe(true);
    expect(shieldFaces(0, at, [3, 64, 2.9])).toBe(true);
    expect(shieldFaces(0, at, [-3, 64, 0])).toBe(false);
    expect(shieldFaces(0, at, [0, 64, 3])).toBe(false); // exactly beside: dot 0
    expect(shieldFaces(Math.PI / 2, at, [0, 64, 3])).toBe(true);
    expect(shieldFaces(Math.PI / 2, at, [0, 64, -3])).toBe(false);
  });

  it('knocks back 0.4 horizontally and 0.36 up, away from the attacker', () => {
    const { ecs } = scene(flatWorld());
    const id = makeMob(ecs, [2.5, GROUND, 0.5]);
    knockBack(ecs, id, 0.5, 0.5);
    expect(ecs.get(id, MobBodyC)!.vel).toEqual([KNOCKBACK_HORIZONTAL, KNOCKBACK_UP, 0]);
    knockBack(ecs, id, 5.5, 3.5);
    const vel = ecs.get(id, MobBodyC)!.vel;
    expect(Math.hypot(vel[0], vel[2])).toBeCloseTo(0.4);
    expect(vel[0]).toBeLessThan(0);
    expect(vel[2]).toBeLessThan(0);
    expect(vel[0] / vel[2]).toBeCloseTo(1);
    expect(ecs.get(id, MobBodyC)!.onGround).toBe(false);
    // The movement system carries the mob off and lands it.
    const start = pos(ecs, id)[0];
    knockBack(ecs, id, 0.5, 2.5 - 2);
    run(ecs, 20);
    expect(pos(ecs, id)[0]).toBeGreaterThan(start + 0.4);
    expect(pos(ecs, id)[1]).toBeCloseTo(GROUND, 3);
  });

  it('gives 10 ticks of invulnerability in which only a bigger hit lands, for the difference', () => {
    const { ecs } = scene(flatWorld());
    const id = makeMob(ecs, [2.5, GROUND, 0.5]);
    const from = { ref: PLAYER_TARGET, pos: [0.5, GROUND, 0.5] as [number, number, number] };
    expect(hurtMob(ecs, id, 4, from)).toBe(true);
    expect(health(ecs, id)).toBe(16);
    expect(ecs.get(id, CombatC)!.invulnerableTicks).toBe(INVULNERABLE_TICKS);
    expect(ecs.get(id, TargetC)!.attacker).toBe(PLAYER_TARGET);
    ecs.tick();
    expect(hurtMob(ecs, id, 3, from)).toBe(false);
    expect(hurtMob(ecs, id, 4, from)).toBe(false);
    expect(health(ecs, id)).toBe(16);
    ecs.get(id, MobBodyC)!.vel.fill(0);
    expect(hurtMob(ecs, id, 6, from)).toBe(true);
    expect(health(ecs, id)).toBe(14);
    // The top-up hit adds no knockback and does not restart the frames.
    expect(ecs.get(id, MobBodyC)!.vel).toEqual([0, 0, 0]);
    expect(ecs.get(id, CombatC)!.invulnerableTicks).toBe(INVULNERABLE_TICKS - 1);
    run(ecs, INVULNERABLE_TICKS - 2);
    expect(hurtMob(ecs, id, 1, from)).toBe(false);
    ecs.tick();
    expect(ecs.get(id, CombatC)!.invulnerableTicks).toBe(0);
    expect(hurtMob(ecs, id, 1, from)).toBe(true);
    expect(health(ecs, id)).toBe(13);
  });
});

describe('M13c player melee', () => {
  it('recharges the meter after each swing and scales damage by it', () => {
    const world = flatWorld();
    const { ecs } = scene(world);
    const player = fighter(world);
    give(player, 0, 'iron_sword');
    const combat = new PlayerCombat(player, ecs, null);
    const id = makeMob(ecs, [2.5, GROUND, 0.5], { health: 100 });
    combat.tick();
    // Switching items empties the meter.
    expect(combat.cooldown).toBeCloseTo(1 / 12);
    for (let n = 0; n < 11; n++) combat.tick();
    expect(combat.cooldown).toBe(1);
    expect(combat.pick()?.id).toBe(id);
    combat.input('attack', true);
    combat.tick();
    const base = getAttackDamage('iron_sword');
    expect(combat.lastAttack).toMatchObject({ target: id, cooldown: 1, critical: false });
    expect(combat.lastAttack!.damage).toBeCloseTo(base);
    expect(health(ecs, id)).toBeCloseTo(100 - base);
    expect(combat.cooldown).toBeCloseTo(0);
    combat.input('attack', false);
    for (let n = 0; n < 5; n++) combat.tick();
    expect(combat.cooldown).toBeCloseTo(5 / 12);
    // Put the knocked-back mob in front again once its frames are over.
    run(ecs, INVULNERABLE_TICKS);
    pos(ecs, id).splice(0, 3, 2.5, GROUND, 0.5);
    // The swing's own tick adds the sixth recharge tick: c = 0.5.
    combat.input('attack', true);
    combat.tick();
    expect(combat.lastAttack!.cooldown).toBeCloseTo(0.5);
    expect(combat.lastAttack!.damage).toBeCloseTo(scaledDamage(base, 0.5));
    // A swing at nothing still empties the meter.
    combat.input('attack', false);
    for (let n = 0; n < 12; n++) combat.tick();
    player.yaw = Math.PI;
    combat.input('attack', true);
    combat.tick();
    expect(combat.cooldown).toBeCloseTo(0);
    expect(hudSnapshot(player, false, 0.5).attackCooldown).toBeCloseTo(0.5);
    expect(hudSnapshot(player, false, 0.55).attackCooldown).toBeCloseTo(7 / 14);
    expect(hudSnapshot(player, false).attackCooldown).toBe(1);
  });

  it('applies Keen through live PlayerCombat attacks while preserving unaffixed damage', () => {
    const attackWithSword = (keen: boolean) => {
      const world = flatWorld();
      const { ecs } = scene(world);
      const player = fighter(world);
      give(player, 0, 'iron_sword');
      if (keen) player.inventory.slots[0]!.affix = 'Keen';
      const combat = new PlayerCombat(player, ecs, null);
      const id = makeMob(ecs, [2.5, GROUND, 0.5], { health: 100 });
      for (let n = 0; n < 12; n++) combat.tick();
      combat.input('attack', true);
      combat.tick();
      return { damage: combat.lastAttack!.damage, remainingHealth: health(ecs, id) };
    };

    const plain = attackWithSword(false);
    const keen = attackWithSword(true);
    const baseDamage = getAttackDamage('iron_sword');
    expect(plain.damage).toBe(baseDamage);
    expect(100 - plain.remainingHealth).toBe(baseDamage);
    expect(keen.damage - plain.damage).toBe(1);
    expect(100 - keen.remainingHealth).toBe(keen.damage);
  });

  it('crits ×1.5 while falling with a full meter', () => {
    const world = flatWorld();
    const { ecs } = scene(world);
    const player = fighter(world);
    give(player, 0, 'stone_sword');
    const combat = new PlayerCombat(player, ecs, null);
    const id = makeMob(ecs, [2.5, GROUND, 0.5], { health: 100 });
    for (let n = 0; n < 12; n++) combat.tick();
    player.onGround = false;
    player.vel[1] = -4;
    const result = combat.attack(id);
    expect(result.critical).toBe(true);
    expect(result.damage).toBeCloseTo(getAttackDamage('stone_sword') * CRIT_MULTIPLIER);
    expect(result.swept).toEqual([]); // no sweep in the air
  });

  it('sweeps others within 1 block of the target and 3 of the player for 1, only on the ground at full meter', () => {
    const world = flatWorld();
    const { ecs } = scene(world);
    const player = fighter(world);
    give(player, 0, 'iron_sword');
    const combat = new PlayerCombat(player, ecs, null);
    const target = makeMob(ecs, [2.0, GROUND, 0.5], { health: 100 }),
      beside = makeMob(ecs, [2.0, GROUND, 1.8], { health: 100 }),
      apart = makeMob(ecs, [2.0, GROUND, 3.5], { health: 100 }),
      beyond = makeMob(ecs, [3.6, GROUND, 0.5], { health: 100 });
    // 'beyond' is 1 block from the target but 3.1 from the player.
    for (let n = 0; n < 12; n++) combat.tick();
    expect(player.onGround).toBe(true);
    const result = combat.attack(target);
    expect(result.swept).toEqual([beside]);
    expect(health(ecs, beside)).toBe(99);
    expect(health(ecs, apart)).toBe(100);
    expect(health(ecs, beyond)).toBe(100);
    expect(ecs.get(beside, MobBodyC)!.vel[1]).toBe(KNOCKBACK_UP);
    run(ecs, INVULNERABLE_TICKS);
    // Not at full meter: no sweep.
    for (let n = 0; n < 11; n++) combat.tick();
    combat.input('attack', true);
    combat.tick();
    combat.input('attack', false);
    expect(combat.lastAttack!.swept).toEqual([]);
    // An axe never sweeps.
    run(ecs, INVULNERABLE_TICKS);
    give(player, 0, 'iron_axe');
    for (let n = 0; n < 21; n++) combat.tick();
    expect(combat.attack(target).swept).toEqual([]);
  });

  it('does not sweep while sprinting', () => {
    const world = flatWorld();
    const { ecs } = scene(world);
    const player = fighter(world);
    give(player, 0, 'iron_sword');
    const combat = new PlayerCombat(player, ecs, null);
    const target = makeMob(ecs, [2.5, GROUND, 0.5], { health: 100 }),
      beside = makeMob(ecs, [2.5, GROUND, 1.5], { health: 100 });
    player.input('forward', true);
    player.input('sprint', true);
    player.tick();
    expect(player.isSprinting).toBe(true);
    expect(player.onGround).toBe(true);
    for (let n = 0; n < 12; n++) combat.tick();
    expect(combat.attack(target).swept).toEqual([]);
    expect(health(ecs, beside)).toBe(100);
  });

  it('reaches 3 blocks in survival and 5 in creative, and never through a block', () => {
    const world = flatWorld();
    const { ecs } = scene(world);
    const id = makeMob(ecs, [4.5, GROUND, 0.5]);
    const survivor = fighter(world);
    expect(new PlayerCombat(survivor, ecs, null).reach).toBe(SURVIVAL_REACH);
    expect(new PlayerCombat(survivor, ecs, null).pick()).toBeNull();
    const creative = fighter(world, 'creative');
    const combat = new PlayerCombat(creative, ecs, new BlockInteraction(creative, () => {}));
    expect(combat.reach).toBe(CREATIVE_REACH);
    expect(combat.pick()?.id).toBe(id);
    world.setBlock(2, GROUND + 1, 0, 'stone');
    expect(combat.pick()).toBeNull();
    // The attack press then goes to the block, and the mob is untouched.
    combat.input('attack', true);
    combat.tick();
    expect(health(ecs, id)).toBe(20);
    expect(combat.lastAttack).toBeNull();
  });

  it('feeds a mob its food with use, consuming one item in survival only', () => {
    const world = flatWorld();
    const { ecs } = scene(world);
    const id = makeMob(ecs, [2.5, GROUND, 0.5], { foods: ['wheat'] });
    const player = fighter(world);
    give(player, 0, 'wheat', 3);
    const combat = new PlayerCombat(player, ecs, null);
    combat.input('use', true);
    combat.tick();
    expect(ecs.get(id, LoveC)!.loveTicks).toBe(LOVE_TICKS);
    expect(player.inventory.slots[0]!.count).toBe(2);
    combat.input('use', false);
    // Already in love: nothing taken.
    combat.input('use', true);
    combat.tick();
    expect(player.inventory.slots[0]!.count).toBe(2);
    const other = makeMob(ecs, [2.5, GROUND, 0.5], { foods: ['wheat'] });
    ecs.destroy(id);
    const builder = fighter(world, 'creative');
    give(builder, 0, 'wheat', 3);
    const creative = new PlayerCombat(builder, ecs, null);
    creative.input('use', true);
    creative.tick();
    expect(ecs.get(other, LoveC)!.loveTicks).toBe(LOVE_TICKS);
    expect(builder.inventory.slots[0]!.count).toBe(3);
  });
});

describe('M13c damage to the player', () => {
  it('blocks frontal hits with a raised shield in either hand and wears it', () => {
    const world = flatWorld();
    const player = fighter(world);
    const front: [number, number, number] = [3.5, GROUND, 0.5],
      behind: [number, number, number] = [-2.5, GROUND, 0.5];
    give(player, SHIELD_SLOT, 'shield');
    expect(isBlocking(player)).toBe(false);
    expect(hurtPlayer(player, 4, 'mob:test', front)).toBe(true);
    expect(player.health).toBe(16);
    player.input('use', true);
    expect(isBlocking(player)).toBe(true);
    expect(hurtPlayer(player, 4, 'mob:test', front)).toBe(false);
    expect(player.health).toBe(16);
    expect(player.inventory.slots[SHIELD_SLOT]!.damage).toBe(1);
    expect(hurtPlayer(player, 4, 'mob:test', behind)).toBe(true);
    expect(player.health).toBe(12);
    // Main hand works too, and a worn-out shield breaks.
    player.inventory.slots[SHIELD_SLOT] = null;
    give(player, 0, 'shield');
    player.inventory.slots[0]!.damage = 335;
    expect(hurtPlayer(player, 4, 'mob:test', front)).toBe(false);
    expect(player.inventory.slots[0]).toBeNull();
    expect(hurtPlayer(player, 4, 'mob:test', front)).toBe(true);
    expect(player.health).toBe(8);
  });

  it('applies armor to mob damage under the mob source, and spares creative players', () => {
    const world = flatWorld();
    const player = fighter(world);
    const sources: string[] = [];
    player.survival.onDamage = (event) => sources.push(event.source);
    ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'].forEach((id, i) =>
      give(player, 36 + i, id),
    );
    expect(hurtPlayer(player, 5, 'mob:m13c_test_beast', [2, GROUND, 0])).toBe(true);
    expect(player.health).toBeCloseTo(18);
    expect(sources).toEqual(['mob:m13c_test_beast']);
    player.setGameMode('creative');
    expect(hurtPlayer(player, 5, 'mob:m13c_test_beast', [2, GROUND, 0])).toBe(false);
    expect(player.health).toBeCloseTo(18);
  });

  it('routes a mob melee hit through the runtime player hook', () => {
    const world = flatWorld();
    const { ecs, runtime, player } = scene(world, [1.5, GROUND, 0.5]);
    const id = makeMob(ecs, [0.5, GROUND, 0.5]);
    expect(runtime.hurtTarget(PLAYER_TARGET, 3, id)).toBe(true);
    expect(player.hits).toEqual([
      { amount: 3, source: 'mob:m13c_test_beast', from: [0.5, GROUND, 0.5], time: 0 },
    ]);
    const other = makeMob(ecs, [2.5, GROUND, 0.5]);
    expect(runtime.hurtTarget(other, 3, id)).toBe(true);
    expect(health(ecs, other)).toBe(17);
    expect(ecs.get(other, TargetC)!.attacker).toBe(id);
  });
});

describe('M13c blast', () => {
  it('falls off with distance and spares the bursting mob', () => {
    expect(blastRadius(3)).toBe(6);
    expect(blastDamage(3, 0)).toBeCloseTo(12);
    expect(blastDamage(3, 3)).toBeCloseTo((0.25 + 0.5) * 6);
    expect(blastDamage(3, 6)).toBe(0);
    expect(blastDamage(3, 9)).toBe(0);
    const world = flatWorld();
    const { ecs, runtime, player } = scene(world, [3.5, GROUND, 0.5]);
    const source = makeMob(ecs, [0.5, GROUND, 0.5], { health: 100 }),
      near = makeMob(ecs, [1.5, GROUND, 0.5], { health: 100 }),
      mid = makeMob(ecs, [0.5, GROUND, 4.5], { health: 100 }),
      far = makeMob(ecs, [0.5, GROUND, 8.5], { health: 100 });
    expect(blast(runtime, [0.5, GROUND + 0.9, 0.5], 3, source)).toBe(3);
    expect(health(ecs, source)).toBe(100);
    expect(100 - health(ecs, near)).toBeCloseTo(blastDamage(3, 1));
    expect(100 - health(ecs, mid)).toBeCloseTo(blastDamage(3, 4));
    expect(health(ecs, far)).toBe(100);
    expect(player.hits).toHaveLength(1);
    expect(player.hits[0]!.amount).toBeCloseTo(blastDamage(3, 3));
    expect(player.hits[0]!.source).toBe('blast');
    // Pushed away from the centre.
    expect(ecs.get(near, MobBodyC)!.vel[0]).toBeGreaterThan(0);
    expect(ecs.get(mid, MobBodyC)!.vel[2]).toBeGreaterThan(0);
  });
});
