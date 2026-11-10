import { BinaryReader, BinaryWriter, type DecodeError } from './buffer';
import {
  MAX_CHUNK_BYTES,
  MAX_INVENTORY_SLOTS,
  CURSOR_SLOT,
  MOVE_FIELDS,
  MessageType,
  InventoryAction,
  type Message,
  type WireStack,
  type Vector3,
  type Rotation,
  type Weather,
  type EntityChanges,
} from './messages';
import type { DimensionId } from '../../world/dimension';

function dimension(w: BinaryWriter, value: DimensionId): void {
  if (value !== 'overworld' && value !== 'hollowdeep') throw new RangeError('Unknown dimension');
  w.u8(value === 'overworld' ? 0 : 1);
}
function readDimension(r: BinaryReader): DimensionId {
  return r.bounded(r.u8(), 1) === 0 ? 'overworld' : 'hollowdeep';
}
function vector(w: BinaryWriter, v: Vector3): void {
  w.f64(v[0]);
  w.f64(v[1]);
  w.f64(v[2]);
}
function readVector(r: BinaryReader): Vector3 {
  return [r.f64(), r.f64(), r.f64()];
}
function rotation(w: BinaryWriter, v: Rotation): void {
  w.f64(v[0]);
  w.f64(v[1]);
}
function readRotation(r: BinaryReader): Rotation {
  return [r.f64(), r.f64()];
}
function slot(w: BinaryWriter, value: number): void {
  if (value !== CURSOR_SLOT) w.integer(value, 0, MAX_INVENTORY_SLOTS - 1);
  w.u8(value);
}
function readSlot(r: BinaryReader): number {
  const value = r.u8();
  if (value !== CURSOR_SLOT && value >= MAX_INVENTORY_SLOTS)
    r.fail('value', 'Invalid inventory slot');
  return value;
}
function stack(w: BinaryWriter, value: WireStack | null): void {
  w.bool(value !== null);
  if (!value) return;
  w.string(value.id);
  w.integer(value.count, 1, 65535);
  w.u16(value.count);
  // Presence represents the actual stack variants (absent and null damage are distinct).
  w.u8(value.damage === undefined ? 0 : value.damage === null ? 1 : 2);
  if (value.damage !== undefined && value.damage !== null) w.u32(value.damage);
  const affix =
    value.affix === undefined
      ? 0
      : value.affix === 'Keen'
        ? 1
        : value.affix === 'Sturdy'
          ? 2
          : value.affix === 'Swift'
            ? 3
            : -1;
  w.u8(affix);
}
function readStack(r: BinaryReader): WireStack | null {
  if (!r.bool()) return null;
  const value: WireStack = { id: r.string(), count: r.u16() };
  if (!value.count) r.fail('value', 'Empty item stack must be null');
  const damage = r.bounded(r.u8(), 2);
  if (damage === 1) value.damage = null;
  else if (damage === 2) value.damage = r.u32();
  const affix = r.bounded(r.u8(), 3);
  if (affix) value.affix = affix === 1 ? 'Keen' : affix === 2 ? 'Sturdy' : 'Swift';
  return value;
}
function moves(w: BinaryWriter, changes: EntityChanges): void {
  let changed = 0,
    absolute = 0;
  for (let i = 0; i < MOVE_FIELDS.length; i++) {
    const v = changes[MOVE_FIELDS[i]!];
    if (!v) continue;
    changed |= 1 << i;
    if ('absolute' in v) absolute |= 1 << i;
  }
  w.u8(changed);
  w.u8(absolute);
  for (const key of MOVE_FIELDS) {
    const v = changes[key];
    if (!v) continue;
    if ('absolute' in v) w.f64(v.absolute);
    else w.i16(v.delta * 4096);
  }
}
function readMoves(r: BinaryReader): EntityChanges {
  const changed = r.bounded(r.u8(), 31),
    absolute = r.bounded(r.u8(), 31);
  if (absolute & ~changed) r.fail('value', 'Absolute mask contains unchanged fields');
  const changes: EntityChanges = {};
  for (let i = 0; i < MOVE_FIELDS.length && !r.error; i++) {
    if (changed & (1 << i))
      changes[MOVE_FIELDS[i]!] =
        absolute & (1 << i) ? { absolute: r.f64() } : { delta: r.i16() / 4096 };
  }
  return changes;
}

