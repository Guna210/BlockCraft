import { blockSnapshotTransfers, type BlockColumnsSnapshot } from '../world/block-snapshot';
import type { SharedWorkerBudget } from './shared-worker-budget';
import type { ColumnWorkPriority } from '../world/streamer';
import type { LightRect, ColumnLight } from '../world/batch-light';
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
  regionColumns: BlockColumnsSnapshot;
  resolve: (result: LightRegionResult) => void;
  reject: (err: Error) => void;
}

export class LightWorkerPool {
  private priorities = new Map<string, number>();

  public setWorkPriorities(priorities: ColumnWorkPriority[]): void {
    this.priorities = new Map(priorities.map((p) => [`${p.cx},${p.cz}`, p.light]));
  }

  private jobPriority(job: LightJob): number {
    if (!job.interior) return -1;
    let rank = 1e9;
    for (let z = job.interior.minCZ; z <= job.interior.maxCZ; z++)
      for (let x = job.interior.minCX; x <= job.interior.maxCX; x++)
        rank = Math.min(rank, this.priorities.get(`${x},${z}`) ?? 1e9);
    return rank;
  }
  private workers: Worker[] = [];
  private idleWorkers: Worker[] = [];
  private queue: LightJob[] = [];
  private activeJobs: Map<Worker, LightJob[]> = new Map();
  private nextJobId = 1;
  private currentPoolSize: number;

  constructor(
    poolSize?: number,
    private readonly sharedBudget?: SharedWorkerBudget,
  ) {
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
      const worker =
        this.sharedBudget?.createPort('light') ??
        new Worker(new URL('./light.worker.ts', import.meta.url), {
          type: 'module',
        });

      worker.onmessage = (e: MessageEvent) => {
        const response = e.data as LightRegionResponse & LightBatchResponse;
        const { id, sections, columns, duration } = response;

        const posted = this.activeJobs.get(worker) ?? [];
        const index = id === undefined ? 0 : posted.findIndex((job) => job.id === id);
        const job = index < 0 ? undefined : posted.splice(index, 1)[0];
        if (posted.length === 0) {
          this.activeJobs.delete(worker);
          this.idleWorkers.push(worker);
        }

        if (job) {
          job.resolve({ sections: sections ?? [], columns, duration });
        }

        this.processQueue();
      };

      worker.onerror = (err: ErrorEvent) => {
        const jobs = this.activeJobs.get(worker) ?? [];
        this.activeJobs.delete(worker);
        console.error('Light worker error:', err);

        for (const job of jobs) {
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

  /**
   * Drops every queued job and, when jobs are running, replaces the workers so their work stops
   * too. The jobs' promises never settle; their owner (the streamer) has already abandoned them.
   */
  public cancelAll(): void {
    if (this.activeJobs.size > 0) this.setPoolSize(this.workerCount);
    else this.queue = [];
  }

  public get workerCount(): number {
    return this.workers.length;
  }

  public get queueLength(): number {
    return (
      this.queue.length + [...this.activeJobs.values()].reduce((n, jobs) => n + jobs.length, 0)
    );
  }

  public enqueueLightRegionJob(
    radiusChunks: number,
    regionColumns: BlockColumnsSnapshot,
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
    regionColumns: BlockColumnsSnapshot,
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
    this.queue.sort((a, b) => this.jobPriority(a) - this.jobPriority(b));
    while (this.queue.length > 0) {
      const index = this.queue.findIndex((job) =>
        [...this.activeJobs.values()].every((jobs) =>
          jobs.every((active) => {
            const a = job.interior;
            const b = active.interior;
            // Legacy region work conservatively holds the whole lighting lane.
            if (!a || !b) return false;
            return a.maxCX < b.minCX || b.maxCX < a.minCX || a.maxCZ < b.minCZ || b.maxCZ < a.minCZ;
          }),
        ),
      );
      if (index < 0) break;
      const worker =
        this.idleWorkers.shift() ??
        [...this.activeJobs]
          .filter(([, jobs]) => jobs.length < 4)
          .sort((a, b) => a[1].length - b[1].length)[0]?.[0];
      if (!worker) break;
      const job = this.queue.splice(index, 1)[0]!;
      const posted = this.activeJobs.get(worker) ?? [];
      posted.push(job);
      this.activeJobs.set(worker, posted);

      const transferables: Transferable[] = [];
      for (const sectionArray of Object.values(job.regionColumns)) {
        for (const item of sectionArray) {
          transferables.push(...blockSnapshotTransfers(item));
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
