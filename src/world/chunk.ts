/**
 * ChunkSection represents a 16x16x16 block section within a chunk column.
 *
 * Palette Compression & Bit-Packing:
 * - Palette contains distinct block-state IDs (Uint16).
 * - Entry reference counts are tracked to allow palette compaction.
 * - Bit-width steps through:
 *   - 0 bits: Uniform section (1 entry, indices = null)
 *   - 1 bit: <= 2 palette entries (512 bytes indices)
 *   - 2 bits: <= 4 palette entries (1024 bytes indices)
 *   - 4 bits: <= 16 palette entries (2048 bytes indices)
 *   - 8 bits: <= 256 palette entries (4096 bytes indices)
 *   - 16 bits: > 256 palette entries (8192 bytes indices)
 *
 * Byte-Accounting Method for getByteSize():
 * Total Bytes = palette.byteLength + refCounts.byteLength + (indices ? indices.byteLength : 0) + OBJECT_OVERHEAD
 * where OBJECT_OVERHEAD = 32 bytes for JS class instance properties and header.
 * For an all-air or uniform section:
 * - palette (Uint16Array(1)): 2 bytes
 * - refCounts (Uint16Array(1)): 2 bytes
 * - indices: 0 bytes
 * - OBJECT_OVERHEAD: 32 bytes
 * Total: 36 bytes <= 64 bytes criterion.
 */

export class ChunkSection {
  public static readonly SECTION_SIZE = 16;
  public static readonly TOTAL_BLOCKS = 4096; // 16 * 16 * 16
  private static readonly OBJECT_OVERHEAD = 32;

  private palette: Uint16Array;
  private refCounts: Uint16Array;
  private indices: Uint8Array | Uint16Array | null = null;
  private bitsPerEntry: number = 0;

  constructor(initialStateId: number = 0) {
    this.palette = new Uint16Array([initialStateId]);
    this.refCounts = new Uint16Array([ChunkSection.TOTAL_BLOCKS]);
    this.bitsPerEntry = 0;
    this.indices = null;
  }

  public getBitsPerEntry(): number {
    return this.bitsPerEntry;
  }

  public getPaletteSize(): number {
    return this.palette.length;
  }

  public getPalette(): number[] {
    return Array.from(this.palette);
  }

  public getRefCount(paletteIdx: number): number {
    return this.refCounts[paletteIdx] ?? 0;
  }

  public getByteSize(): number {
    const paletteBytes = this.palette.byteLength;
    const refCountBytes = this.refCounts.byteLength;
    const indicesBytes = this.indices ? this.indices.byteLength : 0;
    return paletteBytes + refCountBytes + indicesBytes + ChunkSection.OBJECT_OVERHEAD;
  }

  public getBlockStateId(x: number, y: number, z: number): number {
    if (this.bitsPerEntry === 0 || !this.indices) {
      return this.palette[0]!;
    }

    const idx = (y << 8) | (z << 4) | x;
    let paletteIdx = 0;

    if (this.bitsPerEntry === 1) {
      const byteIdx = idx >> 3;
      const bitOffset = idx & 7;
      paletteIdx = ((this.indices as Uint8Array)[byteIdx]! >> bitOffset) & 1;
    } else if (this.bitsPerEntry === 2) {
      const byteIdx = idx >> 2;
      const bitOffset = (idx & 3) << 1;
      paletteIdx = ((this.indices as Uint8Array)[byteIdx]! >> bitOffset) & 3;
    } else if (this.bitsPerEntry === 4) {
      const byteIdx = idx >> 1;
      const bitOffset = (idx & 1) << 2;
      paletteIdx = ((this.indices as Uint8Array)[byteIdx]! >> bitOffset) & 15;
    } else if (this.bitsPerEntry === 8) {
      paletteIdx = (this.indices as Uint8Array)[idx]!;
    } else if (this.bitsPerEntry === 16) {
      paletteIdx = (this.indices as Uint16Array)[idx]!;
    }

    return this.palette[paletteIdx]!;
  }

