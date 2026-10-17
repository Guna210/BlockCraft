import { type BlockEntityInstance, isPlainJsonObject } from '../world/block-entities';
import { Inventory } from '../gameplay/inventory';
import { items } from '../gameplay/items';
import type { ItemEntity } from '../entity/item-entity';
import type { Player, PlayerSnapshot } from '../entity/player';
import type { ChunkColumn } from '../world/column';
import { BlockTicks, type ScheduledTick } from '../world/ticks';
import { serializeColumn, deserializeColumn } from './column-format';
import { FORMAT_VERSION, migrations } from './version';

// ---------------------------------------------------------------------------
// 1. Block Entities
// ---------------------------------------------------------------------------

export function serializeBlockEntities(entities: ReadonlyArray<BlockEntityInstance>): Uint8Array {
  for (const e of entities) {
    if (!isPlainJsonObject(e.state)) {
      throw new Error(`Block entity state at (${e.x},${e.y},${e.z}) is not a plain JSON object`);
    }
  }
  const json = JSON.stringify(entities);
  return new TextEncoder().encode(json);
}

export function deserializeBlockEntities(bytes: Uint8Array): BlockEntityInstance[] {
  const json = new TextDecoder().decode(bytes);
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Invalid block entities data');
  }
  if (!Array.isArray(data)) {
    throw new Error('Deserialized block entities data must be an array');
  }
  for (const item of data) {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof item.blockId !== 'string' ||
      !Number.isInteger(item.x) ||
      !Number.isInteger(item.y) ||
      !Number.isInteger(item.z) ||
      !isPlainJsonObject(item.state)
    ) {
      throw new Error('Invalid block entity instance data');
    }
  }
  return data as BlockEntityInstance[];
}

// ---------------------------------------------------------------------------
// 2. Inventory (41 slots + cursor stack + selectedSlot)
// ---------------------------------------------------------------------------

export interface SerializedItemStack {
  slot: number;
  id: string;
  count: number;
}

export interface SerializedInventory {
  slots: Array<SerializedItemStack | null>;
  cursor: { id: string; count: number } | null;
  selectedSlot: number;
}

const ARMOR_SLOTS = ['head', 'chest', 'legs', 'feet'] as const;

export function serializeInventory(inv: Inventory | SerializedInventory): Uint8Array {
  let serializable: SerializedInventory;
  if (inv instanceof Inventory) {
    serializable = {
      slots: inv.snapshot(true),
      cursor: inv.cursorSnapshot(),
      selectedSlot: inv.selectedSlot,
    };
  } else {
    serializable = inv;
  }
  const json = JSON.stringify(serializable);
  return new TextEncoder().encode(json);
}

