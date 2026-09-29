import { ColumnLightData, LightWorkerJobResponse } from './light.worker';
import { LightLookupTables } from '../world/lighting';
import { World } from '../world/world';

export class LightWorkerPool {
  private worker: Worker | null = null;
  private nextJobId = 1;

  constructor() {
    if (typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./light.worker.ts', import.meta.url), {
          type: 'module',
        });
      } catch (err) {
        console.warn('Light worker creation failed, falling back to main thread:', err);
        this.worker = null;
      }
    }
  }

  public async propagateRegion(
    world: World,
    minCx: number,
    minCz: number,
    maxCx: number,
    maxCz: number,
    tables: LightLookupTables,
  ): Promise<void> {
    const columnsData: ColumnLightData[] = [];

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        if (!world.hasColumn(cx, cz)) continue;
        const col = world.getColumn(cx, cz, false);
        if (!col) continue;

        const sections = [];
        for (let sy = 0; sy < 20; sy++) {
          const sec = col.getSection(sy);
          if (!sec) {
            sections.push({ sy, states: null, uniformStateId: 0 });
            continue;
          }
          if (sec.getBitsPerEntry() === 0) {
            sections.push({ sy, states: null, uniformStateId: sec.uniformStateId });
          } else {
            const states = new Uint16Array(4096);
            let idx = 0;
            for (let ly = 0; ly < 16; ly++) {
              for (let lz = 0; lz < 16; lz++) {
                for (let lx = 0; lx < 16; lx++) {
                  states[idx++] = sec.getBlockStateId(lx, ly, lz);
                }
              }
            }
            sections.push({ sy, states });
          }
        }
        columnsData.push({ cx, cz, sections });
      }
    }

    const worker = this.worker;
    if (!worker) {
      // Direct main thread fallback for non-worker environment
      world.getLightEngine().bulkPropagateRegion(world, minCx, minCz, maxCx, maxCz);
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const jobId = this.nextJobId++;

      const onMessage = (e: MessageEvent) => {
        const response = e.data as LightWorkerJobResponse;
        if (response.id === jobId) {
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);

          // Apply returned lit section light buffers to main thread LightStorage
          const storage = world.getLightEngine().storage;
          for (const res of response.results) {
            const sec = storage.getOrCreateSection(res.cx, res.sy, res.cz);
            sec.set(res.lightData);
          }

          resolve();
        }
      };

      const onError = (err: ErrorEvent) => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        reject(err.error || new Error('Light worker error'));
      };

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);

      const transferables: Transferable[] = [];
      for (const col of columnsData) {
        for (const sec of col.sections) {
          if (sec.states) {
            transferables.push(sec.states.buffer);
          }
        }
      }

      worker.postMessage(
        {
          id: jobId,
          minCx,
          minCz,
          maxCx,
          maxCz,
          columnsData,
          tables,
        },
        transferables,
      );
    });
  }

  public terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