  public setBlockStateId(x: number, y: number, z: number, newStateId: number): void {
    const idx = (y << 8) | (z << 4) | x;
    const oldStateId = this.getBlockStateId(x, y, z);

    if (oldStateId === newStateId) return;

    // Find or add palette index for newStateId
    let newPaletteIdx = -1;
    for (let i = 0; i < this.palette.length; i++) {
      if (this.palette[i] === newStateId) {
        newPaletteIdx = i;
        break;
      }
    }

    if (newPaletteIdx === -1) {
      // Need to add new entry to palette
      const newPaletteSize = this.palette.length + 1;
      const reqBits = this.calculateBitsPerEntry(newPaletteSize);

      if (reqBits > this.bitsPerEntry) {
        this.reallocateForBits(reqBits);
      }

      const oldPalette = this.palette;
      const oldRefCounts = this.refCounts;

      this.palette = new Uint16Array(newPaletteSize);
      this.refCounts = new Uint16Array(newPaletteSize);

      this.palette.set(oldPalette);
      this.refCounts.set(oldRefCounts);

      newPaletteIdx = newPaletteSize - 1;
      this.palette[newPaletteIdx] = newStateId;
      this.refCounts[newPaletteIdx] = 0;
    }

    // Get current palette index at (x,y,z)
    let oldPaletteIdx = 0;
    if (this.bitsPerEntry > 0 && this.indices) {
      if (this.bitsPerEntry === 1) {
        const byteIdx = idx >> 3;
        const bitOffset = idx & 7;
        oldPaletteIdx = ((this.indices as Uint8Array)[byteIdx]! >> bitOffset) & 1;
      } else if (this.bitsPerEntry === 2) {
        const byteIdx = idx >> 2;
        const bitOffset = (idx & 3) << 1;
        oldPaletteIdx = ((this.indices as Uint8Array)[byteIdx]! >> bitOffset) & 3;
      } else if (this.bitsPerEntry === 4) {
        const byteIdx = idx >> 1;
        const bitOffset = (idx & 1) << 2;
        oldPaletteIdx = ((this.indices as Uint8Array)[byteIdx]! >> bitOffset) & 15;
      } else if (this.bitsPerEntry === 8) {
        oldPaletteIdx = (this.indices as Uint8Array)[idx]!;
      } else if (this.bitsPerEntry === 16) {
        oldPaletteIdx = (this.indices as Uint16Array)[idx]!;
      }
    }

    // Write new palette index into indices buffer
    this.writeIndex(idx, newPaletteIdx);

    // Update reference counts
    const oldVal = this.refCounts[oldPaletteIdx] ?? 0;
    this.refCounts[oldPaletteIdx] = oldVal - 1;

    const newVal = this.refCounts[newPaletteIdx] ?? 0;
    this.refCounts[newPaletteIdx] = newVal + 1;

    // If old palette entry refCount reached 0, trigger palette compaction
    if (this.refCounts[oldPaletteIdx] === 0) {
      this.compactPalette();
    }
  }

  private writeIndex(blockIdx: number, paletteIdx: number): void {
    if (!this.indices) return;

    if (this.bitsPerEntry === 1) {
      const byteIdx = blockIdx >> 3;
      const bitOffset = blockIdx & 7;
      const arr = this.indices as Uint8Array;
      const cur = arr[byteIdx] ?? 0;
      arr[byteIdx] = (cur & ~(1 << bitOffset)) | ((paletteIdx & 1) << bitOffset);
    } else if (this.bitsPerEntry === 2) {
      const byteIdx = blockIdx >> 2;
      const bitOffset = (blockIdx & 3) << 1;
      const arr = this.indices as Uint8Array;
      const cur = arr[byteIdx] ?? 0;
      arr[byteIdx] = (cur & ~(3 << bitOffset)) | ((paletteIdx & 3) << bitOffset);
    } else if (this.bitsPerEntry === 4) {
      const byteIdx = blockIdx >> 1;
      const bitOffset = (blockIdx & 1) << 2;
      const arr = this.indices as Uint8Array;
      const cur = arr[byteIdx] ?? 0;
      arr[byteIdx] = (cur & ~(15 << bitOffset)) | ((paletteIdx & 15) << bitOffset);
    } else if (this.bitsPerEntry === 8) {
      (this.indices as Uint8Array)[blockIdx] = paletteIdx;
    } else if (this.bitsPerEntry === 16) {
      (this.indices as Uint16Array)[blockIdx] = paletteIdx;
    }
  }

  private calculateBitsPerEntry(paletteSize: number): number {
    if (paletteSize <= 1) return 0;
    if (paletteSize <= 2) return 1;
    if (paletteSize <= 4) return 2;
    if (paletteSize <= 16) return 4;
    if (paletteSize <= 256) return 8;
    return 16;
  }

