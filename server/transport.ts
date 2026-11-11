import { WebSocket } from 'ws';
import { BinaryWriter, encodeMessage, decodeMessage, type Message } from '../src/net/protocol';

/** Fixed-capacity ordered delay queue. Frame copies are owned until ws finishes sending. */
class FrameQueue {
  readonly frames: Array<Uint8Array | null> = new Array(2048).fill(null);
  readonly due = new Float64Array(2048);
  private bytes = 0;
  head = 0;
  tail = 0;
  push(frame: Uint8Array, due: number): boolean {
    const next = (this.tail + 1) % this.frames.length;
    if (next === this.head || this.bytes + frame.byteLength > 8 * 1024 * 1024) return false;
    this.bytes += frame.byteLength;
    this.frames[this.tail] = frame;
    this.due[this.tail] = due;
    this.tail = next;
    return true;
  }
  shift(): Uint8Array {
    const frame = this.frames[this.head]!;
    this.frames[this.head] = null;
    this.bytes -= frame.byteLength;
    this.head = (this.head + 1) % this.frames.length;
    return frame;
  }
}
export class Transport {
  private readonly incoming = new FrameQueue();
  private readonly outgoing = new FrameQueue();
  private readonly writer = new BinaryWriter();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pumping = false;
  lastHeard = performance.now();
  closing = false;
  private closeAfter = Infinity;
  constructor(
    readonly socket: WebSocket,
    readonly delayMs: number,
    private readonly receive: (message: Message) => void,
  ) {
    socket.on('message', (data, binary) => {
      if (!binary || !Buffer.isBuffer(data)) {
        this.close();
        return;
      }
      this.lastHeard = performance.now();
      if (!this.incoming.push(data, this.lastHeard + delayMs / 2)) this.close();
      this.pump();
    });
    socket.on('error', () => this.close());
    socket.on('close', () => {
      if (this.timer) clearTimeout(this.timer);
    });
  }
  send(message: Message): void {
    if (this.socket.readyState !== WebSocket.OPEN || this.closing) return;
    if (this.socket.bufferedAmount > 2 * 1024 * 1024) {
      this.close();
      return;
    }
    const frame = encodeMessage(message, this.writer).slice();
    if (!this.outgoing.push(frame, performance.now() + this.delayMs / 2)) this.close();
    this.pump();
  }
  private readonly pump = (): void => {
    if (this.pumping) return;
    this.pumping = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const now = performance.now();
    while (
      !this.closing &&
      this.incoming.head !== this.incoming.tail &&
      this.incoming.due[this.incoming.head]! <= now
    ) {
      const result = decodeMessage(this.incoming.shift());
      if (!result.ok) {
        this.close();
        break;
      }
      this.receive(result.message);
    }
    while (
      this.outgoing.head !== this.outgoing.tail &&
      this.outgoing.due[this.outgoing.head]! <= now
    ) {
      const frame = this.outgoing.shift();
      if (this.socket.readyState === WebSocket.OPEN) this.socket.send(frame);
    }
    if (this.closing && now >= this.closeAfter && this.outgoing.head === this.outgoing.tail) {
      this.socket.close();
    }
    this.pumping = false;
    let due = Infinity;
    if (!this.closing && this.incoming.head !== this.incoming.tail)
      due = this.incoming.due[this.incoming.head]!;
    if (this.outgoing.head !== this.outgoing.tail)
      due = Math.min(due, this.outgoing.due[this.outgoing.head]!);
    if (this.closing && this.socket.readyState === WebSocket.OPEN)
      due = Math.min(due, this.closeAfter);
    if (Number.isFinite(due))
      this.timer = setTimeout(this.pump, Math.max(1, due - performance.now()));
  };
  close(): void {
    this.closing = true;
    this.closeAfter = performance.now() + this.delayMs / 2;
    this.pump();
  }
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.socket.terminate();
  }
}
