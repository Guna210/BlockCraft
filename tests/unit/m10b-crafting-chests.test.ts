import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crafting } from '../../src/gameplay/crafting';
import {
  fillRecipe,
  takeCraftingOutput,
  type CraftingSlot,
} from '../../src/gameplay/crafting-session';
import { Inventory } from '../../src/gameplay/inventory';
import { blockLoot } from '../../src/gameplay/loot';
import { blockEntityRegistry } from '../../src/world/block-entities';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { World } from '../../src/world/world';
import {
  registerChestBlockEntity,
  chestStorageAt,
  type ChestEntityState,
} from '../../src/gameplay/chests';
import { PlayerController } from '../../src/engine/player-controller';
import { Camera } from '../../src/render/camera';
import { InputEngine } from '../../src/engine/input';
import { items } from '../../src/gameplay/items';

describe('M10b blocks, crafting sessions and chests', () => {
  beforeEach(() => {
    blockEntityRegistry.clear();
    registerChestBlockEntity();
  });

  afterEach(() => blockEntityRegistry.clear());

  it('registers workbench and chest with hardness 2.5, item icons, self-drops and appended states', () => {
    const blocks = BlockRegistry.getInstance();
    expect(blocks.getBlockDefinition('workbench')?.hardness).toBe(2.5);
    expect(blocks.getBlockDefinition('chest')?.hardness).toBe(2.5);
    expect(items.get('workbench').block).toBe('workbench');
    expect(items.get('chest').block).toBe('chest');
    expect(blockLoot('workbench')).toEqual([{ id: 'workbench', count: 1 }]);
    expect(blockLoot('chest')).toEqual([{ id: 'chest', count: 1 }]);
    expect(blocks.getStateId('workbench')).toBe(145);
    expect(blocks.getStateId('chest', { facing: 'north', pair: 'single' })).toBe(146);
    expect(blocks.getStateId('chest', { facing: 'west', pair: 'right' })).toBe(157);
    expect(blocks.getMaxStateId()).toBe(157);
  });

  it('uses the 2x2 plank recipe and keeps the chest ring recipe 3x3-only', () => {
    expect(
      crafting.match(['oak_planks', 'birch_planks', 'pine_planks', 'rainwood_planks'])?.result,
    ).toEqual({ id: 'workbench', count: 1 });
    const chestGrid = [
      'oak_planks',
      'oak_planks',
      'oak_planks',
      'birch_planks',
      null,
      'pine_planks',
      'oak_planks',
      'oak_planks',
      'acacia_planks',
    ];
    expect(crafting.match(chestGrid)?.result).toEqual({ id: 'chest', count: 1 });
    expect(crafting.match(['oak_planks', 'oak_planks', 'oak_planks', 'oak_planks'])?.id).not.toBe(
      'chest',
    );
  });

  it('auto-fills from storage, leaves state untouched when ingredients are missing, and shift-crafts the maximum', () => {
    const inventory = new Inventory();
    inventory.insert('oak_planks', 8);
    const empty: CraftingSlot[] = Array.from({ length: 4 }, () => null);
    const workbench = crafting.recipes.get('workbench')!;
    const fill = fillRecipe(workbench, 2, empty, inventory.slots)!;
    expect(fill.crafts).toBe(2);
    expect(fill.grid).toEqual(Array.from({ length: 4 }, () => ({ id: 'oak_planks', count: 2 })));
    expect(fill.inventory[0]).toBeNull();

    const shiftedInventory = new Inventory();
    const grid = fill.grid.map((stack) => (stack ? { ...stack } : null));
    expect(takeCraftingOutput(grid, shiftedInventory, true)).toBe(2);
    expect(grid).toEqual([null, null, null, null]);
    expect(shiftedInventory.slots[0]).toMatchObject({ id: 'workbench', count: 2 });

    const pickaxe = crafting.recipes.get('wooden_pickaxe')!;
    const before = inventory.snapshot(true);
    expect(fillRecipe(pickaxe, 2, empty, inventory.slots)).toBeNull();
    expect(inventory.snapshot(true)).toEqual(before);
    expect(empty).toEqual([null, null, null, null]);
  });

  it('pairs exactly two same-facing adjacent chests and presents their slots in left-to-right order', () => {
    const world = new World(false);
    world.getColumn(0, 0, true);
    world.setBlock(4, 64, 4, 'chest', { facing: 'north', pair: 'single' });
    world.setBlock(5, 64, 4, 'chest', { facing: 'north', pair: 'single' });
    expect(world.getBlock(4, 64, 4).state.pair).toBe('left');
    expect(world.getBlock(5, 64, 4).state.pair).toBe('right');

    const storage = chestStorageAt(world, 5, 64, 4)!;
    expect(storage.double).toBe(true);
    expect(storage.halves).toEqual([
      world.getBlockEntity(4, 64, 4),
      world.getBlockEntity(5, 64, 4),
    ]);
    expect(storage.halves[0]!.slots).toHaveLength(27);
    expect(storage.halves[1]!.slots).toHaveLength(27);

    world.setBlock(6, 64, 4, 'chest', { facing: 'north', pair: 'single' });
    expect(world.getBlock(6, 64, 4).state.pair).toBe('single');
    expect(chestStorageAt(world, 4, 64, 4)?.halves).toHaveLength(2);
  });

  it('spills only the broken chest half and leaves its former partner as a single chest', () => {
    const world = new World(false);
    world.getColumn(0, 0, true);
    world.fill(-4, 64, -4, 8, 64, 8, 'stone');
    world.setBlock(2, 66, 0, 'chest', { facing: 'north', pair: 'single' });
    world.setBlock(3, 66, 0, 'chest', { facing: 'north', pair: 'single' });
    world.getBlockEntity<ChestEntityState>(2, 66, 0)!.slots[0] = { id: 'apple', count: 3 };
    world.getBlockEntity<ChestEntityState>(3, 66, 0)!.slots[0] = { id: 'stick', count: 2 };

    const controller = new PlayerController(
      new Camera(1),
      new InputEngine(document.createElement('canvas')),
      () => true,
    );
    controller.spawn(world, 0.5, 65, 0.5, 'creative');
    controller.loop.pause();
    controller.interaction!.input('attack', true);
    controller.tick(1);

    const drops = controller.itemEntities!.pool.filter((entity) => entity.active);
    expect(drops.map(({ item, count }) => [item.id, count])).toEqual([['apple', 3]]);
    expect(world.getBlock(2, 66, 0).id).toBe('air');
    expect(world.getBlock(3, 66, 0).state.pair).toBe('single');
    expect(world.getBlockEntity<ChestEntityState>(3, 66, 0)?.slots[0]).toEqual({
      id: 'stick',
      count: 2,
    });
  });

  it('keeps a chest intact when its contents cannot all become item entities', () => {
    const world = new World(false);
    world.getColumn(0, 0, true);
    world.fill(-4, 64, -4, 8, 64, 8, 'stone');
    world.setBlock(2, 66, 0, 'chest');
    world.getBlockEntity<ChestEntityState>(2, 66, 0)!.slots[0] = { id: 'apple', count: 3 };
    world.getBlockEntity<ChestEntityState>(2, 66, 0)!.slots[1] = { id: 'stick', count: 2 };

    const controller = new PlayerController(
      new Camera(1),
      new InputEngine(document.createElement('canvas')),
      () => true,
    );
    controller.spawn(world, 0.5, 65, 0.5, 'creative');
    controller.loop.pause();
    controller.itemEntities!.pool.forEach((entity) => (entity.active = true));
    controller.interaction!.input('attack', true);
    controller.interaction!.tick();

    expect(world.getBlock(2, 66, 0).id).toBe('chest');
    expect(world.getBlockEntity<ChestEntityState>(2, 66, 0)?.slots.slice(0, 2)).toEqual([
      { id: 'apple', count: 3 },
      { id: 'stick', count: 2 },
    ]);
  });
});
