import type { DimensionId } from '../../world/dimension';
import type { ItemAffix } from '../../gameplay/items';

/** Change this when any wire layout or enum meaning changes. */
export const PROTOCOL_VERSION = 2;
export const MAX_STRING_BYTES = 256;
export const MAX_CHUNK_BYTES = 1024 * 1024;
export const MAX_INVENTORY_SLOTS = 128;
export const CURSOR_SLOT = 255;

/** Stable wire ids; every frame contains exactly one message. */
export enum MessageType {
  ClientHello = 1,
  ServerHello,
  LoginReject,
  Disconnect,
  Ping,
  Pong,
  ChunkData,
  ChunkUnload,
  BlockUpdate,
  PlayerInput,
  PlayerCorrection,
  EntitySpawn,
  EntityMove,
  EntityRemove,
  InventorySync,
  InventorySlot,
  InventoryTransaction,
  InventoryResult,
  ChatSend,
  ChatBroadcast,
  TimeSync,
  WeatherSync,
  BlockAction,
}

export enum BlockActionKind {
  StartBreak,
  FinishBreak,
  AbortBreak,
  Place,
}
export const BLOCK_FACES = ['top', 'bottom', 'north', 'south', 'east', 'west'] as const;

export enum ActionFlag {
  Jump = 1,
  Sneak = 2,
  Sprint = 4,
  Attack = 8,
  Use = 16,
  Pick = 32,
}
export enum InventoryAction {
  LeftClick,
  RightClick,
  QuickMove,
  DropOne,
  DropStack,
  DragEven,
  DragOne,
  CollectAll,
  SelectSlot,
}
export type Vector3 = readonly [number, number, number];
export type Rotation = readonly [number, number];
export type Weather = 'clear' | 'rain' | 'thunder';
export interface WireStack {
  id: string;
  count: number;
  damage?: number | null;
  affix?: ItemAffix;
}
/** Delta values are exact multiples of 1/4096 in signed i16 range; absolute values are f64. */
export type MoveValue = { delta: number } | { absolute: number };
export const MOVE_FIELDS = ['x', 'y', 'z', 'yaw', 'pitch'] as const;
export type MoveField = (typeof MOVE_FIELDS)[number];
export type EntityChanges = Partial<Record<MoveField, MoveValue>>;
export interface EntityPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface Messages {
  [MessageType.BlockAction]: {
    type: MessageType.BlockAction;
    action: BlockActionKind;
    x: number;
    y: number;
    z: number;
    face: (typeof BLOCK_FACES)[number];
    heldSlot: number;
    sequence: number;
  };
  [MessageType.ClientHello]: { type: MessageType.ClientHello; version: number; name: string };
  [MessageType.ServerHello]: {
    type: MessageType.ServerHello;
    entityId: number;
    seed: number;
    spawn: Vector3;
    dimension: DimensionId;
    time: number;
  };
  [MessageType.LoginReject]: { type: MessageType.LoginReject; reason: string };
  [MessageType.Disconnect]: { type: MessageType.Disconnect; reason: string };
  [MessageType.Ping]: { type: MessageType.Ping; id: number };
  [MessageType.Pong]: { type: MessageType.Pong; id: number };
  [MessageType.ChunkData]: {
    type: MessageType.ChunkData;
    dimension: DimensionId;
    cx: number;
    cz: number;
    payload: Uint8Array;
  };
  [MessageType.ChunkUnload]: {
    type: MessageType.ChunkUnload;
    dimension: DimensionId;
    cx: number;
    cz: number;
  };
  [MessageType.BlockUpdate]: {
    type: MessageType.BlockUpdate;
    dimension: DimensionId;
    x: number;
    y: number;
    z: number;
    stateId: number;
  };
  [MessageType.PlayerInput]: {
    type: MessageType.PlayerInput;
    sequence: number;
    movement: readonly [number, number];
    look: Rotation;
    actions: number;
  };
  [MessageType.PlayerCorrection]: {
    type: MessageType.PlayerCorrection;
    acknowledged: number;
    position: Vector3;
    velocity: Vector3;
  };
  [MessageType.EntitySpawn]: {
    type: MessageType.EntitySpawn;
    id: number;
    kind: string;
    position: Vector3;
    rotation: Rotation;
    name?: string;
  };
  [MessageType.EntityMove]: { type: MessageType.EntityMove; id: number; changes: EntityChanges };
  [MessageType.EntityRemove]: { type: MessageType.EntityRemove; id: number };
  [MessageType.InventorySync]: {
    type: MessageType.InventorySync;
    windowId: number;
    revision: number;
    slots: readonly (WireStack | null)[];
    cursor: WireStack | null;
  };
  [MessageType.InventorySlot]: {
    type: MessageType.InventorySlot;
    windowId: number;
    revision: number;
    slot: number;
    stack: WireStack | null;
  };
  [MessageType.InventoryTransaction]: {
    type: MessageType.InventoryTransaction;
    requestId: number;
    windowId: number;
    revision: number;
    action: InventoryAction;
    slot: number;
    slots: readonly number[];
  };
  [MessageType.InventoryResult]: {
    type: MessageType.InventoryResult;
    requestId: number;
    revision: number;
    accepted: boolean;
    reason: string;
  };
  [MessageType.ChatSend]: { type: MessageType.ChatSend; text: string };
  [MessageType.ChatBroadcast]: {
    type: MessageType.ChatBroadcast;
    senderId: number;
    name: string;
    text: string;
  };
  [MessageType.TimeSync]: { type: MessageType.TimeSync; dimension: DimensionId; time: number };
  [MessageType.WeatherSync]: {
    type: MessageType.WeatherSync;
    dimension: DimensionId;
    weather: Weather;
    remainingTicks: number;
  };
}
export type Message = Messages[MessageType];

