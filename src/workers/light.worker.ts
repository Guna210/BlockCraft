import { LightEngine, buildLightLookupTables } from '../world/lighting';
import { World } from '../world/world';
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
  key: string; // "cx,sy,cz"
  lightData: Uint8Array; // 4096 bytes
}

export interface LightRegionResponse {
  id: number;
  sections: SectionLightTransfer[];
}

ctx.onmessage = (event: MessageEvent) => {
  const { id, radiusChunks, regionColumns } = event.data as LightRegionRequest;

  // Pass false to World constructor to avoid creating an unused LightEngine inside World
  const world = new World(false);
  const engine = new LightEngine(tables);

  // Populate world from regionColumns
  for (const [key, sectionArray] of Object.entries(regionColumns)) {
    const [ccxStr, cczStr] = key.split(',');
    const ccx = parseInt(ccxStr!, 10);
    const ccz = parseInt(cczStr!, 10);
    const col = world.getColumn(ccx, ccz, true)!;

    sectionArray.forEach((secData, sy) => {
      const sec = col.getOrCreateSection(sy);
      if (sec) {
        if (typeof secData === 'number') {
          sec.fill(secData);
        } else if (secData instanceof Uint16Array) {
          sec.loadBlockStatesFrom(secData);
        }
      }
    });
  }

  // Initialize column light sequentially across all columns in the region in a single LightEngine
  for (let cx = -radiusChunks; cx <= radiusChunks; cx++) {
    for (let cz = -radiusChunks; cz <= radiusChunks; cz++) {
      engine.initializeColumnLight(world, cx, cz);
    }
  }

  const sections: SectionLightTransfer[] = [];
  const transferables: Transferable[] = [];

  for (let cx = -radiusChunks; cx <= radiusChunks; cx++) {
    for (let cz = -radiusChunks; cz <= radiusChunks; cz++) {
      for (let sy = 0; sy < 20; sy++) {
        const raw = engine.storage.getRawData(cx, sy, cz);
        if (raw) {
          const lightData = new Uint8Array(raw);
          sections.push({ key: `${cx},${sy},${cz}`, lightData });
          transferables.push(lightData.buffer);
        }
      }
    }
  }

  ctx.postMessage({ id, sections } as LightRegionResponse, transferables);
};
