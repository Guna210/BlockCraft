import { createDefaultPipeline } from '../gen/pipeline';
import { ChunkColumn } from '../world/column';
import { BlockRegistry } from '../world/blocks/registry';
const ctx: Worker = self as unknown as Worker;

// Ensure registry is loaded in worker
BlockRegistry.getInstance();
const pipeline = createDefaultPipeline();

const OVERWORLD_BIOME_IDS = [
  'plains',
  'meadow',
  'oakwood_forest',
  'birch_grove',
  'pine_taiga',
  'snowy_tundra',
  'frost_peaks',
  'stony_heights',
  'desert',
  'badlands',
  'savanna',
  'swampland',
  'rainforest',
  'beach',
  'stony_shore',
  'river',
  'ocean',
  'deep_ocean',
  'frozen_ocean',
] as const;

const biomeIndexMap = new Map<string, number>();
OVERWORLD_BIOME_IDS.forEach((id, idx) => biomeIndexMap.set(id, idx));

export interface GenWorkerRequest {
  id: number;
  seed: number;
  cx: number;
  cz: number;
  type: 'default' | 'flat';
}

export interface SectionDataTransfer {
  sy: number;
  uniformStateId: number | null;
  states?: Uint16Array;
}

export interface GenWorkerResponse {
  id: number;
  cx: number;
  cz: number;
  sections: SectionDataTransfer[];
  biomes: Uint8Array;
  grassTints: Uint8Array;
  foliageTints: Uint8Array;
  perSectionMs: number;
}

ctx.onmessage = (event: MessageEvent) => {
  const { id, seed, cx, cz, type } = event.data as GenWorkerRequest;

  const start = performance.now();
  const col = new ChunkColumn(cx, cz);

  if (type === 'flat') {
    generateFlatColumn(col);
  } else {
    pipeline.generateColumn(seed, cx, cz, col);
  }

  const duration = performance.now() - start;

  const sections: SectionDataTransfer[] = [];
  const transferables: Transferable[] = [];
  let activeSectionCount = 0;

  for (let sy = 0; sy < 20; sy++) {
    const sec = col.getSection(sy);
    if (!sec) continue;
    activeSectionCount++;

    if (sec.getBitsPerEntry() === 0) {
      sections.push({
        sy,
        uniformStateId: sec.uniformStateId,
      });
    } else {
      const states = new Uint16Array(4096);
      sec.copyBlockStatesTo(states);
      sections.push({
        sy,
        uniformStateId: null,
        states,
      });
      transferables.push(states.buffer);
    }
  }

  // Convert biome names to Uint8Array indices (256)
  const biomes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const bName = col.biomes[i] || 'plains';
    biomes[i] = biomeIndexMap.get(bName) ?? 0;
  }

  // Transferable biome and tint buffers
  const grassTints = new Uint8Array(col.grassTints);
  const foliageTints = new Uint8Array(col.foliageTints);

  transferables.push(biomes.buffer, grassTints.buffer, foliageTints.buffer);

  const count = Math.max(1, activeSectionCount);
  const perSectionMs = duration / count;

  ctx.postMessage(
    {
      id,
      cx,
      cz,
      sections,
      biomes,
      grassTints,
      foliageTints,
      perSectionMs,
    } as GenWorkerResponse,
    transferables,
  );
};

function generateFlatColumn(col: ChunkColumn): void {
  const registry = BlockRegistry.getInstance();
  const stoneState = registry.getDefaultStateId('stone') ?? 1;
  const dirtState = registry.getDefaultStateId('dirt') ?? 1;
  const grassState = registry.getDefaultStateId('grass_block') ?? 1;

  for (let sy = 0; sy < 3; sy++) {
    const sec = col.getOrCreateSection(sy);
    if (sec) sec.fill(stoneState);
  }

  const sec3 = col.getOrCreateSection(3);
  if (sec3) {
    for (let yLocal = 0; yLocal <= 12; yLocal++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) sec3.setBlockStateId(x, yLocal, z, stoneState);
      }
    }
    for (let yLocal = 13; yLocal <= 15; yLocal++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) sec3.setBlockStateId(x, yLocal, z, dirtState);
      }
    }
  }

  const sec4 = col.getOrCreateSection(4);
  if (sec4) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) sec4.setBlockStateId(x, 0, z, grassState);
    }
  }
}
