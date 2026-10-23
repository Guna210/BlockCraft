import { describe, expect, it } from 'vitest';
import '../../src/entity/mobs';
import {
  GRAZE_MAX_TICKS,
  GRAZE_MIN_TICKS,
  GRAZE_TICKS,
  TUFTBUCK,
  TUFTBUCK_SHEARED_MODEL,
  TuftbuckC,
  tuftbuckModelId,
  tuftbuckWool,
} from '../../src/entity/mobs/tuftbuck';
import {
  ROOTBOAR,
  ROOT_MAX_TICKS,
  ROOT_MIN_TICKS,
  ROOT_TICKS,
} from '../../src/entity/mobs/rootboar';
import {
  DAPPLEFOWL,
  EGG_MAX_TICKS,
  EGG_MIN_TICKS,
  FLUTTER_FALL_SPEED,
} from '../../src/entity/mobs/dapplefowl';
import { MOSSBACK } from '../../src/entity/mobs/mossback';
import { AnimatorC, HealthC, RenderableC } from '../../src/entity/ecs/components';
import { AiC, DamageScaleC, MobBodyC, PLAYER_TARGET } from '../../src/entity/ai/components';
import { entityAI } from '../../src/entity/ai/runtime';
import type { Goal } from '../../src/entity/ai/goal';
import { ForageGoal } from '../../src/entity/ai/goals/forage';
import { LayEggGoal } from '../../src/entity/ai/goals/lay-egg';
import { WanderGoal } from '../../src/entity/ai/goals/wander';
import { AmphibiousWanderGoal } from '../../src/entity/ai/goals/amphibious-wander';
import {
  SHELL_DAMAGE_SCALE,
  WITHDRAW_TICKS,
  WithdrawGoal,
} from '../../src/entity/ai/goals/withdraw';
import { interactMob } from '../../src/entity/ai/interactions';
import { PlayerCombat, hurtMob } from '../../src/gameplay/combat';
import { getToolDurability } from '../../src/gameplay/tools';
import { BlockCollision } from '../../src/entity/physics';
import { Player } from '../../src/entity/player';
import type { EntityWorld } from '../../src/entity/ecs/world';
import { FLOOR, GROUND, flatWorld, pos, run, scene, type Scene } from './helpers/m13c-mobs';

/** The live goal of a type on a spawned mob (its selector is built on the first AI tick). */
function goal<T extends Goal>(
  ecs: EntityWorld,
  id: number,
  type: abstract new (...args: never[]) => T,
): T {
  const selector = ecs.get(id, AiC)!.selector;
  if (!selector) throw new Error('No selector yet');
  const found = selector.goals.find((entry) => entry.goal instanceof type);
  if (!found) throw new Error(`No ${type.name}`);
  return found.goal as T;
}

/** Items on the ground by id. */
function dropped(s: Scene): Record<string, number> {
  const result: Record<string, number> = {};
  for (const entity of s.items.pool)
    if (entity.active) result[entity.item.id] = (result[entity.item.id] ?? 0) + entity.count;
  return result;
}

function spawnStill(s: Scene, type: string, x = 0.5, z = 0.5): number {
  const id = s.runtime.spawn(type, x, GROUND, z);
  run(s.ecs, 1);
  // Keep it in place: no wandering during the test.
  const selector = s.ecs.get(id, AiC)!.selector!;
  for (const { goal: g } of selector.goals) {
    if (g instanceof AmphibiousWanderGoal) g.idleTicks = 1e9;
    if (g instanceof WanderGoal) (g as unknown as { idle: number }).idle = 1e9;
  }
  return id;
}

