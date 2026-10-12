import type { ChunkSection } from './chunk';
import type { World } from './world';
import type { LightColumns } from './batch-light';

export interface PackedBlockSection {
  bits: number;
  palette: Uint16Array;
  indices: Uint8Array | Uint16Array;
}
export type BlockSectionSnapshot = number | Uint16Array | PackedBlockSection;
export type BlockColumnsSnapshot = Record<string, BlockSectionSnapshot[]>;
export interface BlockPaddingInput {
  sy: number;
  sections: BlockSectionSnapshot[];
}

/** Copy only the compact storage buffers; decoding and voxel extraction belong to the worker. */
export function snapshotBlocks(section: ChunkSection | null | undefined): BlockSectionSnapshot {
  if (!section || !section.palette || !section.indices) return section?.uniformStateId ?? 0;
  return {
    bits: section.getBitsPerEntry(),
    palette: section.palette.slice(),
    indices: section.indices.slice(),
  };
}

export function blockSnapshotTransfers(section: BlockSectionSnapshot): Transferable[] {
  if (typeof section === 'number') return [];
  if (section instanceof Uint16Array) return [section.buffer];
  return [section.palette.buffer, section.indices.buffer];
}

export function snapshotBlockAt(section: BlockSectionSnapshot, index: number): number {
  if (typeof section === 'number') return section;
  if (section instanceof Uint16Array) return section[index]!;
  const { bits, indices, palette } = section;
  const paletteIndex =
    bits >= 8
      ? indices[index]!
      : (indices[Math.floor((index * bits) / 8)]! >>> ((index * bits) & 7)) & ((1 << bits) - 1);
  return palette[paletteIndex]!;
}

export function collectBlockPadding(
  world: World,
  cx: number,
  sy: number,
  cz: number,
): BlockPaddingInput {
  const sections: BlockSectionSnapshot[] = [];
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        sections.push(
          snapshotBlocks(world.getColumn(cx + dx, cz + dz, false)?.getSection(sy + dy)),
        );
  return { sy, sections };
}

export function buildSnapshotPadding(input: BlockPaddingInput): Uint16Array {
  const result = new Uint16Array(18 * 18 * 18);
  for (let z = 0; z < 18; z++) {
    const dz = z === 0 ? -1 : z === 17 ? 1 : 0;
    for (let y = 0; y < 18; y++) {
      const wy = input.sy * 16 + y - 1;
      if (wy < 0 || wy >= 320) continue;
      const dy = y === 0 ? -1 : y === 17 ? 1 : 0;
      const row = ((wy & 15) << 8) | (((z + 15) & 15) << 4);
      const out = 18 * (y + 18 * z);
      // Each row crosses only three section snapshots. Decode the centre span
      // with one storage-kind check rather than repeating it for every voxel.
      for (let dx = -1; dx <= 1; dx++) {
        const section = input.sections[((dz + 1) * 3 + dx + 1) * 3 + dy + 1]!;
        const start = dx === -1 ? 0 : dx === 0 ? 1 : 17;
        const end = dx === 0 ? 17 : start + 1;
        if (typeof section === 'number') {
          result.fill(section, out + start, out + end);
        } else if (section instanceof Uint16Array) {
          for (let x = start; x < end; x++) result[out + x] = section[row | ((x + 15) & 15)]!;
        } else {
          const { bits, indices, palette } = section;
          const mask = (1 << bits) - 1;
          if (bits >= 8) {
            for (let x = start; x < end; x++)
              result[out + x] = palette[indices[row | ((x + 15) & 15)]!]!;
          } else {
            for (let x = start; x < end; x++) {
              const bit = (row | ((x + 15) & 15)) * bits;
              result[out + x] = palette[(indices[bit >>> 3]! >>> (bit & 7)) & mask]!;
            }
          }
        }
      }
    }
  }
  return result;
}

/** The light rectangle's dense working arrays are created only after transfer to the worker. */
export function expandBlockColumns(columns: BlockColumnsSnapshot): LightColumns {
  const result: LightColumns = {};
  for (const [key, sections] of Object.entries(columns))
    result[key] = sections.map((section) => {
      if (typeof section === 'number' || section instanceof Uint16Array) return section;
      const dense = new Uint16Array(4096);
      for (let i = 0; i < dense.length; i++) dense[i] = snapshotBlockAt(section, i);
      return dense;
    });
  return result;
}
