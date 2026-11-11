// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PRNG } from '../../src/engine/rng';
import {
  BinaryWriter,
  MessageType as T,
  InventoryAction,
  PROTOCOL_VERSION,
  MAX_CHUNK_BYTES,
  MAX_INVENTORY_SLOTS,
  CURSOR_SLOT,
  decodeMessage,
  encodeMessage,
  rejectIncompatibleVersion,
  entityMove,
  createEntityMove,
  applyEntityMove,
  type Messages,
  type Message,
} from '../../src/net/protocol';
import { deflate, inflate } from '../../src/persist/compress';

// Exhaustive at compile time and runtime. Enum additions must supply a real round-trip fixture.
const cases: { [K in T]: Messages[K] } = {
  [T.BlockAction]: {
    type: T.BlockAction,
    action: 0,
    x: -16,
    y: 319,
    z: 42,
    face: 'west',
    heldSlot: 8,
    sequence: 0xffffffff,
  },
  [T.ClientHello]: { type: T.ClientHello, version: PROTOCOL_VERSION, name: 'Ada 🌱' },
  [T.ServerHello]: {
    type: T.ServerHello,
    entityId: 0xffffffff,
    seed: 0xfedcba98,
    spawn: [-50000.125, 65, 20.5],
    dimension: 'hollowdeep',
    time: 24001,
  },
  [T.LoginReject]: { type: T.LoginReject, reason: 'Version mismatch' },
  [T.Disconnect]: { type: T.Disconnect, reason: 'Server stopped' },
  [T.Ping]: { type: T.Ping, id: 0xffffffff },
  [T.Pong]: { type: T.Pong, id: 0 },
  [T.ChunkData]: {
    type: T.ChunkData,
    dimension: 'hollowdeep',
    cx: -2147483648,
    cz: 2147483647,
    payload: new Uint8Array([0, 1, 255, 24, 9]),
  },
  [T.ChunkUnload]: { type: T.ChunkUnload, dimension: 'overworld', cx: -9, cz: 10 },
  [T.BlockUpdate]: {
    type: T.BlockUpdate,
    dimension: 'overworld',
    x: -15,
    y: 319,
    z: 42,
    stateId: 65535,
  },
  [T.PlayerInput]: {
    type: T.PlayerInput,
    sequence: 0xffffffff,
    movement: [-1, 0.5],
    look: [3.14, -1.2],
    actions: 63,
  },
  [T.PlayerCorrection]: {
    type: T.PlayerCorrection,
    acknowledged: 100,
    position: [0.1, 60.25, -10.1],
    velocity: [4.3, -0.3, 0],
  },
  [T.EntitySpawn]: {
    type: T.EntitySpawn,
    id: 5,
    kind: 'player',
    position: [-4.5, 8, 9],
    rotation: [1.2, -0.3],
    name: 'Åda',
  },
  [T.EntityMove]: {
    type: T.EntityMove,
    id: 7,
    changes: {
      x: { delta: -8 },
      y: { absolute: 125.1 },
      z: { delta: 32767 / 4096 },
      yaw: { delta: 0.25 },
      pitch: { absolute: -0.7 },
    },
  },
  [T.EntityRemove]: { type: T.EntityRemove, id: 99 },
  [T.InventorySync]: {
    type: T.InventorySync,
    windowId: 3,
    revision: 7,
    slots: [
      null,
      { id: 'iron_pickaxe', count: 1, damage: 42, affix: 'Sturdy' },
      { id: 'dirt', count: 64 },
      { id: 'stick', count: 2, damage: null },
      { id: 'bow', count: 1, affix: 'Keen' },
      { id: 'iron_sword', count: 1, affix: 'Swift' },
    ],
    cursor: { id: 'glass', count: 9 },
  },
  [T.InventorySlot]: {
    type: T.InventorySlot,
    windowId: 3,
    revision: 8,
    slot: CURSOR_SLOT,
    stack: null,
  },
  [T.InventoryTransaction]: {
    type: T.InventoryTransaction,
    requestId: 9,
    windowId: 3,
    revision: 8,
    action: InventoryAction.DragEven,
    slot: 0,
    slots: [0, 1, 40, 127],
  },
  [T.InventoryResult]: {
    type: T.InventoryResult,
    requestId: 9,
    revision: 9,
    accepted: false,
    reason: 'Stale inventory revision',
  },
  [T.ChatSend]: { type: T.ChatSend, text: 'Hello, 世界!' },
  [T.ChatBroadcast]: { type: T.ChatBroadcast, senderId: 5, name: 'Ada', text: 'Hello, 世界!' },
  [T.TimeSync]: { type: T.TimeSync, dimension: 'overworld', time: 1234567890 },
  [T.WeatherSync]: {
    type: T.WeatherSync,
    dimension: 'hollowdeep',
    weather: 'thunder',
    remainingTicks: 65536,
  },
};
const types = Object.values(T).filter((v): v is T => typeof v === 'number');
const writer = new BinaryWriter(1);
function bytes(m: Message): Uint8Array {
  return encodeMessage(m, writer).slice();
}
function roundTrip(m: Message): void {
  expect(decodeMessage(bytes(m))).toEqual({ ok: true, message: m });
}
function error(data: Uint8Array, code?: string): void {
  const result = decodeMessage(data);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.offset).toBeGreaterThanOrEqual(0);
    if (code) expect(result.error.code).toBe(code);
  }
}

