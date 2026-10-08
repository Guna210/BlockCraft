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
  paddedSection: Uint16Array;
  tables: MeshLookupTables;
  /** Streaming job: never takes the last idle worker (see `processQueue`). */
  background: boolean;
  resolve: (result: MeshResult) => void;
  reject: (err: Error) => void;
}

export class WorkerPool {
  private workers: Worker[] = [];
  private idleWorkers: Worker[] = [];
  private queue: MeshJob[] = [];
  private activeJobs: Map<Worker, MeshJob> = new Map();
  private meshMsTimes: number[] = [];
  private nextJobId = 1;

  constructor(poolSize?: number) {
    if (typeof Worker === 'undefined') {
      throw new Error('Web Workers are not supported in this environment');
    }

    const defaultSize =
      typeof navigator !== 'undefined' && navigator.hardwareConcurrency
        ? Math.max(2, navigator.hardwareConcurrency - 1)
        : 2;

    const size = poolSize || defaultSize;

    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL('../workers/mesh.worker.ts', import.meta.url), {
        type: 'module',
      });

      worker.onmessage = (e: MessageEvent) => {
        const { meshData, duration } = e.data as {
          id: number;
          meshData: SectionMeshData;
          duration: number;
        };

        this.meshMsTimes.push(duration);
        if (this.meshMsTimes.length > 100) {
          this.meshMsTimes.shift();
        }

        const job = this.activeJobs.get(worker);
        this.activeJobs.delete(worker);
        this.idleWorkers.push(worker);

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
        const job = this.activeJobs.get(worker);
        this.activeJobs.delete(worker);
        console.error('Mesh worker error:', err);

        if (job) {
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
    return this.queue.length + this.activeJobs.size;
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
    paddedSection: Uint16Array,
    tables: MeshLookupTables,
    background = false,
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
    const reserved = this.workers.length > 1 ? 1 : 0;
    while (this.idleWorkers.length > 0 && this.queue.length > 0) {
      const index =
        this.idleWorkers.length > reserved ? 0 : this.queue.findIndex((j) => !j.background);
      if (index < 0) break;
      const worker = this.idleWorkers.pop()!;
      const job = this.queue.splice(index, 1)[0]!;

      this.activeJobs.set(worker, job);

      worker.postMessage(
        {
          id: job.id,
          paddedSection: job.paddedSection,
          tables: job.tables,
        },
        [job.paddedSection.buffer],
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