export function deserializeInventory(
  bytes: Uint8Array,
  targetInv?: Inventory,
): SerializedInventory {
  const json = new TextDecoder().decode(bytes);
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Invalid inventory data');
  }
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid inventory data');
  }
  const invData = data as Partial<SerializedInventory>;
  if (!Array.isArray(invData.slots) || invData.slots.length !== 41) {
    throw new Error(`Inventory slots must be an array of length 41, got ${invData.slots?.length}`);
  }
  if (
    typeof invData.selectedSlot !== 'number' ||
    !Number.isInteger(invData.selectedSlot) ||
    invData.selectedSlot < 0 ||
    invData.selectedSlot > 8
  ) {
    throw new Error(`Invalid selectedSlot: ${invData.selectedSlot}`);
  }

  // Validate each slot
  for (let i = 0; i < 41; i++) {
    const stack = invData.slots[i];
    if (stack !== null && stack !== undefined) {
      if (typeof stack !== 'object' || stack.slot !== i || typeof stack.id !== 'string') {
        throw new Error(`Invalid item stack at slot ${i}`);
      }
      let itemDef;
      try {
        itemDef = items.get(stack.id);
      } catch {
        throw new Error(`Unknown item ID at slot ${i}: '${stack.id}'`);
      }
      if (!Number.isSafeInteger(stack.count) || stack.count < 1 || stack.count > itemDef.maxStack) {
        throw new Error(
          `Invalid stack count at slot ${i}: ${stack.count} (max ${itemDef.maxStack})`,
        );
      }
      // Check armor constraints
      if (i >= 36 && i <= 39) {
        const armorSlot = ARMOR_SLOTS[i - 36];
        if (itemDef.armorSlot !== armorSlot) {
          throw new Error(`Item '${stack.id}' cannot be placed in armor slot ${armorSlot}`);
        }
      }
    }
  }

  // Validate cursor
  if (invData.cursor !== null && invData.cursor !== undefined) {
    const cursor = invData.cursor;
    if (typeof cursor !== 'object' || typeof cursor.id !== 'string') {
      throw new Error('Invalid cursor stack');
    }
    let itemDef;
    try {
      itemDef = items.get(cursor.id);
    } catch {
      throw new Error(`Unknown cursor item ID: '${cursor.id}'`);
    }
    if (
      !Number.isSafeInteger(cursor.count) ||
      cursor.count < 1 ||
      cursor.count > itemDef.maxStack
    ) {
      throw new Error(`Invalid cursor stack count: ${cursor.count}`);
    }
  } else {
    invData.cursor = null;
  }

  const result: SerializedInventory = {
    slots: invData.slots.map((s, idx) => (s ? { slot: idx, id: s.id, count: s.count } : null)),
    cursor: invData.cursor ? { id: invData.cursor.id, count: invData.cursor.count } : null,
    selectedSlot: invData.selectedSlot,
  };

  if (targetInv) {
    for (let i = 0; i < 41; i++) {
      targetInv.slots[i] = result.slots[i] ? { ...result.slots[i]! } : null;
    }
    targetInv.cursor = result.cursor ? { ...result.cursor } : null;
    targetInv.selectedSlot = result.selectedSlot;
    targetInv.assertInvariant();
  }

  return result;
}

// ---------------------------------------------------------------------------
// 3. Item Entities
// ---------------------------------------------------------------------------

export interface SerializedItemEntity {
  id: string;
  count: number;
  position: [number, number, number];
  velocity: [number, number, number];
  pickupDelay: number;
  age: number;
}

export function serializeItemEntities(
  entities: ReadonlyArray<ItemEntity | SerializedItemEntity>,
): Uint8Array {
  const serializable: SerializedItemEntity[] = entities.map((e) => {
    if ('item' in e && typeof e.item === 'object' && e.item !== null) {
      return {
        id: e.item.id,
        count: e.count,
        position: [e.pos[0], e.pos[1], e.pos[2]],
        velocity: [e.vel[0], e.vel[1], e.vel[2]],
        pickupDelay: e.pickupDelay,
        age: e.age,
      };
    } else {
      const entityObj = e as unknown as Record<string, unknown>;
      const pos = (entityObj['position'] ?? entityObj['pos']) as [number, number, number];
      const vel = (entityObj['velocity'] ?? entityObj['vel']) as [number, number, number];
      const id = typeof e.id === 'string' ? e.id : String(e.id);
      return {
        id,
        count: e.count,
        position: [pos[0], pos[1], pos[2]],
        velocity: [vel[0], vel[1], vel[2]],
        pickupDelay: e.pickupDelay,
        age: e.age,
      };
    }
  });

  const json = JSON.stringify(serializable);
  return new TextEncoder().encode(json);
}

export function deserializeItemEntities(bytes: Uint8Array): SerializedItemEntity[] {
  const json = new TextDecoder().decode(bytes);
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Invalid item entity data');
  }
  if (!Array.isArray(data)) {
    throw new Error('Deserialized item entities must be an array');
  }
  for (const item of data) {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof item.id !== 'string' ||
      !Number.isSafeInteger(item.count) ||
      item.count < 1 ||
      !Array.isArray(item.position) ||
      item.position.length !== 3 ||
      !item.position.every(Number.isFinite) ||
      !Array.isArray(item.velocity) ||
      item.velocity.length !== 3 ||
      !item.velocity.every(Number.isFinite) ||
      typeof item.pickupDelay !== 'number' ||
      typeof item.age !== 'number'
    ) {
      throw new Error('Invalid item entity data');
    }
    try {
      items.get(item.id);
    } catch {
      throw new Error(`Unknown item ID in item entity: '${item.id}'`);
    }
  }
  return data as SerializedItemEntity[];
}

