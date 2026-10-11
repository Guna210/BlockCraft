import { describe, expect, it } from 'vitest';
import { ChunkSection } from '../../src/world/chunk';
import {
  snapshotBlocks,
  snapshotBlockAt,
  buildSnapshotPadding,
  expandBlockColumns,
  blockSnapshotTransfers,
} from '../../src/world/block-snapshot';

describe('transferred compact block inputs', () => {
  it('preserves palette packing through every width and leaves live storage attached', () => {
    for (const count of [1, 2, 4, 16, 256, 300]) {
      const section = new ChunkSection();
      for (let i = 0; i < 4096; i++)
        section.setBlockStateId(i & 15, i >> 8, (i >> 4) & 15, i % count);
      const snapshot = snapshotBlocks(section);
      for (let i = 0; i < 4096; i++) expect(snapshotBlockAt(snapshot, i)).toBe(i % count);
      const transferred = structuredClone(snapshot, {
        transfer: blockSnapshotTransfers(snapshot) as ArrayBuffer[],
      });
      section.setBlockStateId(0, 0, 0, 999);
      expect(snapshotBlockAt(transferred, 0)).toBe(0);
      expect(section.getBlockStateId(0, 0, 0)).toBe(999);
    }
  });

  it('extracts all neighbour faces, edges and corners with the mesh axis order', () => {
    const sections = Array.from({ length: 27 }, (_, i) => i + 1);
    const padded = buildSnapshotPadding({ sy: 3, sections });
    for (let z = 0; z < 18; z++)
      for (let y = 0; y < 18; y++)
        for (let x = 0; x < 18; x++) {
          const axis = (v: number) => (v === 0 ? 0 : v === 17 ? 2 : 1);
          expect(padded[x + 18 * (y + 18 * z)]).toBe(
            sections[(axis(z) * 3 + axis(x)) * 3 + axis(y)],
          );
        }
    expect(buildSnapshotPadding({ sy: 0, sections })[0]).toBe(0);
    expect(buildSnapshotPadding({ sy: 19, sections })[18 * 17]).toBe(0);
  });

  it('expands the light rectangle in block-storage order inside the worker', () => {
    const section = new ChunkSection(2);
    section.setBlockStateId(7, 11, 13, 19);
    const columns = expandBlockColumns({ '3,-2': [0, snapshotBlocks(section), 5] });
    expect(columns['3,-2']![0]).toBe(0);
    expect(columns['3,-2']![2]).toBe(5);
    const dense = columns['3,-2']![1] as Uint16Array;
    expect(dense[(11 << 8) | (13 << 4) | 7]).toBe(19);
    expect(dense[0]).toBe(2);
  });
});
