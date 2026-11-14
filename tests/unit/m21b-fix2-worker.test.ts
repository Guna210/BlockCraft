// @vitest-environment node
import { expect, it, vi } from 'vitest';
import {
  BinaryWriter,
  encodeMessage,
  decodeMessage,
  MessageType as T,
  type Message,
} from '../../src/net/protocol';
it('stops dead input at the socket, keeps answering keep-alives, and starts fresh after respawn', async () => {
  vi.useFakeTimers();
  const events: unknown[] = [];
  const channel = {
    onmessage: null as ((e: { data: unknown }) => void) | null,
    postMessage(value: unknown) {
      events.push(structuredClone(value));
    },
  };
  class Socket {
    static OPEN = 1;
    static latest: Socket;
    readyState = 1;
    onmessage: ((e: { data: ArrayBuffer }) => void) | null = null;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    binaryType = '';
    sent: Message[] = [];
    constructor() {
      Socket.latest = this;
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
    send(bytes: Uint8Array) {
      const d = decodeMessage(bytes);
      if (d.ok) this.sent.push(d.message);
    }
    receive(m: Message) {
      this.onmessage?.({
        data: encodeMessage(m, new BinaryWriter()).slice().buffer as ArrayBuffer,
      });
    }
  }
  vi.stubGlobal('self', channel);
  vi.stubGlobal('WebSocket', Socket);
  try {
    vi.resetModules();
    await import('../../src/game/net/socket-worker');
    const command = (data: unknown) => channel.onmessage!({ data });
    command({ kind: 'open', address: 'ws://localhost' });
    command({
      kind: 'intent',
      input: { type: T.PlayerInput, sequence: 0, movement: [1, 0], look: [0, 0], actions: 0 },
      immediate: false,
    });
    command({ kind: 'start', sequence: 0 });
    await vi.advanceTimersByTimeAsync(50);
    expect(Socket.latest.sent.at(-1)).toMatchObject({ type: T.PlayerInput, sequence: 1 });
    Socket.latest.receive({
      type: T.PlayerVitals,
      health: 0,
      hunger: 10,
      saturation: 0,
      air: 0,
      burning: false,
      mode: 'survival',
      dead: true,
      deathCause: 'Drowned',
      xpLevel: 0,
      xpProgress: 0,
    });
    const deathInputs = Socket.latest.sent.length;
    // A main-thread ServerHello handler may post start after the worker already saw death.
    command({ kind: 'start', sequence: 1 });
    for (let i = 1; i <= 10; i++) {
      await vi.advanceTimersByTimeAsync(2000);
      Socket.latest.receive({ type: T.Ping, id: i });
      expect(Socket.latest.sent.at(-1)).toEqual({ type: T.Pong, id: i });
    }
    expect(Socket.latest.sent.filter((m) => m.type === T.PlayerInput)).toHaveLength(deathInputs);
    Socket.latest.receive({
      type: T.PlayerRespawn,
      dimension: 'overworld',
      position: [0.5, 65, 0.5],
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(Socket.latest.sent.filter((m) => m.type === T.PlayerInput)).toHaveLength(1);
    command({ kind: 'start', sequence: 1 });
    await vi.advanceTimersByTimeAsync(50);
    expect(Socket.latest.sent.at(-1)).toMatchObject({ type: T.PlayerInput, sequence: 2 });
    expect(events.length).toBeGreaterThan(10);
    command({ kind: 'close' });
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
