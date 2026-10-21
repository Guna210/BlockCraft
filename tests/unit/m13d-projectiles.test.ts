import { describe, expect, it } from 'vitest';
import { createEntityWorld } from '../../src/entity/ecs/systems';
import { BodyC, EntityKindC, HealthC, TransformC } from '../../src/entity/ecs/components';
import { CombatC, MobBodyC, PLAYER_TARGET, TargetC } from '../../src/entity/ai/components';
import {
  ProjectileC,
  ProjectileRuntime,
  ProjectileVelocityC,
  fireProjectile,
  solveAimDirection,
} from '../../src/entity/projectiles';
import { BowController, bowChargeSpeed } from '../../src/gameplay/bow';
import { getToolDurability } from '../../src/gameplay/tools';
import { Player } from '../../src/entity/player';
import { BlockCollision } from '../../src/entity/physics';
import { ItemEntityManager } from '../../src/entity/item-entity';
import { World } from '../../src/world/world';
import { hudSnapshot } from '../../src/ui/hud';

function target(ecs: ReturnType<typeof createEntityWorld>, pos: [number, number, number]): number {
  const id = ecs.create();
  ecs.add(id, EntityKindC, { type: 'projectile_test_target' });
  ecs.add(id, TransformC, { pos, previous: [...pos], yaw: 0, previousYaw: 0 });
  ecs.add(id, BodyC, { width: 0.6, height: 1.8 });
  ecs.add(id, HealthC, {
    current: 20,
    max: 20,
    hurtTicks: 0,
    deathTicks: 0,
    previousDeathTicks: 0,
  });
  ecs.add(id, CombatC, { invulnerableTicks: 0, lastDamage: 0 });
  ecs.add(id, MobBodyC, {
    speed: 0,
    flying: false,
    climbing: false,
    vel: [0, 0, 0],
    onGround: true,
    inFluid: false,
    horizontalCollision: false,
    wish: [0, 0, 0],
    jump: false,
    climb: false,
  });
  ecs.add(id, TargetC, { target: null, attacker: null, attackerPos: null, hurtAt: 0 });
  return id;
}

function arrowCount(player: Player): number {
  return player.inventory.slots
    .slice(0, 36)
    .reduce((sum, stack) => sum + (stack?.id === 'arrow' ? stack.count : 0), 0);
}

