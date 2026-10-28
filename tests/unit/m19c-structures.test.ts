import { describe, expect, it } from 'vitest';
import { deriveSeed } from '../../src/engine/rng';
import { BlockCollision } from '../../src/entity/physics';
import { Player, SILKMESH_SPEED_FACTOR } from '../../src/entity/player';
import { registerEntityType } from '../../src/entity/ecs/entity-types';
import { EntityKindC, TransformC } from '../../src/entity/ecs/components';
import { MOB_CAPS, SpawnRuleRegistry } from '../../src/entity/spawning';
import '../../src/entity/mobs';
import { blockLoot } from '../../src/gameplay/loot';
import { chestLootTable, rollChestLootById } from '../../src/gameplay/chest-loot';
import { canHarvest, type MiningTool } from '../../src/gameplay/mining';
import { items } from '../../src/gameplay/items';
import {
  SPAWNER_ACTIVATION_RANGE,
  SPAWNER_FAR_INTERVAL,
  SPAWNER_MAX_DELAY,
  SPAWNER_MIN_DELAY,
  SPAWNER_NEAR_INTERVAL,
  SPAWNER_NEARBY_CAP,
  SPAWNER_SPAWN_RADIUS,
  spawnerMiniatures,
  spawnerTickDelay,
  tickSpawner,
  type SpawnerState,
} from '../../src/gameplay/spawners';
import { applyStructureMarkers } from '../../src/gameplay/structure-markers';
import type { ChestEntityState } from '../../src/gameplay/chests';
import '../../src/gameplay/chests';
import {
  assembleJigsaw,
  getPlacedPieceAabb,
  structureAabbsIntersect,
} from '../../src/gen/structures/jigsaw';
import { createPlacementGrid } from '../../src/gen/structures/placement';
import { STRUCTURE_REGISTRATIONS } from '../../src/gen/structures/registrations';
import {
  createStructureStage,
  structureStartY,
  type StructureMarker,
  type StructureRegistration,
} from '../../src/gen/structures/stage';
import {
  CRYPT_SPAWNER_CREATURES,
  SUNKEN_CRYPT_REGISTRATION,
} from '../../src/gen/structures/sunken-crypt';
import { SPIRE_RUIN_REGISTRATION } from '../../src/gen/structures/spire-ruin';
import { MINESHAFT_WARREN_REGISTRATION } from '../../src/gen/structures/mineshaft-warren';
import { createDefaultPipeline } from '../../src/gen/pipeline';
import { sampleTerrainTopY } from '../../src/gen/terrain-height';
import { withTerrainVariant, type TerrainVariant } from '../../src/gen/world-options';
import { textureGenerators, texturePalettes } from '../../src/render/textures/index';
import { buildIconSheet } from '../../src/ui/icons';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { ChunkColumn } from '../../src/world/column';
import { World } from '../../src/world/world';
import blockStateIds from '../../data/block-state-ids.json';
import { GROUND, flatWorld, makeMob, scene } from './helpers/m13c-mobs';

const DEFAULT: TerrainVariant = { type: 'default' };
const M19C = [SUNKEN_CRYPT_REGISTRATION, SPIRE_RUIN_REGISTRATION, MINESHAFT_WARREN_REGISTRATION];

function findStart(registration: StructureRegistration, preferredSeed = 42) {
  return withTerrainVariant(DEFAULT, () => {
    for (let seed = preferredSeed; seed < preferredSeed + 200; seed++) {
      const start = createPlacementGrid(seed, [registration.config]).locateNearest(
        registration.config.id,
        [0, 64, 0],
        2000,
      );
      if (start) return { seed, start };
    }
    throw new Error('No ' + registration.config.id + ' start within 2000 blocks');
  });
}

interface Generated {
  cells: Map<string, number>;
  markers: StructureMarker[];
}

