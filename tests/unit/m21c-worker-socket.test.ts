import { it, expect, vi } from 'vitest';
import { WorkerSocket } from '../../src/game/net/worker-socket';
import { MessageType as T } from '../../src/net/protocol';

it('forwards ordered worker packets and immediate receipts, owns outgoing bytes and terminates on close', () => {
  class Worker {
    static latest: Worker;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    messages: unknown[] = [];
    terminated = false;
    constructor() {
      Worker.latest = this;
    }
    postMessage(message: unknown) {
      this.messages.push(structuredClone(message));
    }
    terminate() {
      this.terminated = true;
    }
    receive(data: unknown) {
      this.onmessage?.({ data });
    }
  }
  vi.stubGlobal('Worker', Worker);
  try {
    const socket = new WorkerSocket('ws://localhost:3001'),
      worker = Worker.latest;
    let opened = false,
      closed = false;
    const received: Array<{ bytes: number[]; immediate: boolean }> = [];
    socket.onopen = () => {
      opened = true;
    };
    socket.onclose = () => {
      closed = true;
    };
    socket.onmessage = (event) =>
      received.push({ bytes: [...new Uint8Array(event.data)], immediate: socket.inputImmediate });
    worker.receive({ kind: 'open' });
    expect(opened).toBe(true);
    const bytes = new Uint8Array([1, 2, 3]);
    socket.send(bytes);
    bytes[0] = 9;
    const sent = worker.messages[1] as { packet: ArrayBuffer };
    expect([...new Uint8Array(sent.packet)]).toEqual([1, 2, 3]);
    worker.receive({ kind: 'packet', packet: new Uint8Array([4]).buffer, immediate: false });
    worker.receive({ kind: 'packet', packet: new Uint8Array([5]).buffer, immediate: true });
    expect(received).toEqual([
      { bytes: [4], immediate: false },
      { bytes: [5], immediate: true },
    ]);
    socket.intent(
      { type: T.PlayerInput, sequence: 0, movement: [1, 0], look: [0, 0], actions: 0 },
      true,
    );
    socket.start(7);
    socket.close();
    worker.receive({ kind: 'close' });
    expect(closed).toBe(true);
    expect(socket.readyState).toBe(3);
    expect(worker.terminated).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});