describe('M13d projectile physics', () => {
  it('integrates gravity and drag to the closed form over ten ticks', () => {
    const world = new World(false);
    const ecs = createEntityWorld();
    new ProjectileRuntime(world, ecs);
    const id = fireProjectile(ecs, {
      kind: 'arrow',
      from: [0.5, 100, 0.5],
      dir: [0, 0, 1],
      speed: 1,
      owner: PLAYER_TARGET,
    });
    const ticks = 10;
    for (let n = 0; n < ticks; n++) ecs.tick();

    const projectile = ecs.get(id, ProjectileC)!;
    const { vel } = ecs.get(id, ProjectileVelocityC)!;
    const drag = 0.99,
      gravity = 0.05,
      geometric = (1 - drag ** ticks) / (1 - drag),
      expectedVy = (-gravity * drag * (1 - drag ** ticks)) / (1 - drag),
      expectedDrop =
        (gravity * drag * (ticks - (drag * (1 - drag ** ticks)) / (1 - drag))) / (1 - drag);
    expect(projectile.stuck).toBe(false);
    expect(vel[1]).toBeCloseTo(expectedVy, 10);
    expect(vel[2]).toBeCloseTo(drag ** ticks, 10);
    expect(ecs.get(id, TransformC)!.pos[1]).toBeCloseTo(100 - expectedDrop, 10);
    expect(ecs.get(id, TransformC)!.pos[2]).toBeCloseTo(0.5 + drag * geometric, 10);
  });

  it('uses a swept block ray so a full-speed projectile cannot tunnel through a one-block wall', () => {
    const world = new World(false);
    world.setBlock(1, 64, 0, 'stone');
    const ecs = createEntityWorld();
    new ProjectileRuntime(world, ecs);
    const id = fireProjectile(ecs, {
      kind: 'arrow',
      from: [0.5, 64.5, 0.5],
      dir: [1, 0, 0],
      speed: 30,
      owner: PLAYER_TARGET,
    });

    ecs.tick();

    const state = ecs.get(id, ProjectileC)!;
    expect(state.stuck).toBe(true);
    expect(ecs.get(id, TransformC)!.pos[0]).toBeCloseTo(0.95, 6);
  });

  it('damages through M13c combat, applies flight-direction knockback and respects invulnerability', () => {
    const world = new World(false);
    const ecs = createEntityWorld();
    new ProjectileRuntime(world, ecs);
    const mob = target(ecs, [3.5, 64, 0.5]);
    const first = fireProjectile(ecs, {
        kind: 'arrow',
        from: [0.5, 64.8, 0.5],
        dir: [1, 0, 0],
        speed: 3,
        owner: PLAYER_TARGET,
      }),
      second = fireProjectile(ecs, {
        kind: 'arrow',
        from: [0.5, 64.8, 0.5],
        dir: [1, 0, 0],
        speed: 3,
        owner: PLAYER_TARGET,
      });

    ecs.tick();

    expect(ecs.get(mob, HealthC)!.current).toBe(14);
    expect(ecs.get(mob, CombatC)!.invulnerableTicks).toBeGreaterThan(0);
    expect(ecs.get(mob, MobBodyC)!.vel[0]).toBeGreaterThan(0);
    expect(ecs.get(mob, MobBodyC)!.vel[1]).toBeLessThan(0);
    expect(ecs.exists(first)).toBe(false);
    expect(ecs.exists(second)).toBe(false);
  });

  it('unpins and drops a pickable arrow when its supporting block is broken', () => {
    const world = new World(false);
    world.setBlock(1, 64, 0, 'stone');
    const ecs = createEntityWorld();
    const items = new ItemEntityManager(world);
    new ProjectileRuntime(
      world,
      ecs,
      () => null,
      () => items,
    );
    const id = fireProjectile(ecs, {
      kind: 'arrow',
      from: [0.5, 64.5, 0.5],
      dir: [1, 0, 0],
      speed: 3,
      owner: PLAYER_TARGET,
    });
    ecs.tick();
    expect(ecs.get(id, ProjectileC)!.stuck).toBe(true);

    world.setBlock(1, 64, 0, 'air');
    ecs.tick();

    expect(ecs.exists(id)).toBe(false);
    expect(
      items.snapshot(new Player(new BlockCollision(world), () => true), { type: 'item' }),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ item: 'arrow', count: 1 })]));
  });
});

