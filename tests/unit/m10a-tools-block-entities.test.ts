import { afterEach, describe, expect, it } from 'vitest';
import {
  ARMOR_DEFENSE,
  TOOL_TIERS,
  getArmorDefense,
  getAttackDamage,
  getHarvestLevel,
  getMiningSpeed,
  getToolDurability,
  getTotalArmorDefense,
} from '../../src/gameplay/tools';
import { blockEntityRegistry } from '../../src/world/block-entities';
import { World } from '../../src/world/world';
import { Camera } from '../../src/render/camera';
import { InputEngine } from '../../src/engine/input';
import { PlayerController } from '../../src/engine/player-controller';

describe('M10a tools & armor queries', () => {
  it('exposes Appendix A.2 tier stats, durabilities, and attack damage for all 25 tiered tools and special tools', () => {
    expect(TOOL_TIERS).toEqual({
      wood: {
        name: 'wood',
        harvestLevel: 0,
        miningSpeed: 2,
        durability: 59,
        swordDamage: 4,
        craftedFrom: '#any_planks',
      },
      stone: {
        name: 'stone',
        harvestLevel: 1,
        miningSpeed: 4,
        durability: 131,
        swordDamage: 5,
        craftedFrom: 'cobblestone',
      },
      copper: {
        name: 'copper',
        harvestLevel: 2,
        miningSpeed: 5,
        durability: 190,
        swordDamage: 5,
        craftedFrom: 'copper_ingot',
      },
      iron: {
        name: 'iron',
        harvestLevel: 3,
        miningSpeed: 6,
        durability: 250,
        swordDamage: 6,
        craftedFrom: 'iron_ingot',
      },
      skyshard: {
        name: 'skyshard',
        harvestLevel: 4,
        miningSpeed: 9,
        durability: 2000,
        swordDamage: 8,
        craftedFrom: 'skyshard_crystal',
      },
    });

    for (const [prefix, level, speed, durability, swordDmg] of [
      ['wooden', 0, 2, 59, 4],
      ['stone', 1, 4, 131, 5],
      ['copper', 2, 5, 190, 5],
      ['iron', 3, 6, 250, 6],
      ['skyshard', 4, 9, 2000, 8],
    ] as const) {
      expect(getHarvestLevel(`${prefix}_pickaxe`)).toBe(level);
      expect(getMiningSpeed(`${prefix}_pickaxe`)).toBe(speed);
      expect(getToolDurability(`${prefix}_pickaxe`)).toBe(durability);

      expect(getAttackDamage(`${prefix}_sword`)).toBe(swordDmg);
      expect(getAttackDamage(`${prefix}_axe`)).toBe(swordDmg - 1);
      expect(getAttackDamage(`${prefix}_pickaxe`)).toBe(swordDmg - 2);
      expect(getAttackDamage(`${prefix}_shovel`)).toBe(swordDmg - 3);
      expect(getAttackDamage(`${prefix}_hoe`)).toBe(1);
    }

    expect(getToolDurability('iron_shears')).toBe(250);
    expect(getToolDurability('bow')).toBe(384);
    expect(getToolDurability('shield')).toBe(336);
    expect(getToolDurability('ember_flint')).toBe(64);
    expect(getToolDurability('dirt')).toBeNull();
    expect(getAttackDamage(null)).toBe(1);
    expect(getMiningSpeed(null)).toBe(1);
  });

  it('exposes copper and iron armor defense points without mutating item registry properties', () => {
    expect(ARMOR_DEFENSE).toEqual({
      copper_helmet: 2,
      copper_chestplate: 4,
      copper_leggings: 3,
      copper_boots: 1,
      iron_helmet: 2,
      iron_chestplate: 6,
      iron_leggings: 5,
      iron_boots: 2,
    });

    expect(
      getTotalArmorDefense([
        'copper_helmet',
        'copper_chestplate',
        'copper_leggings',
        'copper_boots',
      ]),
    ).toBe(10);
    expect(
      getTotalArmorDefense(['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots']),
    ).toBe(15);
    expect(getArmorDefense('dirt')).toBe(0);
  });
});