/** Called during handshake, before accepting any simulation messages. */
export function rejectIncompatibleVersion(
  version: number,
): Messages[MessageType.LoginReject] | null {
  return version === PROTOCOL_VERSION
    ? null
    : {
        type: MessageType.LoginReject,
        reason: `Protocol version mismatch: server requires ${PROTOCOL_VERSION}, client sent ${version}`,
      };
}

/** Allocate one message and its field storage per recipient; reuse it for every update. */
export function createEntityMove(id: number): Messages[MessageType.EntityMove] {
  const message: Messages[MessageType.EntityMove] = {
    type: MessageType.EntityMove,
    id,
    changes: {},
  };
  moveStorage.set(
    message,
    MOVE_FIELDS.map(() => ({ delta: 0, absolute: 0 })),
  );
  return message;
}
const moveStorage = new WeakMap<
  Messages[MessageType.EntityMove],
  Array<{ delta: number; absolute: number }>
>();

/** Quantize against the reconstructed sender baseline, updating it in place. */
export function entityMove(
  id: number,
  previous: EntityPose,
  next: EntityPose,
  message: Messages[MessageType.EntityMove],
): Messages[MessageType.EntityMove] {
  const storage = moveStorage.get(message);
  if (!storage) throw new Error('Use createEntityMove to allocate reusable movement storage');
  message.id = id;
  for (let i = 0; i < MOVE_FIELDS.length; i++) {
    const key = MOVE_FIELDS[i]!;
    const q = Math.round((next[key] - previous[key]) * 4096);
    if (q === 0) {
      delete message.changes[key];
      continue;
    }
    const value = storage[i]!;
    if (Number.isFinite(next[key]) && q >= -32768 && q <= 32767) {
      delete (value as Partial<typeof value>).absolute;
      value.delta = q / 4096;
      previous[key] += value.delta;
    } else {
      delete (value as Partial<typeof value>).delta;
      value.absolute = next[key];
      previous[key] = next[key];
    }
    message.changes[key] = value;
  }
  return message;
}
/** Apply in place; the caller owns the pose and its interpolation history. */
export function applyEntityMove(pose: EntityPose, message: Messages[MessageType.EntityMove]): void {
  for (const key of MOVE_FIELDS) {
    const value = message.changes[key];
    if (value) pose[key] = 'delta' in value ? pose[key] + value.delta : value.absolute;
  }
}
