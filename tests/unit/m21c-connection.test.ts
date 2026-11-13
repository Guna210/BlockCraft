import { it, expect, vi } from 'vitest';
import { Connection } from '../../src/game/net/connection';
import {
  MessageType as T,
  BinaryWriter,
  encodeMessage,
  type Message,
} from '../../src/net/protocol';
it('retains ServerHello and subsequent packets until subscription, preserving order', async () => {
  class Socket {
    static OPEN = 1;
    static latest: Socket;
    readyState = 1;
    binaryType = '';
    sent: unknown[] = [];
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
    constructor() {
      Socket.latest = this;
    }
    send(value: unknown) {
      this.sent.push(value);
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
    receive(message: Message) {
      const bytes = new Uint8Array(encodeMessage(message, new BinaryWriter()));
      this.onmessage?.({ data: bytes.buffer });
    }
  }
  vi.stubGlobal('WebSocket', Socket);
  try {
    const promise = Connection.connect('ws://localhost:3001', 'Ada');
    const socket = Socket.latest;
    socket.onopen?.();
    socket.receive({
      type: T.ServerHello,
      entityId: 1,
      seed: 42,
      dimension: 'overworld',
      spawn: [0, 65, 0],
      time: 0,
    });
    socket.receive({ type: T.TimeSync, dimension: 'overworld', time: 10 });
    const connection = await promise,
      received: Message[] = [];
    connection.listen((message) => received.push(message));
    socket.receive({ type: T.BlockUpdate, dimension: 'overworld', x: 1, y: 65, z: 1, stateId: 0 });
    expect(received.map((message) => message.type)).toEqual([
      T.ServerHello,
      T.TimeSync,
      T.BlockUpdate,
    ]);
    socket.receive({ type: T.Ping, id: 9 });
    expect(socket.sent).toHaveLength(2);
    let reason = '';
    connection.onClose = (value) => {
      reason = value;
    };
    socket.receive({ type: T.Disconnect, reason: 'Server stopped' });
    expect(reason).toBe('Server stopped');
  } finally {
    vi.unstubAllGlobals();
  }
});

it('rejects oversized UTF-8 names through the connection promise without an uncaught socket handler error', async () => {
  class Socket {
    static OPEN = 1;
    static latest: Socket;
    readyState = 1;
    onopen: (() => void) | null = null;
    constructor() {
      Socket.latest = this;
    }
    close() {
      this.readyState = 3;
    }
    send() {
      throw new Error('oversized hello must fail before socket.send');
    }
  }
  vi.stubGlobal('WebSocket', Socket);
  try {
    const promise = Connection.connect('ws://localhost:3001', '界'.repeat(100));
    const rejected = expect(promise).rejects.toThrow('256 UTF-8 bytes');
    expect(() => Socket.latest.onopen?.()).not.toThrow();
    await rejected;
    expect(Socket.latest.readyState).toBe(3);
  } finally {
    vi.unstubAllGlobals();
  }
});
