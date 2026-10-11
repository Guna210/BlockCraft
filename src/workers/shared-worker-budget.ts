export type WorkerKind = 'mesh' | 'light' | 'gen';

interface WorkerPort {
  onmessage: Worker['onmessage'];
  onerror: Worker['onerror'];
  postMessage(data: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}
interface Posted {
  port: WorkerPort;
  worker: Worker;
  kind: WorkerKind;
}

/** Logical pool ports share actual threads; priority is applied in the worker between jobs. */
export class SharedWorkerBudget {
  private workers: Worker[] = [];
  private loads = new Map<Worker, number>();
  private posted = new Map<number, Posted>();
  private nextId = 1;
  private deferredDelivery = false;
  private deliveryScheduled = false;
  private inbox: Array<{ job: Posted; payload: unknown; receivedAt: number }> = [];
  public meshArrivalMs: number[] = [];
  public meshInboxMs: number[] = [];
  private turn = new MessageChannel();
  private turnWaiters: Array<() => void> = [];
  public readonly size: number;

  constructor(size = Math.max(1, (navigator.hardwareConcurrency || 2) - 1)) {
    this.size = Math.max(1, Math.floor(size));
    this.turn.port1.onmessage = () => this.turnWaiters.shift()?.();
    for (let i = 0; i < this.size; i++) {
      const worker = new Worker(new URL('./shared.worker.ts', import.meta.url), { type: 'module' });
      this.workers.push(worker);
      this.loads.set(worker, 0);
      worker.onmessage = (event: MessageEvent<{ requestId: number; payload: unknown }>) => {
        const job = this.posted.get(event.data.requestId);
        if (!job) return;
        this.posted.delete(event.data.requestId);
        this.loads.set(worker, this.loads.get(worker)! - 1);
        const receivedAt = performance.now();
        const data = event.data.payload as { finishedAt?: number };
        if (job.kind === 'mesh' && data.finishedAt !== undefined) {
          this.meshArrivalMs.push(performance.timeOrigin + receivedAt - data.finishedAt);
          if (this.meshArrivalMs.length > 100) this.meshArrivalMs.shift();
        }
        if (this.deferredDelivery) {
          this.inbox.push({ job, payload: event.data.payload, receivedAt });
          this.scheduleDelivery();
        } else {
          job.port.onmessage?.call(
            job.port as unknown as Worker,
            { data: event.data.payload } as MessageEvent,
          );
        }
      };
      worker.onerror = (event) => {
        for (const [id, job] of this.posted) {
          if (job.worker !== worker) continue;
          this.posted.delete(id);
          job.port.onerror?.call(job.port as unknown as Worker, event);
        }
        this.loads.set(worker, 0);
      };
    }
  }

  public enableDeferredDelivery(): void {
    this.deferredDelivery = true;
  }

  /** One unconditional task turn lets already-posted worker messages arrive after a GL wait. */
  public messageTurn(): Promise<void> {
    return new Promise((resolve) => {
      this.turnWaiters.push(resolve);
      this.turn.port2.postMessage(0);
    });
  }

  /** Deliver at least one result, then stop at the main-thread deadline. */
  public flushDeliveries(budgetMs: number): void {
    const end = performance.now() + budgetMs;
    const priorities = { mesh: 0, light: 1, gen: 2 };
    this.inbox.sort((a, b) => priorities[a.job.kind] - priorities[b.job.kind]);
    let did = false;
    while (this.inbox.length && (!did || performance.now() < end)) {
      const item = this.inbox.shift()!;
      if (item.job.kind === 'mesh') {
        this.meshInboxMs.push(performance.now() - item.receivedAt);
        if (this.meshInboxMs.length > 100) this.meshInboxMs.shift();
      }
      item.job.port.onmessage?.call(
        item.job.port as unknown as Worker,
        { data: item.payload } as MessageEvent,
      );
      did = true;
    }
    if (this.inbox.length) this.scheduleDelivery();
  }

  private scheduleDelivery(): void {
    if (this.deliveryScheduled) return;
    this.deliveryScheduled = true;
    setTimeout(() => {
      this.deliveryScheduled = false;
      this.flushDeliveries(3);
    }, 0);
  }

  public setView(x: number, z: number, yaw: number): void {
    for (const worker of this.workers) worker.postMessage({ view: { x, z, yaw } });
  }

  public createPort(kind: WorkerKind): Worker {
    let terminated = false;
    const port: WorkerPort = {
      onmessage: null,
      onerror: null,
      postMessage: (payload, transfer = []) => {
        if (terminated) return;
        const worker = this.workers.reduce((best, candidate) =>
          this.loads.get(candidate)! < this.loads.get(best)! ? candidate : best,
        );
        const requestId = this.nextId++;
        this.posted.set(requestId, { port, worker, kind });
        this.loads.set(worker, this.loads.get(worker)! + 1);
        const data = payload as {
          cx?: number;
          cz?: number;
          interior?: { minCX: number; maxCX: number; minCZ: number; maxCZ: number };
          background?: boolean;
        };
        const cx = data.cx ?? (data.interior ? (data.interior.minCX + data.interior.maxCX) / 2 : 0);
        const cz = data.cz ?? (data.interior ? (data.interior.minCZ + data.interior.maxCZ) / 2 : 0);
        worker.postMessage(
          {
            requestId,
            kind,
            payload,
            cx,
            cz,
            foreground: kind === 'mesh' && data.background === false,
          },
          transfer,
        );
      },
      terminate: () => {
        terminated = true;
        port.onmessage = null;
        port.onerror = null;
      },
    };
    return port as unknown as Worker;
  }

  public terminate(): void {
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
    this.posted.clear();
    this.loads.clear();
    this.inbox = [];
    this.turn.port1.close();
    this.turn.port2.close();
  }
}
