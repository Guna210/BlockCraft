import { blockSnapshotTransfers, type BlockPaddingInput } from '../world/block-snapshot';
import type { SharedWorkerBudget } from '../workers/shared-worker-budget';
import type { ColumnWorkPriority } from '../world/streamer';
import type { LightPaddingInput } from '../world/light-padding';
import type { SectionMeshData, MeshLookupTables } from './greedy';

export interface MeshResult {
  key: string;
  sx: number;
  sy: number;
  sz: number;
  meshData: SectionMeshData;
  duration: number;
}

interface MeshJob {
  id: number;
  key: string;
  sx: number;
  sy: number;
  sz: number;
  paddedSection: Uint16Array | BlockPaddingInput;
  light?: LightPaddingInput;
  tables: MeshLookupTables;
  /** Streaming job: never takes the last idle worker (see `processQueue`). */
  background: boolean;
  resolve: (result: MeshResult) => void;
  reject: (err: Error) => void;
}

export class WorkerPool {
  private priorities = new Map<string, number>();

  public setWorkPriorities(priorities: ColumnWorkPriority[]): void {
    this.priorities = new Map(priorities.map((p) => [`${p.cx},${p.cz}`, p.mesh]));
  }
  private workers: Worker[] = [];
  private idleWorkers: Worker[] = [];
  private queue: MeshJob[] = [];
  private activeJobs: Map<Worker, MeshJob[]> = new Map();
  private meshMsTimes: number[] = [];
  private nextJobId = 1;
  public completedWorkMs = 0;
  public completedJobs = 0;
  public deliveryMs: number[] = [];

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

    const size = poolSize || defaultSize;

    for (let i = 0; i < size; i++) {
      const worker =
        this.sharedBudget?.createPort('mesh') ??
        new Worker(new URL('../workers/mesh.worker.ts', import.meta.url), {
          type: 'module',
        });

      worker.onmessage = (e: MessageEvent) => {
        const { id, meshData, duration, finishedAt } = e.data as {
          id: number;
          meshData: SectionMeshData;
          duration: number;
          finishedAt?: number;
        };

        this.completedWorkMs += duration;
        this.completedJobs++;
        if (finishedAt !== undefined) {
          this.deliveryMs.push(performance.timeOrigin + performance.now() - finishedAt);
          if (this.deliveryMs.length > 100) this.deliveryMs.shift();
        }
        this.meshMsTimes.push(duration);
        if (this.meshMsTimes.length > 100) {
          this.meshMsTimes.shift();
        }

        const posted = this.activeJobs.get(worker) ?? [];
        const index = id === undefined ? 0 : posted.findIndex((job) => job.id === id);
        const job = index < 0 ? undefined : posted.splice(index, 1)[0];
        if (posted.length === 0) {
          this.activeJobs.delete(worker);
          this.idleWorkers.push(worker);
        }

        if (job) {
          job.resolve({
            key: job.key,
            sx: job.sx,
            sy: job.sy,
            sz: job.sz,
            meshData,
            duration,
          });
        }

        this.processQueue();
      };

      worker.onerror = (err: ErrorEvent) => {
        const jobs = this.activeJobs.get(worker) ?? [];
        this.activeJobs.delete(worker);
        console.error('Mesh worker error:', err);

        for (const job of jobs) {
          job.reject(
            err.error instanceof Error ? err.error : new Error(err.message || 'Mesh worker error'),
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
    return (
      this.queue.length + [...this.activeJobs.values()].reduce((n, jobs) => n + jobs.length, 0)
    );
  }

  public get meshMsP95(): number {
    if (this.meshMsTimes.length === 0) return 0;
    const sorted = [...this.meshMsTimes].sort((a, b) => a - b);
    const p95Idx = Math.floor(sorted.length * 0.95);
    return sorted[p95Idx] ?? 0;
  }

  public enqueueMeshJob(
    sx: number,
    sy: number,
    sz: number,
    paddedSection: Uint16Array | BlockPaddingInput,
    tables: MeshLookupTables,
    background = false,
    light?: LightPaddingInput,
  ): Promise<MeshResult> {
    const key = `${sx},${sy},${sz}`;
    const id = this.nextJobId++;

    return new Promise<MeshResult>((resolve, reject) => {
      const job: MeshJob = {
        id,
        key,
        sx,
        sy,
        sz,
        paddedSection,
        tables,
        background,
        light,
        resolve,
        reject,
      };

      this.queue.push(job);
      this.processQueue();
    });
  }

  /**
   * Hands queued jobs to idle workers in order. Background (streaming) jobs leave one worker idle
   * when the pool has more than one, so a foreground job (an edit that must be re-meshed at once)
   * starts without waiting for a streaming job to finish.
   */
  private processQueue(): void {
    this.queue.sort(
      (a, b) =>
        (this.priorities.get(`${a.sx},${a.sz}`) ?? 1e9) -
        (this.priorities.get(`${b.sx},${b.sz}`) ?? 1e9),
    );
    const reserved = this.workers.length > 1 ? 1 : 0;
    while (this.queue.length > 0) {
      const index = this.queue.findIndex((job) => !job.background);
      const job = this.queue[index < 0 ? 0 : index]!;
      let worker: Worker | undefined;
      if (job.background) {
        if (this.idleWorkers.length > reserved) worker = this.idleWorkers.shift();
        else {
          const credit = this.workers.length === 1 ? 1 : 32;
          worker = [...this.activeJobs]
            .filter(([, jobs]) => jobs.length < credit && jobs.every((posted) => posted.background))
            .sort((a, b) => a[1].length - b[1].length)[0]?.[0];
        }
      } else {
        worker = this.idleWorkers.shift();
      }
      if (!worker) break;
      this.queue.splice(index < 0 ? 0 : index, 1);
      const posted = this.activeJobs.get(worker) ?? [];
      posted.push(job);
      this.activeJobs.set(worker, posted);

      const transfers: Transferable[] =
        job.paddedSection instanceof Uint16Array
          ? [job.paddedSection.buffer]
          : job.paddedSection.sections.flatMap(blockSnapshotTransfers);
      if (job.light) {
        for (const column of job.light.columns)
          for (const section of column.sections) {
            if (section.raw instanceof Uint8Array) transfers.push(section.raw.buffer);
            for (const channel of section.rgb ?? [])
              if (channel instanceof Uint8Array) transfers.push(channel.buffer);
          }
        if (job.light.skirt) transfers.push(job.light.skirt.data.buffer);
      }

      worker.postMessage(
        {
          id: job.id,
          cx: job.sx,
          cz: job.sz,
          background: job.background,
          paddedSection: job.paddedSection,
          tables: job.tables,
          light: job.light,
        },
        transfers,
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
