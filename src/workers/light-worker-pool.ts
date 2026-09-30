import type { SectionLightTransfer, LightRegionResponse } from './light.worker';

export interface LightRegionResult {
  sections: SectionLightTransfer[];
}

interface LightJob {
  id: number;
  radiusChunks: number;
  regionColumns: Record<string, (Uint16Array | number)[]>;
  resolve: (result: LightRegionResult) => void;
  reject: (err: Error) => void;
}

export class LightWorkerPool {
  private workers: Worker[] = [];
  private idleWorkers: Worker[] = [];
  private queue: LightJob[] = [];
  private activeJobs: Map<Worker, LightJob> = new Map();
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
      const worker = new Worker(new URL('./light.worker.ts', import.meta.url), {
        type: 'module',
      });

      worker.onmessage = (e: MessageEvent) => {
        const { sections } = e.data as LightRegionResponse;

        const job = this.activeJobs.get(worker);
        this.activeJobs.delete(worker);
        this.idleWorkers.push(worker);

        if (job) {
          job.resolve({ sections });
        }

        this.processQueue();
      };

      worker.onerror = (err: ErrorEvent) => {
        const job = this.activeJobs.get(worker);
        this.activeJobs.delete(worker);
        console.error('Light worker error:', err);

        if (job) {
          job.reject(
            err.error instanceof Error ? err.error : new Error(err.message || 'Light worker error'),
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

  public enqueueLightRegionJob(
    radiusChunks: number,
    regionColumns: Record<string, (Uint16Array | number)[]>,
  ): Promise<LightRegionResult> {
    const id = this.nextJobId++;

    return new Promise<LightRegionResult>((resolve, reject) => {
      const job: LightJob = {
        id,
        radiusChunks,
        regionColumns,
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

      const transferables: Transferable[] = [];
      for (const sectionArray of Object.values(job.regionColumns)) {
        for (const item of sectionArray) {
          if (item instanceof Uint16Array) {
            transferables.push(item.buffer);
          }
        }
      }

      worker.postMessage(
        {
          id: job.id,
          radiusChunks: job.radiusChunks,
          regionColumns: job.regionColumns,
        },
        transferables,
      );
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