// ---------------------------------------------------------------------------
// 4. Player Data
// ---------------------------------------------------------------------------

export interface SerializedPlayerData {
  position: [number, number, number];
  rotation: [number, number]; // [yaw, pitch]
  mode: 'survival' | 'creative';
  selectedSlot: number;
  health: number;
  hunger: number;
  saturation: number;
  air: number;
  flying: boolean;
  dimension: string;
}

export function serializePlayerData(
  player: Player | PlayerSnapshot | SerializedPlayerData,
): Uint8Array {
  let serializable: SerializedPlayerData;
  if ('pos' in player && 'yaw' in player && 'health' in player) {
    const flying =
      'flying' in player && typeof (player as { flying?: unknown }).flying === 'boolean'
        ? (player as { flying: boolean }).flying
        : false;
    serializable = {
      position: [player.pos[0], player.pos[1], player.pos[2]],
      rotation: [player.yaw, player.pitch],
      mode: player.mode as 'survival' | 'creative',
      selectedSlot: player.selectedSlot,
      health: player.health,
      hunger: player.hunger,
      saturation: player.saturation,
      air: player.air,
      flying,
      dimension: player.dimension,
    };
  } else {
    serializable = player as SerializedPlayerData;
  }
  const json = JSON.stringify(serializable);
  return new TextEncoder().encode(json);
}

export function deserializePlayerData(bytes: Uint8Array): SerializedPlayerData {
  const json = new TextDecoder().decode(bytes);
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Invalid player data');
  }
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid player data');
  }
  const d = data as Record<string, unknown>;
  const pos = d['position'];
  const rot = d['rotation'];
  const mode = d['mode'];
  const selectedSlot = d['selectedSlot'];
  const health = d['health'];
  const hunger = d['hunger'];
  const saturation = d['saturation'];
  const air = d['air'];
  const flying = d['flying'];
  const dimension = d['dimension'];

  if (
    !Array.isArray(pos) ||
    pos.length !== 3 ||
    !pos.every((n) => typeof n === 'number' && Number.isFinite(n)) ||
    !Array.isArray(rot) ||
    rot.length !== 2 ||
    !rot.every((n) => typeof n === 'number' && Number.isFinite(n)) ||
    (mode !== 'survival' && mode !== 'creative') ||
    typeof selectedSlot !== 'number' ||
    !Number.isInteger(selectedSlot) ||
    selectedSlot < 0 ||
    selectedSlot > 8 ||
    typeof health !== 'number' ||
    !Number.isFinite(health) ||
    health < 0 ||
    typeof hunger !== 'number' ||
    !Number.isFinite(hunger) ||
    hunger < 0 ||
    typeof saturation !== 'number' ||
    !Number.isFinite(saturation) ||
    saturation < 0 ||
    typeof air !== 'number' ||
    !Number.isFinite(air) ||
    air < 0 ||
    typeof flying !== 'boolean' ||
    typeof dimension !== 'string' ||
    dimension.length === 0
  ) {
    throw new Error('Invalid player data');
  }
  return {
    position: [pos[0] as number, pos[1] as number, pos[2] as number],
    rotation: [rot[0] as number, rot[1] as number],
    mode,
    selectedSlot,
    health,
    hunger,
    saturation,
    air,
    flying,
    dimension,
  };
}

export function applyPlayerData(player: Player, data: SerializedPlayerData): void {
  player.teleport(
    data.position[0],
    data.position[1],
    data.position[2],
    data.rotation[0],
    data.rotation[1],
  );
  player.mode = data.mode;
  player.selectedSlot = data.selectedSlot;
  player.health = data.health;
  player.hunger = data.hunger;
  player.saturation = data.saturation;
  player.air = data.air;
  player.flying = data.flying;
  player.dimension = data.dimension;
}

// ---------------------------------------------------------------------------
// 5. World Metadata
// ---------------------------------------------------------------------------

export interface SerializedWorldMetadata {
  seed: number;
  timeOfDay: number;
  weather: 'clear' | 'rain' | 'thunder';
  manualOverride: boolean;
  strikeCounter: number;
  lastTick: number;
  elapsed: number;
  breakCount: number;
  worldType?: 'default' | 'flat';
}

