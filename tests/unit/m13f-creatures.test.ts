import { afterEach, describe, expect, it } from 'vitest';
import '../../src/entity/mobs';
import { PRIORITY, creatureContext, type CreatureDefinition } from '../../src/entity/mobs/creature';
import { HOLLOW, HOLLOW_DEFINITION, HOLLOW_PALETTE } from '../../src/entity/mobs/hollow';
import {
  THORN_KIND,
  THORN_MODEL_ID,
  THORN_PALETTE,
  THORNLING,
  THORNLING_DEFINITION,
  THORNLING_PALETTE,
  fireThorn,
} from '../../src/entity/mobs/thornling';
import {
  SKITTERER,
  SKITTERER_DEFINITION,
  SKITTERER_PALETTE,
} from '../../src/entity/mobs/skitterer';
import {
  SPOREBURST,
  SPOREBURST_DEFINITION,
  SPOREBURST_FLASH,
  SPOREBURST_FLASH_PALETTE,
  SPOREBURST_PALETTE,
  SWELL_GROWTH,
  SWELL_TICKS,
} from '../../src/entity/mobs/sporeburst';
import {
  SPORE_CLOUD,
  SPORE_CLOUD_PALETTE,
  SPORE_CLOUD_TICKS,
  SPORE_SLOW_FACTOR,
  SPORE_SLOW_TICKS,
  spawnSporeCloud,
} from '../../src/entity/mobs/spore-cloud';
import { playerSlowTicks, slowPlayer, takePlayerSlow } from '../../src/entity/player-slow';
import {
  MAX_MODEL_PARTS,
  getEntityModel,
  getEntitySkin,
  validateModel,
} from '../../src/entity/ecs/model';
import { hasEntityType } from '../../src/entity/ecs/entity-types';
import {
  BodyC,
  EntityKindC,
  HealthC,
  RenderableC,
  TransformC,
} from '../../src/entity/ecs/components';
import { createEntityWorld, killEntity } from '../../src/entity/ecs/systems';
import { ItemEntityManager } from '../../src/entity/item-entity';
import { AiC, MobBodyC, MobC, PLAYER_TARGET } from '../../src/entity/ai/components';
import { MobRuntime, entityAI, type MobHandle } from '../../src/entity/ai/runtime';
import { ProjectileC, ProjectileRuntime, ProjectileVelocityC } from '../../src/entity/projectiles';
import {
  PLAYER_INVULNERABLE_TICKS,
  PlayerCombat,
  SHIELD_SLOT,
  hurtMob,
  hurtPlayer,
  playerInvulnerableTicks,
} from '../../src/gameplay/combat';
import { BlockCollision } from '../../src/entity/physics';
import { Player } from '../../src/entity/player';
import { resetWorldTime, setWorldTime } from '../../src/world/time';
import { GROUND, StubPlayer, flatWorld, pos, run, scene, type Scene } from './helpers/m13c-mobs';

afterEach(() => resetWorldTime());

const DEFINITIONS: Record<string, CreatureDefinition> = {
  [HOLLOW]: HOLLOW_DEFINITION,
  [THORNLING]: THORNLING_DEFINITION,
  [SKITTERER]: SKITTERER_DEFINITION,
  [SPOREBURST]: SPOREBURST_DEFINITION,
};

/** Model id → every colour its skin may use. */
const PALETTES: Record<string, string[]> = {
  [HOLLOW]: HOLLOW_PALETTE,
  [THORNLING]: THORNLING_PALETTE,
  [THORN_MODEL_ID]: THORN_PALETTE,
  [SKITTERER]: SKITTERER_PALETTE,
  [SPOREBURST]: SPOREBURST_PALETTE,
  [SPOREBURST_FLASH]: SPOREBURST_FLASH_PALETTE,
  [SPORE_CLOUD]: SPORE_CLOUD_PALETTE,
};

function goalList(s: Scene, id: number): Array<[number, string]> {
  run(s.ecs, 1);
  return s.ecs.get(id, AiC)!.selector!.goals.map(({ priority, goal }) => [priority, goal.name]);
}

function dropped(s: Scene): Record<string, number> {
  const result: Record<string, number> = {};
  for (const entity of s.items.pool)
    if (entity.active) result[entity.item.id] = (result[entity.item.id] ?? 0) + entity.count;
  return result;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
}

