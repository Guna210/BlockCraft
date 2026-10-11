import type { LightRect, LightColumns, ColumnLight } from '../world/batch-light';
import type { LightBatchResponse } from './light.worker';
import type { SectionLightTransfer, LightRegionResponse } from './light.worker';

export interface LightRegionResult {
  sections: SectionLightTransfer[];
  columns?: ColumnLight[];
  duration?: number;
}

interface LightJob {
  id: number;
  radiusChunks: number;
  bounds?: LightRect;
  interior?: LightRect;
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
        const response = e.data as LightRegionResponse & LightBatchResponse;
        const { sections, columns, duration } = response;

        const job = this.activeJobs.get(worker);
        this.activeJobs.delete(worker);
        this.idleWorkers.push(worker);

        if (job) {
          job.resolve({ sections: sections ?? [], columns, duration });
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
    const bounds = {
      minCX: -radiusChunks,
      maxCX: radiusChunks,
      minCZ: -radiusChunks,
      maxCZ: radiusChunks,
    };
    // The outer generated ring is the block-data border, not a lit interior. It will receive its
    // own exact skirt when streaming supplies its neighbours and wants to mesh it.
    return this.enqueueBatch(
      bounds,
      {
        minCX: bounds.minCX + 1,
        maxCX: bounds.maxCX - 1,
        minCZ: bounds.minCZ + 1,
        maxCZ: bounds.maxCZ - 1,
      },
      regionColumns,
    );
  }

  public enqueueBatch(
    bounds: LightRect,
    interior: LightRect,
    regionColumns: LightColumns,
  ): Promise<LightRegionResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        id: this.nextJobId++,
        radiusChunks: 0,
        bounds,
        interior,
        regionColumns,
        resolve,
        reject,
      });
      this.processQueue();
    });
  }

  private processQueue(): void {
    while (this.idleWorkers.length > 0 && this.queue.length > 0 && this.activeJobs.size === 0) {
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
          ...(job.bounds
            ? { bounds: job.bounds, interior: job.interior, columns: job.regionColumns }
            : {}),
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