export function serializeWorldMetadata(
  meta: Partial<SerializedWorldMetadata> & {
    seed: number;
    timeOfDay: number;
    weather: 'clear' | 'rain' | 'thunder';
    breakCount: number;
  },
): Uint8Array {
  const serializable: SerializedWorldMetadata = {
    seed: meta.seed,
    timeOfDay: meta.timeOfDay,
    weather: meta.weather,
    manualOverride: meta.manualOverride ?? false,
    strikeCounter: meta.strikeCounter ?? 0,
    lastTick: meta.lastTick ?? -1,
    elapsed: meta.elapsed ?? 0,
    breakCount: meta.breakCount,
    worldType: meta.worldType,
  };
  const json = JSON.stringify(serializable);
  return new TextEncoder().encode(json);
}

export function deserializeWorldMetadata(bytes: Uint8Array): SerializedWorldMetadata {
  const json = new TextDecoder().decode(bytes);
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Invalid world metadata');
  }
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid world metadata');
  }
  const d = data as Record<string, unknown>;
  const seed = d['seed'];
  const timeOfDay = d['timeOfDay'];
  const weather = d['weather'];
  const manualOverride = d['manualOverride'] ?? false;
  const strikeCounter = d['strikeCounter'] ?? 0;
  const lastTick = d['lastTick'] ?? -1;
  const elapsed = d['elapsed'] ?? 0;
  const breakCount = d['breakCount'];
  const worldType = d['worldType'];
  if (
    typeof seed !== 'number' ||
    !Number.isFinite(seed) ||
    typeof timeOfDay !== 'number' ||
    !Number.isFinite(timeOfDay) ||
    timeOfDay < 0 ||
    (weather !== 'clear' && weather !== 'rain' && weather !== 'thunder') ||
    typeof manualOverride !== 'boolean' ||
    typeof strikeCounter !== 'number' ||
    !Number.isInteger(strikeCounter) ||
    strikeCounter < 0 ||
    typeof lastTick !== 'number' ||
    !Number.isInteger(lastTick) ||
    lastTick < -1 ||
    typeof elapsed !== 'number' ||
    !Number.isInteger(elapsed) ||
    elapsed < 0 ||
    typeof breakCount !== 'number' ||
    !Number.isInteger(breakCount) ||
    breakCount < 0
  ) {
    throw new Error('Invalid world metadata');
  }
  return {
    seed,
    timeOfDay,
    weather,
    manualOverride,
    strikeCounter,
    lastTick,
    elapsed,
    breakCount,
    worldType: worldType === 'default' || worldType === 'flat' ? worldType : undefined,
  };
}

// ---------------------------------------------------------------------------
// 6. Scheduled Block Ticks
// ---------------------------------------------------------------------------

export interface SerializedBlockTicks {
  time: number;
  ticks: ScheduledTick[];
}

export function serializeBlockTicks(
  source: BlockTicks | SerializedBlockTicks | ScheduledTick[],
  time?: number,
): Uint8Array {
  let data: SerializedBlockTicks;
  if (source instanceof BlockTicks) {
    data = {
      time: source.time,
      ticks: source.getPendingTicks(),
    };
  } else if (Array.isArray(source)) {
    data = {
      time: time ?? 0,
      ticks: source,
    };
  } else {
    data = source;
  }

  if (typeof data.time !== 'number' || !Number.isInteger(data.time) || !Array.isArray(data.ticks)) {
    throw new Error('Invalid block ticks data');
  }

  for (const t of data.ticks) {
    if (
      typeof t !== 'object' ||
      t === null ||
      !Number.isInteger(t.x) ||
      !Number.isInteger(t.y) ||
      !Number.isInteger(t.z) ||
      typeof t.type !== 'string' ||
      !Number.isInteger(t.due) ||
      !Number.isInteger(t.priority) ||
      !Number.isInteger(t.order)
    ) {
      throw new Error('Invalid block tick entry');
    }
  }

  const json = JSON.stringify(data);
  return new TextEncoder().encode(json);
}