/** A stand-in player that also records spore-cloud slowing. */
class SlowablePlayer extends StubPlayer {
  readonly slows: Array<[number, number]> = [];
  slow(factor: number, ticks: number): void {
    this.slows.push([factor, ticks]);
  }
}

describe('M13f hostile creature registration', () => {
  it('registers the four hostiles with Appendix B health, all under one block wide', () => {
    const expected: Record<string, number> = {
      hollow: 20,
      thornling: 16,
      skitterer: 16,
      sporeburst: 20,
    };
    for (const [type, health] of Object.entries(expected)) {
      expect(hasEntityType(type)).toBe(true);
      const s = scene(flatWorld());
      const id = s.runtime.spawn(type, 0.5, GROUND, 0.5);
      expect(s.ecs.get(id, HealthC)!.current, type).toBe(health);
      expect(s.ecs.get(id, MobC)!.category, type).toBe('hostile');
      expect(s.ecs.get(id, BodyC)!.width, type).toBeLessThanOrEqual(0.95);
      expect(s.ecs.get(id, BodyC), type).toEqual({
        width: DEFINITIONS[type]!.width,
        height: DEFINITIONS[type]!.height,
      });
      expect(s.ecs.get(id, MobBodyC)!.climbing, type).toBe(type === SKITTERER);
      expect(s.ecs.get(id, RenderableC)!.scale, type).toBe(type === SKITTERER ? 1.2 : 1);
    }
  });

  it('builds every model within 24 parts, with whole-texel UVs inside its skin', () => {
    for (const id of Object.keys(PALETTES)) {
      const model = getEntityModel(id);
      expect(() => validateModel(model)).not.toThrow();
      expect(model.parts.length).toBeLessThanOrEqual(MAX_MODEL_PARTS);
      for (const part of model.parts)
        for (const cube of part.cubes) {
          expect(cube.uv.every(Number.isInteger), id).toBe(true);
          expect(cube.size.every(Number.isInteger), id).toBe(true);
        }
    }
  });

  it('paints deterministic skins from their declared palettes with readable contrast', () => {
    for (const [id, palette] of Object.entries(PALETTES)) {
      const skin = getEntitySkin(id);
      const a = skin(7),
        b = skin(7);
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
      const [w, h] = getEntityModel(id).textureSize;
      expect(a.length).toBe(w * h * 4);
      const allowed = new Set(palette.map((hex) => hex.toLowerCase()));
      const used = new Set<string>();
      for (let o = 0; o < a.length; o += 4) {
        if (a[o + 3] === 0) continue;
        expect(a[o + 3]).toBe(255);
        used.add(
          '#' + ((a[o]! << 16) | (a[o + 1]! << 8) | a[o + 2]!).toString(16).padStart(6, '0'),
        );
      }
      for (const color of used) expect(allowed.has(color), `${id} uses ${color}`).toBe(true);
      const lum = [...used].map(luminance);
      expect(Math.max(...lum) - Math.min(...lum), id).toBeGreaterThanOrEqual(60);
    }
  });

  it('gives each hostile its goal list with the shared priorities', () => {
    const expected: Record<string, Array<[number, string]>> = {
      hollow: [
        [PRIORITY.target, 'target_player'],
        [PRIORITY.avoidSunlight, 'avoid_sunlight'],
        [PRIORITY.attack, 'melee_attack'],
        [PRIORITY.wander, 'wander'],
      ],
      thornling: [
        [PRIORITY.target, 'target_player'],
        [PRIORITY.attack, 'ranged_attack'],
        [PRIORITY.wander, 'wander'],
      ],
      skitterer: [
        [PRIORITY.target, 'target_player'],
        [PRIORITY.climb, 'climb_wall'],
        [PRIORITY.leap, 'leap'],
        [PRIORITY.attack, 'melee_attack'],
        [PRIORITY.wander, 'wander'],
      ],
      sporeburst: [
        [PRIORITY.target, 'target_player'],
        [PRIORITY.swell, 'swell'],
        [PRIORITY.attack, 'approach'],
        [PRIORITY.wander, 'wander'],
      ],
    };
    for (const [type, goals] of Object.entries(expected)) {
      const s = scene(flatWorld(), [-20, GROUND, -20]);
      expect(goalList(s, s.runtime.spawn(type, 0.5, GROUND, 0.5)), type).toEqual(goals);
    }
  });

  it('installs nothing on an ECS world until the first creature spawns', () => {
    const s = scene(flatWorld());
    expect(creatureContext(s.ecs)).toBeUndefined();
    s.runtime.spawn(HOLLOW, 0.5, GROUND, 0.5);
    expect(creatureContext(s.ecs)).toBeDefined();
  });
});