describe('M13e Tuftbuck grazing and shearing', () => {
  it('times grazes 600–1200 ticks apart', () => {
    const s = scene(flatWorld({ top: 'grass_block' }));
    for (let n = 0; n < 20; n++) {
      const id = s.runtime.spawn(TUFTBUCK, 0.5 + n, GROUND, 0.5);
      run(s.ecs, 1);
      const wait = goal(s.ecs, id, ForageGoal).ticksUntilNext;
      expect(wait).toBeGreaterThanOrEqual(GRAZE_MIN_TICKS - 1);
      expect(wait).toBeLessThanOrEqual(GRAZE_MAX_TICKS);
    }
  });

  it('shears 1–3 wool, then regrows the fleece by turning grass to dirt', () => {
    const s = scene(flatWorld({ top: 'grass_block' }));
    const id = spawnStill(s, TUFTBUCK);
    const fleece = s.ecs.get(id, RenderableC)!.model;
    expect(fleece).toBe(tuftbuckModelId(tuftbuckWool(s.world.getBiome(0, 0))));
    expect(interactMob(s.ecs, id, 'iron_shears')).toBe('wear');
    const wool = dropped(s).wool!;
    expect(wool).toBeGreaterThanOrEqual(1);
    expect(wool).toBeLessThanOrEqual(3);
    expect(s.ecs.get(id, TuftbuckC)!.sheared).toBe(true);
    expect(s.ecs.get(id, RenderableC)!.model).toBe(TUFTBUCK_SHEARED_MODEL);
    // Nothing more to shear until it grazes.
    expect(interactMob(s.ecs, id, 'iron_shears')).toBeNull();
    expect(dropped(s).wool).toBe(wool);

    const graze = goal(s.ecs, id, ForageGoal);
    graze.ticksUntilNext = 1;
    run(s.ecs, 1);
    expect(entityAI(s.ecs, id).goal).toBe('graze');
    expect(s.ecs.get(id, AnimatorC)!.clips.map((clip) => clip.name)).toEqual(['graze']);
    const under = [Math.floor(pos(s.ecs, id)[0]), FLOOR, Math.floor(pos(s.ecs, id)[2])] as const;
    run(s.ecs, GRAZE_TICKS - 2);
    expect(s.world.getBlock(...under).id).toBe('grass_block');
    run(s.ecs, 1);
    expect(s.world.getBlock(...under).id).toBe('dirt');
    expect(s.ecs.get(id, TuftbuckC)!.sheared).toBe(false);
    expect(s.ecs.get(id, RenderableC)!.model).toBe(fleece);
    expect(graze.ticksUntilNext).toBeGreaterThanOrEqual(GRAZE_MIN_TICKS - 1);
    // Standing on dirt now, the next graze finds nothing to eat and keeps its fleece state.
    expect(interactMob(s.ecs, id, 'iron_shears')).toBe('wear');
    graze.ticksUntilNext = 1;
    run(s.ecs, GRAZE_TICKS + 2);
    expect(s.ecs.get(id, TuftbuckC)!.sheared).toBe(true);
  });

  it('wears the held shears by one point per shearing in survival, not in creative', () => {
    const world = flatWorld({ top: 'grass_block' });
    const s = scene(world);
    for (const mode of ['survival', 'creative'] as const) {
      const player = new Player(new BlockCollision(world), () => true);
      player.setGameMode(mode);
      player.teleport(0.5, GROUND, 0.5, 0, -0.35);
      player.tick();
      player.inventory.slots[0] = { slot: 0, id: 'iron_shears', count: 1 };
      const combat = new PlayerCombat(player, s.ecs, null);
      const id = s.runtime.spawn(TUFTBUCK, 2.5, GROUND, 0.5);
      combat.tick();
      expect(combat.pick()?.id).toBe(id);
      combat.input('use', true);
      combat.tick();
      combat.input('use', false);
      expect(s.ecs.get(id, TuftbuckC)!.sheared).toBe(true);
      expect(player.inventory.slots[0]!.damage ?? 0).toBe(mode === 'survival' ? 1 : 0);
      s.ecs.destroy(id);
    }
    expect(getToolDurability('iron_shears')).toBeGreaterThan(1);
  });
});

