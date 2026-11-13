import { MessageType as T, type Message } from '../../net/protocol';

export type TransferEvent = {
  phase: 'request' | 'send' | 'receive' | 'apply';
  type: number;
  at: number;
  workerAt: number;
  x: number;
  y: number;
  z: number;
  sequence: number;
  action: number;
};
const PHASES = ['request', 'send', 'receive', 'apply'] as const;
const CAPACITY = 64;
const STRIDE = 9;

/** Bounded diagnostics for edit delivery; input/correction ticks allocate nothing. */
export class TransferTrace {
  private readonly data = new Float64Array(CAPACITY * STRIDE);
  private count = 0;
  private head = 0;

  record(phase: number, message: Message, workerAt = 0): void {
    if (
      message.type !== T.BlockAction &&
      message.type !== T.BlockUpdate &&
      message.type !== T.ChunkData
    )
      return;
    const offset = this.head * STRIDE;
    this.data[offset] = phase;
    this.data[offset + 1] = message.type;
    this.data[offset + 2] = Date.now();
    this.data[offset + 3] = workerAt;
    this.data[offset + 4] = message.type === T.ChunkData ? message.cx : message.x;
    this.data[offset + 5] = message.type === T.ChunkData ? 0 : message.y;
    this.data[offset + 6] = message.type === T.ChunkData ? message.cz : message.z;
    this.data[offset + 7] =
      message.type === T.BlockAction
        ? message.sequence
        : message.type === T.BlockUpdate
          ? message.stateId
          : message.payload.length;
    this.data[offset + 8] = message.type === T.BlockAction ? message.action : -1;
    this.head = (this.head + 1) % CAPACITY;
    this.count = Math.min(CAPACITY, this.count + 1);
  }

  snapshot(): TransferEvent[] {
    return Array.from({ length: this.count }, (_, i) => {
      const offset = ((this.head - this.count + i + CAPACITY) % CAPACITY) * STRIDE;
      return {
        phase: PHASES[this.data[offset]!]!,
        type: this.data[offset + 1]!,
        at: this.data[offset + 2]!,
        workerAt: this.data[offset + 3]!,
        x: this.data[offset + 4]!,
        y: this.data[offset + 5]!,
        z: this.data[offset + 6]!,
        sequence: this.data[offset + 7]!,
        action: this.data[offset + 8]!,
      };
    });
  }
}
