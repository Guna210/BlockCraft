import { createDefaultPipeline } from '../gen/pipeline';
import { deriveSeed } from '../engine/rng';
import { withTerrainVariant } from '../gen/world-options';
import { STRUCTURE_REGISTRATIONS } from '../gen/structures/registrations';
import type { StructureMarker } from '../gen/structures/stage';
import { ChunkColumn } from '../world/column';
import type { PackedChunkStorage } from '../world/chunk';
import { BlockRegistry } from '../world/blocks/registry';
import type { WorldType } from '../gen/world-options';
import type { OverworldBiomeId } from '../gen/biomes';
const ctx: Worker = self as unknown as Worker;

// Ensure registry is loaded in worker
BlockRegistry.getInstance();
const pipelineWithStructures = createDefaultPipeline(STRUCTURE_REGISTRATIONS);
const pipelineWithoutStructures = createDefaultPipeline();

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
  type: WorldType;
  /** The biome of a Single Biome world. */
  biome?: OverworldBiomeId;
  structures?: boolean;
}

export interface SectionDataTransfer {
  sy: number;
  uniformStateId: number | null;
  states?: Uint16Array;
  packed?: PackedChunkStorage;
}

export interface GenWorkerResponse {
  id: number;
  cx: number;
  cz: number;
  sections: SectionDataTransfer[];
  biomes: Uint8Array;
  grassTints: Uint8Array;
  foliageTints: Uint8Array;
  /** Generated chests and spawners that need block entities (M19c). */
  markers: StructureMarker[];
  /** Worker wall time of the whole job: generation plus packaging the result for transfer. */
  columnMs: number;
  /** 16³ sections shipped to the main thread (every section that exists in the column). */
  sectionCount: number;
  /** columnMs / sectionCount */
  perSectionMs: number;
}

export function processGenMessage(event: MessageEvent): void {
  const { id, seed, cx, cz, type, biome, structures = true } = event.data as GenWorkerRequest;

  // The clock covers everything the worker spends on this column, packaging included
  const start = performance.now();
  const col = new ChunkColumn(cx, cz);
  const pipeline = structures ? pipelineWithStructures : pipelineWithoutStructures;

  if (type === 'flat') {
    generateFlatColumn(col);
    col.worldSeed = seed;
    const structureStage = pipeline.getStages().find((stage) => stage.name === 'structures');
    withTerrainVariant({ type, biome }, () =>
      structureStage?.generate(deriveSeed(seed, 'structures'), cx, cz, col),
    );
  } else {
    pipeline.generateColumn(seed, cx, cz, col, { type, biome });
  }
  const markers = pipeline.takeStructureMarkers(cx, cz);

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
      const packed: PackedChunkStorage = {
        uniformStateId: sec.uniformStateId,
        bits: sec.getBitsPerEntry(),
        palette: sec.palette!,
        refCounts: sec.refCounts!,
        indices: sec.indices!,
      };
      sections.push({ sy, uniformStateId: null, packed });
      transferables.push(packed.palette.buffer, packed.refCounts.buffer, packed.indices.buffer);
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

  const columnMs = performance.now() - start;
  const count = Math.max(1, activeSectionCount);

  ctx.postMessage(
    {
      id,
      cx,
      cz,
      sections,
      biomes,
      grassTints,
      foliageTints,
      markers,
      columnMs,
      sectionCount: count,
      perSectionMs: columnMs / count,
    } as GenWorkerResponse,
    transferables,
  );
}

ctx.onmessage = processGenMessage;

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
