import { ChunkSection } from '../world/chunk';
import { ChunkColumn } from '../world/column';
import { BlockRegistry } from '../world/blocks/registry';
import { OVERWORLD_BIOME_IDS } from '../gen/biomes';
import { deflate, inflate } from './compress';
import { FORMAT_VERSION, migrations } from './version';

export const COLUMN_MAGIC = 0x46434342; // 'BCCF' in Little-Endian (0x42, 0x43, 0x43, 0x46)
export const HEADER_SIZE = 271; // 4 magic + 2 version + 4 cx + 4 cz + 1 count + 256 biomes

export function calculateBitsPerEntry(paletteSize: number): number {
  if (paletteSize <= 1) return 0;
  if (paletteSize <= 2) return 1;
  if (paletteSize <= 4) return 2;
  if (paletteSize <= 16) return 4;
  if (paletteSize <= 256) return 8;
  return 16;
}

export function getIndicesByteLength(bitsPerEntry: number): number {
  if (bitsPerEntry === 1) return 512;
  if (bitsPerEntry === 2) return 1024;
  if (bitsPerEntry === 4) return 2048;
  if (bitsPerEntry === 8) return 4096;
  if (bitsPerEntry === 16) return 8192;
  return 0;
}

/**
 * Serializes a ChunkColumn to uncompressed binary format.
 * Format per section:
 * - paletteSize: uint16
 *   - 0: unallocated section (null)
 *   - 1: uniform section, followed by uniformStateId (uint16)
 *   - >1: palette of uint16 state IDs, followed by bit-packed indices array
 */
export function serializeColumnBinary(col: ChunkColumn): Uint8Array {
  // Pass 1: compute total byte size
  let totalSize = HEADER_SIZE;
  for (let sy = 0; sy < ChunkColumn.SECTION_COUNT; sy++) {
    const sec = col.getSection(sy);
    if (!sec) {
      totalSize += 2; // paletteSize = 0
    } else if (sec.getBitsPerEntry() === 0) {
      totalSize += 4; // paletteSize = 1 (2 bytes) + stateId (2 bytes)
    } else {
      const pSize = sec.palette!.length;
      const bits = sec.getBitsPerEntry();
      const indexBytes = getIndicesByteLength(bits);
      totalSize += 2 + pSize * 2 + indexBytes;
    }
  }

  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

  // Magic 'BCCF'
  out[0] = 0x42;
  out[1] = 0x43;
  out[2] = 0x43;
  out[3] = 0x46;

  // Format version
  view.setUint16(4, FORMAT_VERSION, true);

  // Column coordinates
  view.setInt32(6, col.cx, true);
  view.setInt32(10, col.cz, true);

  // Section count
  view.setUint8(14, ChunkColumn.SECTION_COUNT);

  // Biome indices (256 bytes)
  out.set(col.biomeIndices, 15);

  let offset = HEADER_SIZE;
  for (let sy = 0; sy < ChunkColumn.SECTION_COUNT; sy++) {
    const sec = col.getSection(sy);
    if (!sec) {
      view.setUint16(offset, 0, true);
      offset += 2;
    } else if (sec.getBitsPerEntry() === 0) {
      view.setUint16(offset, 1, true);
      view.setUint16(offset + 2, sec.uniformStateId, true);
      offset += 4;
    } else {
      const palette = sec.palette!;
      const pSize = palette.length;
      view.setUint16(offset, pSize, true);
      offset += 2;

      for (let i = 0; i < pSize; i++) {
        view.setUint16(offset, palette[i]!, true);
        offset += 2;
      }

      const bits = sec.getBitsPerEntry();
      const indexBytes = getIndicesByteLength(bits);
      if (bits === 16) {
        const uint16Indices = sec.indices as Uint16Array;
        for (let i = 0; i < 4096; i++) {
          view.setUint16(offset, uint16Indices[i]!, true);
          offset += 2;
        }
      } else {
        const uint8Indices = sec.indices as Uint8Array;
        out.set(uint8Indices.subarray(0, indexBytes), offset);
        offset += indexBytes;
      }
    }
  }

  return out;
}

export interface DeserializeColumnOptions {
  validateStateIds?: boolean;
  validateStateId?: (stateId: number) => boolean;
  targetVersion?: number;
}

/**
 * Deserializes a ChunkColumn from uncompressed binary format.
 */
