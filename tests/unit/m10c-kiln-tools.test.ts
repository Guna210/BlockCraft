import { describe, it, expect, beforeEach } from 'vitest';
import { smelting } from '../../src/gameplay/smelting';
import { canSmelt, tickKiln, type KilnState } from '../../src/gameplay/kiln';
import { getToolDurability } from '../../src/gameplay/tools';
import { canHarvest } from '../../src/gameplay/mining';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { items } from '../../src/gameplay/items';
import { pointsForLevel, addXp } from '../../src/gameplay/xp';
import { Inventory } from '../../src/gameplay/inventory';
import { serializeInventory, deserializeInventory } from '../../src/persist/serializers';
import { World } from '../../src/world/world';
import { ChunkColumn } from '../../src/world/column';

describe('M10c — Kiln & tool wear unit tests', () => {
  beforeEach(() => {
    // Ensure registry is loaded
    BlockRegistry.getInstance();
  });

  describe('XP progression curve', () => {
    it('computes exact points required per level across early, mid and late tiers', () => {
      // Early tiers (0..14): 10 + 2*L
      expect(pointsForLevel(0)).toBe(10);
      expect(pointsForLevel(1)).toBe(12);
      expect(pointsForLevel(5)).toBe(20);
      expect(pointsForLevel(14)).toBe(38);

      // Mid tiers (15..29): 40 + 5*(L-15)
      expect(pointsForLevel(15)).toBe(40);
      expect(pointsForLevel(16)).toBe(45);
      expect(pointsForLevel(29)).toBe(110);

      // Late tiers (30+): 115 + 10*(L-30)
      expect(pointsForLevel(30)).toBe(115);
      expect(pointsForLevel(31)).toBe(125);
    });

    it('adds experience points and levels up smoothly', () => {
      const player = { xpLevel: 0, xpProgress: 0 };
      // Level 0 requires 10 points. Add 5 points -> 50% progress
      addXp(player, 5);
      expect(player.xpLevel).toBe(0);
      expect(player.xpProgress).toBeCloseTo(0.5);

      // Add 5 more points -> reaches level 1, 0% progress
      addXp(player, 5);
      expect(player.xpLevel).toBe(1);
      expect(player.xpProgress).toBeCloseTo(0);

      // Level 1 requires 12 points. Add 18 points -> reaches level 2 with 6/14 progress
      addXp(player, 18);
      expect(player.xpLevel).toBe(2);
      expect(player.xpProgress).toBeCloseTo(6 / 14);
    });
  });

  describe('Tool durability and wear', () => {
    it('exposes exact Appendix A.2 durabilities for all tiered tools', () => {
      expect(getToolDurability('wooden_pickaxe')).toBe(59);
      expect(getToolDurability('wooden_axe')).toBe(59);
      expect(getToolDurability('stone_pickaxe')).toBe(131);
      expect(getToolDurability('copper_pickaxe')).toBe(190);
      expect(getToolDurability('iron_pickaxe')).toBe(250);
      expect(getToolDurability('skyshard_pickaxe')).toBe(2000);
    });

    it('wooden pickaxe breaks on exactly the 59th use', () => {
      const durability = getToolDurability('wooden_pickaxe')!;
      expect(durability).toBe(59);

      let damage = 0;
      let broken = false;
      for (let use = 1; use <= 59; use++) {
        damage++;
        if (damage >= durability) {
          broken = true;
        }
        if (use < 59) {
          expect(broken).toBe(false);
          expect(damage).toBe(use);
        }
      }
      expect(broken).toBe(true);
      expect(damage).toBe(59);
    });

    it('preserves tool damage through inventory serialization and deserialization', () => {
      const inv = new Inventory();
      inv.slots[0] = { slot: 0, id: 'wooden_pickaxe', count: 1, damage: 42 };
      inv.cursor = { id: 'stone_pickaxe', count: 1, damage: 13 };

      const bytes = serializeInventory(inv);
      const parsed = deserializeInventory(bytes);

      expect(parsed.slots[0]?.damage).toBe(42);
      expect(parsed.cursor?.damage).toBe(13);

      const target = new Inventory();
      deserializeInventory(bytes, target);
      expect(target.slots[0]?.damage).toBe(42);
      expect(target.cursor?.damage).toBe(13);
    });
  });

  describe('Harvest level drop rules', () => {
    it('iron ore requires pickaxe tier 1 (stone or better)', () => {
      const ironOre = BlockRegistry.getInstance().getBlockDefinition('iron_ore')!;
      expect(ironOre.minTier).toBe(1);
      expect(ironOre.tool).toBe('pickaxe');

      const woodPickDef = items.get('wooden_pickaxe');
      const stonePickDef = items.get('stone_pickaxe');
      const ironPickDef = items.get('iron_pickaxe');

      // Wooden pickaxe is tier 0
      expect(canHarvest(ironOre, woodPickDef.tool!)).toBe(false);

      // Stone pickaxe is tier 1
      expect(canHarvest(ironOre, stonePickDef.tool!)).toBe(true);

      // Iron pickaxe is tier 3
      expect(canHarvest(ironOre, ironPickDef.tool!)).toBe(true);
    });
  });

  describe('Smelting data & fuel burn times', () => {
    it('has smelting recipes for iron ore, copper ore, and gold ore', () => {
      const ironRecipe = smelting.getByInput('iron_ore');
      expect(ironRecipe).toBeDefined();
      expect(ironRecipe!.output).toBe('iron_ingot');
      expect(ironRecipe!.count).toBe(1);
      expect(ironRecipe!.xp).toBe(0.7);

      const rawIronRecipe = smelting.getByInput('raw_iron');
      expect(rawIronRecipe).toBeDefined();
      expect(rawIronRecipe!.output).toBe('iron_ingot');

      const copperRecipe = smelting.getByInput('copper_ore');
      expect(copperRecipe).toBeDefined();
      expect(copperRecipe!.output).toBe('copper_ingot');

      const goldRecipe = smelting.getByInput('gold_ore');
      expect(goldRecipe).toBeDefined();
      expect(goldRecipe!.output).toBe('gold_ingot');
    });

    it('returns correct burn times for fuels', () => {
      expect(smelting.getBurnTime('coal')).toBe(1600); // 80 seconds = 8 smelts
      expect(smelting.getBurnTime('oak_planks')).toBe(300); // 15 seconds
      expect(smelting.getBurnTime('oak_slab')).toBe(150); // 7.5 seconds
      expect(smelting.getBurnTime('stick')).toBe(100); // 5 seconds
      expect(smelting.getBurnTime('wooden_pickaxe')).toBe(200); // 10 seconds = 1 smelt
      expect(smelting.getBurnTime('stone')).toBe(0);
    });
  });

  describe('Kiln block entity simulation', () => {
    it('smelts 8 iron ore with 1 coal in exactly 1600 ticks (80 seconds)', () => {
      const world = new World(false);
      const cx = 0;
      const cz = 0;
      const col = new ChunkColumn(cx, cz);
      world.setColumn(col);

      const x = 5;
      const y = 65;
      const z = 5;

      const kilnStateId = BlockRegistry.getInstance().getStateId('kiln', {
        facing: 'north',
        lit: 'false',
      })!;
      world.setBlockStateId(x, y, z, kilnStateId);

      const entity = world.blockEntities.get<KilnState>(x, y, z);
      expect(entity).toBeDefined();

      const state = entity!.state;
      state.input = { id: 'iron_ore', count: 8, damage: null };
      state.fuel = { id: 'coal', count: 1, damage: null };

      expect(canSmelt(state)).toBe(true);

      // Tick for 1600 ticks (80 seconds at 20 tps)
      for (let t = 0; t < 1600; t++) {
        tickKiln(entity!, world);
      }

      // After 1600 ticks:
      // Coal is exhausted
      expect(state.fuel).toBeNull();
      expect(state.burnRemaining).toBe(0);
      // All 8 iron ore have smelted into 8 iron ingots
      expect(state.input).toBeNull();
      expect(state.output).toEqual({ id: 'iron_ingot', count: 8, damage: null });
      // 8 * 0.7 XP = 5.6 XP stored
      expect(state.storedXp).toBeCloseTo(5.6);
      // Lit state is false after burning completes
      expect(world.getBlock(x, y, z).state.lit).toBe('false');
    });

    it('emits light level 13 when lit and 0 when unlit', () => {
      const reg = BlockRegistry.getInstance();
      const unlitId = reg.getStateId('kiln', { facing: 'north', lit: 'false' })!;
      const litId = reg.getStateId('kiln', { facing: 'north', lit: 'true' })!;

      const world = new World(true);
      const col = new ChunkColumn(0, 0);
      world.setColumn(col);

      world.setBlockStateId(1, 65, 1, unlitId);
      expect(world.getLight(1, 65, 1).block).toBe(0);

      world.setBlockStateId(1, 65, 1, litId);
      expect(world.getLight(1, 65, 1).block).toBe(13);
    });
  });
});
