import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SharedWorkerBudget } from '../../src/workers/shared-worker-budget';
class HeldWorker {
  static all: HeldWorker[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror = null;
  jobs: Array<{ requestId: number; kind: string; payload: { id: number } }> = [];
  constructor() {
    HeldWorker.all.push(this);
  }
  postMessage(data: HeldWorker['jobs'][number], transfer: Transferable[]) {
    this.jobs.push(structuredClone(data, { transfer }));
  }
  terminate() {}
  answer(index = 0) {
    const job = this.jobs[index]!;
    this.onmessage?.({
      data: { requestId: job.requestId, payload: { id: job.payload.id } },
    } as MessageEvent);
  }
}
beforeEach(() => {
  HeldWorker.all = [];
  vi.stubGlobal('Worker', HeldWorker);
});
test('all pool lanes share exactly the hardware worker budget and route overlapping local IDs', () => {
  const budget = new SharedWorkerBudget(2);
  const mesh = budget.createPort('mesh');
  const light = budget.createPort('light');
  const gen = budget.createPort('gen');
  const results: string[] = [];
  mesh.onmessage = (e) => {
    results.push(`mesh:${e.data.id}`);
  };
  light.onmessage = (e) => {
    results.push(`light:${e.data.id}`);
  };
  gen.onmessage = (e) => {
    results.push(`gen:${e.data.id}`);
  };
  mesh.postMessage({ id: 1 });
  light.postMessage({ id: 1 });
  gen.postMessage({ id: 1 });
  expect(HeldWorker.all).toHaveLength(2);
  HeldWorker.all[0]!.answer(1);
  HeldWorker.all[1]!.answer();
  HeldWorker.all[0]!.answer();
  expect(results).toEqual(['gen:1', 'light:1', 'mesh:1']);
  budget.terminate();
});
test('terminating a logical lane leaves other lanes alive and drops obsolete delivery', () => {
  const budget = new SharedWorkerBudget(1);
  const gen = budget.createPort('gen');
  const mesh = budget.createPort('mesh');
  const receive = vi.fn();
  gen.onmessage = receive;
  gen.postMessage({ id: 2 });
  gen.terminate();
  mesh.onmessage = receive;
  mesh.postMessage({ id: 3 });
  HeldWorker.all[0]!.answer();
  HeldWorker.all[0]!.answer(1);
  expect(receive).toHaveBeenCalledTimes(1);
  expect(receive.mock.calls[0]![0].data.id).toBe(3);
  budget.terminate();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
test('frame delivery prioritizes meshes and stops at its time budget without losing results', () => {
  vi.useFakeTimers();
  let clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const budget = new SharedWorkerBudget(1);
  budget.enableDeferredDelivery();
  const gen = budget.createPort('gen'),
    mesh = budget.createPort('mesh');
  const delivered: string[] = [];
  gen.onmessage = () => {
    delivered.push('gen');
    clock += 3;
  };
  mesh.onmessage = () => {
    delivered.push('mesh');
    clock += 3;
  };
  gen.postMessage({ id: 1 });
  mesh.postMessage({ id: 1 });
  HeldWorker.all[0]!.answer();
  HeldWorker.all[0]!.answer(1);
  expect(delivered).toEqual([]);
  budget.flushDeliveries(2);
  expect(delivered).toEqual(['mesh']);
  budget.flushDeliveries(2);
  expect(delivered).toEqual(['mesh', 'gen']);
  budget.terminate();
});
