import { LightEngine, LightLookupTables } from '../world/lighting';
import { World } from '../world/world';

export interface ColumnLightData {
  cx: number;
  cz: number;
  sections: Array<{
    sy: number;
    states: Uint16Array | null;
    uniformStateId?: number;
  }>;
}

export interface LightWorkerJobRequest {
  id: number;
  minCx: number;
  minCz: number;
  maxCx: number;
  maxCz: number;
  columnsData: ColumnLightData[];
  tables: LightLookupTables;
}

export interface SectionLightResult {
  cx: number;
  sy: number;
  cz: number;
  lightData: Uint8Array | null;
  uniformSky?: number;
}

export interface LightWorkerJobResponse {
  id: number;
  results: SectionLightResult[];
  duration: number;
}

class WorkerLightWorld {
  private colMap = new Map<number, Map<number, Uint16Array | number>>();
  private lastColKey = -1;
  private lastSecMap: Map<number, Uint16Array | number> | undefined = undefined;

  constructor(columnsData: ColumnLightData[]) {
    for (const col of columnsData) {
      const key = ((col.cx + 32768) << 16) | ((col.cz + 32768) & 0xffff);
      const secMap = new Map<number, Uint16Array | number>();
      for (const sec of col.sections) {
        if (sec.states) {
          secMap.set(sec.sy, sec.states);
        } else if (sec.uniformStateId !== undefined) {
          secMap.set(sec.sy, sec.uniformStateId);
        }
      }
      this.colMap.set(key, secMap);
    }
  }

  public hasColumn(cx: number, cz: number): boolean {
    const key = ((cx + 32768) << 16) | ((cz + 32768) & 0xffff);
    return this.colMap.has(key);
  }

  public getBlockStateId(x: number, y: number, z: number): number {
    if (y < 0 || y > 319) return 0;
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const colKey = ((cx + 32768) << 16) | ((cz + 32768) & 0xffff);

    let secMap = this.lastSecMap;
    if (colKey !== this.lastColKey) {
      secMap = this.colMap.get(colKey);
      this.lastColKey = colKey;
      this.lastSecMap = secMap;
    }
    if (!secMap) return 0;

    const sy = y >> 4;
    const secData = secMap.get(sy);
    if (secData === undefined) return 0;
    if (typeof secData === 'number') return secData;

    const localX = ((x % 16) + 16) % 16;
    const localY = y & 15;
    const localZ = ((z % 16) + 16) % 16;
    const idx = (localY << 8) | (localZ << 4) | localX;
    return secData[idx] ?? 0;
  }
}

export function performBulkLightPropagation(
  minCx: number,
  minCz: number,
  maxCx: number,
  maxCz: number,
  columnsData: ColumnLightData[],
  tables: LightLookupTables,
  worldTarget?: World,
): { results: SectionLightResult[]; lightEngine: LightEngine; world: World } {
  const world = worldTarget ?? new World();

  if (!worldTarget) {
    for (const colData of columnsData) {
      const col = world.getColumn(colData.cx, colData.cz, true)!;
      for (const secData of colData.sections) {
        if (secData.states) {
          const sec = col.getOrCreateSection(secData.sy);
          sec?.loadBlockStatesFrom(secData.states);
        } else if (secData.uniformStateId !== undefined && secData.uniformStateId !== 0) {
          const sec = col.getOrCreateSection(secData.sy, secData.uniformStateId);
          sec?.fill(secData.uniformStateId);
        }
      }
    }
  }

  const lightEngine = world.getLightEngine();
  lightEngine.tables = tables;
  lightEngine.suspendUpdates();

  lightEngine.bulkPropagateRegion(world, minCx, minCz, maxCx, maxCz);

  const results: SectionLightResult[] = [];
  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cz = minCz; cz <= maxCz; cz++) {
      if (!world.hasColumn(cx, cz)) continue;
      for (let sy = 0; sy < 20; sy++) {
        const sec = lightEngine.storage.getSection(cx, sy, cz);
        if (sec) {
          // Check if uniform
          let isUniform = true;
          const firstVal = sec[0]!;
          for (let i = 1; i < 4096; i++) {
            if (sec[i] !== firstVal) {
              isUniform = false;
              break;
            }
          }
          if (isUniform) {
            results.push({
              cx,
              sy,
              cz,
              lightData: null,
              uniformSky: firstVal & 0x0f,
            });
          } else {
            const copy = new Uint8Array(sec);
            results.push({ cx, sy, cz, lightData: copy });
          }
        }
      }
    }
  }

  return { results, lightEngine, world };
}

const ctx: Worker = self as unknown as Worker;

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  ctx.onmessage = (event: MessageEvent) => {
    const { id, minCx, minCz, maxCx, maxCz, columnsData, tables } =
      event.data as LightWorkerJobRequest;

    const start = performance.now();
    const workerWorld = new WorkerLightWorld(columnsData);
    const lightEngine = new LightEngine(tables);

    // Propagate light using pure WorkerLightWorld
    lightEngine.bulkPropagateRegion(workerWorld as unknown as World, minCx, minCz, maxCx, maxCz);
    const duration = performance.now() - start;

    const results: SectionLightResult[] = [];
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        if (!workerWorld.hasColumn(cx, cz)) continue;
        for (let sy = 0; sy < 20; sy++) {
          const sec = lightEngine.storage.getSection(cx, sy, cz);
          if (sec) {
            let isUniform = true;
            const firstVal = sec[0]!;
            for (let i = 1; i < 4096; i++) {
              if (sec[i] !== firstVal) {
                isUniform = false;
                break;
              }
            }
            if (isUniform) {
              results.push({
                cx,
                sy,
                cz,
                lightData: null,
                uniformSky: firstVal & 0x0f,
              });
            } else {
              const copy = new Uint8Array(sec);
              results.push({ cx, sy, cz, lightData: copy });
            }
          }
        }
      }
    }

    const transferables: Transferable[] = [];
    for (const r of results) {
      if (r.lightData) {
        transferables.push(r.lightData.buffer);
      }
    }

    ctx.postMessage({ id, results, duration } as LightWorkerJobResponse, transferables);
  };
}
