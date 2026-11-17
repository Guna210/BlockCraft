export interface ArenaRange {
  offset: number;
  length: number;
}

/** Byte ranges for a GPU buffer; allocation and free occur during streaming, not drawing. */
export class BufferArenaAllocator {
  private freeRanges: ArenaRange[];

  constructor(readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) throw new Error('Invalid arena capacity');
    this.freeRanges = [{ offset: 0, length: capacity }];
  }

  allocate(length: number, alignment = 4): ArenaRange | null {
    if (
      !Number.isSafeInteger(length) ||
      length <= 0 ||
      !Number.isSafeInteger(alignment) ||
      alignment <= 0
    )
      throw new Error('Invalid arena allocation');
    for (let i = 0; i < this.freeRanges.length; i++) {
      const free = this.freeRanges[i]!;
      const offset = Math.ceil(free.offset / alignment) * alignment;
      const end = offset + length;
      const freeEnd = free.offset + free.length;
      if (end > freeEnd) continue;
      const before = offset - free.offset;
      const after = freeEnd - end;
      if (before && after) {
        free.length = before;
        this.freeRanges.splice(i + 1, 0, { offset: end, length: after });
      } else if (before) free.length = before;
      else if (after) {
        free.offset = end;
        free.length = after;
      } else this.freeRanges.splice(i, 1);
      return { offset, length };
    }
    return null;
  }

  free(range: ArenaRange): void {
    const { offset, length } = range;
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length <= 0 ||
      offset + length > this.capacity
    )
      throw new Error('Invalid arena range');
    let index = 0;
    while (index < this.freeRanges.length && this.freeRanges[index]!.offset < offset) index++;
    const previous = this.freeRanges[index - 1];
    const next = this.freeRanges[index];
    if (
      (previous && previous.offset + previous.length > offset) ||
      (next && offset + length > next.offset)
    )
      throw new Error('Arena range overlaps free space');
    if (previous && previous.offset + previous.length === offset) {
      previous.length += length;
      if (next && previous.offset + previous.length === next.offset) {
        previous.length += next.length;
        this.freeRanges.splice(index, 1);
      }
    } else if (next && offset + length === next.offset) {
      next.offset = offset;
      next.length += length;
    } else this.freeRanges.splice(index, 0, { offset, length });
  }
}
