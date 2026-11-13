import {
  BinaryWriter,
  decodeMessage,
  encodeMessage,
  MessageType as T,
  type Messages,
} from '../../net/protocol';

type Command =
  | { kind: 'open'; address: string }
  | { kind: 'send'; packet: ArrayBuffer }
  | { kind: 'intent'; input: Messages[T.PlayerInput]; immediate: boolean }
  | { kind: 'start'; sequence: number }
  | { kind: 'close' };
const channel = self as unknown as {
  onmessage: ((event: MessageEvent<Command>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};
const writer = new BinaryWriter();
const input = {
  type: T.PlayerInput as const,
  sequence: 0,
  movement: [0, 0] as [number, number],
  look: [0, 0] as [number, number],
  actions: 0,
};
const packetEvent = {
  kind: 'packet',
  packet: null as ArrayBuffer | null,
  immediate: false,
  outgoing: false,
  workerAt: 0,
};
const transfers: Transferable[] = [new ArrayBuffer(0)];
let socket: WebSocket | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let closed = false;
let acknowledged = 0;
let nextAt = 0;
const sentLook = new Float64Array(2);
function emit(packet: ArrayBuffer, immediate = false, outgoing = false): void {
  packetEvent.outgoing = outgoing;
  packetEvent.workerAt = Date.now();
  packetEvent.immediate = immediate;
  packetEvent.packet = packet;
  transfers[0] = packet;
  channel.postMessage(packetEvent, transfers);
}
function stop(): void {
  running = false;
  if (timer !== null) clearTimeout(timer);
  timer = null;
}
function step(immediate = false, receipt = immediate): void {
  if (closed || !running || !socket || socket.readyState !== WebSocket.OPEN) return;
  if ((input.sequence - acknowledged) >>> 0 >= (immediate ? 7 : 6)) return;
  input.sequence = (input.sequence + 1) >>> 0;
  const bytes = encodeMessage(input, writer) as Uint8Array<ArrayBuffer>;
  socket.send(bytes);
  sentLook[0] = input.look[0];
  sentLook[1] = input.look[1];
  // Main-thread prediction sees this exact input before any later server packet.
  emit(bytes.slice().buffer, receipt);
}
function schedule(): void {
  if (timer !== null) clearTimeout(timer);
  if (!running) return;
  timer = setTimeout(
    () => {
      step();
      nextAt += 50;
      if (nextAt < performance.now()) nextAt = performance.now() + 50;
      schedule();
    },
    Math.max(1, nextAt - performance.now()),
  );
}
channel.onmessage = ({ data }) => {
  switch (data.kind) {
    case 'open': {
      closed = false;
      socket = new WebSocket(data.address);
      socket.binaryType = 'arraybuffer';
      socket.onopen = () => channel.postMessage({ kind: 'open' });
      socket.onerror = () => channel.postMessage({ kind: 'error' });
      socket.onclose = () => {
        closed = true;
        stop();
        channel.postMessage({ kind: 'close' });
      };
      socket.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        const bytes = new Uint8Array(event.data);
        // Only these control packets affect the transport clock; decode bulk world data once,
        // on the receiving game path instead of copying its payload in both threads.
        const type = bytes[0];
        const decoded =
          type === T.PlayerCorrection || type === T.ServerHello || type === T.Disconnect
            ? decodeMessage(bytes)
            : null;
        if (decoded?.ok) {
          const message = decoded.message;
          if (message.type === T.PlayerCorrection) acknowledged = message.acknowledged;
          else if (message.type === T.ServerHello) stop();
          else if (message.type === T.Disconnect) {
            closed = true;
            stop();
          }
        }
        emit(event.data);
      };
      break;
    }
    case 'send': {
      if (closed) break;
      const decoded = decodeMessage(new Uint8Array(data.packet));
      if (
        decoded.ok &&
        decoded.message.type === T.BlockAction &&
        (input.look[0] !== sentLook[0] || input.look[1] !== sentLook[1])
      )
        step(true, false);
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(data.packet);
        if (decoded.ok && decoded.message.type === T.BlockAction)
          emit(data.packet.slice(0), false, true);
      }
      break;
    }
    case 'intent':
      input.movement[0] = data.input.movement[0];
      input.movement[1] = data.input.movement[1];
      input.look[0] = data.input.look[0];
      input.look[1] = data.input.look[1];
      input.actions = data.input.actions;
      if (data.immediate && running) {
        step(true);
        nextAt = performance.now() + 50;
        schedule();
      }
      break;
    case 'start':
      input.sequence = acknowledged = data.sequence;
      running = true;
      nextAt = performance.now() + 50;
      schedule();
      break;
    case 'close':
      closed = true;
      stop();
      socket?.close();
      break;
  }
};
