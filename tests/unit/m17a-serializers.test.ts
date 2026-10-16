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
  serializeWorld,
  deserializeWorld,
  type SerializedInventory,
  type SerializedItemEntity,
  type SerializedPlayerData,
  type SerializedWorldMetadata,
  type WorldSaveData,
} from '../../src/persist/serializers';
import { Inventory } from '../../src/gameplay/inventory';
import { ItemEntity } from '../../src/entity/item-entity';
import { Player } from '../../src/entity/player';
import { BlockCollision } from '../../src/entity/physics';
import { World } from '../../src/world/world';
import { ChunkColumn } from '../../src/world/column';
import { migrations } from '../../src/persist/version';
import type { BlockEntityInstance } from '../../src/world/block-entities';

describe('M17a — Serializers (Block Entities, Inventory, Entities, Player, Metadata, World)', () => {
  beforeEach(() => {
    migrations.clear();
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
    });
  });

  // -------------------------------------------------------------------------
  // 4. Player Data
  // -------------------------------------------------------------------------
  describe('Player Data', () => {
    it('round-trips player position, rotation, mode, and selectedSlot losslessly', () => {
      const playerData: SerializedPlayerData = {
        position: [123.456, 78.9, -456.789],
        rotation: [1.57, -0.25], // [yaw, pitch]
        mode: 'survival',
        selectedSlot: 4,
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

      const serialized = serializePlayerData(player);
      const parsed = deserializePlayerData(serialized);

      expect(parsed.position).toEqual([45.5, 68.0, -12.5]);
      expect(parsed.rotation).toEqual([2.1, 0.4]);
      expect(parsed.mode).toBe('creative');
      expect(parsed.selectedSlot).toBe(7);

      const targetPlayer = new Player(collision, () => true);
      applyPlayerData(targetPlayer, parsed);

      expect(targetPlayer.pos[0]).toBeCloseTo(45.5);
      expect(targetPlayer.pos[1]).toBeCloseTo(68.0);
      expect(targetPlayer.pos[2]).toBeCloseTo(-12.5);
      expect(targetPlayer.yaw).toBeCloseTo(2.1);
      expect(targetPlayer.pitch).toBeCloseTo(0.4);
      expect(targetPlayer.mode).toBe('creative');
      expect(targetPlayer.selectedSlot).toBe(7);
    });

    it('rejects corrupted player data', () => {
      const invalid = { position: [1, 2], rotation: [0], mode: 'spectator' };
      expect(() =>
        deserializePlayerData(new TextEncoder().encode(JSON.stringify(invalid))),
      ).toThrowError(/Invalid player data/);
    });
  });

  // -------------------------------------------------------------------------
  // 5. World Metadata
  // -------------------------------------------------------------------------
  describe('World Metadata', () => {
    it('round-trips seed, timeOfDay, weather, and world.breakCount losslessly', () => {
      const metadata: SerializedWorldMetadata = {
        seed: 987654321,
        timeOfDay: 14500,
        weather: 'thunder',
        breakCount: 42,
        worldType: 'default',
      };

      const serialized = serializeWorldMetadata(metadata);
      const deserialized = deserializeWorldMetadata(serialized);

      expect(deserialized).toEqual(metadata);
    });

    it('rejects invalid world metadata fields', () => {
      const invalid = { seed: 'invalid', timeOfDay: -1, weather: 'sunny', breakCount: -5 };
      expect(() =>
        deserializeWorldMetadata(new TextEncoder().encode(JSON.stringify(invalid))),
      ).toThrowError(/Invalid world metadata/);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Unified World Save Container
  // -------------------------------------------------------------------------
  describe('Unified World Container (serializeWorld / deserializeWorld)', () => {
    it('round-trips complete world save package into ONE self-describing Uint8Array', async () => {
      // 1. Column 1: (0, 0)
      const col1 = new ChunkColumn(0, 0);
      col1.getOrCreateSection(0)!.fill(28); // foundation
      col1.getOrCreateSection(1)!.fill(24); // stone

      // 2. Column 2: (1, -1)
      const col2 = new ChunkColumn(1, -1);
      col2.getOrCreateSection(0)!.fill(27); // dirt

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
        breakCount: 15,
      };

      const worldSave: WorldSaveData = {
        metadata,
        player,
        inventory,
        columns: [col1, col2],
        blockEntities,
        itemEntities,
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

      expect(restored.columns.length).toBe(2);
      expect(restored.columns[0]!.cx).toBe(0);
      expect(restored.columns[0]!.cz).toBe(0);
      expect(restored.columns[0]!.getBlockStateId(0, 0, 0)).toBe(28);
      expect(restored.columns[0]!.getBlockStateId(0, 16, 0)).toBe(24);

      expect(restored.columns[1]!.cx).toBe(1);
      expect(restored.columns[1]!.cz).toBe(-1);
      expect(restored.columns[1]!.getBlockStateId(0, 0, 0)).toBe(27);
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
        metadata: { seed: 1, timeOfDay: 0, weather: 'clear', breakCount: 0 },
        player: { position: [0, 0, 0], rotation: [0, 0], mode: 'survival', selectedSlot: 0 },
        inventory: { slots: Array.from({ length: 41 }, () => null), cursor: null, selectedSlot: 0 },
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
  });
});