/** Runs only the structures stage over the columns around a start, recording what it writes. */
function generate(
  registration: StructureRegistration,
  seed: number,
  start: { x: number; z: number },
  reverse = false,
): Generated {
  const reach = 96;
  const coords: Array<[number, number]> = [];
  for (let cz = Math.floor((start.z - reach) / 16); cz <= Math.floor((start.z + reach) / 16); cz++)
    for (
      let cx = Math.floor((start.x - reach) / 16);
      cx <= Math.floor((start.x + reach) / 16);
      cx++
    )
      coords.push([cx, cz]);
  if (reverse) coords.reverse();
  const stage = createStructureStage([registration]);
  const cells = new Map<string, number>();
  const markers: StructureMarker[] = [];
  withTerrainVariant(DEFAULT, () => {
    for (const [cx, cz] of coords) {
      const column = new ChunkColumn(cx, cz);
      column.worldSeed = seed;
      const write = column.setBlockStateId.bind(column);
      column.setBlockStateId = (x, y, z, stateId) => {
        write(x, y, z, stateId);
        cells.set(`${cx * 16 + x},${y},${cz * 16 + z}`, stateId);
      };
      stage.generate(deriveSeed(seed, 'structures'), cx, cz, column);
      markers.push(...stage.takeMarkers(cx, cz));
    }
  });
  return { cells, markers };
}

function blockAt(cells: Map<string, number>, x: number, y: number, z: number): string | undefined {
  const stateId = cells.get(`${x},${y},${z}`);
  return stateId === undefined
    ? undefined
    : BlockRegistry.getInstance().getResolvedState(stateId)?.blockId;
}

const sortedMarkers = (markers: StructureMarker[]) =>
  [...markers].sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z);

describe('M19c blocks', () => {
  it('appends the spawner, Silkmesh and decorative rail states after 819', () => {
    const registry = BlockRegistry.getInstance();
    const ids = blockStateIds as Record<string, number>;
    expect(Math.max(...Object.values(ids))).toBe(823);
    expect(registry.getDefaultStateId('spawner')).toBe(820);
    expect(registry.getDefaultStateId('silkmesh')).toBe(821);
    expect(registry.getStateId('decorative_rail', { axis: 'x' })).toBe(822);
    expect(registry.getStateId('decorative_rail', { axis: 'z' })).toBe(823);
    expect(registry.getBlockDefinition('silkmesh')).toMatchObject({
      model: 'cross',
      renderLayer: 'cutout',
    });
    expect(registry.getBlockDefinition('decorative_rail')?.model).toBe('trace');
    expect(registry.getBlockDefinition('spawner')?.fullOpaqueCube).toBe(false);
  });

  it('gives every new block a texture, palette, item, icon and drop rule', () => {
    const registry = BlockRegistry.getInstance();
    const textures = ['spawner', 'silkmesh', 'decorative_rail_x', 'decorative_rail_z'];
    for (const texture of textures) {
      expect(textureGenerators[texture]).toBeDefined();
      expect(texturePalettes[texture]).toBeDefined();
      expect(textureGenerators[texture]!(7)).toEqual(textureGenerators[texture]!(7));
    }
    const railX = registry.getStateId('decorative_rail', { axis: 'x' })!;
    const railZ = registry.getStateId('decorative_rail', { axis: 'z' })!;
    expect(registry.getFaceTexture(railX, 'top')).toBe('decorative_rail_x');
    expect(registry.getFaceTexture(railZ, 'top')).toBe('decorative_rail_z');
    const tiles = new Map(
      Object.entries(textureGenerators).map(([name, generateTile]) => {
        const tile = generateTile(42);
        return [name, Array.isArray(tile) ? tile[0]! : tile] as const;
      }),
    );
    const missing: string[] = [];
    const sheet = buildIconSheet(
      (name) => tiles.get(name),
      new Uint8Array(16 * 16 * 4),
      (name) => missing.push(name),
    );
    for (const id of ['spawner', 'silkmesh', 'decorative_rail']) {
      expect(items.get(id).block).toBe(id);
      expect(sheet.rects.has(id)).toBe(true);
    }
    expect(missing.filter((name) => textures.includes(name))).toEqual([]);
    expect(blockLoot('spawner')).toEqual([]);
    expect(blockLoot('silkmesh')).toEqual([{ id: 'silk', count: 1 }]);
    expect(blockLoot('decorative_rail')).toEqual([{ id: 'decorative_rail', count: 1 }]);
  });

  it('Silkmesh needs shears or a sword to drop silk; the rail and spawner a pickaxe', () => {
    const registry = BlockRegistry.getInstance();
    const silkmesh = registry.getBlockDefinition('silkmesh')!;
    const tool = (type: string): MiningTool => ({ type, tier: 1, speed: 4 });
    expect(canHarvest(silkmesh, tool('shears'))).toBe(true);
    expect(canHarvest(silkmesh, tool('sword'))).toBe(true);
    expect(canHarvest(silkmesh, tool('pickaxe'))).toBe(false);
    expect(canHarvest(silkmesh)).toBe(false);
    expect(canHarvest(registry.getBlockDefinition('spawner')!, tool('pickaxe'))).toBe(true);
    expect(canHarvest(registry.getBlockDefinition('spawner')!)).toBe(false);
  });

  it('Silkmesh slows walking to a quarter and catches a fall', () => {
    const run = (mesh: boolean) => {
      const world = new World(false);
      world.fill(-5, 64, -5, 35, 64, 5, 'stone');
      if (mesh) world.fill(-5, 65, -5, 35, 66, 5, 'silkmesh');
      const player = new Player(new BlockCollision(world), () => true);
      player.teleport(0.5, 65, 0.5, 0, 0);
      player.input('forward', true);
      for (let i = 0; i < 60; i++) player.tick();
      return player.pos[0] - 0.5;
    };
    const ratio = run(true) / run(false);
    expect(ratio).toBeGreaterThan(SILKMESH_SPEED_FACTOR - 0.03);
    expect(ratio).toBeLessThan(SILKMESH_SPEED_FACTOR + 0.03);

    const world = new World(false);
    world.fill(-3, 64, -3, 3, 64, 3, 'stone');
    world.fill(-3, 65, -3, 3, 74, 3, 'silkmesh');
    const player = new Player(new BlockCollision(world), () => true);
    player.teleport(0.5, 90, 0.5, 0, 0);
    for (let i = 0; i < 400 && !player.onGround; i++) player.tick();
    expect(player.onGround).toBe(true);
    expect(player.health).toBe(20);
  });
});

