// @vitest-environment node
import { it, expect, vi } from 'vitest';
import {
  BinaryWriter,
  encodeMessage,
  decodeMessage,
  MessageType as T,
  type Message,
} from '../../src/net/protocol';

it('keeps sending sequenced input without main-thread work, respects backpressure, and stops on travel/disconnect', async () => {
  vi.useFakeTimers();
  const events: Array<{ kind: string; packet?: ArrayBuffer; immediate?: boolean }> = [];
  const channel = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    postMessage(value: unknown) {
      events.push(structuredClone(value) as (typeof events)[number]);
    },
  };
  class Socket {
    static OPEN = 1;
    static latest: Socket;
    readyState = 1;
    binaryType = '';
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
    onclose: (() => void) | null = null;
    sent: Message[] = [];
    constructor() {
      Socket.latest = this;
    }
    send(bytes: Uint8Array) {
      const decoded = decodeMessage(bytes);
      if (decoded.ok) this.sent.push(structuredClone(decoded.message));
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
    receive(message: Message) {
      const packet = encodeMessage(message, new BinaryWriter()).slice().buffer as ArrayBuffer;
      this.onmessage?.({ data: packet });
    }
  }
  vi.stubGlobal('self', channel);
  vi.stubGlobal('WebSocket', Socket);
  try {
    await import('../../src/game/net/socket-worker');
    const command = (data: unknown) => channel.onmessage!({ data });
    command({ kind: 'open', address: 'ws://localhost:3001' });
    Socket.latest.onopen?.();
    command({
      kind: 'intent',
      input: { type: T.PlayerInput, sequence: 0, movement: [1, 0], look: [1, 0], actions: 1 },
      immediate: false,
    });
    command({ kind: 'start', sequence: 0 });
    await vi.advanceTimersByTimeAsync(350);
    expect(Socket.latest.sent.map((m) => (m.type === T.PlayerInput ? m.sequence : -1))).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    Socket.latest.receive({
      type: T.PlayerCorrection,
      acknowledged: 6,
      position: [0, 65, 0],
      velocity: [0, 0, 0],
    });
    command({
      kind: 'intent',
      input: { type: T.PlayerInput, sequence: 0, movement: [0, 1], look: [2, 0], actions: 0 },
      immediate: true,
    });
    expect(Socket.latest.sent.at(-1)).toMatchObject({
      sequence: 7,
      movement: [0, 1],
      look: [2, 0],
    });
    expect(events.at(-1)!.immediate).toBe(true);
    Socket.latest.receive({
      type: T.ServerHello,
      entityId: 1,
      seed: 42,
      spawn: [0, 65, 0],
      dimension: 'hollowdeep',
      time: 0,
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(Socket.latest.sent).toHaveLength(7);
    command({ kind: 'start', sequence: 7 });
    await vi.advanceTimersByTimeAsync(50);
    expect(Socket.latest.sent.at(-1)).toMatchObject({ sequence: 8 });
    Socket.latest.receive({ type: T.Disconnect, reason: 'stopping' });
    await vi.advanceTimersByTimeAsync(500);
    expect(Socket.latest.sent).toHaveLength(8);
    command({
      kind: 'send',
      packet: encodeMessage({ type: T.ChatSend, text: 'late' }, new BinaryWriter()).slice().buffer,
    });
    expect(Socket.latest.sent).toHaveLength(8);
    command({ kind: 'close' });
    expect(events.at(-1)!.kind).toBe('close');
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
