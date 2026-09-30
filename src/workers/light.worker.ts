import { LightEngine, buildLightLookupTables } from '../world/lighting';
import { World } from '../world/world';
import { BlockRegistry } from '../world/blocks/registry';

const ctx: Worker = self as unknown as Worker;

// Ensure registry loaded in worker
BlockRegistry.getInstance();
const tables = buildLightLookupTables(BlockRegistry.getInstance());

export interface LightWorkerRequest {
  id: number;
  cx: number;
  cz: number;
  // Sections block data transferred as 20 Uint16Arrays (4096 entries each)
  columnsData: Map<string, (Uint16Array | number)[]>;
}

export interface SectionLightTransfer {
  sy: number;
  lightData: Uint8Array; // 4096 bytes: high nibble sky, low nibble block
}

export interface LightWorkerResponse {
  id: number;
  cx: number;
  cz: number;
  sections: SectionLightTransfer[];
}

ctx.onmessage = (event: MessageEvent) => {
  const { id, cx, cz, columnsData } = event.data as {
    id: number;
    cx: number;
    cz: number;
    columnsData: Record<string, (Uint16Array | number)[]>;
  };

  const world = new World();
  const engine = new LightEngine(tables);

  // Populate world from columnsData
  for (const [key, sectionArray] of Object.entries(columnsData)) {
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

  // Run light initialization over central column
  engine.initializeColumnLight(world, cx, cz);

  const sections: SectionLightTransfer[] = [];
  const transferables: Transferable[] = [];

  for (let sy = 0; sy < 20; sy++) {
    const raw = engine.storage.getRawData(cx, sy, cz);
    if (raw) {
      const lightData = new Uint8Array(raw);
      sections.push({ sy, lightData });
      transferables.push(lightData.buffer);
    }
  }

  ctx.postMessage({ id, cx, cz, sections } as LightWorkerResponse, transferables);
};
