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
  lightData: Uint8Array;
}

export interface LightWorkerJobResponse {
  id: number;
  results: SectionLightResult[];
  duration: number;
}

export function performBulkLightPropagation(
  minCx: number,
  minCz: number,
  maxCx: number,
  maxCz: number,
  columnsData: ColumnLightData[],
  tables: LightLookupTables,
): { results: SectionLightResult[]; lightEngine: LightEngine; world: World } {
  const world = new World();
  const lightEngine = world.getLightEngine();
  lightEngine.tables = tables;

  lightEngine.suspendUpdates();

  for (const colData of columnsData) {
    for (const secData of colData.sections) {
      if (secData.states) {
        let idx = 0;
        for (let ly = 0; ly < 16; ly++) {
          const y = (secData.sy << 4) + ly;
          for (let lz = 0; lz < 16; lz++) {
            const z = colData.cz * 16 + lz;
            for (let lx = 0; lx < 16; lx++) {
              const x = colData.cx * 16 + lx;
              const stateId = secData.states[idx++]!;
              world.setBlockStateId(x, y, z, stateId);
            }
          }
        }
      } else if (secData.uniformStateId !== undefined && secData.uniformStateId !== 0) {
        const col = world.getColumn(colData.cx, colData.cz, true)!;
        const sec = col.getOrCreateSection(secData.sy, secData.uniformStateId);
        sec?.fill(secData.uniformStateId);
      }
    }
  }

  lightEngine.bulkPropagateRegion(world, minCx, minCz, maxCx, maxCz);

  const results: SectionLightResult[] = [];
  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cz = minCz; cz <= maxCz; cz++) {
      if (!world.hasColumn(cx, cz)) continue;
      for (let sy = 0; sy < 20; sy++) {
        const sec = lightEngine.storage.getSection(cx, sy, cz);
        if (sec) {
          const copy = new Uint8Array(sec);
          results.push({ cx, sy, cz, lightData: copy });
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
    const { results } = performBulkLightPropagation(
      minCx,
      minCz,
      maxCx,
      maxCz,
      columnsData,
      tables,
    );
    const duration = performance.now() - start;

    const transferables: Transferable[] = results.map((r) => r.lightData.buffer);

    ctx.postMessage({ id, results, duration } as LightWorkerJobResponse, transferables);
  };
}
