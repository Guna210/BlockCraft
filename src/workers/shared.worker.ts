import type { ColumnWorkPriority } from '../world/streamer';
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
let chains = new Map<string, ColumnWorkPriority>();
const channel = new MessageChannel();
channel.port1.onmessage = runNext;
const queue: SharedRequest[] = [];
let scheduled = false;
function runNext(): void {
  scheduled = false;
  queue.sort((a, b) => {
    const dxA = a.cx * 16 + 8 - view.x,
      dzA = a.cz * 16 + 8 - view.z;
    const dxB = b.cx * 16 + 8 - view.x,
      dzB = b.cz * 16 + 8 - view.z;
    const distance =
      Math.max(Math.abs(dxA), Math.abs(dzA)) - Math.max(Math.abs(dxB), Math.abs(dzB));
    // Near-camera work wins across pools, then prefer the stage closest to producing a mesh.
    const near =
      Math.floor(Math.max(Math.abs(dxA), Math.abs(dzA)) / 32) -
      Math.floor(Math.max(Math.abs(dxB), Math.abs(dzB)) / 32);
    const foreground = Number(b.foreground) - Number(a.foreground);
    const chain =
      (chains.get(`${a.cx},${a.cz}`)?.[a.kind] ?? 1e9) -
      (chains.get(`${b.cx},${b.cz}`)?.[b.kind] ?? 1e9);
    const kind = priorities[a.kind] - priorities[b.kind];
    return (
      foreground ||
      chain ||
      near ||
      kind ||
      distance ||
      (dxB - dxA) * Math.cos(view.yaw) + (dzB - dzA) * Math.sin(view.yaw)
    );
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
ctx.onmessage = (
  event: MessageEvent<SharedRequest | { view: typeof view } | { priorities: ColumnWorkPriority[] }>,
) => {
  if ('priorities' in event.data) {
    chains = new Map(
      event.data.priorities.map((priority) => [`${priority.cx},${priority.cz}`, priority]),
    );
    return;
  }
  if ('view' in event.data) {
    view = event.data.view;
    return;
  }
  queue.push(event.data);
  schedule();
};
