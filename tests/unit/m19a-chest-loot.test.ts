import { describe, expect, it } from 'vitest';
import { blockLootTable } from '../../src/gameplay/loot';
import {
  chestLootTable,
  rollChestLoot,
  validateChestLootTable,
} from '../../src/gameplay/chest-loot';
import { getAttackDamage, getMiningSpeed, getToolDurability } from '../../src/gameplay/tools';
import { BlockInteraction } from '../../src/gameplay/block-interaction';
import { Player } from '../../src/entity/player';
import { BlockCollision } from '../../src/entity/physics';
import { Inventory } from '../../src/gameplay/inventory';
import { serializeInventory, deserializeInventory } from '../../src/persist/serializers';
import { tooltipFor } from '../../src/ui/inventory-screen';
import { World } from '../../src/world/world';

describe('M19a chest loot tables', () => {
  it('loads a hamlet table without changing the block-drop table loader', () => {
    expect(chestLootTable('wayfarer_hamlet')).toBeDefined();
    expect(blockLootTable('wayfarer_hamlet')).toBeUndefined();
    expect(blockLootTable('stone')?.entries.length).toBeGreaterThan(0);
  });

  it('uses entry weights across many seeded rolls and is repeatable', () => {
    const table = validateChestLootTable('weight_test', {
      rolls: [1, 1],
      entries: [
        { id: 'bread', weight: 1, count: [1, 1] },
        { id: 'wheat', weight: 3, count: [1, 1] },
      ],
    });
    let bread = 0;
    const samples = 20000;
    for (let seed = 0; seed < samples; seed++) {
      const rolled = rollChestLoot(table, seed, 12, 64, -9, 'weight_test');
      if (rolled[0]?.id === 'bread') bread++;
    }
    const ratio = bread / samples;
    expect(ratio).toBeGreaterThan(0.23);
    expect(ratio).toBeLessThan(0.27);
    expect(rollChestLoot(table, 147, 12, 64, -9, 'weight_test')).toEqual(
      rollChestLoot(table, 147, 12, 64, -9, 'weight_test'),
    );
  });

  it('keeps stack counts and remaining durability inside their inclusive ranges', () => {
    const countTable = validateChestLootTable('count_test', {
      rolls: [8, 8],
      entries: [{ id: 'bread', weight: 1, count: [2, 5] }],
    });
    for (let seed = 0; seed < 80; seed++) {
      const rolled = rollChestLoot(countTable, seed, 4, 70, 11, 'count_test');
      expect(rolled).toHaveLength(8);
      expect(rolled.every((stack) => stack.count >= 2 && stack.count <= 5)).toBe(true);
    }

    const durabilityTable = validateChestLootTable('durability_test', {
      rolls: [1, 1],
      entries: [
        {
          id: 'wooden_pickaxe',
          weight: 1,
          count: [1, 1],
          durability: [0.2, 0.4],
          affixChance: 0,
        },
      ],
    });
    for (let seed = 0; seed < 200; seed++) {
      const stack = rollChestLoot(durabilityTable, seed, 4, 70, 11, 'durability_test')[0]!;
      const remaining = 1 - stack.damage! / getToolDurability(stack.id)!;
      expect(remaining).toBeGreaterThanOrEqual(0.19);
      expect(remaining).toBeLessThanOrEqual(0.41);
    }
  });

  it('rolls each affix and applies its combat, mining and durability modifier', () => {
    const table = validateChestLootTable('affix_test', {
      rolls: [1, 1],
      entries: [
        {
          id: 'iron_sword',
          weight: 1,
          count: [1, 1],
          affixChance: 1,
        },
      ],
    });
    const counts = new Map<string, number>();
    for (let seed = 0; seed < 300; seed++) {
      const stack = rollChestLoot(table, seed, 0, 64, 0, 'affix_test')[0]!;
      counts.set(stack.affix!, (counts.get(stack.affix!) ?? 0) + 1);
    }
    expect(counts.get('Keen')).toBeGreaterThan(50);
    expect(counts.get('Sturdy')).toBeGreaterThan(50);
    expect(counts.get('Swift')).toBeGreaterThan(50);
    expect(getAttackDamage({ id: 'iron_sword', affix: 'Keen' })).toBe(
      getAttackDamage('iron_sword') + 1,
    );
    expect(getMiningSpeed({ id: 'wooden_pickaxe', affix: 'Swift' })).toBeCloseTo(2.4);
    expect(getToolDurability({ id: 'wooden_pickaxe', affix: 'Sturdy' })).toBe(89);
  });

  it('uses Swift mining speed in live block interaction', () => {
    const world = new World(false);
    world.setBlock(3, 66, 0, 'stone');
    const player = new Player(new BlockCollision(world), () => true);
    player.teleport(0.5, 65, 0.5, 0, 0);
    player.tick();
    player.inventory.insert('wooden_pickaxe', 1, { affix: 'Swift' });

    const interaction = new BlockInteraction(player, () => {});
    interaction.tick();

    expect(interaction.tool.speed).toBeCloseTo(2.4);
  });

  it('preserves affixes through inventory operations, save/load, and item tooltips', () => {
    const inventory = new Inventory();
    inventory.slots[0] = { slot: 0, id: 'iron_sword', count: 1, affix: 'Keen' };
    inventory.slots[1] = {
      slot: 1,
      id: 'wooden_pickaxe',
      count: 1,
      damage: 17,
      affix: 'Sturdy',
    };
    inventory.cursor = { id: 'stone_pickaxe', count: 1, damage: 20, affix: 'Swift' };
    inventory.leftClick(0);
    inventory.leftClick(2);
    inventory.cursor = { id: 'stone_pickaxe', count: 1, damage: 20, affix: 'Swift' };

    const bytes = serializeInventory(inventory);
    const restored = new Inventory();
    const parsed = deserializeInventory(bytes, restored);
    expect(parsed.slots[0]?.affix).toBe('Swift');
    expect(parsed.slots[1]?.affix).toBe('Sturdy');
    expect(parsed.slots[2]?.affix).toBe('Keen');
    expect(parsed.cursor).toEqual({ id: 'stone_pickaxe', count: 1, damage: 20, affix: 'Swift' });
    expect(restored.slots[1]?.damage).toBe(17);
    expect(tooltipFor(restored, 2)).toBe('KEEN IRON SWORD');

    const stacks = new Inventory();
    expect(stacks.insert('bread', 3, { affix: 'Keen' })).toBe(true);
    expect(stacks.insert('bread', 3, { affix: 'Swift' })).toBe(true);
    expect(stacks.slots[0]?.affix).toBe('Keen');
    expect(stacks.slots[1]?.affix).toBe('Swift');
  });
});