describe('M19c structure placement', () => {
  it('registers all three structures with the M19a pipeline behind the Structures toggle', () => {
    const ids = STRUCTURE_REGISTRATIONS.map((registration) => registration.config.id);
    expect(ids).toEqual(['wayfarer_hamlet', 'sunken_crypt', 'spire_ruin', 'mineshaft_warren']);
    expect(SUNKEN_CRYPT_REGISTRATION.config.biomes).not.toContain('ocean');
    expect(SPIRE_RUIN_REGISTRATION.config.biomes).toEqual(['stony_heights', 'frost_peaks']);
    // Off means no structure stage registrations at all: the stage writes nothing.
    const { seed, start } = findStart(SUNKEN_CRYPT_REGISTRATION);
    const off = createDefaultPipeline([])
      .getStages()
      .find((stage) => stage.name === 'structures')!;
    const column = new ChunkColumn(Math.floor(start.x / 16), Math.floor(start.z / 16));
    column.worldSeed = seed;
    let writes = 0;
    column.setBlockStateId = () => {
      writes++;
    };
    withTerrainVariant(DEFAULT, () =>
      off.generate(deriveSeed(seed, 'structures'), column.cx, column.cz, column),
    );
    expect(writes).toBe(0);
  });

  for (const registration of M19C) {
    it(`${registration.config.id} generates the same blocks in any column order and stage`, () => {
      const { seed, start } = findStart(registration);
      const forward = generate(registration, seed, start);
      const reverse = generate(registration, seed, start, true);
      expect(forward.cells.size).toBeGreaterThan(100);
      expect([...reverse.cells.entries()].sort()).toEqual([...forward.cells.entries()].sort());
      expect(sortedMarkers(reverse.markers)).toEqual(sortedMarkers(forward.markers));
      const chests = forward.markers.filter((marker) => marker.kind === 'chest');
      expect(chests.length).toBeGreaterThan(0);
      for (const chest of chests) {
        expect(chest).toMatchObject({ table: registration.lootTable });
        expect(blockAt(forward.cells, chest.x, chest.y, chest.z)).toBe('chest');
      }
    });

    it(`${registration.config.id} pieces never overlap`, () => {
      for (let seed = 1; seed <= 40; seed++) {
        const pieces = assembleJigsaw({
          worldSeed: seed,
          startTemplate: registration.startTemplate,
          startChunk: [seed, -seed],
          templates: registration.templates,
          pools: registration.pools,
          maxDepth: registration.maxDepth,
          maxPieces: registration.maxPieces,
        });
        expect(pieces.length).toBeGreaterThan(1);
        expect(pieces.length).toBeLessThanOrEqual(registration.maxPieces);
        const templates = new Map(registration.templates.map((t) => [t.name, t]));
        const boxes = pieces.map((piece) =>
          getPlacedPieceAabb(templates.get(piece.template)!, piece),
        );
        for (let a = 0; a < boxes.length; a++)
          for (let b = a + 1; b < boxes.length; b++)
            expect(structureAabbsIntersect(boxes[a]!, boxes[b]!)).toBe(false);
      }
    });
  }

  it('buries a crypt with its spawner and two chests far below the ground', () => {
    const { seed, start } = findStart(SUNKEN_CRYPT_REGISTRATION);
    const { cells, markers } = generate(SUNKEN_CRYPT_REGISTRATION, seed, start);
    const floor = structureStartY(
      seed,
      SUNKEN_CRYPT_REGISTRATION,
      start.x,
      start.z,
      start.chunkX,
      start.chunkZ,
    );
    const spawners = markers.filter((marker) => marker.kind === 'spawner');
    expect(spawners).toHaveLength(1);
    const spawner = spawners[0]!;
    expect([spawner.x, spawner.y, spawner.z]).toEqual([start.x + 5, floor + 1, start.z + 5]);
    expect(CRYPT_SPAWNER_CREATURES).toContain(spawner.kind === 'spawner' && spawner.creature);
    expect(blockAt(cells, spawner.x, spawner.y, spawner.z)).toBe('spawner');
    const hallChests = markers.filter(
      (marker) =>
        marker.kind === 'chest' &&
        marker.y === floor + 1 &&
        Math.abs(marker.x - spawner.x) <= 4 &&
        Math.abs(marker.z - spawner.z) <= 4,
    );
    expect(hallChests).toHaveLength(2);
    // The spawner is out of activation range of anyone standing on the ground above the hall.
    const terrainSeed = deriveSeed(seed, 'terrain_shape');
    for (let dx = -5; dx <= 5; dx++)
      for (let dz = -5; dz <= 5; dz++) {
        const ground = sampleTerrainTopY(terrainSeed, spawner.x + dx, spawner.z + dz);
        expect(ground + 1 - (spawner.y + 0.5)).toBeGreaterThan(SPAWNER_ACTIVATION_RANGE);
      }
    // The hall is walled in mossy masonry and its inside is air.
    const walls = new Set<string>();
    for (let dx = -5; dx <= 5; dx++) walls.add(blockAt(cells, spawner.x + dx, floor + 3, start.z)!);
    expect(walls.has('mossy_cobblestone')).toBe(true);
    expect(blockAt(cells, spawner.x, floor + 3, spawner.z)).toBe('air');
  });

  it('decays spire ruins more at the top while keeping the chest and its floor', () => {
    const { seed, start } = findStart(SPIRE_RUIN_REGISTRATION);
    const { cells, markers } = generate(SPIRE_RUIN_REGISTRATION, seed, start);
    const floor = structureStartY(
      seed,
      SPIRE_RUIN_REGISTRATION,
      start.x,
      start.z,
      start.chunkX,
      start.chunkZ,
    );
    const ring = (y: number) => {
      let solid = 0;
      for (let i = 0; i < 7; i++)
        for (const [x, z] of [
          [i, 0],
          [i, 6],
          [0, i],
          [6, i],
        ] as const) {
          const id = blockAt(cells, start.x + x, floor + y, start.z + z);
          if (id && id !== 'air') solid++;
        }
      return solid;
    };
    const low = ring(1) + ring(2) + ring(4) + ring(5);
    const high = ring(14) + ring(15) + ring(16) + ring(17);
    expect(high).toBeLessThan(low);
    for (const chest of markers.filter((marker) => marker.kind === 'chest')) {
      expect(blockAt(cells, chest.x, chest.y, chest.z)).toBe('chest');
      expect(blockAt(cells, chest.x, chest.y - 1, chest.z)).not.toBe('air');
    }
  });

  it('digs warrens with timber frames, rails and Silkmesh', () => {
    const { seed, start } = findStart(MINESHAFT_WARREN_REGISTRATION);
    const { cells } = generate(MINESHAFT_WARREN_REGISTRATION, seed, start);
    const counts = new Map<string, number>();
    for (const stateId of cells.values()) {
      const id = BlockRegistry.getInstance().getResolvedState(stateId)!.blockId;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    expect(counts.get('decorative_rail')).toBeGreaterThan(10);
    expect(counts.get('oak_log')).toBeGreaterThan(10);
    expect(counts.get('silkmesh')).toBeGreaterThan(3);
    expect(counts.get('air')).toBeGreaterThan(300);
  });

  it('chest tables roll deterministic stacks, with affixes on the gear', () => {
    for (const table of ['sunken_crypt', 'spire_ruin', 'mineshaft_warren']) {
      const loot = chestLootTable(table)!;
      expect(loot.entries.some((entry) => entry.affixChance)).toBe(true);
      const stacks = rollChestLootById(table, 42, 10, 40, 10);
      expect(stacks.length).toBeGreaterThanOrEqual(loot.rolls[0]);
      expect(stacks).toEqual(rollChestLootById(table, 42, 10, 40, 10));
      for (const stack of stacks) expect(loot.entries.map((entry) => entry.id)).toContain(stack.id);
    }
  });
});

const SPAWNER_TEST = 'm19c_test_crypt_mob';
const OTHER_HOSTILE = 'm19c_test_other_hostile';
registerEntityType(SPAWNER_TEST, (ctx, x, y, z) =>
  makeMob(ctx.ecs, [x, y, z], { type: SPAWNER_TEST, category: 'hostile' }),
);
registerEntityType(OTHER_HOSTILE, (ctx, x, y, z) =>
  makeMob(ctx.ecs, [x, y, z], { type: OTHER_HOSTILE, category: 'hostile' }),
);

function spawnerScene(playerDistance: number, options: { spawning?: boolean } = {}) {
  const world = flatWorld({ radius: 1, light: true });
  const s = scene(world, [0.5 + playerDistance, GROUND, 0.5], {
    spawnRules: new SpawnRuleRegistry(),
    spawning: options.spawning ?? true,
  });
  world.setBlock(0, GROUND, 0, 'spawner');
  const entity = world.blockEntities.get<SpawnerState>(0, GROUND, 0)!;
  entity.state.creature = SPAWNER_TEST;
  entity.state.delay = 0;
  const count = (type = SPAWNER_TEST) =>
    s.ecs.query(EntityKindC).filter((id) => s.ecs.get(id, EntityKindC)!.type === type).length;
  return { ...s, entity, count };
}

describe('M19c spawners', () => {
  it('creates a spawner block entity that persists its creature and delay', () => {
    const { world, entity } = spawnerScene(3);
    expect(entity.state).toEqual({ creature: SPAWNER_TEST, delay: 0 });
    const fresh = flatWorld({ radius: 1 });
    fresh.setBlock(2, GROUND, 2, 'spawner');
    expect(fresh.blockEntities.getState<SpawnerState>(2, GROUND, 2)).toMatchObject({
      creature: 'hollow',
    });
    const saved = JSON.parse(JSON.stringify(world.blockEntities.getInColumn(0, 0)));
    const restored = flatWorld({ radius: 1 });
    restored.blockEntities.restore(saved[0]);
    expect(restored.blockEntities.getState(0, GROUND, 0)).toEqual(entity.state);
  });

  it('works only while the player is within 16 blocks, and not with spawning off', () => {
    const far = spawnerScene(SPAWNER_ACTIVATION_RANGE + 2);
    for (let i = 0; i < 50; i++) expect(tickSpawner(far.entity, far.world)).toBe(0);
    expect(far.entity.state.delay).toBe(0);
    expect(far.count()).toBe(0);

    const off = spawnerScene(6, { spawning: false });
    for (let i = 0; i < 50; i++) expect(tickSpawner(off.entity, off.world)).toBe(0);
    expect(off.count()).toBe(0);

    const near = spawnerScene(SPAWNER_ACTIVATION_RANGE - 2);
    let spawned = 0;
    for (let i = 0; i < 400; i++) spawned += tickSpawner(near.entity, near.world);
    expect(spawned).toBeGreaterThan(0);
    expect(near.count()).toBe(spawned);
  });

  it('spawns only on dark spots within its radius', () => {
    const lit = spawnerScene(6);
    lit.world.setBlock(0, GROUND + 1, 0, 'torch');
    lit.world.setBlock(0, GROUND, 3, 'torch');
    lit.world.setBlock(0, GROUND, -3, 'torch');
    for (let i = 0; i < 2000; i++) tickSpawner(lit.entity, lit.world);
    expect(lit.count()).toBe(0);

    const dark = spawnerScene(6);
    for (let i = 0; i < 2000; i++) tickSpawner(dark.entity, dark.world);
    expect(dark.count()).toBeGreaterThan(0);
    for (const id of dark.ecs.query(EntityKindC)) {
      const [x, y, z] = dark.ecs.get(id, TransformC)!.pos;
      expect(Math.abs(x - 0.5)).toBeLessThanOrEqual(SPAWNER_SPAWN_RADIUS + 0.01);
      expect(Math.abs(z - 0.5)).toBeLessThanOrEqual(SPAWNER_SPAWN_RADIUS + 0.01);
      expect(y).toBe(GROUND);
      expect(dark.world.getLight(Math.floor(x), y, Math.floor(z)).block).toBe(0);
    }
  });

  it('respects its nearby cap and the global hostile cap', () => {
    const nearby = spawnerScene(6);
    for (let i = 0; i < 4000; i++) tickSpawner(nearby.entity, nearby.world);
    expect(nearby.count()).toBe(SPAWNER_NEARBY_CAP);

    const global = spawnerScene(6);
    for (let i = 0; i < MOB_CAPS.hostile; i++)
      makeMob(global.ecs, [-15 + (i % 10), GROUND, -15 + Math.floor(i / 10)], {
        type: OTHER_HOSTILE,
        category: 'hostile',
      });
    for (let i = 0; i < 2000; i++) tickSpawner(global.entity, global.world);
    expect(global.count()).toBe(0);
  });

  it('waits a randomized 200–800 tick delay between spawn cycles', () => {
    const { entity, world } = spawnerScene(6);
    const delays = new Set<number>();
    for (let cycle = 0; cycle < 12; cycle++) {
      entity.state.delay = 0;
      tickSpawner(entity, world);
      expect(entity.state.delay).toBeGreaterThanOrEqual(SPAWNER_MIN_DELAY);
      expect(entity.state.delay).toBeLessThanOrEqual(SPAWNER_MAX_DELAY);
      delays.add(entity.state.delay);
    }
    expect(delays.size).toBeGreaterThan(6);
    entity.state.delay = 35;
    expect(tickSpawner(entity, world)).toBe(0);
    expect(entity.state.delay).toBe(35 - SPAWNER_NEAR_INTERVAL);
  });

  it('checks rarely while the player is away and shows a miniature only nearby', () => {
    const near = spawnerScene(10);
    expect(spawnerTickDelay(near.entity, near.world)).toBe(SPAWNER_NEAR_INTERVAL);
    near.entity.state.creature = 'hollow';
    near.entity.state.delay = 1000;
    tickSpawner(near.entity, near.world);
    expect(spawnerMiniatures(near.world)).toEqual([{ model: 'hollow', x: 0, y: GROUND, z: 0 }]);
    const delay = near.entity.state.delay;
    near.player.pos[0] = 60;
    expect(spawnerTickDelay(near.entity, near.world)).toBe(SPAWNER_FAR_INTERVAL);
    tickSpawner(near.entity, near.world);
    expect(spawnerMiniatures(near.world)).toEqual([]);
    expect(near.entity.state.delay).toBe(delay);
    // A broken spawner leaves the list at once.
    near.player.pos[0] = 5;
    tickSpawner(near.entity, near.world);
    near.world.setBlock(0, GROUND, 0, 'air');
    expect(spawnerMiniatures(near.world)).toEqual([]);
  });

  it('structure markers fill chests from their table and set spawner creatures', () => {
    const world = flatWorld({ radius: 1 });
    world.setBlock(1, GROUND, 1, 'chest', { facing: 'south', pair: 'single' });
    world.setBlock(3, GROUND, 3, 'spawner');
    world.worldSeed = 9;
    applyStructureMarkers(world, [
      { kind: 'chest', x: 1, y: GROUND, z: 1, table: 'sunken_crypt' },
      { kind: 'spawner', x: 3, y: GROUND, z: 3, creature: 'skitterer' },
      { kind: 'chest', x: 5, y: GROUND, z: 5, table: 'sunken_crypt' },
    ]);
    const chest = world.getBlockEntity<ChestEntityState>(1, GROUND, 1)!;
    const stacks = chest.slots.filter((slot) => slot !== null);
    expect(stacks.map((slot) => slot.id)).toEqual(
      rollChestLootById('sunken_crypt', 9, 1, GROUND, 1).map((stack) => stack.id),
    );
    expect(world.getBlockEntity<SpawnerState>(3, GROUND, 3)!.creature).toBe('skitterer');
    expect(world.getBlockEntity(5, GROUND, 5)).toBeUndefined();
  });
});
