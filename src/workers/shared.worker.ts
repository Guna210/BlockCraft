import { processGenMessage } from './gen.worker';
import { processLightMessage } from './light.worker';
import { processMeshMessage } from './mesh.worker';
import type { WorkerKind } from './shared-worker-budget';

interface SharedRequest {
  requestId: number;
  kind: WorkerKind;
  payload: unknown;
  cx: number;
  cz: number;
  foreground: boolean;
}
const ctx: Worker = self as unknown as Worker;
const post = ctx.postMessage.bind(ctx);
let requestId = 0;
ctx.postMessage = ((payload: unknown, transfer: Transferable[]) =>
  post({ requestId, payload }, transfer)) as Worker['postMessage'];
const handlers = { mesh: processMeshMessage, light: processLightMessage, gen: processGenMessage };
const priorities = { mesh: 1, light: 2, gen: 3 };
let view = { x: 0, z: 0, yaw: 0 };
const channel = new MessageChannel();
channel.port1.onmessage = runNext;
const queue: SharedRequest[] = [];
let scheduled = false;
function runNext(): void {
  scheduled = false;
  queue.sort((a, b) => {
    const kind = (a.foreground ? 0 : priorities[a.kind]) - (b.foreground ? 0 : priorities[b.kind]);
    if (kind) return kind;
    const dxA = a.cx * 16 + 8 - view.x,
      dzA = a.cz * 16 + 8 - view.z;
    const dxB = b.cx * 16 + 8 - view.x,
      dzB = b.cz * 16 + 8 - view.z;
    const distance =
      Math.max(Math.abs(dxA), Math.abs(dzA)) - Math.max(Math.abs(dxB), Math.abs(dzB));
    return distance || (dxB - dxA) * Math.cos(view.yaw) + (dzB - dzA) * Math.sin(view.yaw);
  });
  const job = queue.shift();
  if (!job) return;
  requestId = job.requestId;
  handlers[job.kind]({ data: job.payload } as MessageEvent);
  schedule();
}
function schedule(): void {
  if (scheduled || queue.length === 0) return;
  scheduled = true;
  channel.port2.postMessage(0);
}
ctx.onmessage = (event: MessageEvent<SharedRequest | { view: typeof view }>) => {
  if ('view' in event.data) {
    view = event.data.view;
    return;
  }
  queue.push(event.data);
  schedule();
};
