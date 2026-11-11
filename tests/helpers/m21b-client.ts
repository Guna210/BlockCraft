import { WebSocket } from 'ws';
import {
  BinaryWriter,
  encodeMessage,
  decodeMessage,
  MessageType as T,
  PROTOCOL_VERSION,
  type Message,
  type Messages,
} from '../../src/net/protocol';

export class HeadlessClient {
  readonly socket: WebSocket;
  readonly messages: Message[] = [];
  private readonly writer = new BinaryWriter();
  private readonly waiters = new Set<() => void>();
  autoPong = true;
  constructor(port: number) {
    this.socket = new WebSocket(`ws://127.0.0.1:${port}`);
    this.socket.on('message', (data) => {
      const result = decodeMessage(new Uint8Array(data as Buffer));
      if (!result.ok) throw new Error(`Invalid server frame: ${result.error.message}`);
      if (result.message.type === T.Ping && this.autoPong)
        this.send({ type: T.Pong, id: result.message.id });
      this.messages.push(result.message);
      for (const waiter of this.waiters) waiter();
    });
  }
  async open(): Promise<this> {
    await new Promise<void>((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
    return this;
  }
  send(message: Message): void {
    this.socket.send(encodeMessage(message, this.writer));
  }
  async login(name: string, version = PROTOCOL_VERSION): Promise<Messages[T.ServerHello]> {
    this.send({ type: T.ClientHello, version, name });
    return this.wait(T.ServerHello);
  }
  wait<K extends T>(
    type: K,
    predicate: (message: Messages[K]) => boolean = () => true,
    timeout = 8000,
  ): Promise<Messages[K]> {
    return new Promise((resolve, reject) => {
      const check = (): void => {
        const index = this.messages.findIndex(
          (message) => message.type === type && predicate(message as Messages[K]),
        );
        if (index < 0) return;
        const message = this.messages.splice(index, 1)[0] as Messages[K];
        clearTimeout(timer);
        this.waiters.delete(check);
        resolve(message);
      };
      const timer = setTimeout(() => {
        this.waiters.delete(check);
        reject(new Error(`Timed out waiting for ${T[type]}`));
      }, timeout);
      this.waiters.add(check);
      check();
    });
  }
  close(): void {
    this.socket.terminate();
  }
}