  private reallocateForBits(newBits: number): void {
    if (newBits === this.bitsPerEntry) return;

    const oldBits = this.bitsPerEntry;
    const oldIndices = this.indices;

    this.bitsPerEntry = newBits;

    if (newBits === 0) {
      this.indices = null;
      return;
    }

    if (newBits === 1) {
      this.indices = new Uint8Array(512); // 4096 / 8
    } else if (newBits === 2) {
      this.indices = new Uint8Array(1024); // 4096 / 4
    } else if (newBits === 4) {
      this.indices = new Uint8Array(2048); // 4096 / 2
    } else if (newBits === 8) {
      this.indices = new Uint8Array(4096);
    } else if (newBits === 16) {
      this.indices = new Uint16Array(4096);
    }

    // Unpack old indices to new indices if oldIndices existed
    if (oldIndices) {
      for (let i = 0; i < ChunkSection.TOTAL_BLOCKS; i++) {
        let pIdx = 0;
        if (oldBits === 1) {
          const byteIdx = i >> 3;
          const bitOffset = i & 7;
          pIdx = ((oldIndices as Uint8Array)[byteIdx]! >> bitOffset) & 1;
        } else if (oldBits === 2) {
          const byteIdx = i >> 2;
          const bitOffset = (i & 3) << 1;
          pIdx = ((oldIndices as Uint8Array)[byteIdx]! >> bitOffset) & 3;
        } else if (oldBits === 4) {
          const byteIdx = i >> 1;
          const bitOffset = (i & 1) << 2;
          pIdx = ((oldIndices as Uint8Array)[byteIdx]! >> bitOffset) & 15;
        } else if (oldBits === 8) {
          pIdx = (oldIndices as Uint8Array)[i]!;
        } else if (oldBits === 16) {
          pIdx = (oldIndices as Uint16Array)[i]!;
        }

        this.writeIndex(i, pIdx);
      }
    } else if (oldBits === 0) {
      // All blocks had palette index 0
      // UintTypedArray is initialized to 0 by default, so nothing extra needed!
    }
  }

  private compactPalette(): void {
    // Count active palette entries
    let activeCount = 0;
    for (let i = 0; i < this.palette.length; i++) {
      if (this.refCounts[i]! > 0) {
        activeCount++;
      }
    }

    if (activeCount === this.palette.length) {
      return; // No unused entries to compact
    }

    const newPalette = new Uint16Array(activeCount);
    const newRefCounts = new Uint16Array(activeCount);
    const oldToNewMap = new Int32Array(this.palette.length);

    let newIdx = 0;
    for (let oldIdx = 0; oldIdx < this.palette.length; oldIdx++) {
      if (this.refCounts[oldIdx]! > 0) {
        newPalette[newIdx] = this.palette[oldIdx]!;
        newRefCounts[newIdx] = this.refCounts[oldIdx]!;
        oldToNewMap[oldIdx] = newIdx;
        newIdx++;
      } else {
        oldToNewMap[oldIdx] = -1;
      }
    }

    const reqBits = this.calculateBitsPerEntry(activeCount);
    const oldIndices = this.indices;
    const oldBits = this.bitsPerEntry;

    this.palette = newPalette;
    this.refCounts = newRefCounts;

    if (reqBits === 0) {
      this.bitsPerEntry = 0;
      this.indices = null;
      return;
    }

    // Allocate new indices buffer for reqBits
    this.bitsPerEntry = reqBits;
    if (reqBits === 1) {
      this.indices = new Uint8Array(512);
    } else if (reqBits === 2) {
      this.indices = new Uint8Array(1024);
    } else if (reqBits === 4) {
      this.indices = new Uint8Array(2048);
    } else if (reqBits === 8) {
      this.indices = new Uint8Array(4096);
    } else if (reqBits === 16) {
      this.indices = new Uint16Array(4096);
    }

    // Remap indices from old to new
    if (oldIndices) {
      for (let i = 0; i < ChunkSection.TOTAL_BLOCKS; i++) {
        let oldPIdx = 0;
        if (oldBits === 1) {
          const byteIdx = i >> 3;
          const bitOffset = i & 7;
          oldPIdx = ((oldIndices as Uint8Array)[byteIdx]! >> bitOffset) & 1;
        } else if (oldBits === 2) {
          const byteIdx = i >> 2;
          const bitOffset = (i & 3) << 1;
          oldPIdx = ((oldIndices as Uint8Array)[byteIdx]! >> bitOffset) & 3;
        } else if (oldBits === 4) {
          const byteIdx = i >> 1;
          const bitOffset = (i & 1) << 2;
          oldPIdx = ((oldIndices as Uint8Array)[byteIdx]! >> bitOffset) & 15;
        } else if (oldBits === 8) {
          oldPIdx = (oldIndices as Uint8Array)[i]!;
        } else if (oldBits === 16) {
          oldPIdx = (oldIndices as Uint16Array)[i]!;
        }

        const mappedNewIdx = oldToNewMap[oldPIdx]!;
        this.writeIndex(i, mappedNewIdx);
      }
    }
  }
}
