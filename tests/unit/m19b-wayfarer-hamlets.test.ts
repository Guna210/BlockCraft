import { describe, expect, it } from 'vitest';
import { deriveSeed } from '../../src/engine/rng';
import { BlockCollision } from '../../src/entity/physics';
import { ItemEntityManager } from '../../src/entity/item-entity';
import { Player } from '../../src/entity/player';
import { Inventory } from '../../src/gameplay/inventory';
import { blockLoot, blockLootTable, rollBlockLoot } from '../../src/gameplay/loot';
import { chestLootTable, rollChestLootById } from '../../src/gameplay/chest-loot';
import { dropInventoryStack } from '../../src/gameplay/inventory-drop';
import { spillChestContents, type ChestEntityState } from '../../src/gameplay/chests';
import { items } from '../../src/gameplay/items';
import { WAYFARER_HAMLET_REGISTRATIONS } from '../../src/gen/structures/wayfarer-hamlet';
import { createPlacementGrid } from '../../src/gen/structures/placement';
import { createStructureStage } from '../../src/gen/structures/stage';
import { adaptPieceToTerrain } from '../../src/gen/structures/adapt';
import { sampleTerrainTopY } from '../../src/gen/terrain-height';
import { withTerrainVariant, type TerrainVariant } from '../../src/gen/world-options';
import { textureGenerators, texturePalettes } from '../../src/render/textures/index';
import { buildIconSheet } from '../../src/ui/icons';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { ChunkColumn } from '../../src/world/column';
import { World } from '../../src/world/world';

const registration = WAYFARER_HAMLET_REGISTRATIONS[0]!;

function findHamletStart(variant: TerrainVariant, preferredSeed = 42) {
  return withTerrainVariant(variant, () => {
    for (let seed = preferredSeed; seed < preferredSeed + 100; seed++) {
      const grid = createPlacementGrid(
        seed,
        [registration.config],
        variant.type === 'flat' ? () => 'plains' : undefined,
      );
      const start = grid.locateNearest('wayfarer_hamlet', [0, 64, 0], 2000);
      if (start) return { seed, start };
    }
    throw new Error('Could not find a test hamlet start within 2000 blocks');
  });
}

function generateHamlet(
  seed: number,
  start: { x: number; z: number },
  variant: TerrainVariant,
  reverse = false,
): Map<string, number> {
  const minCX = Math.floor((start.x - 16) / 16);
  const maxCX = Math.floor((start.x + 64) / 16);
  const minCZ = Math.floor((start.z - 16) / 16);
  const maxCZ = Math.floor((start.z + 64) / 16);
  const coords: Array<[number, number]> = [];
  for (let cz = minCZ; cz <= maxCZ; cz++)
    for (let cx = minCX; cx <= maxCX; cx++) coords.push([cx, cz]);
  if (reverse) coords.reverse();
  const stage = createStructureStage(WAYFARER_HAMLET_REGISTRATIONS);
  const cells = new Map<string, number>();
  withTerrainVariant(variant, () => {
    for (const [cx, cz] of coords) {
      const column = new ChunkColumn(cx, cz);
      column.worldSeed = seed;
      const write = column.setBlockStateId.bind(column);
      column.setBlockStateId = (x, y, z, stateId) => {
        write(x, y, z, stateId);
        cells.set(`${cx * 16 + x},${y},${cz * 16 + z}`, stateId);
      };
      stage.generate(deriveSeed(seed, 'structures'), cx, cz, column);
    }
  });
  return cells;
}

