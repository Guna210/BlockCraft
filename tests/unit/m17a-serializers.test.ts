import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  serializeBlockEntities,
  deserializeBlockEntities,
  serializeInventory,
  deserializeInventory,
  serializeItemEntities,
  deserializeItemEntities,
  serializePlayerData,
  deserializePlayerData,
  applyPlayerData,
  serializeWorldMetadata,
  deserializeWorldMetadata,
  serializeBlockTicks,
  deserializeBlockTicks,
  serializeColumnTicks,
  serializeWorld,
  deserializeWorld,
  WORLD_HEADER_SIZE,
  type SerializedInventory,
  type SerializedItemEntity,
  type SerializedPlayerData,
  type SerializedWorldMetadata,
  type SerializedBlockTicks,
  type WorldSaveData,
} from '../../src/persist/serializers';
import { Inventory } from '../../src/gameplay/inventory';
import { ItemEntity } from '../../src/entity/item-entity';
import { Player } from '../../src/entity/player';
import { BlockCollision } from '../../src/entity/physics';
import { World } from '../../src/world/world';
import { ChunkColumn } from '../../src/world/column';
import { BlockTicks, type ScheduledTick } from '../../src/world/ticks';
import { weatherManager } from '../../src/world/weather';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { migrations } from '../../src/persist/version';
import type { BlockEntityInstance } from '../../src/world/block-entities';