export function deserializeColumnBinary(
  inputData: Uint8Array,
  options?: DeserializeColumnOptions,
): ChunkColumn {
  if (inputData.length < HEADER_SIZE) {
    throw new Error('Invalid column binary: data too short for header');
  }

  let data = inputData;
  let view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // Validate magic 'BCCF'
  if (data[0] !== 0x42 || data[1] !== 0x43 || data[2] !== 0x43 || data[3] !== 0x46) {
    throw new Error('Invalid column format magic bytes');
  }

  const version = view.getUint16(4, true);
  const targetVersion = options?.targetVersion ?? FORMAT_VERSION;

  if (version !== targetVersion) {
    data = migrations.migrate('column', data, version, targetVersion);
    view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  const cx = view.getInt32(6, true);
  const cz = view.getInt32(10, true);
  const sectionCount = view.getUint8(14);
  if (sectionCount !== ChunkColumn.SECTION_COUNT) {
    throw new Error(`Unsupported section count: ${sectionCount}`);
  }

  const col = new ChunkColumn(cx, cz);
  const biomeIndices = data.subarray(15, 271);
  col.setBiomeIndices(biomeIndices, OVERWORLD_BIOME_IDS);

  const validateStateIds = options?.validateStateIds ?? true;
  const stateValidator =
    options?.validateStateId ??
    ((id: number) => {
      return BlockRegistry.getInstance().getResolvedState(id) !== undefined;
    });

  const checkStateId = (id: number) => {
    if (validateStateIds && !stateValidator(id)) {
      throw new Error(`Unknown block state ID: ${id}`);
    }
  };

  let offset = HEADER_SIZE;
  for (let sy = 0; sy < sectionCount; sy++) {
    if (offset + 2 > data.length) {
      throw new Error(`Unexpected end of data reading section ${sy}`);
    }
    const paletteSize = view.getUint16(offset, true);
    offset += 2;

    if (paletteSize === 0) {
      // null section
      continue;
    } else if (paletteSize === 1) {
      if (offset + 2 > data.length) {
        throw new Error(`Unexpected end of data reading uniform section ${sy}`);
      }
      const stateId = view.getUint16(offset, true);
      offset += 2;
      checkStateId(stateId);
      const sec = col.getOrCreateSection(sy, stateId);
      sec?.fill(stateId);
    } else {
      if (offset + paletteSize * 2 > data.length) {
        throw new Error(`Unexpected end of data reading palette for section ${sy}`);
      }
      const palette = new Uint16Array(paletteSize);
      for (let i = 0; i < paletteSize; i++) {
        const stateId = view.getUint16(offset, true);
        offset += 2;
        checkStateId(stateId);
        palette[i] = stateId;
      }

      const bits = calculateBitsPerEntry(paletteSize);
      const indexBytes = getIndicesByteLength(bits);
      if (offset + indexBytes > data.length) {
        throw new Error(`Unexpected end of data reading indices for section ${sy}`);
      }

      let indices: Uint8Array | Uint16Array;
      if (bits === 16) {
        indices = new Uint16Array(4096);
        for (let i = 0; i < 4096; i++) {
          indices[i] = view.getUint16(offset, true);
          offset += 2;
        }
      } else {
        indices = new Uint8Array(indexBytes);
        indices.set(data.subarray(offset, offset + indexBytes));
        offset += indexBytes;
      }

      // Compute refCounts
      const refCounts = new Uint16Array(paletteSize);
      for (let i = 0; i < ChunkSection.TOTAL_BLOCKS; i++) {
        let pIdx = 0;
        if (bits === 1) {
          const byteIdx = i >> 3;
          const bitOffset = i & 7;
          pIdx = ((indices as Uint8Array)[byteIdx]! >> bitOffset) & 1;
        } else if (bits === 2) {
          const byteIdx = i >> 2;
          const bitOffset = (i & 3) << 1;
          pIdx = ((indices as Uint8Array)[byteIdx]! >> bitOffset) & 3;
        } else if (bits === 4) {
          const byteIdx = i >> 1;
          const bitOffset = (i & 1) << 2;
          pIdx = ((indices as Uint8Array)[byteIdx]! >> bitOffset) & 15;
        } else if (bits === 8) {
          pIdx = (indices as Uint8Array)[i]!;
        } else if (bits === 16) {
          pIdx = (indices as Uint16Array)[i]!;
        }
        if (pIdx < paletteSize) {
          refCounts[pIdx]!++;
        }
      }

      const sec = col.getOrCreateSection(sy);
      sec?.adoptPackedStorage({
        uniformStateId: palette[0]!,
        bits,
        palette,
        refCounts,
        indices,
      });
    }
  }

  return col;
}

/**
 * Serializes a ChunkColumn and deflates with CompressionStream.
 */
export async function serializeColumn(col: ChunkColumn): Promise<Uint8Array> {
  const binary = serializeColumnBinary(col);
  return deflate(binary);
}

/**
 * Inflates with DecompressionStream and deserializes a ChunkColumn.
 */
export async function deserializeColumn(
  data: Uint8Array,
  options?: DeserializeColumnOptions,
): Promise<ChunkColumn> {
  const inflated = await inflate(data);
  return deserializeColumnBinary(inflated, options);
}