describe('M13f drops', () => {
  /** Kills `count` of `type` across a wide world and returns each dropped stack's size by item. */
  function stacks(type: string, count: number): Record<string, number[]> {
    const s = scene(flatWorld({ radius: 3 }), [-40, GROUND, -40]);
    for (let n = 0; n < count; n++)
      killEntity(
        s.ecs,
        s.runtime.spawn(type, (n % 10) * 3 - 15.5, GROUND, Math.floor(n / 10) * 3 - 15.5),
      );
    run(s.ecs, 1);
    const result: Record<string, number[]> = {};
    for (const entity of s.items.pool)
      if (entity.active) (result[entity.item.id] ??= []).push(entity.count);
    return result;
  }

  it('drops Bark Strips and occasionally iron from a Hollow', () => {
    const drops = stacks(HOLLOW, 100);
    expect(drops.bark_strips).toHaveLength(100);
    expect([...new Set(drops.bark_strips)].sort()).toEqual([1, 2]);
    // About 5 % drop one iron ingot.
    expect(drops.iron_ingot?.every((n) => n === 1)).toBe(true);
    expect(drops.iron_ingot!.length).toBeGreaterThan(0);
    expect(drops.iron_ingot!.length).toBeLessThan(20);
    expect(Object.keys(drops).sort()).toEqual(['bark_strips', 'iron_ingot']);
  });

  it('drops Thorns and sticks from a Thornling, Silk and Carapace from a Skitterer', () => {
    const thornling = stacks(THORNLING, 40);
    expect(thornling.thorn).toHaveLength(40);
    expect([...new Set(thornling.thorn)].sort()).toEqual([1, 2]);
    expect([...new Set(thornling.stick)].sort()).toEqual([1, 2]);
    expect(Object.keys(thornling).sort()).toEqual(['stick', 'thorn']);
    const skitterer = stacks(SKITTERER, 40);
    expect([...new Set(skitterer.silk)].sort()).toEqual([1, 2]);
    expect(skitterer.silk!.length).toBeLessThan(40);
    expect(skitterer.carapace!.every((n) => n === 1)).toBe(true);
    expect(skitterer.carapace!.length).toBeLessThan(40);
    expect(Object.keys(skitterer).sort()).toEqual(['carapace', 'silk']);
  });

  it('drops Spore Powder from a killed Sporeburst and nothing from one that bursts', () => {
    const killed = stacks(SPOREBURST, 20);
    expect(killed.spore_powder).toHaveLength(20);
    expect([...new Set(killed.spore_powder)].sort()).toEqual([1, 2]);

    const s = scene(flatWorld(), [2.5, GROUND, 0.5]);
    const id = s.runtime.spawn(SPOREBURST, 0.5, GROUND, 0.5);
    run(s.ecs, 60);
    expect(s.ecs.exists(id)).toBe(false);
    expect(dropped(s)).toEqual({});
  });
});

