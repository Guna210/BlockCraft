import {
  BinaryWriter,
  decodeMessage,
  encodeMessage,
  MessageType,
  PROTOCOL_VERSION,
  type Message,
} from '../../net/protocol';

/** Owns a browser WebSocket and its handshake; subsequent messages retain wire order. */
export class Connection {
  private readonly writer = new BinaryWriter();
  onClose: (reason: string) => void = () => {};
  private constructor(private readonly socket: WebSocket) {}

  static connect(address: string, name: string): Promise<Connection> {
    return new Promise((resolve, reject) => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(address);
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
      socket.onopen = () =>
        connection.send({ type: MessageType.ClientHello, version: PROTOCOL_VERSION, name });
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
        else if (message.type === MessageType.LoginReject) fail(message.reason);
        else if (message.type === MessageType.Disconnect && settled) {
          disconnectReason = message.reason || disconnectReason;
          socket.close();
        } else if (message.type === MessageType.ServerHello && !settled) {
          settled = true;
          window.clearTimeout(timeout);
          resolve(connection);
        }
      };
    });
  }

  send(message: Message): void {
    if (this.socket.readyState === WebSocket.OPEN)
      this.socket.send(new Uint8Array(encodeMessage(message, this.writer)));
  }

  close(): void {
    this.socket.close();
  }
}