describe('M21a protocol', () => {
  it('has exactly one fixture for every message enum member', () => {
    expect(
      Object.keys(cases)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual(types);
  });
  for (const type of types) it(`round-trips ${T[type]}`, () => roundTrip(cases[type]));

  it('pins u8 type, little endian version, string length and ping id on the wire', () => {
    expect([...bytes({ type: T.ClientHello, version: 0x1234, name: 'A' })]).toEqual([
      1, 0x34, 0x12, 1, 0, 65,
    ]);
    expect([...bytes({ type: T.Ping, id: 0x12345678 })]).toEqual([5, 0x78, 0x56, 0x34, 0x12]);
    expect(decodeMessage(new Uint8Array([6, 4, 3, 2, 1]))).toEqual({
      ok: true,
      message: { type: T.Pong, id: 0x01020304 },
    });
  });
  it('rejects incompatible versions with a clear encodable handshake response', () => {
    expect(rejectIncompatibleVersion(PROTOCOL_VERSION)).toBeNull();
    const rejection = rejectIncompatibleVersion(PROTOCOL_VERSION + 1)!;
    expect(rejection.reason).toContain(`server requires ${PROTOCOL_VERSION}`);
    expect(rejection.reason).toContain(`client sent ${PROTOCOL_VERSION + 1}`);
    roundTrip(rejection);
  });
  it('reuses writer storage and grows only when capacity is exhausted', () => {
    const w = new BinaryWriter(64);
    const a = encodeMessage(cases[T.Ping], w),
      saved = a.slice();
    const b = encodeMessage(cases[T.Pong], w);
    expect(b.buffer).toBe(a.buffer);
    expect([...saved]).toEqual([T.Ping, 255, 255, 255, 255]);
    expect([...a]).toEqual([...b]);
    const long = encodeMessage({ type: T.ChatSend, text: 'a'.repeat(256) }, w);
    expect(long.buffer).not.toBe(b.buffer);
  });
  it('handles multibyte strings, BOM and exact byte limits without silent replacement', () => {
    for (const text of ['', '\uFEFFname', '🌱'.repeat(64), 'é'.repeat(128), 'a'.repeat(256)])
      roundTrip({ type: T.ChatSend, text });
    for (const text of ['a'.repeat(257), '🌱'.repeat(65), '\ud800', '\udfff'])
      expect(() => bytes({ type: T.ChatSend, text })).toThrow(RangeError);
    error(new Uint8Array([T.ChatSend, 1, 0, 0xff]), 'utf8');
    error(new Uint8Array([T.ChatSend, 2, 0, 0xc0, 0x80]), 'utf8');
    error(new Uint8Array([T.ChatSend, 1, 1]), 'length');
  });
  it('caps chunk bytes before allocation and keeps compression outside the codec', async () => {
    const raw = new Uint8Array(4096).fill(42),
      payload = await deflate(raw);
    const decoded = decodeMessage(bytes({ ...cases[T.ChunkData], payload }));
    expect(decoded.ok).toBe(true);
    if (decoded.ok && decoded.message.type === T.ChunkData)
      expect(await inflate(decoded.message.payload)).toEqual(raw);
    roundTrip({ ...cases[T.ChunkData], payload: new Uint8Array(MAX_CHUNK_BYTES) });
    expect(() =>
      bytes({ ...cases[T.ChunkData], payload: new Uint8Array(MAX_CHUNK_BYTES + 1) }),
    ).toThrow(RangeError);
    const bad = bytes(cases[T.ChunkData]);
    bad.fill(255, 10, 14);
    error(bad, 'length');
    error(new Uint8Array(MAX_CHUNK_BYTES + 65), 'length');
  });
  it('handles array bounds, cursor slots, stack variants and every transaction action', () => {
    roundTrip({
      ...cases[T.InventorySync],
      slots: Array(MAX_INVENTORY_SLOTS).fill(null),
      cursor: null,
    });
    roundTrip({ ...cases[T.InventorySync], slots: [], cursor: null });
    for (let action = InventoryAction.LeftClick; action <= InventoryAction.SelectSlot; action++)
      roundTrip({ ...cases[T.InventoryTransaction], action });
    for (const accepted of [true, false]) roundTrip({ ...cases[T.InventoryResult], accepted });
    expect(() =>
      bytes({ ...cases[T.InventorySync], slots: Array(MAX_INVENTORY_SLOTS + 1).fill(null) }),
    ).toThrow(RangeError);
    const bad = bytes(cases[T.InventorySync]);
    bad[9] = 255;
    bad[10] = 255;
    error(bad, 'length');
    const badTransaction = bytes(cases[T.InventoryTransaction]);
    badTransaction[15] = 255;
    badTransaction[16] = 255;
    error(badTransaction, 'length');
    expect(() => bytes({ ...cases[T.InventorySlot], slot: 128 })).toThrow(RangeError);
  });
  it('encodes changed masks and exact small deltas with absolute fallback, then applies in place', () => {
    const pose = { x: 0, y: 50, z: 20, yaw: 0, pitch: 0 };
    const next = { x: -8, y: 50 + 32767 / 4096, z: 1000, yaw: 0.125, pitch: 0.1 };
    const receiver = { ...pose };
    const move = entityMove(8, pose, next, createEntityMove(8)),
      encoded = bytes(move);
    expect(encoded[5]).toBe(31);
    expect(encoded[6]).toBe(4); // z is absolute.
    expect(move.changes.x).toEqual({ delta: -8 });
    roundTrip(move);
    applyEntityMove(receiver, move);
    expect(receiver).toEqual(pose);
    expect(Math.abs(pose.pitch - next.pitch)).toBeLessThanOrEqual(1 / 8192);
    expect(bytes({ type: T.EntityMove, id: 8, changes: { x: { delta: 1 / 4096 } } }).length).toBe(
      9,
    );
    expect(bytes(entityMove(8, pose, next, createEntityMove(8))).length).toBe(7);
    expect(() => bytes({ type: T.EntityMove, id: 8, changes: { x: { delta: 0.1 } } })).toThrow(
      RangeError,
    );
    for (const [changed, absolute] of [
      [32, 0],
      [0, 1],
      [0, 32],
    ]) {
      const bad = bytes(cases[T.EntityMove]);
      bad[5] = changed!;
      bad[6] = absolute!;
      error(bad);
    }
    roundTrip({ ...cases[T.EntitySpawn], name: undefined });
  });
  it('quantizes ordinary movement against a reconstructed baseline without drift', () => {
    const sender = { x: 0, y: 80, z: 0, yaw: 0, pitch: 0 };
    const receiver = { ...sender };
    const actual = { ...sender };
    const reusable = createEntityMove(42);
    let total = 0,
      deltas = 0;
    for (let tick = 0; tick < 10000; tick++) {
      actual.x += 0.1137;
      actual.y -= 0.0317;
      actual.z += 0.0731;
      actual.yaw += 0.0137;
      actual.pitch += 0.0013;
      const move = entityMove(42, sender, actual, reusable);
      expect(move).toBe(reusable);
      const decoded = decodeMessage(bytes(move));
      expect(decoded.ok).toBe(true);
      if (!decoded.ok || decoded.message.type !== T.EntityMove)
        throw new Error('Expected movement');
      applyEntityMove(receiver, decoded.message);
      for (const key of ['x', 'y', 'z', 'yaw', 'pitch'] as const) {
        total++;
        if (move.changes[key] && 'delta' in move.changes[key]!) deltas++;
        expect(receiver[key]).toBe(sender[key]);
        expect(Math.abs(receiver[key] - actual[key])).toBeLessThanOrEqual(1 / 8192 + 1e-10);
      }
    }
    expect(deltas / total).toBeGreaterThan(0.99);
    actual.x += 100;
    const teleport = entityMove(42, sender, actual, reusable);
    expect(teleport.changes.x).toEqual({ absolute: actual.x });
    applyEntityMove(receiver, teleport);
    expect(receiver).toEqual(sender);
  });
  it('rejects unknown types, nonfinite numbers, invalid enums, trailing data and every truncated frame', () => {
    error(new Uint8Array([255]), 'type');
    const nonfinite = bytes(cases[T.PlayerCorrection]);
    new DataView(nonfinite.buffer).setFloat64(5, NaN, true);
    error(nonfinite, 'value');
    const badDim = bytes(cases[T.ChunkUnload]);
    badDim[1] = 2;
    error(badDim);
    const badWeather = bytes(cases[T.WeatherSync]);
    badWeather[2] = 3;
    error(badWeather);
    const badBool = bytes(cases[T.InventoryResult]);
    badBool[9] = 2;
    error(badBool);
    for (const type of types) {
      const valid = bytes(cases[type]);
      for (let length = 0; length < valid.length; length++) error(valid.subarray(0, length));
      error(new Uint8Array([...valid, 0]), 'trailing');
    }
  });
  it('never throws for 10,000 seeded random buffers plus mutated and truncated valid encodings', () => {
    const rng = new PRNG(0x21a);
    function check(data: Uint8Array): void {
      const result = decodeMessage(data);
      expect(typeof result.ok).toBe('boolean');
      if (result.ok) expect(types).toContain(result.message.type);
      else
        expect(result.error).toMatchObject({
          code: expect.any(String),
          offset: expect.any(Number),
          message: expect.any(String),
        });
    }
    for (let n = 0; n < 10000; n++) {
      const data = new Uint8Array(Math.floor(rng.next() * 2048));
      for (let i = 0; i < data.length; i++) data[i] = Math.floor(rng.next() * 256);
      check(data);
    }
    for (const type of types) {
      const valid = bytes(cases[type]);
      for (let length = 0; length < valid.length; length++) check(valid.subarray(0, length));
      for (let n = 0; n < 64; n++) {
        const mutant = valid.slice();
        mutant[Math.floor(rng.next() * mutant.length)] = Math.floor(rng.next() * 256);
        check(mutant);
      }
    }
  });
});