describe('M13e Rootboar rooting', () => {
  it('roots 1200–2400 ticks apart on dirt or grass, leaving one tuber', () => {
    for (const top of ['dirt', 'grass_block']) {
      const s = scene(flatWorld({ top }));
      const id = spawnStill(s, ROOTBOAR);
      const root = goal(s.ecs, id, ForageGoal);
      expect(root.name).toBe('root');
      expect(root.ticksUntilNext).toBeGreaterThanOrEqual(ROOT_MIN_TICKS - 1);
      expect(root.ticksUntilNext).toBeLessThanOrEqual(ROOT_MAX_TICKS);
      root.ticksUntilNext = 1;
      run(s.ecs, ROOT_TICKS);
      expect(dropped(s)).toEqual({ tuber: 1 });
      expect(s.world.getBlock(0, FLOOR, 0).id).toBe(top);
      expect(root.ticksUntilNext).toBeGreaterThanOrEqual(ROOT_MIN_TICKS - ROOT_TICKS);
    }
  });

  it('does not root on stone', () => {
    const s = scene(flatWorld());
    const id = spawnStill(s, ROOTBOAR);
    goal(s.ecs, id, ForageGoal).ticksUntilNext = 1;
    run(s.ecs, ROOT_TICKS + 5);
    expect(dropped(s)).toEqual({});
  });
});

describe('M13e Dapplefowl', () => {
  it('lays one egg every 6000–12000 ticks, but not as a baby', () => {
    const s = scene(flatWorld());
    const id = spawnStill(s, DAPPLEFOWL);
    const lay = goal(s.ecs, id, LayEggGoal);
    expect(lay.ticksUntilNext).toBeGreaterThanOrEqual(EGG_MIN_TICKS - 1);
    expect(lay.ticksUntilNext).toBeLessThanOrEqual(EGG_MAX_TICKS);
    lay.ticksUntilNext = 3;
    run(s.ecs, 2);
    expect(dropped(s)).toEqual({});
    run(s.ecs, 1);
    expect(dropped(s)).toEqual({ egg: 1 });
    expect(lay.ticksUntilNext).toBeGreaterThanOrEqual(EGG_MIN_TICKS - 1);
    expect(lay.ticksUntilNext).toBeLessThanOrEqual(EGG_MAX_TICKS);
    run(s.ecs, 50);
    expect(dropped(s)).toEqual({ egg: 1 });

    const baby = s.runtime.spawn(DAPPLEFOWL, 4.5, GROUND, 0.5, { baby: true });
    run(s.ecs, 1);
    goal(s.ecs, baby, LayEggGoal).ticksUntilNext = 1;
    run(s.ecs, 20);
    expect(dropped(s)).toEqual({ egg: 1 });
  });

  it('flutters down at no more than 0.1 blocks per tick and takes no fall damage', () => {
    const s = scene(flatWorld());
    const fowl = s.runtime.spawn(DAPPLEFOWL, 0.5, GROUND + 20, 0.5),
      buck = s.runtime.spawn(TUFTBUCK, 6.5, GROUND + 20, 0.5);
    let fastestFowl = 0,
      fastestBuck = 0,
      flapped = false;
    run(s.ecs, 260, () => {
      fastestFowl = Math.min(fastestFowl, s.ecs.get(fowl, MobBodyC)!.vel[1]);
      fastestBuck = Math.min(fastestBuck, s.ecs.get(buck, MobBodyC)!.vel[1]);
      flapped ||= s.ecs.get(fowl, AnimatorC)!.clips.some((clip) => clip.name === 'flap');
    });
    expect(fastestFowl).toBeCloseTo(-FLUTTER_FALL_SPEED, 6);
    expect(fastestBuck).toBeLessThan(-0.5);
    expect(flapped).toBe(true);
    expect(pos(s.ecs, fowl)[1]).toBeCloseTo(GROUND, 3);
    expect(s.ecs.get(fowl, HealthC)!.current).toBe(4);
    expect(s.ecs.get(fowl, MobBodyC)!.onGround).toBe(true);
  });
});

