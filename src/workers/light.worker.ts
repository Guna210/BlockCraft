import { buildLightLookupTables, computeRegionLight, LightStorage } from '../world/lighting';
import { BlockRegistry } from '../world/blocks/registry';
import {
  computeBatchLight,
  type LightRect,
  type LightColumns,
  type ColumnLight,
} from '../world/batch-light';

const ctx: Worker = self as unknown as Worker;

// Ensure registry loaded in worker
BlockRegistry.getInstance();
const tables = buildLightLookupTables(BlockRegistry.getInstance());

export interface LightRegionRequest {
  id: number;
  radiusChunks: number;
  // Region block data transferred as map of chunkKey -> array of section data
  regionColumns: Record<string, (Uint16Array | number)[]>;
}

export interface SectionLightTransfer {
  key: number; // numeric section key packed from cx, sy, cz
  cx: number;
  sy: number;
  cz: number;
  lightData: Uint8Array; // 4096 bytes
}

export interface LightRegionResponse {
  id: number;
  sections: SectionLightTransfer[];
}

export interface LightBatchResponse {
  id: number;
  columns: ColumnLight[];
  duration: number;
}

export function processLightMessage(event: MessageEvent): void {
  if ('bounds' in event.data) {
    const { id, bounds, interior, columns } = event.data as {
      id: number;
      bounds: LightRect;
      interior: LightRect;
      columns: LightColumns;
    };
    const start = performance.now();
    const result = computeBatchLight(bounds, interior, columns, tables);
    const transferables: Transferable[] = [];
    for (const column of result) {
      transferables.push(column.skirt.buffer);
      for (const section of column.sections) {
        if (section.lightData instanceof Uint8Array) transferables.push(section.lightData.buffer);
        for (const channel of section.rgb ?? []) transferables.push(channel.buffer);
      }
    }
    ctx.postMessage(
      { id, columns: result, duration: performance.now() - start } satisfies LightBatchResponse,
      transferables,
    );
    return;
  }
  const { id, radiusChunks, regionColumns } = event.data as LightRegionRequest;

  const resultMap = computeRegionLight(radiusChunks, regionColumns, tables);

  const sections: SectionLightTransfer[] = [];
  const transferables: Transferable[] = [];

  for (let cx = -radiusChunks; cx <= radiusChunks; cx++) {
    for (let cz = -radiusChunks; cz <= radiusChunks; cz++) {
      for (let sy = 0; sy < 20; sy++) {
        const secKey = LightStorage.getSectionKey(cx, sy, cz);
        const raw = resultMap.get(secKey);
        if (raw) {
          sections.push({ key: secKey, cx, sy, cz, lightData: raw });
          transferables.push(raw.buffer);
        }
      }
    }
  }

  ctx.postMessage({ id, sections } as LightRegionResponse, transferables);
}

ctx.onmessage = processLightMessage;