export function deserializeBlockTicks(bytes: Uint8Array): SerializedBlockTicks {
  const json = new TextDecoder().decode(bytes);
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Invalid block ticks data');
  }
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid block ticks data');
  }
  const d = data as Record<string, unknown>;
  const time = d['time'];
  const ticks = d['ticks'];
  if (typeof time !== 'number' || !Number.isInteger(time) || !Array.isArray(ticks)) {
    throw new Error('Invalid block ticks data');
  }
  for (const t of ticks) {
    if (
      typeof t !== 'object' ||
      t === null ||
      !Number.isInteger(t.x) ||
      !Number.isInteger(t.y) ||
      !Number.isInteger(t.z) ||
      typeof t.type !== 'string' ||
      !Number.isInteger(t.due) ||
      !Number.isInteger(t.priority) ||
      !Number.isInteger(t.order)
    ) {
      throw new Error('Invalid block tick entry');
    }
  }
  return {
    time,
    ticks: ticks as ScheduledTick[],
  };
}

export function serializeColumnTicks(ticks: BlockTicks, cx: number, cz: number): Uint8Array {
  const colTicks = ticks.getPendingTicksForColumn(cx, cz);
  return serializeBlockTicks({ time: ticks.time, ticks: colTicks });
}

// ---------------------------------------------------------------------------
// 7. Whole World Container
// ---------------------------------------------------------------------------

export interface WorldSaveData {
  metadata: SerializedWorldMetadata;
  player: SerializedPlayerData;
  inventory: SerializedInventory;
  columns: ChunkColumn[];
  blockEntities: BlockEntityInstance[];
  itemEntities: SerializedItemEntity[];
  blockTicks?: SerializedBlockTicks;
}

export const WORLD_MAGIC = 0x44574342; // 'BCWD' in Little-Endian (0x42, 0x43, 0x57, 0x44)
export const WORLD_HEADER_SIZE = 34; // 4 magic + 2 version + 7 * 4 TOC

export async function serializeWorld(data: WorldSaveData): Promise<Uint8Array> {
  const metaBytes = serializeWorldMetadata(data.metadata);
  const playerBytes = serializePlayerData(data.player);
  const invBytes = serializeInventory(data.inventory);
  const beBytes = serializeBlockEntities(data.blockEntities);
  const ieBytes = serializeItemEntities(data.itemEntities);
  const ticksBytes = serializeBlockTicks(data.blockTicks ?? { time: 0, ticks: [] });

  const colEntries: Array<{ cx: number; cz: number; bytes: Uint8Array }> = [];
  for (const col of data.columns) {
    const bytes = await serializeColumn(col);
    colEntries.push({ cx: col.cx, cz: col.cz, bytes });
  }

  // Header: 4 magic + 2 version + 7 * 4 table of contents = 34 bytes
  let totalSize = WORLD_HEADER_SIZE;
  totalSize += metaBytes.length;
  totalSize += playerBytes.length;
  totalSize += invBytes.length;
  totalSize += beBytes.length;
  totalSize += ieBytes.length;
  totalSize += ticksBytes.length;

  for (const entry of colEntries) {
    totalSize += 12 + entry.bytes.length; // 4 cx + 4 cz + 4 length + payload
  }

  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

  // Magic 'BCWD'
  out[0] = 0x42;
  out[1] = 0x43;
  out[2] = 0x57;
  out[3] = 0x44;

  // Version
  view.setUint16(4, FORMAT_VERSION, true);

  // TOC
  view.setUint32(6, metaBytes.length, true);
  view.setUint32(10, playerBytes.length, true);
  view.setUint32(14, invBytes.length, true);
  view.setUint32(18, beBytes.length, true);
  view.setUint32(22, ieBytes.length, true);
  view.setUint32(26, ticksBytes.length, true);
  view.setUint32(30, colEntries.length, true);

  let offset = WORLD_HEADER_SIZE;

  out.set(metaBytes, offset);
  offset += metaBytes.length;

  out.set(playerBytes, offset);
  offset += playerBytes.length;

  out.set(invBytes, offset);
  offset += invBytes.length;

  out.set(beBytes, offset);
  offset += beBytes.length;

  out.set(ieBytes, offset);
  offset += ieBytes.length;

  out.set(ticksBytes, offset);
  offset += ticksBytes.length;

  for (const entry of colEntries) {
    view.setInt32(offset, entry.cx, true);
    view.setInt32(offset + 4, entry.cz, true);
    view.setUint32(offset + 8, entry.bytes.length, true);
    offset += 12;
    out.set(entry.bytes, offset);
    offset += entry.bytes.length;
  }

  return out;
}

