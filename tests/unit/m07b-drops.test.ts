import { it, expect } from 'vitest';
import { items } from '../../src/gameplay/items';
import { Inventory } from '../../src/gameplay/inventory';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { World } from '../../src/world/world';
import { Player } from '../../src/entity/player';
import { BlockCollision } from '../../src/entity/physics';
import { ItemEntityManager, ITEM_CAPACITY, ITEM_LIFETIME } from '../../src/entity/item-entity';
import { BreakParticles, PARTICLE_CAPACITY } from '../../src/render/particles';
import { BlockInteraction } from '../../src/gameplay/block-interaction';
import { canHarvest, BARE_HAND } from '../../src/gameplay/mining';
import { blockLoot } from '../../src/gameplay/loot';
import { toolGenerators, toolPalettes } from '../../src/render/textures/tools';
function scene() {
  const world = new World(false);
  world.fill(-2, 64, -2, 10, 64, 2, 'stone');
  const player = new Player(new BlockCollision(world), () => true);
  player.teleport(0.5, 65, 0.5, 0, 0);
  player.tick();
  return { world, player, entities: new ItemEntityManager(world) };
}
it('M07b every registered block has a valid data-driven block item; harvest tiers are available', () => {
  for (const id of BlockRegistry.getInstance().getAllBlockIds())
    expect(items.get(id).block).toBe(id);
  for (const [id, tier, speed] of [
    ['wooden_pickaxe', 0, 2],
    ['stone_pickaxe', 1, 4],
    ['copper_pickaxe', 2, 5],
    ['iron_pickaxe', 3, 6],
  ] as const)
    expect(items.get(id).tool).toEqual({ type: 'pickaxe', tier, speed });
});
it('M07b storage merges before empty slots, respects tool limits, rejects overflow atomically and validates hotbar', () => {
  const inv = new Inventory();
  expect(inv.insert('dirt', 60)).toBe(true);
  expect(inv.insert('dirt', 10)).toBe(true);
  expect(inv.snapshot().slice(0, 2)).toEqual([
    { slot: 0, id: 'dirt', count: 64 },
    { slot: 1, id: 'dirt', count: 6 },
  ]);
  inv.selectedSlot = 1;
  expect(inv.held?.count).toBe(6);
  inv.consumeSelected();
  expect(inv.held?.count).toBe(5);
  expect(() => {
    inv.selectedSlot = 9;
  }).toThrow();
  expect(() => inv.insert('dirt', 0)).toThrow();
  expect(inv.insert('wooden_pickaxe', 34)).toBe(true);
  const before = inv.snapshot();
  expect(inv.insert('dirt', 60)).toBe(false);
  expect(inv.snapshot()).toEqual(before);
  expect(inv.insert('dirt', 59)).toBe(true);
  expect(
    inv
      .snapshot()
      .slice(2)
      .every((s) => s?.count === 1),
  ).toBe(true);
  const copy = inv.snapshot();
  copy[0]!.count = 1;
  expect(inv.slots[0]!.count).toBe(64);
});
it('M07b selected tool yields 150 bare-hand and 23 wooden-pick ticks; harvest rule controls stone and logs', () => {
  const { world, player } = scene();
  world.setBlock(3, 66, 0, 'stone');
  const i = new BlockInteraction(player, () => {});
  i.input('attack', true);
  for (let n = 0; n < 149; n++) i.tick();
  expect(world.getBlock(3, 66, 0).id).toBe('stone');
  i.tick();
  expect(world.getBlock(3, 66, 0).id).toBe('air');
  world.setBlock(3, 66, 0, 'stone');
  player.inventory.insert('wooden_pickaxe', 1);
  for (let n = 0; n < 22; n++) i.tick();
  expect(world.getBlock(3, 66, 0).id).toBe('stone');
  i.tick();
  expect(world.getBlock(3, 66, 0).id).toBe('air');
  const r = BlockRegistry.getInstance();
  expect(canHarvest(r.getBlockDefinition('stone')!, BARE_HAND)).toBe(false);
  expect(canHarvest(r.getBlockDefinition('stone')!, items.get('wooden_pickaxe').tool!)).toBe(true);
  expect(canHarvest(r.getBlockDefinition('oak_log')!, BARE_HAND)).toBe(true);
  expect(blockLoot('stone')).toEqual([{ id: 'cobblestone', count: 1 }]);
  expect(blockLoot('oak_log')).toEqual([{ id: 'oak_log', count: 1 }]);
});
it('M07b placement consumes selected block only on success in survival, never creative; a tool cannot place', () => {
  const { world, player } = scene();
  world.setBlock(3, 66, 0, 'stone');
  player.inventory.insert('oak_log', 2);
  const i = new BlockInteraction(player, () => {});
  i.input('use', true);
  i.tick();
  expect(world.getBlock(2, 66, 0)).toEqual({ id: 'oak_log', state: { axis: 'x' } });
  expect(player.inventory.held?.count).toBe(1);
  world.setBlock(1, 66, 0, 'stone');
  i.input('use', false);
  i.input('use', true);
  i.tick();
  expect(player.inventory.held?.count).toBe(1);
  world.setBlock(1, 66, 0, 'air');
  world.setBlock(2, 66, 0, 'air');
  player.setGameMode('creative');
  i.input('use', false);
  i.input('use', true);
  i.tick();
  expect(player.inventory.held?.count).toBe(1);
  player.inventory.insert('wooden_pickaxe', 1);
  player.selectedSlot = 1;
  world.setBlock(2, 66, 0, 'air');
  i.input('use', false);
  i.input('use', true);
  i.tick();
  expect(world.getBlock(2, 66, 0).id).toBe('air');
});
it('M07b item physics falls onto full blocks and slabs, stops at walls, uses bounded reused records and expires exactly at tick 6000', () => {
  const { world, player, entities } = scene();
  player.detached = true;
  world.setBlock(4, 65, 0, 'stone_slab', { half: 'bottom' });
  const e = entities.spawn('oak_log', 1, 4.5, 67, 0.5)!;
  e.vel.fill(0);
  for (let n = 0; n < 60; n++) entities.tick(player);
  expect(e.pos[1]).toBeCloseTo(65.5);
  expect(e.vel[1]).toBe(0);
  world.fill(6, 65, -1, 6, 68, 1, 'stone');
  e.pos[0] = 5.5;
  e.pos[1] = 65;
  e.vel[0] = 20;
  entities.tick(player);
  expect(e.pos[0]).toBeCloseTo(5.875);
  expect(e.vel[0]).toBe(0);
  e.age = ITEM_LIFETIME - 2;
  entities.tick(player);
  expect(e.active).toBe(true);
  entities.tick(player);
  expect(e.active).toBe(false);
  expect(entities.spawn('dirt', 1, 1, 65, 1)).toBe(e);
  for (let n = 1; n < ITEM_CAPACITY; n++)
    expect(entities.spawn('dirt', 1, 1, 65, 1)).not.toBeNull();
  expect(entities.spawn('dirt', 1, 1, 65, 1)).toBeNull();
  expect(entities.pool).toHaveLength(ITEM_CAPACITY);
});
it('M07b compatible nearby stacks merge to limits; different or distant items stay separate', () => {
  const { player, entities } = scene();
  player.detached = true;
  const a = entities.spawn('dirt', 63, 3.5, 65, 0.5)!,
    b = entities.spawn('dirt', 3, 3.5, 65, 0.5)!;
  const c = entities.spawn('oak_log', 1, 3.5, 65, 0.5)!,
    d = entities.spawn('dirt', 1, 7.5, 65, 0.5)!;
  for (const e of [a, b, c, d]) e.vel.fill(0);
  entities.tick(player);
  expect(a.count).toBe(64);
  expect(b.count).toBe(2);
  expect(c.count).toBe(1);
  expect(d.count).toBe(1);
});
it('M07b magnetic pickup within one second, full inventory retains whole stack, walls block attraction and radius filters serialize', () => {
  const { world, player, entities } = scene();
  const e = entities.spawn('oak_log', 1, 0.5, 66, 0.5)!;
  for (let n = 0; n < 20; n++) entities.tick(player);
  expect(e.active).toBe(false);
  expect(player.inventory.held?.id).toBe('oak_log');
  player.inventory.insert('dirt', 35 * 64);
  player.inventory.insert('oak_log', 63);
  const full = entities.spawn('oak_log', 1, 0.5, 65, 0.5)!;
  for (let n = 0; n < 20; n++) entities.tick(player);
  expect(full.active).toBe(true);
  expect(entities.snapshot(player, { type: 'mob' })).toEqual([]);
  expect(
    JSON.parse(JSON.stringify(entities.snapshot(player, { type: 'item', radius: 1.5 })))[0],
  ).toMatchObject({ type: 'item', item: 'oak_log', count: 1 });
  // A fresh empty inventory attracts but cannot pull an item through a solid wall.
  const other = new Player(player.collision, () => true);
  other.teleport(0.9, 65, 0.5);
  world.fill(1, 65, -1, 1, 68, 1, 'stone');
  const blocked = entities.spawn('dirt', 1, 2.125, 65.5, 0.5)!;
  blocked.vel.fill(0);
  for (let n = 0; n < 20; n++) entities.tick(other);
  expect(blocked.active).toBe(true);
  expect(blocked.pos[0]).toBeGreaterThanOrEqual(2.125 - 1e-7);
});
it('M07b seeded pops replay identically; particles emit 16 textured fragments, fall, expire and remain bounded', () => {
  const { world } = scene(),
    a = new ItemEntityManager(world),
    b = new ItemEntityManager(world);
  expect(a.spawn('dirt', 1, 1, 65, 1)?.vel).toEqual(b.spawn('dirt', 1, 1, 65, 1)?.vel);
  const particles = new BreakParticles(world),
    state = BlockRegistry.getInstance().getDefaultStateId('stone')!;
  particles.spawn(state, 3, 66, 0);
  expect(particles.pool.filter((p) => p.active)).toHaveLength(16);
  const first = particles.pool[0]!,
    start = first.vel[1];
  particles.tick();
  expect(first.vel[1]).toBeLessThan(start);
  for (let n = 0; n < 22; n++) particles.tick();
  expect(particles.pool.some((p) => p.active)).toBe(false);
  for (let n = 0; n < 40; n++) particles.spawn(state, 3, 66, 0);
  expect(particles.pool).toHaveLength(PARTICLE_CAPACITY);
  expect(particles.pool.every((p) => p.active && p.state === state && p.u <= 12 && p.v <= 12)).toBe(
    true,
  );
});
it('M07b procedural tool sprites are deterministic, readable silhouettes and use only their declared palettes', () => {
  for (const [id, gen] of Object.entries(toolGenerators)) {
    const pixels = gen();
    expect(gen()).toEqual(pixels);
    expect(gen(12345)).not.toEqual(gen(99999));
    const colors = new Set(toolPalettes[id]!.map((c) => c.join(',')));
    expect(colors.size).toBeLessThanOrEqual(12);
    let min = 255,
      max = 0,
      opaque = 0;
    for (let n = 0; n < pixels.length; n += 4) {
      expect(colors.has([...pixels.slice(n, n + 4)].join(','))).toBe(true);
      if (pixels[n + 3]) {
        const l = 0.2126 * pixels[n]! + 0.7152 * pixels[n + 1]! + 0.0722 * pixels[n + 2]!;
        min = Math.min(min, l);
        max = Math.max(max, l);
        opaque++;
      }
    }
    expect(max - min).toBeGreaterThanOrEqual(60);
    expect(opaque).toBeGreaterThan(20);
    expect(opaque).toBeLessThan(120);
  }
});
it('M07b creative middle pick still places the targeted default block when an inventory slot is occupied', () => {
  const { world, player } = scene();
  world.setBlock(3, 66, 0, 'oak_log', { axis: 'z' });
  player.inventory.insert('wooden_pickaxe', 1);
  player.setGameMode('creative');
  const interaction = new BlockInteraction(player, () => {});
  interaction.input('pick', true);
  interaction.tick();
  expect(player.inventory.held?.id).toBe('oak_log');
  expect(player.heldBlock).toBe(BlockRegistry.getInstance().getDefaultStateId('oak_log'));
  interaction.input('use', true);
  interaction.tick();
  expect(world.getBlock(2, 66, 0)).toEqual({ id: 'oak_log', state: { axis: 'x' } });
  expect(player.inventory.held?.count).toBe(1);
});
