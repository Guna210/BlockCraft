import {
  BinaryWriter,
  decodeMessage,
  encodeMessage,
  MessageType,
  PROTOCOL_VERSION,
  type Message,
} from '../../net/protocol';
import { WorkerSocket } from './worker-socket';
import type { Messages } from '../../net/protocol';

/** Owns a browser WebSocket and its handshake; subsequent messages retain wire order. */
export class Connection {
  private readonly writer = new BinaryWriter();
  private pending: Message[] = [];
  private receiver: ((message: Message, immediateReceipt?: boolean) => void) | null = null;
  listen(receiver: (message: Message, immediateReceipt?: boolean) => void): void {
    this.receiver = receiver;
    for (const message of this.pending) receiver(message);
    this.pending = [];
  }
  onClose: (reason: string) => void = () => {};
  private constructor(private readonly socket: WebSocket | WorkerSocket) {}
  get open(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }
  get threaded(): boolean {
    return this.socket instanceof WorkerSocket;
  }
  startInputs(sequence: number): void {
    if (this.socket instanceof WorkerSocket) this.socket.start(sequence);
  }
  updateIntent(input: Messages[MessageType.PlayerInput], immediate: boolean): void {
    if (this.socket instanceof WorkerSocket) this.socket.intent(input, immediate);
  }

  static connect(address: string, name: string, threaded = false): Promise<Connection> {
    return new Promise((resolve, reject) => {
      let socket: WebSocket | WorkerSocket;
      try {
        socket = threaded ? new WorkerSocket(address) : new WebSocket(address);
      } catch {
        reject(new Error('Invalid server address'));
        return;
      }
      socket.binaryType = 'arraybuffer';
      const connection = new Connection(socket);
      let settled = false;
      let disconnectReason = 'Connection lost';
      const timeout = window.setTimeout(() => fail('Connection refused or timed out'), 10000);
      const fail = (reason: string) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        socket.close();
        reject(new Error(reason));
      };
      socket.onopen = () => {
        try {
          connection.send({ type: MessageType.ClientHello, version: PROTOCOL_VERSION, name });
        } catch {
          fail('Player name is limited to 256 UTF-8 bytes');
        }
      };
      socket.onerror = () => fail('Connection refused or timed out');
      socket.onclose = () => {
        if (settled) connection.onClose(disconnectReason);
        else fail('Connection refused or timed out');
      };
      socket.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        const decoded = decodeMessage(new Uint8Array(event.data));
        if (!decoded.ok) return;
        const message = decoded.message;
        if (message.type === MessageType.Ping)
          connection.send({ type: MessageType.Pong, id: message.id });
        if (message.type === MessageType.LoginReject && !settled) {
          fail(message.reason);
          return;
        }
        if (message.type === MessageType.ServerHello && !settled) {
          settled = true;
          window.clearTimeout(timeout);
          connection.pending.push(message);
          resolve(connection);
        } else if (settled) {
          if (connection.receiver)
            connection.receiver(message, socket instanceof WorkerSocket && socket.inputImmediate);
          else connection.pending.push(message);
        }
        if (message.type === MessageType.Disconnect && settled) {
          disconnectReason = message.reason || disconnectReason;
          socket.close();
        }
      };
    });
  }

  send(message: Message): void {
    if (this.socket.readyState === WebSocket.OPEN)
      this.socket.send(encodeMessage(message, this.writer) as Uint8Array<ArrayBuffer>);
  }

  close(): void {
    this.socket.close();
  }
}