describe('M13f behaviour', () => {
  it('lobs thorns that arc and can never be picked up', () => {
    const s = scene(flatWorld(), [10.5, GROUND, 0.5]);
    new ProjectileRuntime(s.world, s.ecs);
    const mob: MobHandle = { id: s.runtime.spawn(THORNLING, 0.5, GROUND, 0.5), runtime: s.runtime };
    const thorn = fireThorn(mob, [10.5, GROUND + 0.9, 0.5]);
    expect(s.ecs.get(thorn, ProjectileC)).toMatchObject({ kind: THORN_KIND, pickup: false });
    expect(s.ecs.get(thorn, ProjectileC)!.owner).toBe(mob.id);
    const vy = s.ecs.get(thorn, ProjectileVelocityC)!.vel[1];
    // Aimed above a straight line to allow for the drop.
    expect(vy).toBeGreaterThan(0);
    run(s.ecs, 5);
    expect(s.ecs.get(thorn, ProjectileVelocityC)!.vel[1]).toBeLessThan(vy);
  });

  it('keeps a Thornling 8–12 blocks from the player while it fires', () => {
    const s = scene(flatWorld({ radius: 3 }), [0.5, GROUND, 0.5]);
    const id = s.runtime.spawn(THORNLING, 4.5, GROUND, 0.5);
    let fired = 0;
    run(s.ecs, 200, () => {
      for (const p of s.ecs.query(ProjectileC))
        if (s.ecs.get(p, ProjectileC)!.kind === THORN_KIND) fired++;
    });
    const p = pos(s.ecs, id);
    expect(Math.hypot(p[0] - 0.5, p[2] - 0.5)).toBeGreaterThanOrEqual(7);
    expect(fired).toBeGreaterThan(0);
  });

  it('leaps at the player from within 4 blocks', () => {
    setWorldTime(18000);
    const s = scene(flatWorld(), [3.5, GROUND, 0.5]);
    const id = s.runtime.spawn(SKITTERER, 0.5, GROUND, 0.5);
    let leapt = false;
    run(s.ecs, 40, () => {
      // The leap claims only the jump flag, so it runs beside the melee attack.
      const running = s.ecs.get(id, AiC)!.selector!.running.map((goal) => goal.name);
      if (running.includes('leap') && s.ecs.get(id, MobBodyC)!.vel[1] > 0) leapt = true;
    });
    expect(leapt).toBe(true);
    expect(s.player.hits.some((hit) => hit.source.includes(SKITTERER))).toBe(true);
  });

  it('leaves the player alone in daylight until hit, and hunts at night', () => {
    const world = flatWorld({ light: true });
    setWorldTime(6000);
    const s = scene(world, [6.5, GROUND, 0.5]);
    const id = s.runtime.spawn(SKITTERER, 0.5, GROUND, 0.5);
    run(s.ecs, 40);
    expect(entityAI(s.ecs, id).target).toBeNull();
    expect(s.player.hits).toHaveLength(0);
    // Hit by the player: it fights back, daylight or not.
    hurtMob(s.ecs, id, 1, { ref: PLAYER_TARGET, pos: [...s.player.pos] });
    run(s.ecs, 5);
    expect(entityAI(s.ecs, id).target).toBe(PLAYER_TARGET);

    const night = scene(world, [6.5, GROUND, 0.5]);
    const other = night.runtime.spawn(SKITTERER, 0.5, GROUND, 0.5);
    setWorldTime(18000);
    run(night.ecs, 5);
    expect(entityAI(night.ecs, other).target).toBe(PLAYER_TARGET);
  });

  it('swells a Sporeburst for 30 ticks, growing and flashing, then bursts into a spore cloud', () => {
    const s = scene(flatWorld(), [2.5, GROUND, 0.5]);
    const id = s.runtime.spawn(SPOREBURST, 0.5, GROUND, 0.5);
    let ticks = 0;
    const models = new Set<string>();
    let biggest = 1;
    run(s.ecs, 60, () => {
      if (!s.ecs.exists(id)) return;
      if (entityAI(s.ecs, id).goal !== 'swell') return;
      ticks++;
      const renderable = s.ecs.get(id, RenderableC)!;
      models.add(renderable.model);
      biggest = Math.max(biggest, renderable.scale ?? 1);
    });
    // Its last swelling tick is the burst, after which it is gone.
    expect(ticks).toBe(SWELL_TICKS - 1);
    expect(s.ecs.exists(id)).toBe(false);
    expect([...models].sort()).toEqual([SPOREBURST, SPOREBURST_FLASH].sort());
    expect(biggest).toBeGreaterThan(1 + SWELL_GROWTH * 0.9);
    expect(s.player.hits.map((hit) => hit.source)).toEqual(['blast']);
    const clouds = [...s.ecs.query(EntityKindC)].filter(
      (e) => s.ecs.get(e, EntityKindC)!.type === SPORE_CLOUD,
    );
    expect(clouds).toHaveLength(1);
    // The cloud is scenery: nothing can hit it.
    expect(s.ecs.has(clouds[0]!, BodyC)).toBe(false);
    expect(s.ecs.has(clouds[0]!, HealthC)).toBe(false);
  });

  it('cancels the swell and resets its look when the player gets more than 7 blocks away', () => {
    const s = scene(flatWorld({ radius: 3 }), [2.5, GROUND, 0.5]);
    const id = s.runtime.spawn(SPOREBURST, 0.5, GROUND, 0.5);
    for (let n = 0; n < 20 && entityAI(s.ecs, id).goal !== 'swell'; n++) run(s.ecs, 1);
    expect(entityAI(s.ecs, id).goal).toBe('swell');
    run(s.ecs, 10);
    s.player.pos[0] = 9;
    run(s.ecs, 2);
    expect(entityAI(s.ecs, id).goal).not.toBe('swell');
    expect(s.ecs.get(id, RenderableC)).toMatchObject({ scale: 1, model: SPOREBURST });
    run(s.ecs, 40);
    expect(s.ecs.exists(id)).toBe(true);
    expect(s.player.hits).toHaveLength(0);
  });

  it('slows the player inside a spore cloud, which fades after 100 ticks', () => {
    const world = flatWorld();
    const ecs = createEntityWorld();
    const player = new SlowablePlayer(1.5, GROUND, 0.5);
    const runtime = new MobRuntime(world, ecs, {
      seed: 1,
      player: () => player,
      spawnContext: { ecs, items: new ItemEntityManager(world) },
    });
    const s = { ecs, runtime };
    const cloud = spawnSporeCloud(s.ecs, [0.5, GROUND, 0.5]);
    run(s.ecs, 1);
    expect(player.slows.at(-1)).toEqual([SPORE_SLOW_FACTOR, SPORE_SLOW_TICKS]);
    player.pos[0] = 5;
    const count = player.slows.length;
    run(s.ecs, 5);
    expect(player.slows).toHaveLength(count);
    run(s.ecs, SPORE_CLOUD_TICKS);
    expect(s.ecs.exists(cloud)).toBe(false);
    expect(s.ecs.get(cloud, TransformC)).toBeUndefined();
  });

  it('keeps the strongest and longest slow, and counts it down', () => {
    const player = {};
    expect(takePlayerSlow(player)).toBe(1);
    slowPlayer(player, 0.5, 3);
    slowPlayer(player, 0.8, 5);
    expect(playerSlowTicks(player)).toBe(5);
    expect([1, 2, 3, 4, 5].map(() => takePlayerSlow(player))).toEqual([0.5, 0.5, 0.5, 0.5, 0.5]);
    expect(playerSlowTicks(player)).toBe(0);
    expect(takePlayerSlow(player)).toBe(1);
  });
});

