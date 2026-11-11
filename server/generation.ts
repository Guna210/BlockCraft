import type { BlockColumnsSnapshot } from '../src/world/block-snapshot';
import type { ColumnLight, LightRect } from '../src/world/batch-light';
import { Worker } from 'node:worker_threads';
import type { DimensionId } from '../src/world/dimension';
import type { StructureMarker } from '../src/gen/structures/stage';

export interface LightingJob {
  bounds: LightRect;
  interior: LightRect;
  columns: BlockColumnsSnapshot;
}
export interface GeneratedColumn {
  relit?: ColumnLight[];
  bytes: Uint8Array;
  lights: Array<{ sy: number; data: Uint8Array; rgb: Uint8Array[] }>;
  markers: StructureMarker[];
}
interface Job {
  id: number;
  seed: number;
  dimension: DimensionId;
  cx: number;
  cz: number;
  bytes?: Uint8Array;
  light?: LightingJob;
  resolve(value: GeneratedColumn): void;
  reject(error: Error): void;
}
/** Bounded pool: one active column per worker, callers queue without blocking the tick. */
export class GenerationPool {
  private readonly workers: Array<{ worker: Worker; job: Job | null }> = [];
  private readonly queue: Job[] = [];
  private nextId = 0;
  private closed = false;
  constructor(size = 2, entry = new URL('./generation-worker.js', import.meta.url)) {
    for (let i = 0; i < size; i++) {
      const slot = { worker: new Worker(entry), job: null as Job | null };
      slot.worker.on('message', (result: GeneratedColumn & { error?: string }) => {
        if (result.error) slot.job?.reject(new Error(result.error));
        else slot.job?.resolve(result);
        slot.job = null;
        this.dispatch();
      });
      slot.worker.on('error', (error) =>
        this.fail(error instanceof Error ? error : new Error(String(error))),
      );
      slot.worker.on('exit', (code) => {
        if (code !== 0 && !this.closed) this.fail(new Error(`Generation worker exited: ${code}`));
      });
      this.workers.push(slot);
    }
  }
  generate(
    seed: number,
    dimension: DimensionId,
    cx: number,
    cz: number,
    bytes?: Uint8Array,
    light?: LightingJob,
  ): Promise<GeneratedColumn> {
    if (this.closed) return Promise.reject(new Error('Generation pool closed'));
    return new Promise((resolve, reject) => {
      this.queue.push({
        id: this.nextId++,
        seed,
        dimension,
        cx,
        cz,
        bytes,
        light,
        resolve,
        reject,
      });
      this.dispatch();
    });
  }
  private dispatch(): void {
    for (const slot of this.workers) {
      if (slot.job || !this.queue.length) continue;
      const job = this.queue.shift()!;
      slot.job = job;
      slot.worker.postMessage({
        id: job.id,
        seed: job.seed,
        dimension: job.dimension,
        cx: job.cx,
        cz: job.cz,
        bytes: job.bytes,
        light: job.light,
      });
    }
  }
  private fail(error: Error): void {
    this.closed = true;
    for (const job of this.queue) job.reject(error);
    this.queue.length = 0;
    for (const slot of this.workers) {
      slot.job?.reject(error);
      slot.job = null;
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const job of this.queue) job.reject(new Error('Generation pool closed'));
    this.queue.length = 0;
    await Promise.all(
      this.workers.map(async (slot) => {
        slot.job?.reject(new Error('Generation pool closed'));
        await slot.worker.terminate();
      }),
    );
  }
}