describe('M19b Wayfarer Hamlet blocks and loot', () => {
  it('registers farmland and all eight static crop states with their generated icons and drops', () => {
    const registry = BlockRegistry.getInstance();
    expect(registry.getDefaultStateId('farmland')).toBe(811);
    expect(registry.getBlockDefinition('farmland')?.fullOpaqueCube).toBe(true);
    expect(items.get('farmland').block).toBe('farmland');
    expect(items.get('wheat_crop').block).toBe('wheat_crop');
    expect(registry.getBlockDefinition('wheat_crop')).toMatchObject({
      renderLayer: 'cutout',
      fullOpaqueCube: false,
      model: 'cross',
    });
    for (let age = 0; age <= 7; age++) {
      expect(registry.getStateId('wheat_crop', { age: String(age) })).toBe(812 + age);
      const texture = `wheat_crop_${age}`;
      expect(textureGenerators[texture]).toBeDefined();
      expect(texturePalettes[texture]).toBeDefined();
      expect(textureGenerators[texture]!()).toEqual(textureGenerators[texture]!());
    }
    for (const texture of ['farmland_top', 'farmland_side']) {
      expect(textureGenerators[texture]).toBeDefined();
      expect(texturePalettes[texture]).toBeDefined();
      expect(textureGenerators[texture]!()).toEqual(textureGenerators[texture]!());
    }
    const generatedTiles = new Map(
      Object.entries(textureGenerators).map(([name, generate]) => {
        const generated = generate(42);
        return [name, Array.isArray(generated) ? generated[0]! : generated] as const;
      }),
    );
    const iconSheet = buildIconSheet(
      (name) => generatedTiles.get(name),
      new Uint8Array(16 * 16 * 4),
    );
    expect(iconSheet.rects.has('farmland')).toBe(true);
    expect(iconSheet.rects.has('wheat_crop')).toBe(true);
    expect(blockLoot('wheat_crop')).toEqual([{ id: 'wheat', count: 1, min: 1, max: 3 }]);
    expect(blockLoot('farmland')).toEqual([{ id: 'dirt', count: 1 }]);
    expect(rollBlockLoot('wheat_crop', 42, 1, 65, 2)).toEqual(
      rollBlockLoot('wheat_crop', 42, 1, 65, 2),
    );
    expect(blockLootTable('wayfarer_hamlet')).toBeUndefined();
    expect(chestLootTable('wayfarer_hamlet')?.entries.some((entry) => entry.affixChance)).toBe(
      true,
    );
    expect(rollChestLootById('wayfarer_hamlet', 42, 1, 65, 2)).toEqual(
      rollChestLootById('wayfarer_hamlet', 42, 1, 65, 2),
    );
  });

  it('registers four original houses, a farm, a well, a lookout and six connected entrances', () => {
    const templateNames = registration.templates.map((template) => template.name);
    expect(
      templateNames.filter(
        (name) =>
          name.endsWith('cottage') ||
          name.endsWith('house') ||
          name.endsWith('home') ||
          name.endsWith('wayhouse'),
      ),
    ).toHaveLength(4);
    expect(templateNames).toContain('abandoned_crop_farm');
    expect(templateNames).toContain('broken_lookout');
    const center = registration.templates.find((template) => template.name === 'hamlet_center')!;
    expect(center.connectors).toHaveLength(6);
    expect(center.blocks.palette).toContain('water');
    expect(center.blocks.palette).toContain('chest');
    expect(registration.config).toMatchObject({ spacing: 34, separation: 16 });
  });

  it('supports only occupied template columns when a sparse footprint is supplied', () => {
    const supports = adaptPieceToTerrain(
      42,
      { position: [20, 74, 30], size: [4, 2, 4] },
      {
        foundationBlock: 'cobblestone',
        supportFootprint: [
          [1, 2],
          [2, 2],
        ],
      },
      () => 70,
    );
    expect(supports).toHaveLength(6);
    expect(new Set(supports.map((block) => `${block.x},${block.z}`))).toEqual(
      new Set(['21,32', '22,32']),
    );
  });

  it.each([
    { type: 'default' },
    { type: 'flat' },
    { type: 'amplified' },
    { type: 'single_biome', biome: 'plains' },
  ] satisfies TerrainVariant[])(
    'generates non-buried, repeatable houses on $type terrain',
    (variant) => {
      const { seed, start } = findHamletStart(variant);
      const forward = generateHamlet(seed, start, variant);
      const reverse = generateHamlet(seed, start, variant, true);
      expect([...reverse.entries()].sort()).toEqual([...forward.entries()].sort());

      const registry = BlockRegistry.getInstance();
      const doors = [...forward.entries()]
        .map(([coordinate, stateId]) => ({
          coordinate,
          state: registry.getResolvedState(stateId)!,
        }))
        .filter(
          ({ state }) => state.blockId === 'oak_door' && state.properties['half'] === 'lower',
        );
      expect(doors.length).toBeGreaterThanOrEqual(4);
      withTerrainVariant(variant, () => {
        for (const { coordinate } of doors) {
          const [x, y, z] = coordinate.split(',').map(Number);
          const surface =
            variant.type === 'flat'
              ? 64
              : sampleTerrainTopY(deriveSeed(seed, 'terrain_shape'), x!, z!)!;
          expect(y).toBeGreaterThan(surface);
        }
      });
      const generatedBlockIds = new Set(
        [...forward.values()].map((stateId) => registry.getResolvedState(stateId)?.blockId),
      );
      expect(generatedBlockIds.has('farmland')).toBe(true);
      expect(generatedBlockIds.has('wheat_crop')).toBe(true);
      expect(generatedBlockIds.has('ladder')).toBe(true);
      expect(generatedBlockIds.has('water')).toBe(true);
    },
  );
});

describe('M19b item affix carry-through', () => {
  it('preserves damage and affix when dropping, picking up and breaking a chest', () => {
    const world = new World(false);
    world.fill(-1, 64, -1, 1, 64, 1, 'stone');
    const player = new Player(new BlockCollision(world), () => true);
    player.teleport(0.5, 65, 0.5, 0, 0);
    player.tick();

    const droppedItems = new ItemEntityManager(world);
    const inventory = new Inventory();
    inventory.insert('iron_pickaxe', 1, { damage: 19, affix: 'Keen' });
    const dropped = dropInventoryStack(inventory, droppedItems, [0.5, 66, 0.5], 0)!;
    expect(dropped).toMatchObject({ id: 'iron_pickaxe', damage: 19, affix: 'Keen' });
    expect(droppedItems.pool[0]).toMatchObject({ damage: 19, affix: 'Keen' });

    const pickupItems = new ItemEntityManager(world);
    const entity = pickupItems.spawn('iron_pickaxe', 1, 0.5, 66, 0.5, undefined, {
      damage: 23,
      affix: 'Swift',
    })!;
    for (let tick = 0; tick < 30 && entity.active; tick++) pickupItems.tick(player);
    expect(entity.active).toBe(false);
    expect(player.inventory.slots.find((stack) => stack?.id === 'iron_pickaxe')).toMatchObject({
      damage: 23,
      affix: 'Swift',
    });

    world.setBlock(2, 65, 2, 'chest', { facing: 'north', pair: 'single' });
    const chest = world.getBlockEntity<ChestEntityState>(2, 65, 2)!;
    chest.slots[0] = { id: 'stone_pickaxe', count: 1, damage: 11, affix: 'Sturdy' };
    const chestItems = new ItemEntityManager(world);
    expect(spillChestContents(world, chestItems, 2, 65, 2)).toBe(true);
    expect(chestItems.pool[0]).toMatchObject({
      item: { id: 'stone_pickaxe' },
      damage: 11,
      affix: 'Sturdy',
    });
  });
});