describe('M10a block-entity framework', () => {
  afterEach(() => {
    blockEntityRegistry.clear();
  });

  it('creates plain-JSON state on placement, removes on break or column unload, and ticks only in loaded chunks via ticks.ts', () => {
    interface TestCounterState {
      ticks: number;
      label: string;
      history: number[];
      [key: string]: string | number | boolean | null | number[];
    }

    blockEntityRegistry.register<TestCounterState>({
      blockId: 'lumite_block',
      create: (x, y, z) => ({
        ticks: 0,
        label: `be:${x},${y},${z}`,
        history: [],
      }),
      tick: (entity, world) => {
        entity.state.ticks++;
        entity.state.history.push(world.ticks.time);
      },
    });

    const world = new World(false);
    world.getColumn(0, 0, true);
    world.getColumn(1, 0, true);

    // Place block entity in chunk (0, 0) and chunk (1, 0)
    world.setBlock(4, 64, 4, 'lumite_block');
    world.setBlock(20, 64, 4, 'lumite_block');

    expect(world.blockEntities.count).toBe(2);
    expect(world.getBlockEntity<TestCounterState>(4, 64, 4)).toEqual({
      ticks: 0,
      label: 'be:4,64,4',
      history: [],
    });

    // Advance 3 world ticks via ticks.ts
    world.tick();
    world.tick();
    world.tick();

    expect(world.getBlockEntity<TestCounterState>(4, 64, 4)?.ticks).toBe(3);
    expect(world.getBlockEntity<TestCounterState>(4, 64, 4)?.history).toEqual([1, 2, 3]);
    expect(world.getBlockEntity<TestCounterState>(20, 64, 4)?.ticks).toBe(3);

    // Unload column (1, 0): removes the block entity at (20, 64, 4) and its scheduled tick
    world.removeColumn(1, 0);
    expect(world.blockEntities.count).toBe(1);
    expect(world.getBlockEntity(20, 64, 4)).toBeUndefined();

    // Further ticks only advance the remaining loaded block entity in (0, 0)
    world.tick();
    world.tick();
    expect(world.getBlockEntity<TestCounterState>(4, 64, 4)?.ticks).toBe(5);
    expect(world.hasColumn(1, 0)).toBe(false);

    // Breaking the block removes its block entity and stops future ticks
    world.setBlock(4, 64, 4, 'air');
    expect(world.blockEntities.count).toBe(0);
    expect(world.getBlockEntity(4, 64, 4)).toBeUndefined();
    world.tick();
    expect(world.ticks.count).toBe(0);
  });

  it('stops ticking while paused and advances exact ticks via controller.tick(n)', () => {
    blockEntityRegistry.register({
      blockId: 'lumite_block',
      create: () => ({ count: 0 }),
      tick: (entity) => {
        entity.state.count = (entity.state.count as number) + 1;
      },
    });

    const world = new World(false);
    world.fill(-2, 64, -2, 2, 64, 2, 'stone');
    const controller = new PlayerController(
      new Camera(1),
      new InputEngine(document.createElement('canvas')),
      () => true,
    );
    controller.spawn(world, 0.5, 65, 0.5, 'survival');

    world.setBlock(1, 65, 1, 'lumite_block');
    expect(world.getBlockEntity(1, 65, 1)).toEqual({ count: 0 });

    // Pause simulation loop: frame() must not advance block-entity ticks
    controller.loop.pause();
    controller.frame(0.5);
    expect(world.getBlockEntity(1, 65, 1)).toEqual({ count: 0 });

    // Stepping with controller.tick(n) (used by debug.tick(n)) advances exact ticks while paused
    controller.tick(7);
    expect(world.getBlockEntity(1, 65, 1)).toEqual({ count: 7 });
  });
});