describe('M13f player invulnerability', () => {
  function survivor(): { player: Player; combat: PlayerCombat } {
    const world = flatWorld();
    const player = new Player(new BlockCollision(world), () => true);
    player.setGameMode('survival');
    player.teleport(0.5, GROUND, 0.5, 0, 0);
    player.tick();
    return { player, combat: new PlayerCombat(player, scene(world).ecs, null) };
  }

  it('ignores a second entity hit within 10 ticks and takes one after', () => {
    const { player, combat } = survivor();
    const from: [number, number, number] = [2.5, GROUND, 0.5];
    expect(hurtPlayer(player, 3, 'mob:hollow', from)).toBe(true);
    expect(player.health).toBe(17);
    expect(playerInvulnerableTicks(player)).toBe(PLAYER_INVULNERABLE_TICKS);
    for (let n = 1; n < PLAYER_INVULNERABLE_TICKS; n++) {
      combat.tick();
      expect(hurtPlayer(player, 3, 'projectile:thorn', from), `tick ${n}`).toBe(false);
    }
    expect(player.health).toBe(17);
    combat.tick();
    expect(playerInvulnerableTicks(player)).toBe(0);
    expect(hurtPlayer(player, 3, 'blast', from)).toBe(true);
    expect(player.health).toBe(14);
  });

  it('leaves environmental damage and shield wear unchanged while immune', () => {
    const { player } = survivor();
    expect(hurtPlayer(player, 2, 'mob:skitterer', [2.5, GROUND, 0.5])).toBe(true);
    player.survival.damage(1, 'cactus');
    expect(player.health).toBe(17);
    player.inventory.slots[SHIELD_SLOT] = { slot: SHIELD_SLOT, id: 'shield', count: 1 };
    player.input('use', true);
    expect(hurtPlayer(player, 2, 'mob:skitterer', [2.5, GROUND, 0.5])).toBe(false);
    expect(player.inventory.slots[SHIELD_SLOT]!.damage).toBe(1);
  });
});
