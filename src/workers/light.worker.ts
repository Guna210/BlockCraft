import { buildLightLookupTables, computeRegionLight, LightStorage } from '../world/lighting';
import { BlockRegistry } from '../world/blocks/registry';

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

ctx.onmessage = (event: MessageEvent) => {
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
};