describe('M17a — Serializers (Block Entities, Inventory, Entities, Player, Metadata, Ticks, World)', () => {
  let stoneId: number;
  let dirtId: number;
  let foundationStoneId: number;

  beforeEach(() => {
    migrations.clear();
    const registry = BlockRegistry.getInstance();
    stoneId = registry.getDefaultStateId('stone')!;
    dirtId = registry.getDefaultStateId('dirt')!;
    foundationStoneId = registry.getDefaultStateId('foundation_stone')!;
  });

  afterEach(() => {
    migrations.clear();
  });

  // -------------------------------------------------------------------------
  // 1. Block Entities
  // -------------------------------------------------------------------------
  describe('Block Entities', () => {
    it('round-trips complex nested plain-JSON state losslessly', () => {
      const entities: BlockEntityInstance[] = [
        {
          blockId: 'chest',
          x: 10,
          y: 65,
          z: -20,
          state: {
            customName: 'Storage Chest #1',
            locked: false,
            items: [
              { slot: 0, id: 'stone', count: 64 },
              { slot: 5, id: 'iron_ingot', count: 12 },
              null,
            ],
            extra: { nested: { flag: true, value: 42.5 } },
          },
        },
        {
          blockId: 'kiln',
          x: 12,
          y: 65,
          z: -20,
          state: {
            cookTime: 140,
            totalCookTime: 200,
            fuelTime: 850,
            active: true,
            input: 'raw_iron',
            output: 'iron_ingot',
            recipeXp: 0.7,
          },
        },
      ];

      const serialized = serializeBlockEntities(entities);
      const deserialized = deserializeBlockEntities(serialized);

      expect(deserialized).toEqual(entities);
    });

    it('rejects non-plain JSON block entity state on serialization', () => {
      const invalid = [
        {
          blockId: 'chest',
          x: 0,
          y: 0,
          z: 0,
          state: {
            fn: () => {},
          } as unknown as Record<string, string>,
        },
      ];
      expect(() => serializeBlockEntities(invalid)).toThrowError(/not a plain JSON object/);
    });

    it('rejects invalid or corrupted data on deserialization', () => {
      const invalidJson = new TextEncoder().encode(JSON.stringify({ notAnArray: true }));
      expect(() => deserializeBlockEntities(invalidJson)).toThrowError(
        /Deserialized block entities data must be an array/,
      );

      const invalidItem = new TextEncoder().encode(
        JSON.stringify([{ blockId: 123, x: 0, y: 0, z: 0, state: {} }]),
      );
      expect(() => deserializeBlockEntities(invalidItem)).toThrowError(
        /Invalid block entity instance data/,
      );

      const corruptJson = new TextEncoder().encode('{ not valid json');
      expect(() => deserializeBlockEntities(corruptJson)).toThrowError(
        /Invalid block entities data/,
      );
    });
  });

  // -------------------------------------------------------------------------
  // 2. Inventory
  // -------------------------------------------------------------------------
  describe('Inventory', () => {
    it('round-trips full 41 slots including empty slots, unstackables, equipment and cursor', () => {
      const inv = new Inventory();

      // Hotbar slots (0..8)
      inv.slots[0] = { slot: 0, id: 'iron_pickaxe', count: 1 }; // unstackable
      inv.slots[1] = { slot: 1, id: 'stone', count: 64 }; // full stack
      inv.slots[2] = { slot: 2, id: 'apple', count: 7 }; // partial stack
      // slots 3..8 remain empty (null)

      // Main storage (9..35)
      inv.slots[9] = { slot: 9, id: 'cobblestone', count: 32 };
      inv.slots[15] = { slot: 15, id: 'copper_sword', count: 1 }; // unstackable
      inv.slots[35] = { slot: 35, id: 'dirt', count: 16 };

      // Armor slots (36..39: head, chest, legs, feet)
      inv.slots[36] = { slot: 36, id: 'iron_helmet', count: 1 };
      inv.slots[37] = { slot: 37, id: 'iron_chestplate', count: 1 };
      inv.slots[38] = { slot: 38, id: 'copper_leggings', count: 1 };
      inv.slots[39] = { slot: 39, id: 'copper_boots', count: 1 };

      // Offhand slot (40)
      inv.slots[40] = { slot: 40, id: 'shield', count: 1 };

      // Cursor
      inv.cursor = { id: 'torch', count: 14 };

      // Selected slot
      inv.selectedSlot = 2;

      // Invariant holds on original
      inv.assertInvariant();

      // Serialize
      const serialized = serializeInventory(inv);

      // Deserialize to raw SerializedInventory
      const parsed = deserializeInventory(serialized);
      expect(parsed.selectedSlot).toBe(2);
      expect(parsed.cursor).toEqual({ id: 'torch', count: 14 });
      expect(parsed.slots.length).toBe(41);
      expect(parsed.slots[0]).toEqual({ slot: 0, id: 'iron_pickaxe', count: 1 });
      expect(parsed.slots[3]).toBeNull();
      expect(parsed.slots[36]).toEqual({ slot: 36, id: 'iron_helmet', count: 1 });
      expect(parsed.slots[40]).toEqual({ slot: 40, id: 'shield', count: 1 });

      // Deserialize directly into a new target Inventory instance
      const targetInv = new Inventory();
      deserializeInventory(serialized, targetInv);

      // Target inventory passes full model invariant and matches original snapshots
      targetInv.assertInvariant();
      expect(targetInv.selectedSlot).toBe(inv.selectedSlot);
      expect(targetInv.cursorSnapshot()).toEqual(inv.cursorSnapshot());
      expect(targetInv.snapshot(true)).toEqual(inv.snapshot(true));
    });

    it('rejects invalid inventory slots length, stack counts, or armor slot mismatches', () => {
      // 1. Invalid slots count
      const shortSlots = {
        slots: Array.from({ length: 36 }, () => null),
        cursor: null,
        selectedSlot: 0,
      };
      expect(() =>
        deserializeInventory(new TextEncoder().encode(JSON.stringify(shortSlots))),
      ).toThrowError(/Inventory slots must be an array of length 41/);

      // 2. Unknown item ID
      const unknownItem: SerializedInventory = {
        slots: Array.from({ length: 41 }, () => null),
        cursor: null,
        selectedSlot: 0,
      };
      unknownItem.slots[0] = { slot: 0, id: 'nonexistent_gem_xyz', count: 1 };
      expect(() =>
        deserializeInventory(new TextEncoder().encode(JSON.stringify(unknownItem))),
      ).toThrowError(/Unknown item ID/);

      // 3. Stack overflow count
      const overflowItem: SerializedInventory = {
        slots: Array.from({ length: 41 }, () => null),
        cursor: null,
        selectedSlot: 0,
      };
      overflowItem.slots[0] = { slot: 0, id: 'iron_pickaxe', count: 2 }; // max is 1
      expect(() =>
        deserializeInventory(new TextEncoder().encode(JSON.stringify(overflowItem))),
      ).toThrowError(/Invalid stack count/);

      // 4. Armor slot mismatch: putting leggings in helmet slot
      const armorMismatch: SerializedInventory = {
        slots: Array.from({ length: 41 }, () => null),
        cursor: null,
        selectedSlot: 0,
      };
      armorMismatch.slots[36] = { slot: 36, id: 'iron_leggings', count: 1 }; // head slot 36
      expect(() =>
        deserializeInventory(new TextEncoder().encode(JSON.stringify(armorMismatch))),
      ).toThrowError(/cannot be placed in armor slot head/);

      const corruptJson = new TextEncoder().encode('{ not valid json');
      expect(() => deserializeInventory(corruptJson)).toThrowError(/Invalid inventory data/);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Item Entities
  // -------------------------------------------------------------------------
  describe('Item Entities', () => {
    it('round-trips ground drop item entities losslessly', () => {
      const itemsList: SerializedItemEntity[] = [
        {
          id: 'raw_iron',
          count: 3,
          position: [100.5, 64.125, -200.75],
          velocity: [0.1, -0.4, 0.25],
          pickupDelay: 10,
          age: 120,
        },
        {
          id: 'apple',
          count: 1,
          position: [0, 70, 0],
          velocity: [0, 0, 0],
          pickupDelay: 0,
          age: 45,
        },
      ];

      const serialized = serializeItemEntities(itemsList);
      const deserialized = deserializeItemEntities(serialized);

      expect(deserialized).toEqual(itemsList);
    });

    it('serializes from ItemEntity pool objects', () => {
      const entity = new ItemEntity();
      entity.active = true;
      entity.count = 4;
      entity.pos[0] = 12.5;
      entity.pos[1] = 65.0;
      entity.pos[2] = 30.5;
      entity.vel[0] = 0.5;
      entity.vel[1] = 1.0;
      entity.vel[2] = -0.5;
      entity.pickupDelay = 20;
      entity.age = 300;

      const serialized = serializeItemEntities([entity]);
      const deserialized = deserializeItemEntities(serialized);

      expect(deserialized.length).toBe(1);
      expect(deserialized[0]?.id).toBe('stone');
      expect(deserialized[0]?.count).toBe(4);
      expect(deserialized[0]?.position).toEqual([12.5, 65.0, 30.5]);
      expect(deserialized[0]?.velocity).toEqual([0.5, 1.0, -0.5]);
      expect(deserialized[0]?.pickupDelay).toBe(20);
      expect(deserialized[0]?.age).toBe(300);
    });

    it('rejects invalid item entity data', () => {
      const invalid = [{ id: 'stone', count: 0, position: [0, 0, 0] }];
      expect(() =>
        deserializeItemEntities(new TextEncoder().encode(JSON.stringify(invalid))),
      ).toThrowError(/Invalid item entity data/);

      const corruptJson = new TextEncoder().encode('{ not valid json');
      expect(() => deserializeItemEntities(corruptJson)).toThrowError(/Invalid item entity data/);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Player Data
  // -------------------------------------------------------------------------
  describe('Player Data', () => {
    it('round-trips player position, rotation, mode, selectedSlot, health, hunger, saturation, air, flying, and dimension losslessly', () => {
      const playerData: SerializedPlayerData = {
        position: [123.456, 78.9, -456.789],
        rotation: [1.57, -0.25], // [yaw, pitch]
        mode: 'survival',
        selectedSlot: 4,
        health: 18.5,
        hunger: 16,
        saturation: 4.5,
        air: 280,
        flying: false,
        dimension: 'overworld',
        xpLevel: 0,
        xpProgress: 0,
        spawnPoint: null,
      };

      const serialized = serializePlayerData(playerData);
      const deserialized = deserializePlayerData(serialized);

      expect(deserialized).toEqual(playerData);
    });

    it('serializes and applies player data to Player instance', () => {
      const world = new World(false);
      const collision = new BlockCollision(world);
      const player = new Player(collision, () => true);

      player.pos[0] = 45.5;
      player.pos[1] = 68.0;
      player.pos[2] = -12.5;
      player.yaw = 2.1;
      player.pitch = 0.4;
      player.mode = 'creative';
      player.selectedSlot = 7;
      player.health = 14;
      player.hunger = 11;
      player.saturation = 3.5;
      player.air = 220;
      player.flying = true;
      player.dimension = 'nether';

      const serialized = serializePlayerData(player);
      const parsed = deserializePlayerData(serialized);

      expect(parsed.position).toEqual([45.5, 68.0, -12.5]);
      expect(parsed.rotation).toEqual([2.1, 0.4]);
      expect(parsed.mode).toBe('creative');
      expect(parsed.selectedSlot).toBe(7);
      expect(parsed.health).toBe(14);
      expect(parsed.hunger).toBe(11);
      expect(parsed.saturation).toBe(3.5);
      expect(parsed.air).toBe(220);
      expect(parsed.flying).toBe(true);
      expect(parsed.dimension).toBe('nether');

      const targetPlayer = new Player(collision, () => true);
      applyPlayerData(targetPlayer, parsed);

      expect(targetPlayer.pos[0]).toBeCloseTo(45.5);
      expect(targetPlayer.pos[1]).toBeCloseTo(68.0);
      expect(targetPlayer.pos[2]).toBeCloseTo(-12.5);
      expect(targetPlayer.yaw).toBeCloseTo(2.1);
      expect(targetPlayer.pitch).toBeCloseTo(0.4);
      expect(targetPlayer.mode).toBe('creative');
      expect(targetPlayer.selectedSlot).toBe(7);
      expect(targetPlayer.health).toBe(14);
      expect(targetPlayer.hunger).toBe(11);
      expect(targetPlayer.saturation).toBe(3.5);
      expect(targetPlayer.air).toBe(220);
      expect(targetPlayer.flying).toBe(true);
      expect(targetPlayer.dimension).toBe('nether');
    });

    it('serializes from player.snapshot() and applies restored data to Player instance', () => {
      const world = new World(false);
      const collision = new BlockCollision(world);
      const player = new Player(collision, () => true);

      player.pos[0] = 10.5;
      player.pos[1] = 64.0;
      player.pos[2] = 20.5;
      player.yaw = 1.0;
      player.pitch = 0.5;
      player.health = 18;
      player.hunger = 17;
      player.saturation = 4;
      player.air = 290;
      player.dimension = 'overworld';
      player.selectedSlot = 3;

      const snap = player.snapshot();
      const serialized = serializePlayerData(snap);
      const deserialized = deserializePlayerData(serialized);

      expect(deserialized.position).toEqual([10.5, 64.0, 20.5]);
      expect(deserialized.rotation).toEqual([1.0, 0.5]);
      expect(deserialized.health).toBe(18);
      expect(deserialized.hunger).toBe(17);
      expect(deserialized.saturation).toBe(4);
      expect(deserialized.air).toBe(290);
      expect(deserialized.flying).toBe(false);
      expect(deserialized.dimension).toBe('overworld');
      expect(deserialized.selectedSlot).toBe(3);

      const target = new Player(collision, () => true);
      applyPlayerData(target, deserialized);
      expect(target.pos[0]).toBeCloseTo(10.5);
      expect(target.pos[1]).toBeCloseTo(64.0);
      expect(target.pos[2]).toBeCloseTo(20.5);
      expect(target.health).toBe(18);
      expect(target.hunger).toBe(17);
      expect(target.saturation).toBe(4);
      expect(target.air).toBe(290);
      expect(target.flying).toBe(false);
      expect(target.dimension).toBe('overworld');
      expect(target.selectedSlot).toBe(3);
    });

    it('rejects corrupted player data', () => {
      expect(() =>
        deserializePlayerData(new TextEncoder().encode(JSON.stringify({ position: [1, 2] }))),
      ).toThrowError(/Invalid player data/);

      expect(() =>
        deserializePlayerData(
          new TextEncoder().encode(
            JSON.stringify({
              position: [0, 0, 0],
              rotation: [0, 0],
              mode: 'survival',
              selectedSlot: 0,
              health: -5,
              hunger: 20,
              saturation: 5,
              air: 300,
              flying: false,
              dimension: 'overworld',
            }),
          ),
        ),
      ).toThrowError(/Invalid player data/);

      expect(() =>
        deserializePlayerData(
          new TextEncoder().encode(
            JSON.stringify({
              position: [0, 0, 0],
              rotation: [0, 0],
              mode: 'spectator',
              selectedSlot: 0,
              health: 20,
              hunger: 20,
              saturation: 5,
              air: 300,
              flying: false,
              dimension: 'overworld',
            }),
          ),
        ),
      ).toThrowError(/Invalid player data/);

      expect(() =>
        deserializePlayerData(
          new TextEncoder().encode(
            JSON.stringify({
              position: [0, 0, 0],
              rotation: [0, 0],
              mode: 'survival',
              selectedSlot: 0,
              health: 20,
              hunger: 20,
              saturation: 5,
              air: 300,
              flying: 'yes',
              dimension: 'overworld',
            }),
          ),
        ),
      ).toThrowError(/Invalid player data/);

      expect(() =>
        deserializePlayerData(
          new TextEncoder().encode(
            JSON.stringify({
              position: [0, 0, 0],
              rotation: [0, 0],
              mode: 'survival',
              selectedSlot: 0,
              health: 20,
              hunger: 20,
              saturation: 5,
              air: 300,
              flying: false,
              dimension: '',
            }),
          ),
        ),
      ).toThrowError(/Invalid player data/);
    });
  });

  // -------------------------------------------------------------------------
  // 5. World Metadata
  // -------------------------------------------------------------------------
  describe('World Metadata', () => {
    it('round-trips seed, timeOfDay, weather, manualOverride, strikeCounter, lastTick, elapsed, and world.breakCount losslessly', () => {
      const metadata: SerializedWorldMetadata = {
        seed: 987654321,
        timeOfDay: 14500,
        weather: 'thunder',
        manualOverride: true,
        strikeCounter: 42,
        lastTick: 14450,
        elapsed: 14500,
        breakCount: 42,
        worldType: 'default',
      };

      const serialized = serializeWorldMetadata(metadata);
      const deserialized = deserializeWorldMetadata(serialized);

      expect(deserialized).toEqual(metadata);
    });

    it('round-trips full weather state with weatherManager', () => {
      weatherManager.reset();
      weatherManager.setWeather('thunder');
      weatherManager.strikeCounter = 88;
      weatherManager.lastTick = 500;
      weatherManager.elapsed = 600;

      const meta: SerializedWorldMetadata = {
        seed: 42,
        timeOfDay: 500,
        ...weatherManager.getState(),
        breakCount: 7,
      };

      const serialized = serializeWorldMetadata(meta);
      const deserialized = deserializeWorldMetadata(serialized);

      expect(deserialized.weather).toBe('thunder');
      expect(deserialized.manualOverride).toBe(true);
      expect(deserialized.strikeCounter).toBe(88);
      expect(deserialized.lastTick).toBe(500);
      expect(deserialized.elapsed).toBe(600);

      const restoredWeather = {
        weather: deserialized.weather,
        manualOverride: deserialized.manualOverride,
        strikeCounter: deserialized.strikeCounter,
        lastTick: deserialized.lastTick,
        elapsed: deserialized.elapsed,
      };

      weatherManager.reset();
      weatherManager.setState(restoredWeather);
      expect(weatherManager.getState()).toEqual(restoredWeather);
    });

    it('rejects invalid world metadata fields', () => {
      const invalid = { seed: 'invalid', timeOfDay: -1, weather: 'sunny', breakCount: -5 };
      expect(() =>
        deserializeWorldMetadata(new TextEncoder().encode(JSON.stringify(invalid))),
      ).toThrowError(/Invalid world metadata/);

      const invalidElapsed = {
        seed: 1,
        timeOfDay: 0,
        weather: 'clear',
        manualOverride: false,
        strikeCounter: 0,
        lastTick: 0,
        elapsed: -10,
        breakCount: 0,
      };
      expect(() =>
        deserializeWorldMetadata(new TextEncoder().encode(JSON.stringify(invalidElapsed))),
      ).toThrowError(/Invalid world metadata/);

      const invalidLastTick = {
        seed: 1,
        timeOfDay: 0,
        weather: 'clear',
        manualOverride: false,
        strikeCounter: 0,
        lastTick: -2,
        elapsed: 0,
        breakCount: 0,
      };
      expect(() =>
        deserializeWorldMetadata(new TextEncoder().encode(JSON.stringify(invalidLastTick))),
      ).toThrowError(/Invalid world metadata/);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Scheduled Block Ticks
  // -------------------------------------------------------------------------
  describe('Scheduled Block Ticks', () => {
    it('round-trips scheduled block ticks losslessly', () => {
      const ticks: ScheduledTick[] = [
        { x: 10, y: 64, z: 20, type: 'water', due: 15, priority: 0, order: 1 },
        { x: 11, y: 64, z: 20, type: 'water', due: 18, priority: -1, order: 2 },
        { x: 5, y: 30, z: -5, type: 'block_entity', due: 20, priority: 1, order: 3 },
      ];
      const serialized = serializeBlockTicks(ticks, 10);
      const deserialized = deserializeBlockTicks(serialized);

      expect(deserialized.time).toBe(10);
      expect(deserialized.ticks).toEqual(ticks);
    });

    it('serializes ticks from BlockTicks instance and for specific column', () => {
      const blockTicks = new BlockTicks();
      blockTicks.time = 50;
      blockTicks.schedule({ x: 5, y: 64, z: 5, type: 'water' }, 5, 0); // column (0, 0)
      blockTicks.schedule({ x: 25, y: 64, z: 5, type: 'water' }, 10, 0); // column (1, 0)

      const col0Bytes = serializeColumnTicks(blockTicks, 0, 0);
      const col0Data = deserializeBlockTicks(col0Bytes);
      expect(col0Data.ticks.length).toBe(1);
      expect(col0Data.ticks[0]!.x).toBe(5);

      const allBytes = serializeBlockTicks(blockTicks);
      const allData = deserializeBlockTicks(allBytes);
      expect(allData.ticks.length).toBe(2);
    });

    it('supports incremental column tick loading and merging via addTicks without clearing previous ticks', () => {
      const ticks = new BlockTicks();
      ticks.time = 100;
      ticks.schedule({ x: 5, y: 64, z: 5, type: 'water' }, 10, 0); // col (0, 0)

      const col1Ticks = [
        { x: 25, y: 64, z: 5, type: 'water', due: 115, priority: 0, order: 5 }, // col (1, 0)
      ];

      // Add col1 ticks without clearing col (0, 0) ticks
      ticks.addTicks(col1Ticks);

      const all = ticks.getPendingTicks();
      expect(all.length).toBe(2);
      expect(all.some((t) => t.x === 5)).toBe(true);
      expect(all.some((t) => t.x === 25)).toBe(true);
    });

    it('rejects corrupted block tick data', () => {
      const invalid = { time: 'abc', ticks: [] };
      expect(() =>
        deserializeBlockTicks(new TextEncoder().encode(JSON.stringify(invalid))),
      ).toThrowError(/Invalid block ticks data/);
    });

    it('preserves water mid-flow: restored world continues simulation identically', async () => {
      const w1 = new World(false);
      w1.fill(0, 63, 0, 15, 63, 15, 'stone');
      w1.setBlock(8, 64, 8, 'water');

      // Tick 2 steps: water begins flowing, ticks are queued
      w1.tick();
      w1.tick();
      expect(w1.ticks.count).toBeGreaterThan(0);

      const pendingTicks = w1.ticks.getPendingTicks();
      const tickTime = w1.ticks.time;

      // Pack w1 into a complete WorldSaveData
      const col = w1.getColumn(0, 0)!;
      const worldSave: WorldSaveData = {
        metadata: {
          seed: 42,
          timeOfDay: 100,
          weather: 'clear',
          manualOverride: false,
          strikeCounter: 0,
          lastTick: -1,
          elapsed: 100,
          breakCount: 0,
        },
        player: {
          position: [8, 65, 8],
          rotation: [0, 0],
          mode: 'survival',
          selectedSlot: 0,
          health: 20,
          hunger: 20,
          saturation: 5,
          air: 300,
          flying: false,
          dimension: 'overworld',
          xpLevel: 0,
          xpProgress: 0,
          spawnPoint: null,
        },
        inventory: {
          slots: Array.from({ length: 41 }, () => null),
          cursor: null,
          selectedSlot: 0,
        },
        columns: [col],
        blockEntities: [],
        itemEntities: [],
        blockTicks: {
          time: tickTime,
          ticks: pendingTicks,
        },
      };

      const packedWorld = await serializeWorld(worldSave);
      const restoredWorldData = await deserializeWorld(packedWorld);

      // Verify deserialized scheduled ticks match
      expect(restoredWorldData.blockTicks).toBeDefined();
      expect(restoredWorldData.blockTicks!.time).toBe(tickTime);
      expect(restoredWorldData.blockTicks!.ticks).toEqual(pendingTicks);

      // Create a second world w2 and restore column + ticks
      const w2 = new World(false);
      const restoredCol = restoredWorldData.columns[0]!;
      w2.setColumn(restoredCol);
      w2.ticks.loadTicks(restoredWorldData.blockTicks!.ticks, restoredWorldData.blockTicks!.time);

      // Simulate both worlds for 10 ticks
      for (let step = 0; step < 10; step++) {
        w1.tick();
        w2.tick();

        // Compare pending ticks at every step
        expect(w2.ticks.getPendingTicks()).toEqual(w1.ticks.getPendingTicks());

        // Compare all water and block positions
        for (let x = 2; x <= 14; x++) {
          for (let z = 2; z <= 14; z++) {
            expect(w2.getBlock(x, 64, z)).toEqual(w1.getBlock(x, 64, z));
          }
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // 7. Unified World Save Container
  // -------------------------------------------------------------------------
  describe('Unified World Container (serializeWorld / deserializeWorld)', () => {
    it('round-trips complete world save package into ONE self-describing Uint8Array', async () => {
      // 1. Column 1: (0, 0)
      const col1 = new ChunkColumn(0, 0);
      col1.getOrCreateSection(0)!.fill(foundationStoneId);
      col1.getOrCreateSection(1)!.fill(stoneId);

      // 2. Column 2: (1, -1)
      const col2 = new ChunkColumn(1, -1);
      col2.getOrCreateSection(0)!.fill(dirtId);

      // Custom column tints
      for (let i = 0; i < 256 * 3; i++) {
        col1.grassTints[i] = (i * 7 + 1) % 256;
        col1.foliageTints[i] = (i * 11 + 3) % 256;
        col2.grassTints[i] = (i * 13 + 5) % 256;
        col2.foliageTints[i] = (i * 17 + 9) % 256;
      }

      // 3. Block entities
      const blockEntities: BlockEntityInstance[] = [
        {
          blockId: 'chest',
          x: 5,
          y: 65,
          z: 5,
          state: { items: [{ slot: 0, id: 'stone', count: 64 }] },
        },
      ];

      // 4. Item entities
      const itemEntities: SerializedItemEntity[] = [
        {
          id: 'flint',
          count: 2,
          position: [5.5, 65.0, 5.5],
          velocity: [0, 0.1, 0],
          pickupDelay: 0,
          age: 50,
        },
      ];

      // 5. Player data
      const player: SerializedPlayerData = {
        position: [5.0, 65.0, 5.0],
        rotation: [0.0, 0.0],
        mode: 'survival',
        selectedSlot: 1,
        health: 20,
        hunger: 19,
        saturation: 4,
        air: 300,
        flying: false,
        dimension: 'overworld',
        xpLevel: 0,
        xpProgress: 0,
        spawnPoint: null,
      };

      // 6. Inventory
      const inventory: SerializedInventory = {
        slots: Array.from({ length: 41 }, () => null),
        cursor: null,
        selectedSlot: 1,
      };
      inventory.slots[0] = { slot: 0, id: 'stone_pickaxe', count: 1 };
      inventory.slots[1] = { slot: 1, id: 'cobblestone', count: 20 };

      // 7. World metadata
      const metadata: SerializedWorldMetadata = {
        seed: 12345678,
        timeOfDay: 6000,
        weather: 'clear',
        manualOverride: false,
        strikeCounter: 0,
        lastTick: -1,
        elapsed: 6000,
        breakCount: 15,
      };

      // 8. Scheduled block ticks
      const blockTicks: SerializedBlockTicks = {
        time: 6000,
        ticks: [{ x: 5, y: 65, z: 5, type: 'water', due: 6005, priority: 0, order: 1 }],
      };

      const worldSave: WorldSaveData = {
        metadata,
        player,
        inventory,
        columns: [col1, col2],
        blockEntities,
        itemEntities,
        blockTicks,
      };

      // Serialize whole world into single self-describing Uint8Array
      const packedBytes = await serializeWorld(worldSave);

      // Verify header magic 'BCWD' and version
      expect(packedBytes[0]).toBe(0x42);
      expect(packedBytes[1]).toBe(0x43);
      expect(packedBytes[2]).toBe(0x57);
      expect(packedBytes[3]).toBe(0x44);

      // Deserialize whole world
      const restored = await deserializeWorld(packedBytes);

      // Assert deep-equal lossless restoration
      expect(restored.metadata).toEqual(metadata);
      expect(restored.player).toEqual(player);
      expect(restored.inventory).toEqual(inventory);
      expect(restored.blockEntities).toEqual(blockEntities);
      expect(restored.itemEntities).toEqual(itemEntities);
      expect(restored.blockTicks).toEqual(blockTicks);

      expect(restored.columns.length).toBe(2);
      expect(restored.columns[0]!.cx).toBe(0);
      expect(restored.columns[0]!.cz).toBe(0);
      expect(restored.columns[0]!.getBlockStateId(0, 0, 0)).toBe(foundationStoneId);
      expect(restored.columns[0]!.getBlockStateId(0, 16, 0)).toBe(stoneId);
      expect(restored.columns[0]!.grassTints).toEqual(col1.grassTints);
      expect(restored.columns[0]!.foliageTints).toEqual(col1.foliageTints);

      expect(restored.columns[1]!.cx).toBe(1);
      expect(restored.columns[1]!.cz).toBe(-1);
      expect(restored.columns[1]!.getBlockStateId(0, 0, 0)).toBe(dirtId);
      expect(restored.columns[1]!.grassTints).toEqual(col2.grassTints);
      expect(restored.columns[1]!.foliageTints).toEqual(col2.foliageTints);
    });

    it('rejects invalid world magic bytes', async () => {
      const corrupt = new Uint8Array(40);
      corrupt[0] = 0x00;
      await expect(deserializeWorld(corrupt)).rejects.toThrowError(
        /Invalid world format magic bytes/,
      );
    });

    it('rejects unsupported world format version when no migration registered', async () => {
      const validHeader = new Uint8Array(40);
      validHeader[0] = 0x42;
      validHeader[1] = 0x43;
      validHeader[2] = 0x57;
      validHeader[3] = 0x44;
      new DataView(validHeader.buffer).setUint16(4, 99, true); // version 99

      await expect(deserializeWorld(validHeader)).rejects.toThrowError(
        /Cannot migrate world from future version 99 to 1/,
      );
    });

    it('executes world migration hook when version is older', async () => {
      // Create minimal valid world data
      const worldSave: WorldSaveData = {
        metadata: {
          seed: 1,
          timeOfDay: 0,
          weather: 'clear',
          manualOverride: false,
          strikeCounter: 0,
          lastTick: -1,
          elapsed: 0,
          breakCount: 0,
        },
        player: {
          position: [0, 0, 0],
          rotation: [0, 0],
          mode: 'survival',
          selectedSlot: 0,
          health: 20,
          hunger: 20,
          saturation: 5,
          air: 300,
          flying: false,
          dimension: 'overworld',
          xpLevel: 0,
          xpProgress: 0,
          spawnPoint: null,
        },
        inventory: {
          slots: Array.from({ length: 41 }, () => null),
          cursor: null,
          selectedSlot: 0,
        },
        columns: [],
        blockEntities: [],
        itemEntities: [],
      };

      const packed = await serializeWorld(worldSave);

      // Mock version 0 in header
      const v0Packed = new Uint8Array(packed);
      new DataView(v0Packed.buffer).setUint16(4, 0, true);

      // Without migration, loading fails
      await expect(deserializeWorld(v0Packed)).rejects.toThrowError(
        /No migration registered for world version 0 -> 1/,
      );

      // Register migration 0 -> 1
      let migrated = false;
      migrations.registerWorld(0, (data) => {
        migrated = true;
        const upgraded = new Uint8Array(data);
        new DataView(upgraded.buffer).setUint16(4, 1, true);
        return upgraded;
      });

      const restored = await deserializeWorld(v0Packed);
      expect(migrated).toBe(true);
      expect(restored.metadata.seed).toBe(1);
    });

    it('fails clearly on truncation of a world file at several lengths', async () => {
      const col = new ChunkColumn(0, 0);
      col.getOrCreateSection(0)!.fill(stoneId);

      const worldSave: WorldSaveData = {
        metadata: {
          seed: 12345,
          timeOfDay: 6000,
          weather: 'clear',
          manualOverride: false,
          strikeCounter: 0,
          lastTick: -1,
          elapsed: 6000,
          breakCount: 0,
        },
        player: {
          position: [0, 65, 0],
          rotation: [0, 0],
          mode: 'survival',
          selectedSlot: 0,
          health: 20,
          hunger: 20,
          saturation: 5,
          air: 300,
          flying: false,
          dimension: 'overworld',
          xpLevel: 0,
          xpProgress: 0,
          spawnPoint: null,
        },
        inventory: {
          slots: Array.from({ length: 41 }, () => null),
          cursor: null,
          selectedSlot: 0,
        },
        columns: [col],
        blockEntities: [],
        itemEntities: [],
        blockTicks: { time: 0, ticks: [] },
      };

      const packed = await serializeWorld(worldSave);

      // Truncate at several lengths across the buffer
      const testTruncationLengths = [
        0,
        10,
        WORLD_HEADER_SIZE - 1,
        WORLD_HEADER_SIZE + 5,
        WORLD_HEADER_SIZE + 50,
        WORLD_HEADER_SIZE + 150,
        packed.length - 20,
        packed.length - 1,
      ];

      for (const len of testTruncationLengths) {
        const truncated = packed.subarray(0, len);
        await expect(deserializeWorld(truncated)).rejects.toThrowError(/truncated world data/i);
      }
    });

    it('rejects column coordinate mismatch between TOC and column payload', async () => {
      const col = new ChunkColumn(5, 7);
      col.getOrCreateSection(0)!.fill(stoneId);

      const worldSave: WorldSaveData = {
        metadata: {
          seed: 1,
          timeOfDay: 0,
          weather: 'clear',
          manualOverride: false,
          strikeCounter: 0,
          lastTick: -1,
          elapsed: 0,
          breakCount: 0,
        },
        player: {
          position: [0, 0, 0],
          rotation: [0, 0],
          mode: 'survival',
          selectedSlot: 0,
          health: 20,
          hunger: 20,
          saturation: 5,
          air: 300,
          flying: false,
          dimension: 'overworld',
          xpLevel: 0,
          xpProgress: 0,
          spawnPoint: null,
        },
        inventory: {
          slots: Array.from({ length: 41 }, () => null),
          cursor: null,
          selectedSlot: 0,
        },
        columns: [col],
        blockEntities: [],
        itemEntities: [],
      };

      const packed = await serializeWorld(worldSave);
      const corrupt = new Uint8Array(packed);
      const view = new DataView(corrupt.buffer);

      // Find column header offset: 34 + metaLen + playerLen + invLen + beLen + ieLen + ticksLen
      const metaLen = view.getUint32(6, true);
      const playerLen = view.getUint32(10, true);
      const invLen = view.getUint32(14, true);
      const beLen = view.getUint32(18, true);
      const ieLen = view.getUint32(22, true);
      const ticksLen = view.getUint32(26, true);
      const colTOC = 34 + metaLen + playerLen + invLen + beLen + ieLen + ticksLen;

      // Corrupt TOC cx to 99 instead of 5
      view.setInt32(colTOC, 99, true);

      await expect(deserializeWorld(corrupt)).rejects.toThrowError(
        /Column coordinate mismatch in world save: TOC \(99,7\) != payload \(5,7\)/,
      );
    });
  });
});
