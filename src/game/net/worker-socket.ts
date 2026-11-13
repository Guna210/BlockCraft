import type { Messages, MessageType as T } from '../../net/protocol';

/** WebSocket adapter whose input clock survives main-thread rendering and decompression. */
export class WorkerSocket {
  readonly worker = new Worker(new URL('./socket-worker.ts', import.meta.url), { type: 'module' });
  readyState = 0;
  binaryType = 'arraybuffer';
  inputImmediate = false;
  outgoing = false;
  workerAt = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: MessageEvent<ArrayBuffer>) => void) | null = null;
  private readonly packetEvent = { data: null as ArrayBuffer | null };
  private readonly intentEvent = {
    kind: 'intent',
    input: null as Messages[T.PlayerInput] | null,
    immediate: false,
  };
  constructor(address: string) {
    this.worker.onmessage = ({ data }) => {
      switch (data.kind) {
        case 'open':
          this.readyState = 1;
          this.onopen?.();
          break;
        case 'error':
          this.onerror?.();
          break;
        case 'close':
          this.readyState = 3;
          this.onclose?.();
          this.worker.terminate();
          break;
        case 'packet':
          this.outgoing = data.outgoing ?? false;
          this.workerAt = data.workerAt ?? 0;
          this.inputImmediate = data.immediate;
          this.packetEvent.data = data.packet;
          this.onmessage?.(this.packetEvent as MessageEvent<ArrayBuffer>);
          break;
      }
    };
    this.worker.onerror = () => {
      this.readyState = 3;
      this.worker.terminate();
      this.onerror?.();
      this.onclose?.();
    };
    this.worker.postMessage({ kind: 'open', address });
  }
  send(bytes: Uint8Array<ArrayBuffer>): void {
    const packet = bytes.slice().buffer;
    this.worker.postMessage({ kind: 'send', packet }, [packet]);
  }
  intent(input: Messages[T.PlayerInput], immediate: boolean): void {
    this.intentEvent.input = input;
    this.intentEvent.immediate = immediate;
    this.worker.postMessage(this.intentEvent);
  }
  start(sequence: number): void {
    this.worker.postMessage({ kind: 'start', sequence });
  }
  close(): void {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    this.worker.postMessage({ kind: 'close' });
  }
}
