import type { SharedWorkerBudget } from './shared-worker-budget';
import type { ColumnWorkPriority } from '../world/streamer';
import type { SectionDataTransfer, GenWorkerResponse } from './gen.worker';
import { columnPercentile, sectionPercentile, type GenSample } from './gen-stats';
import type { TerrainVariant } from '../gen/world-options';

// Number of most recent columns the percentile statistics cover
const GEN_STATS_WINDOW = 100;

export interface GenResult {
  cx: number;
  cz: number;
  sections: SectionDataTransfer[];
  biomes: Uint8Array;
  grassTints: Uint8Array;
  foliageTints: Uint8Array;
  columnMs: number;
  sectionCount: number;
  perSectionMs: number;
}

interface GenJob {
  id: number;
  seed: number;
  cx: number;
  cz: number;
  variant: TerrainVariant;
  structures: boolean;
  resolve: (result: GenResult) => void;
  reject: (err: Error) => void;
}

export class GenWorkerPool {
  private priorities = new Map<string, number>();

  public setWorkPriorities(priorities: ColumnWorkPriority[]): void {
    this.priorities = new Map(priorities.map((p) => [`${p.cx},${p.cz}`, p.gen]));
  }
  private workers: Worker[] = [];
  private idleWorkers: Worker[] = [];
  private queue: GenJob[] = [];
  private activeJobs: Map<Worker, GenJob[]> = new Map();
  private genSamples: GenSample[] = [];
  private nextJobId = 1;
  public completedWorkMs = 0;
  public completedJobs = 0;
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
        this.sharedBudget?.createPort('gen') ??
        new Worker(new URL('./gen.worker.ts', import.meta.url), {
          type: 'module',
        });

      worker.onmessage = (e: MessageEvent) => {
        const {
          id,
          cx,
          cz,
          sections,
          biomes,
          grassTints,
          foliageTints,
          columnMs,
          sectionCount,
          perSectionMs,
        } = e.data as GenWorkerResponse;

        this.completedWorkMs += columnMs;
        this.completedJobs++;
        this.genSamples.push({ columnMs, sections: sectionCount });
        if (this.genSamples.length > GEN_STATS_WINDOW) {
          this.genSamples.shift();
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
            cx,
            cz,
            sections,
            biomes,
            grassTints,
            foliageTints,
            columnMs,
            sectionCount,
            perSectionMs,
          });
        }

        this.processQueue();
      };

      worker.onerror = (err: ErrorEvent) => {
        const jobs = this.activeJobs.get(worker) ?? [];
        this.activeJobs.delete(worker);
        console.error('Gen worker error:', err);

        for (const job of jobs) {
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

  /**
   * p95 worker time per 16³ section over the last 100 generated columns: each column's wall time
   * (generation plus packaging) divided by the sections it produced, with every section counted.
   * See decisions/M03d-fix-gen-metric.md.
   */
  public get genMsP95(): number {
    return sectionPercentile(this.genSamples, 0.95);
  }

  /** p95 worker time per whole column over the same window (diagnostic, not a SPEC budget). */
  public get genColumnMsP95(): number {
    return columnPercentile(this.genSamples, 0.95);
  }

  public enqueueGenJob(
    seed: number,
    cx: number,
    cz: number,
    variant: TerrainVariant['type'] | TerrainVariant,
    structures = true,
  ): Promise<GenResult> {
    const id = this.nextJobId++;

    return new Promise<GenResult>((resolve, reject) => {
      const job: GenJob = {
        id,
        seed,
        cx,
        cz,
        variant: typeof variant === 'string' ? { type: variant } : variant,
        structures,
        resolve,
        reject,
      };

      this.queue.push(job);
      this.processQueue();
    });
  }

  private processQueue(): void {
    this.queue.sort(
      (a, b) =>
        (this.priorities.get(`${a.cx},${a.cz}`) ?? 1e9) -
        (this.priorities.get(`${b.cx},${b.cz}`) ?? 1e9),
    );
    while (this.queue.length > 0) {
      const worker =
        this.idleWorkers.shift() ?? [...this.activeJobs].find(([, jobs]) => jobs.length < 8)?.[0];
      if (!worker) break;
      const job = this.queue.shift()!;
      const posted = this.activeJobs.get(worker) ?? [];
      posted.push(job);
      this.activeJobs.set(worker, posted);

      worker.postMessage({
        id: job.id,
        seed: job.seed,
        cx: job.cx,
        cz: job.cz,
        type: job.variant.type,
        biome: job.variant.biome,
        structures: job.structures,
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