export async function deserializeWorld(
  inputData: Uint8Array,
  options?: { targetVersion?: number },
): Promise<WorldSaveData> {
  if (inputData.length < WORLD_HEADER_SIZE) {
    throw new Error(
      `Truncated world data: buffer size ${inputData.length} is smaller than header size ${WORLD_HEADER_SIZE}`,
    );
  }

  let data = inputData;
  let view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  if (data[0] !== 0x42 || data[1] !== 0x43 || data[2] !== 0x57 || data[3] !== 0x44) {
    throw new Error('Invalid world format magic bytes');
  }

  const version = view.getUint16(4, true);
  const targetVersion = options?.targetVersion ?? FORMAT_VERSION;

  if (version !== targetVersion) {
    data = migrations.migrate('world', data, version, targetVersion);
    view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  if (data.length < WORLD_HEADER_SIZE) {
    throw new Error(
      `Truncated world data: buffer size ${data.length} is smaller than header size ${WORLD_HEADER_SIZE}`,
    );
  }

  const metaLen = view.getUint32(6, true);
  const playerLen = view.getUint32(10, true);
  const invLen = view.getUint32(14, true);
  const beLen = view.getUint32(18, true);
  const ieLen = view.getUint32(22, true);
  const ticksLen = view.getUint32(26, true);
  const colCount = view.getUint32(30, true);

  let offset = WORLD_HEADER_SIZE;

  function checkBounds(needed: number, field: string) {
    if (offset + needed > data.length) {
      throw new Error(
        `Truncated world data: expected ${needed} bytes for ${field} at offset ${offset}, have ${data.length - offset}`,
      );
    }
  }

  checkBounds(metaLen, 'metadata');
  const metaBytes = data.subarray(offset, offset + metaLen);
  offset += metaLen;

  checkBounds(playerLen, 'player data');
  const playerBytes = data.subarray(offset, offset + playerLen);
  offset += playerLen;

  checkBounds(invLen, 'inventory');
  const invBytes = data.subarray(offset, offset + invLen);
  offset += invLen;

  checkBounds(beLen, 'block entities');
  const beBytes = data.subarray(offset, offset + beLen);
  offset += beLen;

  checkBounds(ieLen, 'item entities');
  const ieBytes = data.subarray(offset, offset + ieLen);
  offset += ieLen;

  checkBounds(ticksLen, 'block ticks');
  const ticksBytes = data.subarray(offset, offset + ticksLen);
  offset += ticksLen;

  const metadata = deserializeWorldMetadata(metaBytes);
  const player = deserializePlayerData(playerBytes);
  const inventory = deserializeInventory(invBytes);
  const blockEntities = deserializeBlockEntities(beBytes);
  const itemEntities = deserializeItemEntities(ieBytes);
  const blockTicks = deserializeBlockTicks(ticksBytes);

  const columns: ChunkColumn[] = [];
  for (let i = 0; i < colCount; i++) {
    checkBounds(12, `column ${i} header`);
    const cx = view.getInt32(offset, true);
    const cz = view.getInt32(offset + 4, true);
    const colLen = view.getUint32(offset + 8, true);
    offset += 12;

    checkBounds(colLen, `column ${i} payload`);
    const colBytes = data.subarray(offset, offset + colLen);
    offset += colLen;

    const col = await deserializeColumn(colBytes);
    if (col.cx !== cx || col.cz !== cz) {
      throw new Error(
        `Column coordinate mismatch in world save: TOC (${cx},${cz}) != payload (${col.cx},${col.cz})`,
      );
    }
    columns.push(col);
  }

  if (offset < data.length) {
    throw new Error(`Unexpected trailing data in world save: ${data.length - offset} extra bytes`);
  }

  return {
    metadata,
    player,
    inventory,
    columns,
    blockEntities,
    itemEntities,
    blockTicks,
  };
}