/** Encodes one frame into borrowed reusable storage. Copy the result before reusing the writer if queued. */
export function encodeMessage(message: Message, writer: BinaryWriter): Uint8Array {
  const w = writer;
  w.reset();
  w.u8(message.type);
  switch (message.type) {
    case MessageType.ClientHello:
      w.u16(message.version);
      w.string(message.name);
      break;
    case MessageType.ServerHello:
      w.u32(message.entityId);
      w.u32(message.seed);
      vector(w, message.spawn);
      dimension(w, message.dimension);
      w.f64(message.time);
      break;
    case MessageType.LoginReject:
    case MessageType.Disconnect:
      w.string(message.reason);
      break;
    case MessageType.Ping:
    case MessageType.Pong:
    case MessageType.EntityRemove:
      w.u32(message.id);
      break;
    case MessageType.ChunkData:
    case MessageType.ChunkUnload:
      dimension(w, message.dimension);
      w.i32(message.cx);
      w.i32(message.cz);
      if (message.type === MessageType.ChunkData) w.payload(message.payload);
      break;
    case MessageType.BlockUpdate:
      dimension(w, message.dimension);
      w.i32(message.x);
      w.integer(message.y, 0, 319);
      w.u16(message.y);
      w.i32(message.z);
      w.u16(message.stateId);
      break;
    case MessageType.PlayerInput:
      w.u32(message.sequence);
      rotation(w, message.movement);
      rotation(w, message.look);
      w.integer(message.actions, 0, 63);
      w.u8(message.actions);
      break;
    case MessageType.PlayerCorrection:
      w.u32(message.acknowledged);
      vector(w, message.position);
      vector(w, message.velocity);
      break;
    case MessageType.EntitySpawn:
      w.u32(message.id);
      w.string(message.kind);
      vector(w, message.position);
      rotation(w, message.rotation);
      w.bool(message.name !== undefined);
      if (message.name !== undefined) w.string(message.name);
      break;
    case MessageType.EntityMove:
      w.u32(message.id);
      moves(w, message.changes);
      break;
    case MessageType.InventorySync:
      w.u32(message.windowId);
      w.u32(message.revision);
      w.integer(message.slots.length, 0, MAX_INVENTORY_SLOTS);
      w.u16(message.slots.length);
      for (const value of message.slots) stack(w, value);
      stack(w, message.cursor);
      break;
    case MessageType.InventorySlot:
      w.u32(message.windowId);
      w.u32(message.revision);
      slot(w, message.slot);
      stack(w, message.stack);
      break;
    case MessageType.InventoryTransaction:
      w.u32(message.requestId);
      w.u32(message.windowId);
      w.u32(message.revision);
      w.integer(message.action, 0, InventoryAction.SelectSlot);
      w.u8(message.action);
      slot(w, message.slot);
      w.integer(message.slots.length, 0, MAX_INVENTORY_SLOTS);
      w.u16(message.slots.length);
      for (const value of message.slots) slot(w, value);
      break;
    case MessageType.InventoryResult:
      w.u32(message.requestId);
      w.u32(message.revision);
      w.bool(message.accepted);
      w.string(message.reason);
      break;
    case MessageType.ChatSend:
      w.string(message.text);
      break;
    case MessageType.ChatBroadcast:
      w.u32(message.senderId);
      w.string(message.name);
      w.string(message.text);
      break;
    case MessageType.TimeSync:
      dimension(w, message.dimension);
      w.f64(message.time);
      break;
    case MessageType.WeatherSync:
      dimension(w, message.dimension);
      if (
        message.weather !== 'clear' &&
        message.weather !== 'rain' &&
        message.weather !== 'thunder'
      )
        throw new RangeError('Unknown weather');
      w.u8(message.weather === 'clear' ? 0 : message.weather === 'rain' ? 1 : 2);
      w.u32(message.remainingTicks);
      break;
    default: {
      const exhaustive: never = message;
      throw new RangeError(`Unknown message: ${exhaustive}`);
    }
  }
  return w.finish();
}

export type DecodeResult = { ok: true; message: Message } | { ok: false; error: DecodeError };