describe('M13d bow', () => {
  it('maps the charge curve to the specified shot speeds', () => {
    expect(bowChargeSpeed(0)).toBe(0);
    expect(bowChargeSpeed(0.1)).toBeCloseTo(0.21);
    expect(bowChargeSpeed(0.5)).toBeCloseTo(1.25);
    expect(bowChargeSpeed(1)).toBe(3);
  });

  it('leaves use input available to other items when the held item is not a bow', () => {
    const world = new World(false);
    const player = new Player(new BlockCollision(world), () => true);
    player.inventory.slots[0] = { slot: 0, id: 'bread', count: 1 };
    const bow = new BowController(player, createEntityWorld());

    expect(bow.input('use', true)).toBe(false);
    expect(bow.input('use', false)).toBe(false);
  });

  it('solves the flatter ballistic angle and uses the 45 degree fallback out of range', () => {
    const flat = solveAimDirection([0, 0, 0], [10, 0, 0], 1, 0.05);
    expect(flat[0]).toBeGreaterThan(0);
    expect(flat[1]).toBeGreaterThan(0);
    expect(flat[1]).toBeLessThan(Math.SQRT1_2);

    const fallback = solveAimDirection([0, 0, 0], [1000, 0, 0], 1, 0.05);
    expect(fallback[0]).toBeCloseTo(Math.SQRT1_2);
    expect(fallback[1]).toBeCloseTo(Math.SQRT1_2);
  });

  it('uses one arrow and one bow durability on a charged survival shot', () => {
    const world = new World(false);
    const ecs = createEntityWorld();
    new ProjectileRuntime(world, ecs);
    const player = new Player(new BlockCollision(world), () => true);
    player.setGameMode('survival');
    player.teleport(0.5, 64, 0.5, 0, 0);
    player.inventory.slots[0] = { slot: 0, id: 'bow', count: 1, damage: 382 };
    player.inventory.slots[1] = { slot: 1, id: 'arrow', count: 2 };
    const bow = new BowController(player, ecs);

    expect(bow.input('use', true)).toBe(true);
    for (let n = 0; n < 20; n++) bow.tick();
    expect(bow.charge).toBe(1);
    expect(bow.input('use', false)).toBe(true);

    expect(arrowCount(player)).toBe(1);
    expect(player.inventory.slots[0]?.damage).toBe(383);
    expect(getToolDurability('bow')).toBe(384);
    expect(ecs.query(ProjectileC)).toHaveLength(1);

    bow.input('use', true);
    for (let n = 0; n < 20; n++) bow.tick();
    bow.input('use', false);
    expect(arrowCount(player)).toBe(0);
    expect(player.inventory.slots[0]).toBe(null);
    expect(ecs.query(ProjectileC)).toHaveLength(2);
  });

  it('lets creative charge without arrows and marks its shot as unpickable', () => {
    const world = new World(false);
    const ecs = createEntityWorld();
    new ProjectileRuntime(world, ecs);
    const player = new Player(new BlockCollision(world), () => true);
    player.setGameMode('creative');
    player.teleport(0.5, 64, 0.5, 0, 0);
    player.inventory.slots[0] = { slot: 0, id: 'bow', count: 1 };
    const bow = new BowController(player, ecs);

    bow.input('use', true);
    for (let n = 0; n < 20; n++) bow.tick();
    bow.input('use', false);

    const id = ecs.query(ProjectileC)[0]!;
    expect(arrowCount(player)).toBe(0);
    expect(ecs.get(id, ProjectileC)!.pickup).toBe(false);
    expect(player.inventory.slots[0]?.damage).toBe(1);
  });

  it('routes projectile hits through the player shield frontal block and armor reduction', () => {
    const world = new World(false);
    const ecs = createEntityWorld();
    const player = new Player(new BlockCollision(world), () => true);
    player.setGameMode('survival');
    player.teleport(3.5, 64, 0.5, Math.PI, 0);
    player.inventory.slots[40] = { slot: 40, id: 'shield', count: 1 };
    player.input('use', true);
    new ProjectileRuntime(world, ecs, () => player);
    const blocked = fireProjectile(ecs, {
      kind: 'arrow',
      from: [0.5, 64.8, 0.5],
      dir: [1, 0, 0],
      speed: 3,
      owner: 123,
    });
    ecs.tick();
    expect(player.health).toBe(20);
    expect(player.inventory.slots[40]?.damage).toBe(1);
    expect(ecs.exists(blocked)).toBe(false);

    const armoredEcs = createEntityWorld();
    const armored = new Player(new BlockCollision(world), () => true);
    armored.setGameMode('survival');
    armored.teleport(3.5, 64, 0.5, Math.PI, 0);
    armored.inventory.slots[37] = { slot: 37, id: 'iron_chestplate', count: 1 };
    new ProjectileRuntime(world, armoredEcs, () => armored);
    fireProjectile(armoredEcs, {
      kind: 'arrow',
      from: [0.5, 64.8, 0.5],
      dir: [1, 0, 0],
      speed: 3,
      owner: 123,
    });
    armoredEcs.tick();
    expect(armored.health).toBeGreaterThan(14);
    expect(armored.health).toBeLessThan(20);
  });

  it('quantizes bow charge with the HUD cooldown meter pixels', () => {
    const world = new World(false);
    const player = new Player(new BlockCollision(world), () => true);
    expect(hudSnapshot(player, false, 1, 0.55).bowCharge).toBe(7 / 14);
    expect(hudSnapshot(player, false).bowCharge).toBe(null);
  });
});
