import { expect, it, vi } from 'vitest';
import { Connection } from '../../src/game/net/connection';
import {
  BinaryWriter,
  encodeMessage,
  MessageType as T,
  BlockActionKind as B,
  type Message,
} from '../../src/net/protocol';

it('separates worker send receipts from server messages and measures receive-to-apply delay', async () => {
  class Worker {
    static latest: Worker;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
      Worker.latest = this;
    }
    postMessage() {}
    terminate() {}
    event(data: unknown) {
      this.onmessage?.({ data });
    }
    packet(message: Message, outgoing: boolean, workerAt: number) {
      this.event({
        kind: 'packet',
        packet: encodeMessage(message, new BinaryWriter()).slice().buffer,
        outgoing,
        workerAt,
      });
    }
  }
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  vi.stubGlobal('Worker', Worker);
  try {
    const opening = Connection.connect('ws://localhost:3001', 'Trace', true);
    const worker = Worker.latest;
    worker.event({ kind: 'open' });
    worker.packet(
      {
        type: T.ServerHello,
        entityId: 1,
        seed: 42,
        dimension: 'overworld',
        spawn: [0, 65, 0],
        time: 0,
      },
      false,
      900,
    );
    const connection = await opening;
    const received: Message[] = [];
    connection.listen((message) => received.push(message));
    const action: Message = {
      type: T.BlockAction,
      action: B.FinishBreak,
      x: 1,
      y: 64,
      z: 2,
      face: 'top',
      heldSlot: 0,
      sequence: 7,
    };
    connection.send(action);
    vi.setSystemTime(1020);
    worker.packet(action, true, 1002);
    expect(received.map((m) => m.type)).toEqual([T.ServerHello]);
    const update: Message = {
      type: T.BlockUpdate,
      dimension: 'overworld',
      x: 1,
      y: 64,
      z: 2,
      stateId: 0,
    };
    vi.setSystemTime(1100);
    worker.packet(update, false, 1040);
    vi.setSystemTime(1150);
    connection.transferTrace.record(3, update);
    expect(received.map((m) => m.type)).toEqual([T.ServerHello, T.BlockUpdate]);
    const trace = connection.transferTrace.snapshot();
    expect(trace.map((e) => e.phase)).toEqual(['request', 'send', 'receive', 'apply']);
    expect(trace.map((e) => e.at)).toEqual([1000, 1020, 1100, 1150]);
    expect(trace.map((e) => e.workerAt)).toEqual([0, 1002, 1040, 0]);
    expect(trace[2]!.at - trace[2]!.workerAt).toBe(60);
    expect(trace[3]!.at - trace[2]!.at).toBe(50);
    trace[0]!.x = 999;
    expect(connection.transferTrace.snapshot()[0]!.x).toBe(1);
    connection.close();
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
