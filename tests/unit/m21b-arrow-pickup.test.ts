// @vitest-environment node
import { expect, it } from 'vitest';
import { createEntityWorld } from '../../src/entity/ecs/systems';
import { PLAYER_TARGET } from '../../src/entity/ai/components';
import { ProjectileC, ProjectileRuntime, fireProjectile } from '../../src/entity/projectiles';
import { Player } from '../../src/entity/player';
import { BlockCollision } from '../../src/entity/physics';
import { ItemEntityManager } from '../../src/entity/item-entity';
import { World } from '../../src/world/world';

it('drops exactly one arrow when two players can pick up the same stuck arrow', () => {
  const world = new World(false);
  world.setBlock(1, 65, 0, 'stone');
  const ecs = createEntityWorld();
  const a = new Player(new BlockCollision(world), () => true);
  const b = new Player(new BlockCollision(world), () => true);
  a.teleport(0.5, 64, 0.5);
  b.teleport(0.5, 64, 0.5);
  const items = new ItemEntityManager(world);
  new ProjectileRuntime(
    world,
    ecs,
    () => a,
    () => items,
    () => [a, b],
  );
  const id = fireProjectile(ecs, {
    kind: 'arrow',
    from: [0.5, 65.5, 0.5],
    dir: [1, 0, 0],
    speed: 3,
    owner: PLAYER_TARGET,
  });
  ecs.tick();
  expect(ecs.get(id, ProjectileC)!.stuck).toBe(true);
  ecs.tick();
  expect(ecs.exists(id)).toBe(false);
  expect(items.pool.filter((item) => item.active && item.item.id === 'arrow')).toHaveLength(1);
});