/** Untrusted bytes never escape as exceptions. Chunk payloads borrow the supplied frame. */
export function decodeMessage(bytes: Uint8Array): DecodeResult {
  // Maximum valid inventory frames are smaller than a chunk frame.
  if (bytes.byteLength > MAX_CHUNK_BYTES + 64)
    return { ok: false, error: { code: 'length', offset: 0, message: 'Frame exceeds limit' } };
  const r = new BinaryReader(bytes);
  const type = r.u8();
  let message: Message;
  switch (type) {
    case MessageType.ClientHello:
      message = { type, version: r.u16(), name: r.string() };
      break;
    case MessageType.ServerHello:
      message = {
        type,
        entityId: r.u32(),
        seed: r.u32(),
        spawn: readVector(r),
        dimension: readDimension(r),
        time: r.f64(),
      };
      break;
    case MessageType.LoginReject:
    case MessageType.Disconnect:
      message = { type, reason: r.string() };
      break;
    case MessageType.Ping:
    case MessageType.Pong:
    case MessageType.EntityRemove:
      message = { type, id: r.u32() };
      break;
    case MessageType.ChunkData:
      message = {
        type,
        dimension: readDimension(r),
        cx: r.i32(),
        cz: r.i32(),
        payload: r.payload(),
      };
      break;
    case MessageType.ChunkUnload:
      message = { type, dimension: readDimension(r), cx: r.i32(), cz: r.i32() };
      break;
    case MessageType.BlockUpdate:
      message = {
        type,
        dimension: readDimension(r),
        x: r.i32(),
        y: r.bounded(r.u16(), 319),
        z: r.i32(),
        stateId: r.u16(),
      };
      break;
    case MessageType.PlayerInput:
      message = {
        type,
        sequence: r.u32(),
        movement: readRotation(r),
        look: readRotation(r),
        actions: r.bounded(r.u8(), 63),
      };
      break;
    case MessageType.PlayerCorrection:
      message = { type, acknowledged: r.u32(), position: readVector(r), velocity: readVector(r) };
      break;
    case MessageType.EntitySpawn: {
      message = {
        type,
        id: r.u32(),
        kind: r.string(),
        position: readVector(r),
        rotation: readRotation(r),
      };
      if (r.bool()) message.name = r.string();
      break;
    }
    case MessageType.EntityMove:
      message = { type, id: r.u32(), changes: readMoves(r) };
      break;
    case MessageType.InventorySync: {
      const windowId = r.u32(),
        revision = r.u32(),
        length = r.bounded(r.u16(), MAX_INVENTORY_SLOTS);
      const slots: (WireStack | null)[] = [];
      // Every slot needs at least one presence byte. Check before allocating any records.
      if (r.has(length)) for (let i = 0; i < length && !r.error; i++) slots.push(readStack(r));
      message = { type, windowId, revision, slots, cursor: readStack(r) };
      break;
    }
    case MessageType.InventorySlot:
      message = {
        type,
        windowId: r.u32(),
        revision: r.u32(),
        slot: readSlot(r),
        stack: readStack(r),
      };
      break;
    case MessageType.InventoryTransaction: {
      const requestId = r.u32(),
        windowId = r.u32(),
        revision = r.u32(),
        action = r.bounded(r.u8(), InventoryAction.SelectSlot),
        slot = readSlot(r),
        length = r.bounded(r.u16(), MAX_INVENTORY_SLOTS);
      const slots: number[] = [];
      if (r.has(length)) for (let i = 0; i < length && !r.error; i++) slots.push(readSlot(r));
      message = { type, requestId, windowId, revision, action, slot, slots };
      break;
    }
    case MessageType.InventoryResult:
      message = {
        type,
        requestId: r.u32(),
        revision: r.u32(),
        accepted: r.bool(),
        reason: r.string(),
      };
      break;
    case MessageType.ChatSend:
      message = { type, text: r.string() };
      break;
    case MessageType.ChatBroadcast:
      message = { type, senderId: r.u32(), name: r.string(), text: r.string() };
      break;
    case MessageType.TimeSync:
      message = { type, dimension: readDimension(r), time: r.f64() };
      break;
    case MessageType.WeatherSync: {
      const dimension = readDimension(r),
        value = r.bounded(r.u8(), 2);
      const weather: Weather = value === 0 ? 'clear' : value === 1 ? 'rain' : 'thunder';
      message = { type, dimension, weather, remainingTicks: r.u32() };
      break;
    }
    default:
      r.fail('type', `Unknown message type ${type}`);
      return { ok: false, error: r.error! };
  }
  r.end();
  return r.error ? { ok: false, error: r.error } : { ok: true, message };
}
