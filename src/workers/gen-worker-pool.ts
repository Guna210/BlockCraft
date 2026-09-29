import type { SectionDataTransfer, GenWorkerResponse } from './gen.worker';

export interface GenResult {
  cx: number;
  cz: number;
  sections: SectionDataTransfer[];
  perSectionMs: number;
}

interface GenJob {
  id: number;
  seed: number;
  cx: number;
  cz: number;
  type: 'default' | 'flat';
  resolve: (result: GenResult) => void;
  reject: (err: Error) => void;
}

export class GenWorkerPool {
  private workers: Worker[] = [];
  private idleWorkers: Worker[] = [];
  private queue: GenJob[] = [];
  private activeJobs: Map<Worker, GenJob> = new Map();
  private genMsTimes: number[] = [];
  private nextJobId = 1;
  private currentPoolSize: number;

  constructor(poolSize?: number) {
    if (typeof Worker === 'undefined') {
      throw new Error('Web Workers are not supported in this environment');
    }

    const defaultSize =
      typeof navigator !== 'undefined' && navigator.hardwareConcurrency
        ? Math.max(2, navigator.hardwareConcurrency - 1)
        : 2;

    this.currentPoolSize = poolSize || defaultSize;
    this.createWorkers(this.currentPoolSize);
  }

  public setPoolSize(newSize: number): void {
    this.terminate();
    this.currentPoolSize = newSize;
    this.createWorkers(newSize);
  }

  private createWorkers(size: number): void {
    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL('./gen.worker.ts', import.meta.url), {
        type: 'module',
      });

      worker.onmessage = (e: MessageEvent) => {
        const { cx, cz, sections, perSectionMs } = e.data as GenWorkerResponse;

        this.genMsTimes.push(perSectionMs);
        if (this.genMsTimes.length > 100) {
          this.genMsTimes.shift();
        }

        const job = this.activeJobs.get(worker);
        this.activeJobs.delete(worker);
        this.idleWorkers.push(worker);

        if (job) {
          job.resolve({
            cx,
            cz,
            sections,
            perSectionMs,
          });
        }

        this.processQueue();
      };

      worker.onerror = (err: ErrorEvent) => {
        const job = this.activeJobs.get(worker);
        this.activeJobs.delete(worker);
        console.error('Gen worker error:', err);

        if (job) {
          job.reject(
            err.error instanceof Error ? err.error : new Error(err.message || 'Gen worker error'),
          );
        }

        this.processQueue();
      };

      this.workers.push(worker);
      this.idleWorkers.push(worker);
    }
  }

  public get workerCount(): number {
    return this.workers.length;
  }

  public get queueLength(): number {
    return this.queue.length + this.activeJobs.size;
  }

  public get genMsP95(): number {
    if (this.genMsTimes.length === 0) return 0;
    const sorted = [...this.genMsTimes].sort((a, b) => a - b);
    const p95Idx = Math.floor(sorted.length * 0.95);
    return sorted[p95Idx] ?? 0;
  }

  public enqueueGenJob(
    seed: number,
    cx: number,
    cz: number,
    type: 'default' | 'flat',
  ): Promise<GenResult> {
    const id = this.nextJobId++;

    return new Promise<GenResult>((resolve, reject) => {
      const job: GenJob = {
        id,
        seed,
        cx,
        cz,
        type,
        resolve,
        reject,
      };

      this.queue.push(job);
      this.processQueue();
    });
  }

  private processQueue(): void {
    while (this.idleWorkers.length > 0 && this.queue.length > 0) {
      const worker = this.idleWorkers.pop()!;
      const job = this.queue.shift()!;

      this.activeJobs.set(worker, job);

      worker.postMessage({
        id: job.id,
        seed: job.seed,
        cx: job.cx,
        cz: job.cz,
        type: job.type,
      });
    }
  }

  public terminate(): void {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.idleWorkers = [];
    this.activeJobs.clear();
    this.queue = [];
  }
}