describe('M13e Mossback', () => {
  it('withdraws for 100 ticks when hurt: no movement, ×0.2 damage, extended by a new hit', () => {
    const s = scene(flatWorld(), [0.5, GROUND, 6.5]);
    const id = spawnStill(s, MOSSBACK);
    const attacker = { ref: PLAYER_TARGET, pos: s.player.pos };
    const health = () => s.ecs.get(id, HealthC)!.current;
    expect(hurtMob(s.ecs, id, 5, attacker)).toBe(true);
    expect(health()).toBe(25);
    const start = [...pos(s.ecs, id)];
    run(s.ecs, 1);
    expect(entityAI(s.ecs, id).goal).toBe('withdraw');
    expect(s.ecs.get(id, DamageScaleC)!.scale).toBe(SHELL_DAMAGE_SCALE);
    expect(s.ecs.get(id, AnimatorC)!.clips.map((clip) => clip.name)).toEqual(['withdraw']);
    const withdraw = goal(s.ecs, id, WithdrawGoal);
    run(s.ecs, 40);
    // Knockback and the AI are both held: it stays where it was hit.
    expect(pos(s.ecs, id)[0]).toBeCloseTo(start[0]!, 6);
    expect(pos(s.ecs, id)[2]).toBeCloseTo(start[2]!, 6);
    expect(hurtMob(s.ecs, id, 5, attacker)).toBe(true);
    expect(health()).toBeCloseTo(24, 6);
    run(s.ecs, 1);
    expect(withdraw.ticksLeft).toBe(WITHDRAW_TICKS - 1);
    run(s.ecs, WITHDRAW_TICKS - 2);
    expect(entityAI(s.ecs, id).goal).toBe('withdraw');
    run(s.ecs, 2);
    expect(entityAI(s.ecs, id).goal).not.toBe('withdraw');
    expect(s.ecs.has(id, DamageScaleC)).toBe(false);
    expect(pos(s.ecs, id)[0]).toBeCloseTo(start[0]!, 6);
    // Out of the shell, hits land in full again.
    expect(hurtMob(s.ecs, id, 5, attacker)).toBe(true);
    expect(health()).toBeCloseTo(19, 6);
  });

  it('wanders between water and land within 12 blocks and swims', () => {
    const world = flatWorld({ radius: 3 });
    // A pool 5 blocks east: three deep, its surface level with the ground.
    world.fill(5, FLOOR - 2, -3, 11, FLOOR, 3, 'water');
    const s = scene(world, [-20.5, GROUND, -20.5]);
    const id = s.runtime.spawn(MOSSBACK, 0.5, GROUND, 0.5);
    run(s.ecs, 1);
    const wander = goal(s.ecs, id, AmphibiousWanderGoal);
    const kinds: boolean[] = [];
    let inWater = false;
    for (let trip = 0; trip < 4; trip++) {
      wander.idleTicks = 0;
      run(s.ecs, 1);
      expect(wander.target).not.toBeNull();
      kinds.push(wander.toWater);
      const [tx, ty, tz] = wander.target!;
      expect(world.getBlock(tx, ty, tz).id).toBe(wander.toWater ? 'water' : 'air');
      expect(
        Math.hypot(tx + 0.5 - pos(s.ecs, id)[0], tz + 0.5 - pos(s.ecs, id)[2]),
      ).toBeLessThanOrEqual(13);
      for (let n = 0; n < 1500 && entityAI(s.ecs, id).goal === 'wander'; n++) {
        run(s.ecs, 1);
        inWater ||= s.ecs.get(id, MobBodyC)!.inFluid;
      }
    }
    expect(kinds).toEqual([true, false, true, false]);
    expect(inWater).toBe(true);
  });
});
