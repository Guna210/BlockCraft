/**
 * ChunkSection represents a 16x16x16 block section within a chunk column.
 *
 * Uniform & Palette Storage:
 * - Uniform sections (bitsPerEntry === 0) store only `uniformStateId: number` (4 bytes).
 *   `palette`, `refCounts`, and `indices` are null until a write introduces a second state ID.
 * - Non-uniform sections allocate bit-packed index arrays and palette Uint16Arrays.
 * - Bit-width steps through:
 *   - 0 bits: Uniform section (palette, refCounts, indices = null)
 *   - 1 bit: <= 2 palette entries (512 bytes indices)
 *   - 2 bits: <= 4 palette entries (1024 bytes indices)
 *   - 4 bits: <= 16 palette entries (2048 bytes indices)
 *   - 8 bits: <= 256 palette entries (4096 bytes indices)
 *   - 16 bits: > 256 palette entries (8192 bytes indices)
 * - When compaction reduces the live palette entry count to 1, buffers are freed
 *   and the section returns to uniform (palette, refCounts, indices = null).
 *
 * Byte-Accounting Method for getByteSize():
 * Total Bytes = (palette ? palette.byteLength : 0) + (refCounts ? refCounts.byteLength : 0) + (indices ? indices.byteLength : 0)
 * For a uniform section (palette = null, refCounts = null, indices = null):
 * getByteSize() returns 4 bytes (for uniformStateId).
 */

export class ChunkSection {
  public static readonly SECTION_SIZE = 16;
  public static readonly TOTAL_BLOCKS = 4096; // 16 * 16 * 16

  public uniformStateId: number;
  public palette: Uint16Array | null = null;
  public refCounts: Uint16Array | null = null;
  public indices: Uint8Array | Uint16Array | null = null;
  private bitsPerEntry: number = 0;

  constructor(initialStateId: number = 0) {
    this.uniformStateId = initialStateId;
    this.palette = null;
    this.refCounts = null;
    this.indices = null;
    this.bitsPerEntry = 0;
  }

  public fill(stateId: number): void {
    this.uniformStateId = stateId;
    this.palette = null;
    this.refCounts = null;
    this.indices = null;
    this.bitsPerEntry = 0;
  }

  public getBitsPerEntry(): number {
    return this.bitsPerEntry;
  }

  public getPaletteSize(): number {
    return this.palette ? this.palette.length : 1;
  }

  public getPalette(): number[] {
    return this.palette ? Array.from(this.palette) : [this.uniformStateId];
  }

  public getRefCount(paletteIdx: number): number {
    if (!this.palette || !this.refCounts) {
      return paletteIdx === 0 ? ChunkSection.TOTAL_BLOCKS : 0;
    }
    return this.refCounts[paletteIdx] ?? 0;
  }

  public getByteSize(): number {
    if (!this.palette || !this.refCounts) {
      return 4; // Size of uniformStateId primitive
    }
    const paletteBytes = this.palette.byteLength;
    const refCountBytes = this.refCounts.byteLength;
    const indicesBytes = this.indices ? this.indices.byteLength : 0;
    return paletteBytes + refCountBytes + indicesBytes;
  }

  public getBlockStateId(x: number, y: number, z: number): number {
    if (this.bitsPerEntry === 0 || !this.indices || !this.palette) {
      return this.uniformStateId;
    }

    const idx = (y << 8) | (z << 4) | x;
    const paletteIdx = this.readIndex(idx);
    return this.palette[paletteIdx] ?? this.uniformStateId;
  }

  public setBlockStateId(x: number, y: number, z: number, newStateId: number): void {
    const idx = (y << 8) | (z << 4) | x;
    const oldStateId = this.getBlockStateId(x, y, z);

    if (oldStateId === newStateId) return;

    // If currently uniform (palette === null), transition to 2-entry palette
    if (this.palette === null) {
      this.palette = new Uint16Array([this.uniformStateId, newStateId]);
      this.refCounts = new Uint16Array([ChunkSection.TOTAL_BLOCKS - 1, 1]);
      this.reallocateForBits(1); // 2 entries -> 1 bit/entry
      this.writeIndex(idx, 1);
      return;
    }

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

      const oldPalette = this.palette!;
      const oldRefCounts = this.refCounts!;

      this.palette = new Uint16Array(newPaletteSize);
      this.refCounts = new Uint16Array(newPaletteSize);

      this.palette.set(oldPalette);
      this.refCounts.set(oldRefCounts);

      newPaletteIdx = newPaletteSize - 1;
      this.palette[newPaletteIdx] = newStateId;
      this.refCounts[newPaletteIdx] = 0;
    }

    // Get current palette index at (x,y,z)
    const oldPaletteIdx = this.readIndex(idx);

    // Write new palette index into indices buffer
    this.writeIndex(idx, newPaletteIdx);

    // Update reference counts
    if (this.refCounts) {
      const oldVal = this.refCounts[oldPaletteIdx] ?? 0;
      this.refCounts[oldPaletteIdx] = oldVal - 1;

      const newVal = this.refCounts[newPaletteIdx] ?? 0;
      this.refCounts[newPaletteIdx] = newVal + 1;

      // If old palette entry refCount reached 0, trigger palette compaction
      if (this.refCounts[oldPaletteIdx] === 0) {
        this.compactPalette();
      }
    }
  }

  private readIndex(blockIdx: number): number {
    if (!this.indices) return 0;

    if (this.bitsPerEntry === 1) {
      const byteIdx = blockIdx >> 3;
      const bitOffset = blockIdx & 7;
      return (((this.indices as Uint8Array)[byteIdx] ?? 0) >> bitOffset) & 1;
    } else if (this.bitsPerEntry === 2) {
      const byteIdx = blockIdx >> 2;
      const bitOffset = (blockIdx & 3) << 1;
      return (((this.indices as Uint8Array)[byteIdx] ?? 0) >> bitOffset) & 3;
    } else if (this.bitsPerEntry === 4) {
      const byteIdx = blockIdx >> 1;
      const bitOffset = (blockIdx & 1) << 2;
      return (((this.indices as Uint8Array)[byteIdx] ?? 0) >> bitOffset) & 15;
    } else if (this.bitsPerEntry === 8) {
      return (this.indices as Uint8Array)[blockIdx] ?? 0;
    } else if (this.bitsPerEntry === 16) {
      return (this.indices as Uint16Array)[blockIdx] ?? 0;
    }
    return 0;
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
    }
  }

  private compactPalette(): void {
    if (!this.palette || !this.refCounts) return;

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

    // If compacted down to 1 entry: return to uniform state!
    if (activeCount === 1) {
      this.uniformStateId = newPalette[0]!;
      this.palette = null;
      this.refCounts = null;
      this.indices = null;
      this.bitsPerEntry = 0;
      return;
    }

    const reqBits = this.calculateBitsPerEntry(activeCount);
    const oldIndices = this.indices;
    const oldBits = this.bitsPerEntry;

    this.palette = newPalette;
    this.refCounts = newRefCounts;

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
